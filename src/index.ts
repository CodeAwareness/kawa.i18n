#!/usr/bin/env node

/**
 * Kawa i18n Extension
 *
 * Internationalization service for Kawa Code that translates code identifiers
 * between languages while preserving TypeScript semantics and IDE support.
 */

import { createHash } from 'crypto';
import { registerHandler, startListening, addResponseInterceptor, setRequestStream } from './ipc/handlers';
import { log, sendProgress, sendBroadcast, setResponseStream, setTransport } from './ipc/protocol';
import { connectToMuninn, getDefaultMuninnSocketPath } from './ipc/muninn-socket';
import { CircularStreamBuffer } from './ipc/stream-buffer';
import {
  startDirectServer,
  registerDirectHandler,
  handleMuninnResponse,
  getLanguage,
  setLanguage,
  getOriginForPath
} from './ipc/server';
import { Translator } from './core/translator';
import { UnifiedTranslator } from './core/unifiedTranslator';
import { DictionaryManager } from './dictionary/manager';
import { IdentifierExtractor } from './core/identifierExtractor';
import { CommentExtractor } from './core/commentExtractor';
import { MarkdownExtractor } from './core/markdownExtractor';
import { IPCMessage } from './ipc/protocol';
import { LanguageCode, TranslationScope } from './core/types';
import {
  translateIdentifiers as localTranslateIdentifiers,
  translateComments as localTranslateComments,
  translateProject as localTranslateProject,
} from './claude';
import type { TranslationProgressCallback } from './claude';
import { setAuthState } from './auth/store';
import {
  handleGetIntentsForFile,
  handleGetIntentsForLines,
  handleNormalizeIntent,
  handleTranslateIntentMetadata,
  handleDetectLanguage,
  handleDirectGetIntentsForFile,
  handleDirectGetIntentsForLines,
  handleGetBlockContentTranslated,
  handleDirectGetBlockContentTranslated,
} from './intent/handlers';
import { getTranslationScope, setTranslationScope } from './config/settings';

const EXTENSION_ID = 'i18n';
const VERSION = '1.0.0';

// Initialize dictionary manager and extractors
const dictionaryManager = new DictionaryManager();
const identifierExtractor = new IdentifierExtractor();
const commentExtractor = new CommentExtractor();
const markdownExtractor = new MarkdownExtractor();

/**
 * Cache for pending translation confirmations
 * Stores scan data for large projects awaiting user confirmation
 */
interface PendingTranslation {
  origin: string;
  targetLang: LanguageCode;
  workspaceRoot: string;
  identifiers: string[];
  comments: string[];
  stats: {
    files: number;
    terms: number;
    comments: number;
    estimatedTokens: number;
    estimatedSeconds: number;
  };
  createdAt: number;
}

const pendingTranslations = new Map<string, PendingTranslation>();

// Clean up old pending translations after 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, pending] of pendingTranslations) {
    if (now - pending.createdAt > 10 * 60 * 1000) {
      pendingTranslations.delete(key);
      log(`[i18n] Expired pending translation for ${key}`);
    }
  }
}, 60 * 1000);

/**
 * Simple LRU Cache for translation results
 *
 * Cache key: SHA256(code) + source_lang + target_lang
 * Max entries: 100
 * On-demand only (no prefetching)
 */
class TranslationCache {
  private cache: Map<string, { result: any; timestamp: number }>;
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Generate cache key from code content, language pair, and scope
   */
  private getCacheKey(code: string, sourceLang: string, targetLang: string, scope?: TranslationScope): string {
    const hash = createHash('sha256').update(code).digest('hex');
    const scopeKey = scope
      ? `${+scope.comments}${+scope.stringLiterals}${+scope.identifiers}${+scope.keywords}`
      : 'default';
    return `${hash}:${sourceLang}:${targetLang}:${scopeKey}`;
  }

  /**
   * Get cached translation result
   */
  get(code: string, sourceLang: string, targetLang: string, scope?: TranslationScope): any | null {
    const key = this.getCacheKey(code, sourceLang, targetLang, scope);
    const entry = this.cache.get(key);

    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);

      log(`[i18n] Cache HIT: ${key.substring(0, 16)}...`);
      return entry.result;
    }

    log(`[i18n] Cache MISS: ${key.substring(0, 16)}...`);
    return null;
  }

  /**
   * Store translation result in cache
   */
  set(code: string, sourceLang: string, targetLang: string, result: any, scope?: TranslationScope): void {
    const key = this.getCacheKey(code, sourceLang, targetLang, scope);

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        log(`[i18n] Cache evicted: ${firstKey.substring(0, 16)}...`);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    log(`[i18n] Cache stored: ${key.substring(0, 16)}... (total: ${this.cache.size}/${this.maxSize})`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  /**
   * Clear all cached translations
   * Called when user changes language to avoid stale translations
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    log(`[i18n] Cache cleared (was ${size} entries)`);
  }
}

// Initialize translation cache
const translationCache = new TranslationCache(100);

/**
 * Handle translate-code request (UNIFIED VERSION)
 *
 * Translates code between any language pair uniformly.
 * No special-casing for English - all languages are treated equally.
 * Uses MultiLangDictionary and UnifiedTranslator for consistent behavior.
 *
 * NOTE: Expects 'origin' to be added by Muninn before routing to this extension
 */
async function handleTranslateCode(message: IPCMessage): Promise<any> {
  const { code, filePath, targetLang, origin, sourceLang: providedSourceLang, translationScope } = message.data;
  const taskId = `translate-${targetLang}-${Date.now()}`;
  const startTime = Date.now();

  // Translation scope is REQUIRED - must be sent by the caller
  if (!translationScope) {
    const errorMsg = 'Missing translationScope in translate-code request. Please configure translation scope in Settings.';
    log(`[TranslateCode] ERROR: ${errorMsg}`);
    sendBroadcast('muninn', 'notification', {
      severity: 'error',
      summary: 'Translation Scope Missing',
      detail: 'translate-code request is missing translationScope. The code viewer must send the user\'s scope settings.',
      life: 8000,
    });
    throw new Error(errorMsg);
  }
  const scope: TranslationScope = translationScope as TranslationScope;

  try {
    log(`[TIMING] Translation started for ${filePath} -> ${targetLang} (scope: c=${+scope.comments} s=${+scope.stringLiterals} i=${+scope.identifiers} k=${+scope.keywords} md=${+scope.markdownFiles})`);

    if (!origin) {
      throw new Error('Missing origin - Muninn should add origin before routing to i18n extension');
    }

    // Step 1: Use provided source language or default to English
    // Files on disk are always English by convention, so 'en' is the safe default
    const sourceLang: LanguageCode = providedSourceLang && providedSourceLang !== 'auto'
      ? providedSourceLang as LanguageCode
      : 'en';
    log(`Source language: ${sourceLang} (provided: ${providedSourceLang || 'none'})`);

    // Check cache first (scope-aware)
    const cachedResult = translationCache.get(code, sourceLang, targetLang, scope);
    if (cachedResult) {
      log(`[TIMING] Cache hit! Returning cached translation`);
      return { ...cachedResult, cached: true };
    }

    // Step 2: Load dictionary (MultiLangDictionary handles which language file to load)
    const dictStartTime = Date.now();
    const { dictionary, existsOnAPI } = await dictionaryManager.loadMultiLang(
      origin,
      sourceLang,
      targetLang as LanguageCode
    );
    log(`[TIMING] Dictionary loaded in ${Date.now() - dictStartTime}ms, terms: ${dictionary.getTermCount()}`);

    // Step 3: Handle empty dictionary - trigger project scan if needed
    if (dictionary.getTermCount() === 0 && !existsOnAPI && sourceLang === 'en') {
      return await triggerProjectScan(message, origin, targetLang, filePath);
    }

    // NOTE: We do NOT translate new terms on a per-file basis.
    // This would cause inconsistent translations across files.
    // New terms require a full project scan to ensure consistency.
    // The dictionary should already contain all terms from a prior project scan.

    // Use the loaded dictionary directly for translation
    const translator = new UnifiedTranslator(dictionary);

    const translateStartTime = Date.now();
    const result = translator.translate(code, sourceLang, targetLang as LanguageCode, scope);
    log(`[TIMING] Code translated in ${Date.now() - translateStartTime}ms, tokens: ${result.translatedTokens.length}`);

    // NOTE: No progress popup here - this is just applying cached dictionary translations,
    // not actual Claude SDK translation. Popups are shown only when new terms are translated
    // via Claude (in handleScanProject, handleFileSaved, etc.)

    const totalTime = Date.now() - startTime;
    log(`[TIMING] Total translation time: ${totalTime}ms`);

    // Cache result (scope-aware)
    const translationResult = {
      success: true,
      code: result.code,
      translatedTokens: result.translatedTokens,
      unmappedTokens: result.unmappedTokens,
    };
    translationCache.set(code, sourceLang, targetLang, translationResult, scope);

    return translationResult;
  } catch (error: any) {
    log(`Translation error: ${error.message}`);
    sendProgress(taskId, 'Code Translation', 'error', {
      status: 'error',
      error: error.message || 'Translation failed',
      autoClose: false,
    });
    throw error;
  }
}

/**
 * Trigger full project scan for empty dictionary
 */
async function triggerProjectScan(
  message: IPCMessage,
  origin: string,
  targetLang: string,
  filePath: string
): Promise<any> {
  const path = await import('path');
  const fs = await import('fs');

  // Use projectRoot from the message if available (authoritative source)
  // Only fall back to walking up from filePath if projectRoot is missing AND filePath is absolute
  let workspaceRoot = message.data?.projectRoot;
  if (!workspaceRoot) {
    if (!path.isAbsolute(filePath)) {
      log(`[ERROR] Cannot determine workspace root: filePath is relative (${filePath}) and no projectRoot in message`);
      throw new Error('Cannot determine project root: relative file path without projectRoot');
    }
    workspaceRoot = path.dirname(filePath);
    while (workspaceRoot !== path.dirname(workspaceRoot)) {
      if (fs.existsSync(path.join(workspaceRoot, 'package.json')) ||
          fs.existsSync(path.join(workspaceRoot, '.git'))) {
        break;
      }
      workspaceRoot = path.dirname(workspaceRoot);
    }
  }

  log(`Empty dictionary, triggering project scan at: ${workspaceRoot}`);

  sendBroadcast('muninn', 'notification', {
    severity: 'info',
    summary: 'Scanning Project',
    detail: 'Analyzing all source files for translation. This may take a moment...',
    life: 5000
  });

  handleScanProject({
    flow: 'req',
    domain: 'i18n',
    action: 'scan-project',
    caw: message.caw,
    data: { origin, targetLang, workspaceRoot }
  } as IPCMessage).catch((error: any) => {
    log(`[ERROR] Background project scan failed: ${error.message}`);
    sendBroadcast('muninn', 'notification', {
      severity: 'error',
      summary: 'Project Scan Failed',
      detail: error.message || 'Failed to scan project for translation',
      life: 8000
    });
  });

  return {
    success: false,
    translating: true,
    message: 'Project scan in progress. Please wait for completion notification, then re-open the file.',
  };
}

/**
 * Translate new terms locally via Claude CLI and store in dictionary
 *
 * Uses local translation to maintain zero-knowledge privacy model.
 * The dictionary stores { englishTerm: foreignTerm }. We need to flip
 * the key-value pairs when storing non-English source terms.
 */
async function translateNewTerms(
  origin: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  terms: string[],
  _code: string,
  _filePath: string
): Promise<void> {
  try {
    // Determine which language dictionary to update
    const dictLang = sourceLang === 'en' ? targetLang : sourceLang;

    // Use local translation via Claude CLI
    const translations = await localTranslateIdentifiers(terms, sourceLang, targetLang);

    const translatedCount = Object.keys(translations).length;
    log(`Successfully translated ${translatedCount} new terms locally`);

    // Dictionary stores { englishTerm: foreignTerm }
    // When source is non-English (e.g., JA), we need to flip:
    //   Local: { "信五系列": "shingoSeries" }
    //   Dict: { "shingoSeries": "信五系列" }
    let termsToStore: Record<string, string>;

    if (sourceLang === 'en') {
      // EN→JA: translations are { english: foreign }, dictionary stores same format
      termsToStore = translations;
    } else {
      // JA→EN: translations are { foreign: english }, need to flip for dictionary
      termsToStore = {};
      for (const [foreignTerm, englishTerm] of Object.entries(translations)) {
        termsToStore[englishTerm] = foreignTerm;
      }
    }

    dictionaryManager.addTerms(origin, dictLang, termsToStore);
    log(`Stored terms in dictionary: ${JSON.stringify(termsToStore)}`);
  } catch (error: any) {
    log(`Warning: Failed to translate new terms locally: ${error.message}`);
    sendBroadcast('muninn', 'notification', {
      severity: 'warn',
      summary: 'Translation Incomplete',
      detail: `Could not translate ${terms.length} new term(s). They may remain untranslated.`,
      life: 5000
    });
  }
}

/**
 * Translate new comments locally via Claude CLI
 */
async function translateNewComments(
  origin: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  comments: string[],
  _filePath: string
): Promise<void> {
  try {
    const translations = await localTranslateComments(comments, sourceLang, targetLang);
    const translatedCount = Object.keys(translations).length;
    log(`Successfully translated ${translatedCount} new comments locally`);

    // Store translated comments in dictionary
    // Dictionary stores comments as { hash: { en: string, [lang]: string } }
    // For now, we just log success - full comment storage would require DictionaryManager updates
  } catch (error: any) {
    log(`Warning: Failed to translate new comments locally: ${error.message}`);
  }
}

/**
 * Translate project in background using local Claude CLI (fire and forget)
 */
async function translateProjectInBackground(taskId: string, origin: string, targetLang: LanguageCode, identifierNames: string[], comments: string[], _context: string): Promise<void> {
  try {
    log(`Background translation started for ${origin} (${targetLang}) - using local Claude CLI`);

    // Send progress update
    sendProgress(taskId, 'Project Translation', 'progress', {
      status: 'processing',
      statusMessage: 'Translating terms locally via Claude CLI...',
    });

    // Use local translation via Claude CLI
    const onTranslationProgress: TranslationProgressCallback = (info) => {
      const label = info.type === 'identifiers' ? 'terms' : info.type;
      if (info.status === 'retrying') {
        sendProgress(taskId, 'Project Translation', 'progress', {
          status: 'retrying',
          statusMessage: `Retrying ${label} batch ${info.batchNum}/${info.totalBatches} (attempt ${info.retryAttempt}/${info.maxRetries})...`,
        });
      } else if (info.status === 'processing') {
        const totalItems = identifierNames.length + comments.length;
        const itemsDone = info.type === 'identifiers'
          ? (info.batchNum - 1) * info.batchSize
          : identifierNames.length + (info.batchNum - 1) * info.batchSize;
        const progress = Math.floor((itemsDone / totalItems) * 100);
        sendProgress(taskId, 'Project Translation', 'progress', {
          status: 'processing',
          statusMessage: `Translating ${label} batch ${info.batchNum}/${info.totalBatches} (${info.batchSize} items)...`,
          progress,
        });
      }
    };

    const translateResult = await localTranslateProject(
      identifierNames,
      comments,
      'en', // Source is always English for project scan
      targetLang,
      onTranslationProgress
    );

    log(`Local translation complete: ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments`);

    // Send progress update
    sendProgress(taskId, 'Project Translation', 'progress', {
      status: 'downloading',
      statusMessage: 'Saving dictionary...',
    });

    // Create dictionary from translation results
    const { apiToLocalDictionary } = await import('./api/client');
    const newDictionary = apiToLocalDictionary({
      origin,
      language: targetLang,
      terms: translateResult.terms,
      comments: translateResult.comments,
      totalTerms: translateResult.totalTerms,
      totalComments: translateResult.totalComments,
      batchCount: 1,
    });

    // Save dictionary to cache (use module-level manager so memory cache stays in sync)
    dictionaryManager.import(JSON.stringify(newDictionary));

    // Clear translation cache so stale results aren't served
    translationCache.clear();

    log(`Background translation fully complete: dictionary saved with ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments`);

    // Send progress complete (this closes the progress indicator)
    sendProgress(taskId, 'Project Translation', 'complete', {
      status: 'complete',
      statusMessage: `Translated ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments`,
      autoClose: true,
      autoCloseDelay: 3000,
    });

    // Show success notification AFTER everything is done
    sendBroadcast('muninn', 'notification', {
      severity: 'success',
      summary: 'Project Translation Complete',
      detail: `Translated ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments. You can now change the language in your editor to see the translated code.`,
      life: 8000
    });
  } catch (error: any) {
    log(`Background translation failed: ${error.message}`);

    // Send progress error
    sendProgress(taskId, 'Project Translation', 'error', {
      status: 'error',
      error: error.message || 'Translation failed',
      autoClose: false,
    });

    // Show error notification
    sendBroadcast('muninn', 'notification', {
      severity: 'error',
      summary: 'Translation Failed',
      detail: error.message || 'Failed to translate project',
      life: 8000
    });
  }
}

/**
 * Check if a string contains non-English characters
 * Used to identify identifiers that need translation to/from English
 */
function isNonEnglish(str: string): boolean {
  // Non-ASCII characters indicate non-English text
  // This includes Japanese, Chinese, Korean, Arabic, Cyrillic, etc.
  return /[^\x00-\x7F]/.test(str);
}

/**
 * Detect new terms in code that need translation
 * Works uniformly for any source language
 */
function detectNewTerms(
  identifiers: string[],
  sourceLang: LanguageCode,
  dictionary: { hasTerm: (term: string) => boolean }
): string[] {
  return identifiers.filter(name => {
    // Skip if term is already in dictionary
    if (dictionary.hasTerm(name)) return false;

    // Include terms that match the source language:
    // - If source is English: include ASCII-only terms
    // - If source is non-English: include non-ASCII terms
    const termIsNonEnglish = isNonEnglish(name);
    return sourceLang === 'en' ? !termIsNonEnglish : termIsNonEnglish;
  });
}

/**
 * Handle load-dictionary request
 * Loads or creates a dictionary for a repository
 */
async function handleLoadDictionary(message: IPCMessage): Promise<any> {
  const { origin, language } = message.data;

  try {
    log(`Loading dictionary: ${origin} (${language})`);

    // Load or create dictionary (try API first)
    const { dictionary, existsOnAPI } = await dictionaryManager.loadOrCreate(origin, language as LanguageCode);
    const termCount = Object.keys(dictionary.terms).length;

    return {
      success: true,
      created: termCount === 0,
      existsOnAPI,
      termCount,
      metadata: dictionary.metadata,
    };
  } catch (error: any) {
    log(`Load dictionary error: ${error.message}`);
    throw error;
  }
}

/**
 * Handle add-terms request
 * Adds new terms to a dictionary
 */
async function handleAddTerms(message: IPCMessage): Promise<any> {
  const { origin, language, terms } = message.data;

  try {
    log(`Adding ${Object.keys(terms).length} terms to ${origin} (${language})`);

    // Add terms to dictionary (creates if not exists)
    const dictionary = dictionaryManager.exists(origin, language as LanguageCode)
      ? dictionaryManager.addTerms(origin, language as LanguageCode, terms)
      : dictionaryManager.create(origin, language as LanguageCode, terms);

    return {
      success: true,
      totalTerms: Object.keys(dictionary.terms).length,
      addedTerms: Object.keys(terms).length,
      metadata: dictionary.metadata,
    };
  } catch (error: any) {
    log(`Add terms error: ${error.message}`);
    throw error;
  }
}

/**
 * Handle list-dictionaries request
 * Lists all cached dictionaries
 */
async function handleListDictionaries(message: IPCMessage): Promise<any> {
  try {
    const dictionaries = dictionaryManager.listAll();
    return {
      success: true,
      dictionaries,
    };
  } catch (error: any) {
    log(`List dictionaries error: ${error.message}`);
    throw error;
  }
}

/**
 * Handle extract-identifiers request
 * Extracts all identifiers from source code
 */
async function handleExtractIdentifiers(message: IPCMessage): Promise<any> {
  const { code, filePath } = message.data;

  try {
    log(`Extracting identifiers from ${filePath || 'code'}`);

    const identifiers = identifierExtractor.extract(code, filePath);
    const names = identifiers.map(id => id.name);

    return {
      success: true,
      identifiers,
      names,
      count: names.length,
    };
  } catch (error: any) {
    log(`Extract identifiers error: ${error.message}`);
    throw error;
  }
}


/**
 * Handle scan-project request
 * VSCode sends only workspace root - i18n does ALL the work:
 * - Scan for source files
 * - Read .gitignore
 * - Extract identifiers from all files
 * - Translate via API
 * - Save dictionary
 */
async function handleScanProject(message: IPCMessage): Promise<any> {
  const { origin, targetLang, workspaceRoot } = message.data;
  const taskId = `scan-project-${targetLang}-${Date.now()}`;

  try {
    log(`Scanning project at ${workspaceRoot} for ${origin} -> ${targetLang}`);

    // Load translation scope settings to check if markdown is enabled
    const translationScope = getTranslationScope();
    const includeMarkdown = translationScope.markdownFiles;
    log(`[ScanProject] Markdown translation: ${includeMarkdown ? 'enabled' : 'disabled'}`);

    // Send progress: started
    sendProgress(taskId, 'Project Scan', 'started', {
      status: 'scanning',
      statusMessage: 'Finding source files...',
    });

    // Find all source files in workspace
    const fs = await import('fs');
    const path = await import('path');
    const files: string[] = [];
    const markdownFiles: string[] = [];

    // Supported extensions for code files
    const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.rs'];

    // Recursively find files
    function walkDir(dir: string, depth: number = 0) {
      // Max depth to prevent infinite loops
      if (depth > 10) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip common directories
          if (entry.isDirectory()) {
            // Skip node_modules, .git, dist, build, etc.
            if (['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache'].includes(entry.name)) {
              continue;
            }
            walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (codeExtensions.includes(ext)) {
              files.push(fullPath);
            } else if (includeMarkdown && ext === '.md') {
              markdownFiles.push(fullPath);
            }
          }
        }
      } catch (error: any) {
        log(`Failed to read directory ${dir}: ${error.message}`);
      }
    }

    walkDir(workspaceRoot);

    log(`Found ${files.length} source files${includeMarkdown ? ` and ${markdownFiles.length} markdown files` : ''}`);

    const totalFilesToScan = files.length + markdownFiles.length;
    if (totalFilesToScan === 0) {
      sendProgress(taskId, 'Project Scan', 'complete', {
        status: 'complete',
        statusMessage: 'No source files found',
        autoClose: true,
        autoCloseDelay: 3000,
      });

      return {
        success: true,
        message: 'No source files found',
      };
    }

    // Update progress - always scan to get counts
    const fileCountMsg = includeMarkdown && markdownFiles.length > 0
      ? `${files.length} code + ${markdownFiles.length} markdown`
      : `${files.length}`;
    sendProgress(taskId, 'Project Scan', 'progress', {
      status: 'scanning',
      statusMessage: `Extracting content from ${fileCountMsg} files...`,
    });

    // Extract identifiers and comments from all code files
    const identifierSet = new Set<string>(); // For deduplication
    const allComments: string[] = [];
    const allMarkdownTexts: string[] = []; // Markdown content (treated like comments)

    let filesProcessed = 0;
    for (const filePath of files) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');

        // Extract identifiers
        const identifiers = identifierExtractor.extract(fileContent, filePath);
        identifiers.forEach(id => identifierSet.add(id.name));

        // Extract comments
        const comments = commentExtractor.extract(fileContent, filePath);
        allComments.push(...comments);

        filesProcessed++;

        // Update progress every 5 files (or less frequently for large projects)
        const progressInterval = totalFilesToScan > 50 ? 10 : (totalFilesToScan > 20 ? 5 : 2);
        if (filesProcessed % progressInterval === 0 || filesProcessed === totalFilesToScan) {
          sendProgress(taskId, 'Project Scan', 'progress', {
            status: 'scanning',
            statusMessage: `Scanned ${filesProcessed}/${totalFilesToScan} files...`,
            progress: Math.floor((filesProcessed / totalFilesToScan) * 50), // 0-50% for scanning
          });
        }
      } catch (error: any) {
        log(`Failed to process file ${filePath}: ${error.message}`);
        // Continue with other files
      }
    }

    // Extract content from markdown files (if enabled)
    if (includeMarkdown && markdownFiles.length > 0) {
      log(`[ScanProject] Extracting content from ${markdownFiles.length} markdown files...`);

      for (const mdPath of markdownFiles) {
        try {
          const mdContent = fs.readFileSync(mdPath, 'utf-8');
          const texts = markdownExtractor.extract(mdContent, mdPath);
          allMarkdownTexts.push(...texts);

          filesProcessed++;

          // Update progress
          const progressInterval = totalFilesToScan > 50 ? 10 : (totalFilesToScan > 20 ? 5 : 2);
          if (filesProcessed % progressInterval === 0 || filesProcessed === totalFilesToScan) {
            sendProgress(taskId, 'Project Scan', 'progress', {
              status: 'scanning',
              statusMessage: `Scanned ${filesProcessed}/${totalFilesToScan} files...`,
              progress: Math.floor((filesProcessed / totalFilesToScan) * 50),
            });
          }
        } catch (error: any) {
          log(`Failed to process markdown file ${mdPath}: ${error.message}`);
        }
      }

      log(`[ScanProject] Extracted ${allMarkdownTexts.length} text blocks from markdown files`);
    }

    const uniqueIdentifiers = Array.from(identifierSet);
    // Combine comments and markdown texts for translation (both are natural language)
    const allTextsToTranslate = [...allComments, ...allMarkdownTexts];

    // Calculate total characters for token estimation
    // Identifiers: each identifier name
    const identifierChars = uniqueIdentifiers.reduce((sum, id) => sum + id.length, 0);
    // Comments and markdown: full text
    const textChars = allTextsToTranslate.reduce((sum, c) => sum + c.length, 0);

    // Estimate tokens (roughly 4 chars per token for English, but identifiers are dense)
    // Use 3 chars per token for identifiers (camelCase splits), 4 for text
    const estimatedInputTokens = Math.ceil(identifierChars / 3) + Math.ceil(textChars / 4);
    // Output is roughly same size (translations)
    const estimatedOutputTokens = estimatedInputTokens;
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

    // Estimate time: ~1000 tokens/sec for Claude, plus overhead
    // Batch size of 500 terms, ~2 seconds per batch
    const numBatches = Math.ceil(uniqueIdentifiers.length / 500) + Math.ceil(allTextsToTranslate.length / 100);
    const estimatedSeconds = Math.max(5, numBatches * 3); // Minimum 5 seconds
    const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

    const textCountDesc = allMarkdownTexts.length > 0
      ? `${allComments.length} comments + ${allMarkdownTexts.length} markdown blocks`
      : `${allComments.length} comments`;
    log(`Extracted ${uniqueIdentifiers.length} unique identifiers and ${textCountDesc}`);
    log(`Estimated: ${estimatedTotalTokens} tokens, ${estimatedSeconds}s processing time`);

    if (uniqueIdentifiers.length === 0) {
      sendProgress(taskId, 'Project Scan', 'complete', {
        status: 'complete',
        statusMessage: 'No identifiers found to translate',
        autoClose: true,
        autoCloseDelay: 3000,
      });

      return {
        success: true,
        message: 'No identifiers to translate',
      };
    }

    // For larger projects, show stats and ask for confirmation before proceeding
    // This gives users a chance to review the scope before translation begins
    if (files.length > 10) {
      const timeEstimate = estimatedMinutes > 1
        ? `~${estimatedMinutes} minutes`
        : `~${estimatedSeconds} seconds`;

      // Store scan data for the proceed-translation handler
      const pendingKey = `${origin}:${targetLang}`;
      pendingTranslations.set(pendingKey, {
        origin,
        targetLang: targetLang as LanguageCode,
        workspaceRoot,
        identifiers: uniqueIdentifiers,
        comments: allTextsToTranslate, // Includes both comments and markdown
        stats: {
          files: totalFilesToScan,
          terms: uniqueIdentifiers.length,
          comments: allTextsToTranslate.length,
          estimatedTokens: estimatedTotalTokens,
          estimatedSeconds,
        },
        createdAt: Date.now(),
      });

      // Build stats message with markdown info if applicable
      const statsLines = [
        `📊 Project Analysis Complete`,
        ``,
        `Code files: ${files.length}`,
      ];
      if (markdownFiles.length > 0) {
        statsLines.push(`Markdown files: ${markdownFiles.length}`);
      }
      statsLines.push(
        `Unique terms: ${uniqueIdentifiers.length}`,
        `Text blocks: ${allTextsToTranslate.length}${allMarkdownTexts.length > 0 ? ` (${allComments.length} comments + ${allMarkdownTexts.length} markdown)` : ''}`,
        ``,
        `Estimated tokens: ~${estimatedTotalTokens.toLocaleString()}`,
        `Estimated time: ${timeEstimate}`,
        ``,
        `Ready to translate using local Claude CLI.`
      );
      const statsMessage = statsLines.join('\n');

      sendProgress(taskId, 'Project Scan', 'complete', {
        status: 'complete',
        statusMessage: statsMessage,
        autoClose: false, // Keep visible so user can review
        details: {
          files: totalFilesToScan,
          codeFiles: files.length,
          markdownFiles: markdownFiles.length,
          terms: uniqueIdentifiers.length,
          comments: allTextsToTranslate.length,
          estimatedTokens: estimatedTotalTokens,
          estimatedSeconds,
          awaitingConfirmation: true,
          pendingKey,
        },
      });

      // Send notification asking user to confirm
      const fileDesc = markdownFiles.length > 0
        ? `${files.length} code + ${markdownFiles.length} markdown files`
        : `${totalFilesToScan} files`;
      sendBroadcast('muninn', 'notification', {
        severity: 'info',
        summary: 'Large Project Detected',
        detail: `${fileDesc}, ${uniqueIdentifiers.length} terms. Click "Proceed" in the progress panel to start translation.`,
        life: 15000
      });

      return {
        success: true,
        awaitingConfirmation: true,
        pendingKey,
        message: `Project scanned. Awaiting confirmation to translate ${uniqueIdentifiers.length} terms.`,
        stats: {
          files: totalFilesToScan,
          terms: uniqueIdentifiers.length,
          comments: allTextsToTranslate.length,
          estimatedTokens: estimatedTotalTokens,
          estimatedSeconds,
        },
      };
    }

    // Send progress: translating
    sendProgress(taskId, 'Project Scan', 'progress', {
      status: 'processing',
      statusMessage: `Translating ${uniqueIdentifiers.length} identifiers to ${targetLang.toUpperCase()} locally...`,
      progress: 50,
    });

    // Use local translation via Claude CLI (batching is handled internally)
    // allTextsToTranslate includes both code comments and markdown content
    const onScanProgress: TranslationProgressCallback = (info) => {
      const label = info.type === 'identifiers' ? 'terms' : info.type;
      if (info.status === 'retrying') {
        sendProgress(taskId, 'Project Scan', 'progress', {
          status: 'retrying',
          statusMessage: `Retrying ${label} batch ${info.batchNum}/${info.totalBatches} (attempt ${info.retryAttempt}/${info.maxRetries})...`,
          progress: 50,
        });
      } else if (info.status === 'processing') {
        const totalItems = uniqueIdentifiers.length + allTextsToTranslate.length;
        const itemsDone = info.type === 'identifiers'
          ? (info.batchNum - 1) * info.batchSize
          : uniqueIdentifiers.length + (info.batchNum - 1) * info.batchSize;
        const progress = 50 + Math.floor((itemsDone / totalItems) * 40); // 50-90% range
        sendProgress(taskId, 'Project Scan', 'progress', {
          status: 'processing',
          statusMessage: `Translating ${label} batch ${info.batchNum}/${info.totalBatches} (${info.batchSize} items)...`,
          progress,
        });
      }
    };

    const translateResult = await localTranslateProject(
      uniqueIdentifiers,
      allTextsToTranslate,
      'en', // Source is always English for project scan
      targetLang as LanguageCode,
      onScanProgress
    );

    log(`Translation complete: ${translateResult.totalTerms} terms and ${translateResult.totalComments} text blocks`);

    // Save dictionary
    sendProgress(taskId, 'Project Scan', 'progress', {
      status: 'downloading',
      statusMessage: 'Saving dictionary...',
      progress: 90,
    });

    const { apiToLocalDictionary } = await import('./api/client');
    const newDictionary = apiToLocalDictionary({
      origin,
      language: targetLang,
      terms: translateResult.terms,
      comments: translateResult.comments,
      totalTerms: translateResult.totalTerms,
      totalComments: translateResult.totalComments,
      batchCount: 1,
    });
    dictionaryManager.import(JSON.stringify(newDictionary));

    // Clear translation cache so stale results aren't served
    translationCache.clear();

    // Send completion
    const completionDetail = allMarkdownTexts.length > 0
      ? `Translated ${translateResult.totalTerms} terms and ${translateResult.totalComments} text blocks (comments + markdown).`
      : `Translated ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments.`;
    sendProgress(taskId, 'Project Scan', 'complete', {
      status: 'complete',
      statusMessage: completionDetail,
      progress: 100,
      autoClose: true,
      autoCloseDelay: 3000,
    });

    // Show success notification
    sendBroadcast('muninn', 'notification', {
      severity: 'success',
      summary: 'Project Translation Complete',
      detail: `${completionDetail} Open any file to see translations.`,
      life: 8000
    });

    return {
      success: true,
      termsTranslated: translateResult.totalTerms,
      commentsTranslated: translateResult.totalComments,
      filesScanned: totalFilesToScan,
    };
  } catch (error: any) {
    log(`Scan project error: ${error.message}`);

    // Send progress error
    sendProgress(taskId, 'Project Scan', 'error', {
      status: 'error',
      error: error.message || 'Project scan failed',
      autoClose: false,
    });

    throw error;
  }
}

/**
 * Handle proceed-translation request
 *
 * Called after user confirms they want to proceed with translation
 * for a large project. Uses cached scan data from handleScanProject.
 */
async function handleProceedTranslation(message: IPCMessage): Promise<any> {
  const { pendingKey, origin, targetLang } = message.data;
  const taskId = `proceed-translation-${Date.now()}`;

  // Try to get pending translation data
  const key = pendingKey || `${origin}:${targetLang}`;
  const pending = pendingTranslations.get(key);

  if (!pending) {
    return {
      success: false,
      error: 'No pending translation found. Please run a project scan first.',
    };
  }

  // Remove from pending cache
  pendingTranslations.delete(key);

  try {
    log(`[ProceedTranslation] Starting translation for ${pending.origin} -> ${pending.targetLang}`);
    log(`[ProceedTranslation] ${pending.identifiers.length} identifiers, ${pending.comments.length} comments`);

    // Send progress: starting
    sendProgress(taskId, 'Project Translation', 'started', {
      status: 'processing',
      statusMessage: `Translating ${pending.identifiers.length} identifiers to ${pending.targetLang.toUpperCase()} locally...`,
    });

    // Use local translation via Claude CLI (batching is handled internally)
    const onProceedProgress: TranslationProgressCallback = (info) => {
      const label = info.type === 'identifiers' ? 'terms' : info.type;
      if (info.status === 'retrying') {
        sendProgress(taskId, 'Project Translation', 'progress', {
          status: 'retrying',
          statusMessage: `Retrying ${label} batch ${info.batchNum}/${info.totalBatches} (attempt ${info.retryAttempt}/${info.maxRetries})...`,
        });
      } else if (info.status === 'processing') {
        const totalItems = pending.identifiers.length + pending.comments.length;
        const itemsDone = info.type === 'identifiers'
          ? (info.batchNum - 1) * info.batchSize
          : pending.identifiers.length + (info.batchNum - 1) * info.batchSize;
        const progress = Math.floor((itemsDone / totalItems) * 90); // 0-90% range
        sendProgress(taskId, 'Project Translation', 'progress', {
          status: 'processing',
          statusMessage: `Translating ${label} batch ${info.batchNum}/${info.totalBatches} (${info.batchSize} items)...`,
          progress,
        });
      }
    };

    const translateResult = await localTranslateProject(
      pending.identifiers,
      pending.comments,
      'en', // Source is always English for project scan
      pending.targetLang,
      onProceedProgress
    );

    log(`[ProceedTranslation] Translation complete: ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments`);

    // Save dictionary
    sendProgress(taskId, 'Project Translation', 'progress', {
      status: 'downloading',
      statusMessage: 'Saving dictionary...',
      progress: 90,
    });

    const { apiToLocalDictionary } = await import('./api/client');
    const newDictionary = apiToLocalDictionary({
      origin: pending.origin,
      language: pending.targetLang,
      terms: translateResult.terms,
      comments: translateResult.comments,
      totalTerms: translateResult.totalTerms,
      totalComments: translateResult.totalComments,
      batchCount: 1,
    });
    dictionaryManager.import(JSON.stringify(newDictionary));

    // Clear translation cache so stale results aren't served
    translationCache.clear();

    // Send completion
    sendProgress(taskId, 'Project Translation', 'complete', {
      status: 'complete',
      statusMessage: `Translated ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments`,
      progress: 100,
      autoClose: true,
      autoCloseDelay: 3000,
    });

    // Show success notification
    sendBroadcast('muninn', 'notification', {
      severity: 'success',
      summary: 'Project Translation Complete',
      detail: `Translated ${translateResult.totalTerms} terms and ${translateResult.totalComments} comments. Open any file to see translations.`,
      life: 8000
    });

    return {
      success: true,
      termsTranslated: translateResult.totalTerms,
      commentsTranslated: translateResult.totalComments,
      filesScanned: pending.stats.files,
    };
  } catch (error: any) {
    log(`[ProceedTranslation] Error: ${error.message}`);

    // Send progress error
    sendProgress(taskId, 'Project Translation', 'error', {
      status: 'error',
      error: error.message || 'Translation failed',
      autoClose: false,
    });

    // Show error notification
    sendBroadcast('muninn', 'notification', {
      severity: 'error',
      summary: 'Translation Failed',
      detail: error.message || 'Failed to translate project',
      life: 8000
    });

    throw error;
  }
}

/**
 * Handle file-saved request
 *
 * When a user saves a file while working in a non-English language mode,
 * this handler detects foreign language terms (identifiers and comments)
 * and translates them back to English before persisting to disk.
 *
 * Flow:
 * 1. Extract identifiers from saved code
 * 2. Detect which ones are in a foreign language
 * 3. For known terms: use dictionary to get English equivalents
 * 4. For NEW foreign terms: upload to API for translation
 * 5. Return translated English code
 */
async function handleFileSaved(message: IPCMessage): Promise<any> {
  const { code, filePath, origin, sourceLang: providedSourceLang, targetLang: providedTargetLang } = message.data;
  const taskId = `file-save-${Date.now()}`;
  const startTime = Date.now();

  try {
    log(`[FileSave] Processing file save for ${filePath}`);

    // Validate required fields
    if (!code) {
      log(`[FileSave] No code content provided, skipping`);
      return {
        success: true,
        code: code,
        translated: false,
        message: 'No code content provided',
      };
    }

    // Origin should be enriched by Muninn before routing to this handler
    if (!origin) {
      log(`[FileSave] No origin provided by Muninn, skipping translation`);
      return {
        success: true,
        code: code,
        translated: false,
        message: 'Origin not available - file may not be in a git repository',
      };
    }

    // Step 1: Determine source and target languages
    // Source comes from caller (user's current language via getLanguage(caw))
    // Target defaults to 'en' (save files in English)
    const sourceLang: LanguageCode = providedSourceLang && providedSourceLang !== 'auto'
      ? providedSourceLang as LanguageCode
      : 'en'; // Fallback to 'en' - caller should always provide sourceLang for save
    const targetLang: LanguageCode = (providedTargetLang as LanguageCode) || 'en';

    log(`[FileSave] Translation: ${sourceLang} → ${targetLang}`);

    // Step 2: Extract identifiers and detect terms needing translation
    const identifiers = identifierExtractor.extract(code, filePath);
    const identifierNames = identifiers.map(id => id.name);

    // Filter to terms that need translation to the target language
    // If target is 'en', find non-English terms (non-ASCII)
    // If target is non-English, find English terms (ASCII-only)
    const termsToTranslate = identifierNames.filter(name => {
      const termIsNonEnglish = isNonEnglish(name);
      return targetLang === 'en' ? termIsNonEnglish : !termIsNonEnglish;
    });

    if (termsToTranslate.length === 0) {
      log(`[FileSave] No terms need translation to ${targetLang}`);
      return {
        success: true,
        code: code,
        translated: false,
        message: `No terms need translation to ${targetLang}`,
      };
    }

    log(`[FileSave] Found ${termsToTranslate.length} terms to translate to ${targetLang}`);

    // Step 3: Load dictionary for the language pair
    const { dictionary } = await dictionaryManager.loadMultiLang(
      origin,
      sourceLang,
      targetLang
    );

    // Step 4: Identify new terms that aren't in dictionary
    const newTermsToTranslate = termsToTranslate.filter(term => !dictionary.hasTerm(term));

    if (newTermsToTranslate.length > 0) {
      log(`[FileSave] Found ${newTermsToTranslate.length} NEW terms, translating locally...`);

      // Send progress notification
      sendProgress(taskId, 'Translating New Terms', 'started', {
        status: 'processing',
        statusMessage: `Translating ${newTermsToTranslate.length} new ${sourceLang.toUpperCase()} terms to ${targetLang.toUpperCase()} locally...`,
      });

      try {
        // Use local translation via Claude CLI
        const translations = await localTranslateIdentifiers(newTermsToTranslate, sourceLang, targetLang);

        log(`[FileSave] Successfully translated ${Object.keys(translations).length} new terms locally`);

        // Add translated terms to dictionary
        // Local translation returns { sourceTerm: translatedTerm } mapping
        // We need to store as { englishTerm: foreignTerm } in the dictionary
        const termsToAdd: Record<string, string> = {};
        for (const [foreignTerm, englishTerm] of Object.entries(translations)) {
          termsToAdd[englishTerm] = foreignTerm;
        }

        if (Object.keys(termsToAdd).length > 0) {
          // Persist to disk for durability
          dictionaryManager.addTerms(origin, sourceLang, termsToAdd);
          // Update in-memory MultiLangDictionary to avoid reloading
          dictionary.addTerms(termsToAdd);
        }

        sendProgress(taskId, 'Translating New Terms', 'complete', {
          status: 'complete',
          statusMessage: `Translated ${Object.keys(translations).length} new terms`,
          autoClose: true,
          autoCloseDelay: 2000,
        });
      } catch (error: any) {
        log(`[FileSave] Warning: Failed to translate new terms locally: ${error.message}`);
        sendProgress(taskId, 'Translating New Terms', 'error', {
          status: 'error',
          error: error.message || 'Failed to translate new terms',
          autoClose: true,
          autoCloseDelay: 3000,
        });
      }
    }

    // Step 5: Translate code to target language using the already-loaded dictionary
    // (No reload needed - dictionary was updated in-place above if new terms were added)
    const translator = new UnifiedTranslator(dictionary);

    const translateStartTime = Date.now();
    const result = translator.translate(code, sourceLang, targetLang);
    log(`[FileSave] Code translated in ${Date.now() - translateStartTime}ms, tokens: ${result.translatedTokens.length}`);

    const totalTime = Date.now() - startTime;
    log(`[FileSave] Total processing time: ${totalTime}ms`);

    // Log any unmapped terms (terms without translation in dictionary)
    if (result.unmappedTokens.length > 0) {
      log(`[FileSave] Warning: ${result.unmappedTokens.length} terms could not be translated to ${targetLang}: ${result.unmappedTokens.slice(0, 5).join(', ')}${result.unmappedTokens.length > 5 ? '...' : ''}`);
    }

    return {
      success: true,
      code: result.code,
      translated: true,
      translatedTokens: result.translatedTokens,
      unmappedTokens: result.unmappedTokens,
    };
  } catch (error: any) {
    log(`[FileSave] Error: ${error.message}`);
    sendProgress(taskId, 'File Save Translation', 'error', {
      status: 'error',
      error: error.message || 'Translation failed',
      autoClose: false,
    });
    throw error;
  }
}

/**
 * Handle active-path broadcast from Gardener
 * Syncs dictionary if dictionaryVersion is newer than local lastSyncDate
 */
async function handleActivePath(message: IPCMessage): Promise<void> {
  const { origin, dictionaryVersion, currentLanguage } = message.data;

  // Only sync if we have a target language and it's not English
  if (!currentLanguage || currentLanguage === 'en') {
    return;
  }

  // Check if dictionary exists locally
  if (!dictionaryManager.exists(origin, currentLanguage)) {
    log(`[ActivePath] Dictionary doesn't exist locally: ${origin} (${currentLanguage})`);
    return;
  }

  try {
    // Load local dictionary to get lastSyncDate
    const dictionary = dictionaryManager.load(origin, currentLanguage);
    const lastSyncDate = dictionary.metadata.lastSyncDate;

    if (!lastSyncDate) {
      log(`[ActivePath] No lastSyncDate in dictionary, skipping sync`);
      return;
    }

    if (!dictionaryVersion) {
      log(`[ActivePath] No dictionaryVersion in active-path response, skipping sync`);
      return;
    }

    // Compare timestamps (lexicographic comparison works for ISO 8601)
    if (dictionaryVersion > lastSyncDate) {
      log(`[ActivePath] Dictionary has updates (local: ${lastSyncDate}, remote: ${dictionaryVersion}), syncing...`);

      // Sync dictionary
      const termCount = await dictionaryManager.sync(origin, currentLanguage);

      if (termCount > 0) {
        log(`[ActivePath] Synced ${termCount} new terms for ${currentLanguage}`);
      }
    } else {
      log(`[ActivePath] Dictionary is up to date (local: ${lastSyncDate}, remote: ${dictionaryVersion})`);
    }
  } catch (error: any) {
    log(`[ActivePath] Sync error: ${error.message}`);
  }
}

/**
 * Handle repo:head-changed broadcast from Gardener
 *
 * Triggered when git HEAD changes (pull, checkout, merge, rebase, etc.)
 * This indicates external code has come in and we should re-scan the project
 * to detect and translate new terms.
 *
 * Expected data:
 * - origin: string - git remote origin
 * - oldSha: string - previous HEAD commit SHA
 * - newSha: string - new HEAD commit SHA
 * - workspaceRoot: string - project root path
 * - reason?: string - what triggered the change (pull, checkout, merge, etc.)
 */
async function handleHeadChanged(message: IPCMessage): Promise<void> {
  const { origin, oldSha, newSha, workspaceRoot, reason } = message.data || {};

  log(`[HeadChanged] Git HEAD changed: ${oldSha?.substring(0, 7)} → ${newSha?.substring(0, 7)} (${reason || 'unknown'})`);

  if (!origin || !workspaceRoot) {
    log(`[HeadChanged] Missing origin or workspaceRoot, skipping scan`);
    return;
  }

  // Check if we have any dictionaries for this origin
  const allDictionaries = dictionaryManager.listAll();
  const originDictionaries = allDictionaries.filter(d => d.origin === origin);
  if (originDictionaries.length === 0) {
    log(`[HeadChanged] No dictionaries exist for ${origin}, skipping scan`);
    return;
  }

  // Get the user's current language preference (use first dictionary's language as fallback)
  // In practice, this should come from the active Huginn client's language setting
  const targetLang = originDictionaries[0].language;

  log(`[HeadChanged] Triggering project scan for ${origin} -> ${targetLang}`);

  // Show notification to user
  sendBroadcast('muninn', 'notification', {
    severity: 'info',
    summary: 'Git Changes Detected',
    detail: `Scanning project for new terms to translate...`,
    life: 5000
  });

  // Trigger project scan asynchronously
  handleScanProject({
    flow: 'req',
    domain: 'i18n',
    action: 'scan-project',
    caw: message.caw || '0',
    data: { origin, targetLang, workspaceRoot }
  } as IPCMessage).catch((error: any) => {
    log(`[HeadChanged] Project scan failed: ${error.message}`);
    sendBroadcast('muninn', 'notification', {
      severity: 'error',
      summary: 'Scan Failed',
      detail: `Failed to scan for new terms: ${error.message}`,
      life: 8000
    });
  });
}

// ============================================================================
// Settings Handlers
// ============================================================================

/**
 * Handle get-settings request
 * Returns current translation scope
 */
async function handleGetSettings(message: IPCMessage): Promise<any> {
  log('[i18n] Getting settings');
  const translationScope = getTranslationScope();
  return { translationScope };
}

/**
 * Handle set-settings request
 * Updates translation scope
 */
async function handleSetSettings(message: IPCMessage): Promise<any> {
  const { translationScope } = message.data;

  if (!translationScope) {
    return { success: false, error: 'Missing translationScope in request' };
  }

  log(`[i18n] Setting translation scope: ${JSON.stringify(translationScope)}`);

  // Validate scope object
  const validScope: TranslationScope = {
    comments: !!translationScope.comments,
    stringLiterals: !!translationScope.stringLiterals,
    identifiers: !!translationScope.identifiers,
    keywords: !!translationScope.keywords,
    punctuation: !!translationScope.punctuation,
    markdownFiles: !!translationScope.markdownFiles,
  };

  setTranslationScope(validScope);

  // Clear translation cache since scope changed
  translationCache.clear();

  return { success: true, translationScope: validScope };
}

/**
 * TEMPORARY TEST: Progress event tester
 * Sends progress events every 5 seconds (completes after 2 seconds)
 * To start: send { domain: 'i18n', action: 'test-progress', data: { start: true } }
 * To stop: send { domain: 'i18n', action: 'test-progress', data: { stop: true } }
 */
let testProgressInterval: NodeJS.Timeout | null = null;

async function handleTestProgress(message: IPCMessage): Promise<any> {
  const { start, stop } = message.data;

  if (stop) {
    if (testProgressInterval) {
      clearInterval(testProgressInterval);
      testProgressInterval = null;
      log('[TEST] Progress test stopped');
      return { success: true, message: 'Progress test stopped' };
    } else {
      return { success: false, message: 'No progress test running' };
    }
  }

  if (start) {
    // Stop existing test if running
    if (testProgressInterval) {
      clearInterval(testProgressInterval);
    }

    log('[TEST] Starting progress test (new task every 5s, completes after 2s)');

    let taskCounter = 0;

    const runTest = () => {
      taskCounter++;
      const taskId = `test-task-${taskCounter}-${Date.now()}`;

      // Random duration between 2 and 15 seconds
      const duration = Math.floor(Math.random() * (15000 - 2000 + 1)) + 2000;
      const midpoint = duration / 2;

      log(`[TEST] Starting task: ${taskId} (duration: ${duration}ms)`);

      // Send started event
      sendProgress(taskId, `Test Task #${taskCounter}`, 'started', {
        status: 'processing',
        statusMessage: `Testing progress events (${(duration / 1000).toFixed(1)}s)...`,
        progress: 0,
      });

      // Send progress update at 25%
      setTimeout(() => {
        log(`[TEST] Progress 25% for: ${taskId}`);
        sendProgress(taskId, `Test Task #${taskCounter}`, 'progress', {
          status: 'processing',
          statusMessage: 'Making progress...',
          progress: 25,
        });
      }, duration * 0.25);

      // Send progress update at 50%
      setTimeout(() => {
        log(`[TEST] Progress 50% for: ${taskId}`);
        sendProgress(taskId, `Test Task #${taskCounter}`, 'progress', {
          status: 'processing',
          statusMessage: 'Halfway through...',
          progress: 50,
        });
      }, midpoint);

      // Send progress update at 75%
      setTimeout(() => {
        log(`[TEST] Progress 75% for: ${taskId}`);
        sendProgress(taskId, `Test Task #${taskCounter}`, 'progress', {
          status: 'processing',
          statusMessage: 'Almost done...',
          progress: 75,
        });
      }, duration * 0.75);

      // Complete after random duration
      setTimeout(() => {
        log(`[TEST] Completing task: ${taskId}`);
        sendProgress(taskId, `Test Task #${taskCounter}`, 'complete', {
          status: 'complete',
          statusMessage: 'Test completed successfully',
          progress: 100,
          autoClose: true,
          autoCloseDelay: 2000,
        });
      }, duration);
    };

    // Run first test immediately
    runTest();

    // Then run every 5 seconds
    testProgressInterval = setInterval(runTest, 5000);

    return {
      success: true,
      message: 'Progress test started (new task every 5s, completes after 2s)'
    };
  }

  return {
    success: false,
    message: 'Please provide { start: true } or { stop: true }'
  };
}

/**
 * Handle auth:info broadcast from Muninn
 * Stores auth tokens in memory for API calls
 */
function handleAuthInfo(message: IPCMessage): void {
  const data = message.data;
  setAuthState(data);
  // No response needed for broadcast messages
}

/**
 * Handle extension:ready broadcast from Muninn
 * Signals that Muninn is ready and provides initial auth state
 */
function handleExtensionReady(message: IPCMessage): void {
  log('[Extension] Received extension:ready from Muninn');

  // Store auth state from the ready message
  const data = message.data;
  if (data) {
    setAuthState(data);
    log(`[Extension] Auth state initialized: authenticated=${data.authenticated}`);
  }

  // No response needed for broadcast messages
}

// ============================================================================
// DIRECT HUGINN HANDLERS
// These handlers are called directly by Huginn clients via the kawa.i18n socket
// They enrich messages with origin and lang locally before processing
// ============================================================================

/**
 * Handle direct translate-code request from Huginn
 * Enriches with origin (from cache/Muninn)
 *
 * For DISPLAY translation (showing user their preferred language):
 * - Source is ALWAYS English (files on disk are stored in English)
 * - Target is the user's preferred language
 *
 * Detection is only needed for SAVE operations (buffer → disk).
 */
async function handleDirectTranslateCode(message: IPCMessage, caw: string): Promise<any> {
  const { code, filePath, targetLang } = message.data;

  log(`[Direct] translate-code for ${filePath} -> ${targetLang}`);

  // Get origin from cache or Muninn
  const originResult = await getOriginForPath(filePath);
  if (!originResult) {
    return {
      success: false,
      error: 'Could not determine repository origin. Is this file in a git repository?'
    };
  }

  // For display translation, source is ALWAYS English.
  // Files on disk are stored in English - that's our design.

  // Create enriched message and delegate to existing handler
  const enrichedMessage: IPCMessage = {
    ...message,
    data: {
      ...message.data,
      origin: originResult.origin,
      sourceLang: 'en'  // Files on disk are always English
    }
  };

  return handleTranslateCode(enrichedMessage);
}

/**
 * Handle direct file-saved request from Huginn
 * Translates foreign content to English for saving
 */
async function handleDirectFileSaved(message: IPCMessage, caw: string): Promise<any> {
  const { code, filePath } = message.data;

  log(`[Direct] file-saved for ${filePath}`);

  // Get origin from cache or Muninn
  const originResult = await getOriginForPath(filePath);
  if (!originResult) {
    return {
      success: false,
      error: 'Could not determine repository origin. Is this file in a git repository?'
    };
  }

  // Get source language from our local state
  const sourceLang = getLanguage(caw);

  // If already in English, nothing to do
  if (sourceLang === 'en') {
    return {
      success: true,
      code: code,
      translated: false,
      message: 'Already in English'
    };
  }

  // Create enriched message and delegate to existing handler
  const enrichedMessage: IPCMessage = {
    ...message,
    data: {
      ...message.data,
      origin: originResult.origin,
      sourceLang,
      targetLang: 'en' // Always save as English
    }
  };

  return handleFileSaved(enrichedMessage);
}

/**
 * Handle set-language request from Huginn
 * Stores language preference for this CAW
 * Also clears the translation cache to avoid stale results
 */
async function handleDirectSetLanguage(message: IPCMessage, caw: string): Promise<any> {
  const { lang } = message.data;

  if (!lang) {
    return {
      success: false,
      error: 'Missing lang parameter'
    };
  }

  // Clear translation cache when language changes to avoid stale results
  // (e.g., cached JA→JA translations from when source detection was broken)
  translationCache.clear();

  setLanguage(caw, lang);
  log(`[Direct] Set language for CAW ${caw}: ${lang}`);

  return {
    success: true,
    lang,
    caw
  };
}

/**
 * Handle get-language request from Huginn
 * Returns current language preference for this CAW
 */
async function handleDirectGetLanguage(message: IPCMessage, caw: string): Promise<any> {
  const lang = getLanguage(caw);
  return {
    success: true,
    lang,
    caw
  };
}

/**
 * Main entry point
 */
async function main() {
  log(`=== Kawa i18n Extension v${VERSION} ===`);

  // -------------------------------------------------------------------------
  // STDIN HANDLERS (Muninn communication)
  // -------------------------------------------------------------------------

  // Register response interceptor to handle our own Muninn requests
  addResponseInterceptor(handleMuninnResponse);

  // Register request handlers for Muninn routing
  registerHandler('i18n', 'translate-code', handleTranslateCode);
  registerHandler('i18n', 'file-saved', handleFileSaved);
  registerHandler('i18n', 'scan-project', handleScanProject);
  registerHandler('i18n', 'proceed-translation', handleProceedTranslation);
  registerHandler('i18n', 'load-dictionary', handleLoadDictionary);
  registerHandler('i18n', 'add-terms', handleAddTerms);
  registerHandler('i18n', 'list-dictionaries', handleListDictionaries);
  registerHandler('i18n', 'extract-identifiers', handleExtractIdentifiers);

  // Settings handlers
  registerHandler('i18n', 'get-settings', handleGetSettings);
  registerHandler('i18n', 'set-settings', handleSetSettings);

  // TEMPORARY: Register test handler
  registerHandler('i18n', 'test-progress', handleTestProgress);

  // Register intent translation handlers under i18n domain (routed to extension)
  // These use the i18n domain to bypass Gardener's intent handling
  registerHandler('i18n', 'normalize-intent', handleNormalizeIntent);
  registerHandler('i18n', 'translate-intent-metadata', handleTranslateIntentMetadata);
  registerHandler('i18n', 'detect-language', handleDetectLanguage);

  // Register intent handlers (for Muninn routing - legacy, may be intercepted by Gardener)
  registerHandler('intent', 'get-for-file', handleGetIntentsForFile);
  registerHandler('intent', 'get-for-lines', handleGetIntentsForLines);
  registerHandler('intent', 'normalize', handleNormalizeIntent);
  registerHandler('intent', 'translate-metadata', handleTranslateIntentMetadata);
  registerHandler('intent-block', 'get-content-translated', handleGetBlockContentTranslated);

  // Register broadcast handlers
  registerHandler('repo', 'active-path', handleActivePath);
  registerHandler('repo', 'head-changed', handleHeadChanged);

  // Register auth handler to receive tokens from Muninn
  registerHandler('auth', 'info', handleAuthInfo);

  // Register extension:ready handler to know when Muninn is ready
  registerHandler('extension', 'ready', handleExtensionReady);

  // Determine transport mode: socket or stdin/stdout
  const muninnSocketArg = process.argv.find(a => a.startsWith('--muninn-socket'));
  const muninnSocketPath = process.env.MUNINN_SOCKET
    || (muninnSocketArg ? muninnSocketArg.split('=')[1] : undefined);

  if (muninnSocketPath) {
    // Socket mode: connect to Muninn as extension client
    log(`Connecting to Muninn socket at: ${muninnSocketPath}`);
    try {
      const transport = await connectToMuninn(muninnSocketPath);
      setTransport(transport.writable, 'socket');
      startListening(transport.readable);
      log('Running in socket mode (Muninn IPC client)');
    } catch (err: any) {
      log(`[Fatal] Failed to connect to Muninn socket: ${err.message}`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    // Legacy stdin/stdout mode (spawned by Muninn)
    startListening();
    log('Running in stdin/stdout mode (spawned by Muninn)');

    // Initialize stream buffers for large message support (stdin mode only)
    {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const STREAMS_DIR = path.join(os.homedir(), '.kawa-code', 'streams', 'i18n');
      try {
        const reqPath = path.join(STREAMS_DIR, 'request.stream');
        const resPath = path.join(STREAMS_DIR, 'response.stream');
        if (fs.existsSync(reqPath)) {
          setRequestStream(new CircularStreamBuffer(reqPath));
          log('Request stream initialized');
        }
        if (fs.existsSync(resPath)) {
          setResponseStream(new CircularStreamBuffer(resPath));
          log('Response stream initialized');
        }
      } catch (err: any) {
        log(`Stream init failed: ${err.message} (falling back to STDOUT-only)`);
      }
    }
  } else {
    // Interactive TTY mode: try connecting to Muninn socket at default path
    const defaultPath = getDefaultMuninnSocketPath();
    log(`No MUNINN_SOCKET env or stdin pipe. Trying default socket: ${defaultPath}`);
    try {
      const transport = await connectToMuninn(defaultPath);
      setTransport(transport.writable, 'socket');
      startListening(transport.readable);
      log('Running in socket mode (auto-detected default path)');
    } catch (err: any) {
      log(`[Fatal] Cannot start: no stdin pipe and no Muninn socket at ${defaultPath}: ${err.message}`);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // DIRECT IPC SERVER (Huginn communication)
  // -------------------------------------------------------------------------

  // Register direct handlers for Huginn clients
  registerDirectHandler('i18n', 'translate-code', handleDirectTranslateCode);
  registerDirectHandler('i18n', 'file-saved', handleDirectFileSaved);
  registerDirectHandler('user', 'set-language', handleDirectSetLanguage);
  registerDirectHandler('user', 'get-language', handleDirectGetLanguage);

  // Register intent direct handlers for Huginn clients
  registerDirectHandler('intent', 'get-for-file', handleDirectGetIntentsForFile);
  registerDirectHandler('intent', 'get-for-lines', handleDirectGetIntentsForLines);
  registerDirectHandler('intent-block', 'get-content-translated', handleDirectGetBlockContentTranslated);

  // Start the direct IPC server for Huginn clients
  try {
    await startDirectServer();
    log('Direct IPC server started - Huginn clients can connect directly');
  } catch (error: any) {
    log(`[Warning] Failed to start direct IPC server: ${error.message}`);
    log('Huginn clients will use Muninn routing as fallback');
  }

  const mode = muninnSocketPath || process.stdin.isTTY ? 'socket' : 'stdin';
  log(`i18n extension ready (Muninn ${mode} + Direct IPC)`);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`[Fatal] Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  log(`[Fatal] Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Start
main().catch((error) => {
  log(`[Fatal] Failed to start: ${error.message}`);
  process.exit(1);
});
