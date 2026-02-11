#!/usr/bin/env node
"use strict";
/**
 * Kawa i18n Extension
 *
 * Internationalization service for Kawa Code that translates code identifiers
 * between languages while preserving TypeScript semantics and IDE support.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const handlers_1 = require("./ipc/handlers");
const protocol_1 = require("./ipc/protocol");
const server_1 = require("./ipc/server");
const unifiedTranslator_1 = require("./core/unifiedTranslator");
const manager_1 = require("./dictionary/manager");
const identifierExtractor_1 = require("./core/identifierExtractor");
const commentExtractor_1 = require("./core/commentExtractor");
const client_1 = require("./api/client");
const store_1 = require("./auth/store");
const handlers_2 = require("./intent/handlers");
const EXTENSION_ID = 'i18n';
const VERSION = '1.0.0';
// Initialize dictionary manager and extractors
const dictionaryManager = new manager_1.DictionaryManager();
const identifierExtractor = new identifierExtractor_1.IdentifierExtractor();
const commentExtractor = new commentExtractor_1.CommentExtractor();
/**
 * Simple LRU Cache for translation results
 *
 * Cache key: SHA256(code) + source_lang + target_lang
 * Max entries: 100
 * On-demand only (no prefetching)
 */
class TranslationCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }
    /**
     * Generate cache key from code content and language pair
     */
    getCacheKey(code, sourceLang, targetLang) {
        const hash = (0, crypto_1.createHash)('sha256').update(code).digest('hex');
        return `${hash}:${sourceLang}:${targetLang}`;
    }
    /**
     * Get cached translation result
     */
    get(code, sourceLang, targetLang) {
        const key = this.getCacheKey(code, sourceLang, targetLang);
        const entry = this.cache.get(key);
        if (entry) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, entry);
            (0, protocol_1.log)(`[i18n] Cache HIT: ${key.substring(0, 16)}...`);
            return entry.result;
        }
        (0, protocol_1.log)(`[i18n] Cache MISS: ${key.substring(0, 16)}...`);
        return null;
    }
    /**
     * Store translation result in cache
     */
    set(code, sourceLang, targetLang, result) {
        const key = this.getCacheKey(code, sourceLang, targetLang);
        // Evict oldest entry if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
                (0, protocol_1.log)(`[i18n] Cache evicted: ${firstKey.substring(0, 16)}...`);
            }
        }
        this.cache.set(key, {
            result,
            timestamp: Date.now()
        });
        (0, protocol_1.log)(`[i18n] Cache stored: ${key.substring(0, 16)}... (total: ${this.cache.size}/${this.maxSize})`);
    }
    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        };
    }
    /**
     * Clear all cached translations
     * Called when user changes language to avoid stale translations
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        (0, protocol_1.log)(`[i18n] Cache cleared (was ${size} entries)`);
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
async function handleTranslateCode(message) {
    const { code, filePath, targetLang, origin, sourceLang: providedSourceLang } = message.data;
    const taskId = `translate-${targetLang}-${Date.now()}`;
    const startTime = Date.now();
    try {
        (0, protocol_1.log)(`[TIMING] Translation started for ${filePath} -> ${targetLang}`);
        if (!origin) {
            throw new Error('Missing origin - Muninn should add origin before routing to i18n extension');
        }
        // Step 1: Use provided source language or default to English
        // Files on disk are always English by convention, so 'en' is the safe default
        const sourceLang = providedSourceLang && providedSourceLang !== 'auto'
            ? providedSourceLang
            : 'en';
        (0, protocol_1.log)(`Source language: ${sourceLang} (provided: ${providedSourceLang || 'none'})`);
        // Check cache first
        const cachedResult = translationCache.get(code, sourceLang, targetLang);
        if (cachedResult) {
            (0, protocol_1.log)(`[TIMING] Cache hit! Returning cached translation`);
            return { ...cachedResult, cached: true };
        }
        // Step 2: Load dictionary (MultiLangDictionary handles which language file to load)
        const dictStartTime = Date.now();
        const { dictionary, existsOnAPI } = await dictionaryManager.loadMultiLang(origin, sourceLang, targetLang);
        (0, protocol_1.log)(`[TIMING] Dictionary loaded in ${Date.now() - dictStartTime}ms, terms: ${dictionary.getTermCount()}`);
        // Step 3: Handle empty dictionary - trigger project scan if needed
        if (dictionary.getTermCount() === 0 && !existsOnAPI && sourceLang === 'en') {
            return await triggerProjectScan(message, origin, targetLang, filePath);
        }
        // Send progress: started
        (0, protocol_1.sendProgress)(taskId, 'Code Translation', 'started', {
            status: 'processing',
            statusMessage: `Translating ${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()}...`,
        });
        // NOTE: We do NOT translate new terms on a per-file basis.
        // This would cause inconsistent translations across files.
        // New terms require a full project scan to ensure consistency.
        // The dictionary should already contain all terms from a prior project scan.
        // Use the loaded dictionary directly for translation
        const translator = new unifiedTranslator_1.UnifiedTranslator(dictionary);
        const translateStartTime = Date.now();
        const result = translator.translate(code, sourceLang, targetLang);
        (0, protocol_1.log)(`[TIMING] Code translated in ${Date.now() - translateStartTime}ms, tokens: ${result.translatedTokens.length}`);
        // Send progress: complete
        (0, protocol_1.sendProgress)(taskId, 'Code Translation', 'complete', {
            status: 'complete',
            statusMessage: `Translated ${result.translatedTokens.length} terms`,
            details: {
                translatedTokens: result.translatedTokens.length,
                unmappedTokens: result.unmappedTokens.length,
            },
            autoClose: true,
            autoCloseDelay: 2000,
        });
        const totalTime = Date.now() - startTime;
        (0, protocol_1.log)(`[TIMING] Total translation time: ${totalTime}ms`);
        // Cache result
        const translationResult = {
            success: true,
            code: result.code,
            translatedTokens: result.translatedTokens,
            unmappedTokens: result.unmappedTokens,
        };
        translationCache.set(code, sourceLang, targetLang, translationResult);
        return translationResult;
    }
    catch (error) {
        (0, protocol_1.log)(`Translation error: ${error.message}`);
        (0, protocol_1.sendProgress)(taskId, 'Code Translation', 'error', {
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
async function triggerProjectScan(message, origin, targetLang, filePath) {
    const path = await Promise.resolve().then(() => __importStar(require('path')));
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    let workspaceRoot = path.dirname(filePath);
    while (workspaceRoot !== path.dirname(workspaceRoot)) {
        if (fs.existsSync(path.join(workspaceRoot, 'package.json')) ||
            fs.existsSync(path.join(workspaceRoot, '.git'))) {
            break;
        }
        workspaceRoot = path.dirname(workspaceRoot);
    }
    (0, protocol_1.log)(`Empty dictionary, triggering project scan at: ${workspaceRoot}`);
    (0, protocol_1.sendBroadcast)('muninn', 'notification', {
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
    }).catch((error) => {
        (0, protocol_1.log)(`[ERROR] Background project scan failed: ${error.message}`);
        (0, protocol_1.sendBroadcast)('muninn', 'notification', {
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
 * Translate new terms via API and store in dictionary
 *
 * The API returns { sourceTerm: translatedTerm } but the dictionary
 * stores { englishTerm: foreignTerm }. We need to flip the key-value
 * pairs when storing non-English source terms.
 */
async function translateNewTerms(origin, sourceLang, targetLang, terms, code, filePath) {
    const context = { filePath, fileContent: code };
    // Determine which language dictionary to update
    const dictLang = sourceLang === 'en' ? targetLang : sourceLang;
    const response = await (0, client_1.translateTerms)(origin, dictLang, terms, context);
    if (response.success && response.data) {
        (0, protocol_1.log)(`Successfully translated ${Object.keys(response.data.translations).length} new terms`);
        // API returns { sourceTerm: translatedTerm }
        // Dictionary stores { englishTerm: foreignTerm }
        // When source is non-English (e.g., JA), we need to flip:
        //   API: { "信五系列": "shingoSeries" }
        //   Dict: { "shingoSeries": "信五系列" }
        let termsToStore;
        if (sourceLang === 'en') {
            // EN→JA: API returns { english: foreign }, dictionary stores same format
            termsToStore = response.data.translations;
        }
        else {
            // JA→EN: API returns { foreign: english }, need to flip for dictionary
            termsToStore = {};
            for (const [foreignTerm, englishTerm] of Object.entries(response.data.translations)) {
                termsToStore[englishTerm] = foreignTerm;
            }
        }
        dictionaryManager.addTerms(origin, dictLang, termsToStore);
        (0, protocol_1.log)(`Stored terms in dictionary: ${JSON.stringify(termsToStore)}`);
    }
    else {
        (0, protocol_1.log)(`Warning: Failed to translate new terms: ${response.error}`);
        (0, protocol_1.sendBroadcast)('muninn', 'notification', {
            severity: 'warn',
            summary: 'Translation Incomplete',
            detail: `Could not translate ${terms.length} new term(s). They may remain untranslated.`,
            life: 5000
        });
    }
}
/**
 * Upload new comments for translation
 */
async function uploadNewComments(origin, targetLang, comments, filePath) {
    const response = await (0, client_1.uploadTerms)(origin, targetLang, [], comments, filePath);
    if (response.success && response.data) {
        (0, protocol_1.log)(`Successfully uploaded ${response.data.addedComments} new comments`);
    }
    else {
        (0, protocol_1.log)(`Warning: Failed to upload new comments: ${response.error}`);
    }
}
/**
 * Translate project in background (fire and forget)
 */
async function translateProjectInBackground(taskId, origin, targetLang, identifierNames, comments, context) {
    try {
        (0, protocol_1.log)(`Background translation started for ${origin} (${targetLang})`);
        // Send progress update
        (0, protocol_1.sendProgress)(taskId, 'Project Translation', 'progress', {
            status: 'uploading',
            statusMessage: 'Sending terms to translation API...',
        });
        // Import translateProject function
        const { translateProject } = await Promise.resolve().then(() => __importStar(require('./api/client')));
        // Call API to translate all identifiers and comments
        const translateResponse = await translateProject(origin, targetLang, identifierNames, comments, context);
        if (translateResponse.success && translateResponse.data) {
            (0, protocol_1.log)(`Background translation API complete: ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments`);
            // Send progress update
            (0, protocol_1.sendProgress)(taskId, 'Project Translation', 'progress', {
                status: 'downloading',
                statusMessage: 'Saving dictionary...',
            });
            // Import conversion function and update dictionary
            const { apiToLocalDictionary } = await Promise.resolve().then(() => __importStar(require('./api/client')));
            const newDictionary = apiToLocalDictionary(translateResponse.data);
            // Save dictionary to cache
            const dictionaryManager = new manager_1.DictionaryManager();
            dictionaryManager.import(JSON.stringify(newDictionary));
            (0, protocol_1.log)(`Background translation fully complete: dictionary saved with ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments`);
            // Send progress complete (this closes the progress indicator)
            (0, protocol_1.sendProgress)(taskId, 'Project Translation', 'complete', {
                status: 'complete',
                statusMessage: `Translated ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments`,
                autoClose: true,
                autoCloseDelay: 3000,
            });
            // Show success notification AFTER everything is done
            const { sendBroadcast } = await Promise.resolve().then(() => __importStar(require('./ipc/protocol')));
            sendBroadcast('muninn', 'notification', {
                severity: 'success',
                summary: 'Project Translation Complete',
                detail: `Translated ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments. You can now change the language in your editor to see the translated code.`,
                life: 8000
            });
        }
        else {
            throw new Error(translateResponse.error || 'Translation failed');
        }
    }
    catch (error) {
        (0, protocol_1.log)(`Background translation failed: ${error.message}`);
        // Send progress error
        (0, protocol_1.sendProgress)(taskId, 'Project Translation', 'error', {
            status: 'error',
            error: error.message || 'Translation failed',
            autoClose: false,
        });
        // Show error notification
        const { sendBroadcast } = await Promise.resolve().then(() => __importStar(require('./ipc/protocol')));
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
function isNonEnglish(str) {
    // Non-ASCII characters indicate non-English text
    // This includes Japanese, Chinese, Korean, Arabic, Cyrillic, etc.
    return /[^\x00-\x7F]/.test(str);
}
/**
 * Detect new terms in code that need translation
 * Works uniformly for any source language
 */
function detectNewTerms(identifiers, sourceLang, dictionary) {
    return identifiers.filter(name => {
        // Skip if term is already in dictionary
        if (dictionary.hasTerm(name))
            return false;
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
async function handleLoadDictionary(message) {
    const { origin, language } = message.data;
    try {
        (0, protocol_1.log)(`Loading dictionary: ${origin} (${language})`);
        // Load or create dictionary (try API first)
        const { dictionary, existsOnAPI } = await dictionaryManager.loadOrCreate(origin, language);
        const termCount = Object.keys(dictionary.terms).length;
        return {
            success: true,
            created: termCount === 0,
            existsOnAPI,
            termCount,
            metadata: dictionary.metadata,
        };
    }
    catch (error) {
        (0, protocol_1.log)(`Load dictionary error: ${error.message}`);
        throw error;
    }
}
/**
 * Handle add-terms request
 * Adds new terms to a dictionary
 */
async function handleAddTerms(message) {
    const { origin, language, terms } = message.data;
    try {
        (0, protocol_1.log)(`Adding ${Object.keys(terms).length} terms to ${origin} (${language})`);
        // Add terms to dictionary (creates if not exists)
        const dictionary = dictionaryManager.exists(origin, language)
            ? dictionaryManager.addTerms(origin, language, terms)
            : dictionaryManager.create(origin, language, terms);
        return {
            success: true,
            totalTerms: Object.keys(dictionary.terms).length,
            addedTerms: Object.keys(terms).length,
            metadata: dictionary.metadata,
        };
    }
    catch (error) {
        (0, protocol_1.log)(`Add terms error: ${error.message}`);
        throw error;
    }
}
/**
 * Handle list-dictionaries request
 * Lists all cached dictionaries
 */
async function handleListDictionaries(message) {
    try {
        const dictionaries = dictionaryManager.listAll();
        return {
            success: true,
            dictionaries,
        };
    }
    catch (error) {
        (0, protocol_1.log)(`List dictionaries error: ${error.message}`);
        throw error;
    }
}
/**
 * Handle extract-identifiers request
 * Extracts all identifiers from source code
 */
async function handleExtractIdentifiers(message) {
    const { code, filePath } = message.data;
    try {
        (0, protocol_1.log)(`Extracting identifiers from ${filePath || 'code'}`);
        const identifiers = identifierExtractor.extract(code, filePath);
        const names = identifiers.map(id => id.name);
        return {
            success: true,
            identifiers,
            names,
            count: names.length,
        };
    }
    catch (error) {
        (0, protocol_1.log)(`Extract identifiers error: ${error.message}`);
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
async function handleScanProject(message) {
    const { origin, targetLang, workspaceRoot } = message.data;
    const taskId = `scan-project-${targetLang}-${Date.now()}`;
    try {
        (0, protocol_1.log)(`Scanning project at ${workspaceRoot} for ${origin} -> ${targetLang}`);
        // Send progress: started
        (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'started', {
            status: 'scanning',
            statusMessage: 'Finding source files...',
        });
        // Find all source files in workspace
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const files = [];
        // Supported extensions
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.rs'];
        // Recursively find files
        function walkDir(dir, depth = 0) {
            // Max depth to prevent infinite loops
            if (depth > 10)
                return;
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
                    }
                    else if (entry.isFile()) {
                        const ext = path.extname(entry.name);
                        if (extensions.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            }
            catch (error) {
                (0, protocol_1.log)(`Failed to read directory ${dir}: ${error.message}`);
            }
        }
        walkDir(workspaceRoot);
        (0, protocol_1.log)(`Found ${files.length} source files`);
        if (files.length === 0) {
            (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'complete', {
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
        (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'progress', {
            status: 'scanning',
            statusMessage: `Extracting identifiers from ${files.length} files...`,
        });
        // Extract identifiers and comments from all files
        const identifierSet = new Set(); // For deduplication
        const allComments = [];
        let totalCharacters = 0; // Track total characters for token estimation
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
                const progressInterval = files.length > 50 ? 10 : (files.length > 20 ? 5 : 2);
                if (filesProcessed % progressInterval === 0 || filesProcessed === files.length) {
                    (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'progress', {
                        status: 'scanning',
                        statusMessage: `Scanned ${filesProcessed}/${files.length} files...`,
                        progress: Math.floor((filesProcessed / files.length) * 50), // 0-50% for scanning
                    });
                }
            }
            catch (error) {
                (0, protocol_1.log)(`Failed to process file ${filePath}: ${error.message}`);
                // Continue with other files
            }
        }
        const uniqueIdentifiers = Array.from(identifierSet);
        // Calculate total characters for token estimation
        // Identifiers: each identifier name
        const identifierChars = uniqueIdentifiers.reduce((sum, id) => sum + id.length, 0);
        // Comments: full text
        const commentChars = allComments.reduce((sum, c) => sum + c.length, 0);
        totalCharacters = identifierChars + commentChars;
        // Estimate tokens (roughly 4 chars per token for English, but identifiers are dense)
        // Use 3 chars per token for identifiers (camelCase splits), 4 for comments
        const estimatedInputTokens = Math.ceil(identifierChars / 3) + Math.ceil(commentChars / 4);
        // Output is roughly same size (translations)
        const estimatedOutputTokens = estimatedInputTokens;
        const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
        // Estimate time: ~1000 tokens/sec for Claude, plus overhead
        // Batch size of 500 terms, ~2 seconds per batch
        const numBatches = Math.ceil(uniqueIdentifiers.length / 500) + Math.ceil(allComments.length / 100);
        const estimatedSeconds = Math.max(5, numBatches * 3); // Minimum 5 seconds
        const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
        (0, protocol_1.log)(`Extracted ${uniqueIdentifiers.length} unique identifiers and ${allComments.length} comments`);
        (0, protocol_1.log)(`Estimated: ${estimatedTotalTokens} tokens, ${estimatedSeconds}s processing time`);
        if (uniqueIdentifiers.length === 0) {
            (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'complete', {
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
        // Demo constraint: show stats and estimates for projects >10 files
        if (files.length > 10) {
            const timeEstimate = estimatedMinutes > 1
                ? `~${estimatedMinutes} minutes`
                : `~${estimatedSeconds} seconds`;
            const statsMessage = [
                `📊 Project Analysis Complete`,
                ``,
                `Files: ${files.length}`,
                `Unique terms: ${uniqueIdentifiers.length}`,
                `Comments: ${allComments.length}`,
                ``,
                `Estimated tokens: ~${estimatedTotalTokens.toLocaleString()}`,
                `Estimated time: ${timeEstimate}`,
                ``,
                `⚠️ Demo mode: Translation disabled for projects >10 files.`,
            ].join('\n');
            (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'complete', {
                status: 'complete',
                statusMessage: statsMessage,
                autoClose: false, // Keep visible so user can read
                details: {
                    files: files.length,
                    terms: uniqueIdentifiers.length,
                    comments: allComments.length,
                    estimatedTokens: estimatedTotalTokens,
                    estimatedSeconds,
                    demoLimited: true,
                },
            });
            // Also send a notification with summary
            (0, protocol_1.sendBroadcast)('muninn', 'notification', {
                severity: 'warn',
                summary: 'Demo Mode Limit',
                detail: `Project has ${files.length} files, ${uniqueIdentifiers.length} terms. Translation requires full license.`,
                life: 10000
            });
            return {
                success: false,
                demoLimited: true,
                message: `Demo mode: ${files.length} files exceeds 10-file limit`,
                stats: {
                    files: files.length,
                    terms: uniqueIdentifiers.length,
                    comments: allComments.length,
                    estimatedTokens: estimatedTotalTokens,
                    estimatedSeconds,
                },
            };
        }
        // TODO: BATCHING REQUIRED FOR PRODUCTION
        // Current implementation sends all identifiers in ONE request.
        // For production, we need to:
        // 1. Check if uniqueIdentifiers.length > 5000 and ask user for confirmation
        // 2. Implement batching (e.g., 1000 identifiers per request)
        // 3. Keep request payloads small (<10 MB) to avoid HTTP limits
        // 4. Handle API timeouts gracefully
        // 5. Show progress per batch (e.g., "Translating batch 3/7...")
        // See: PROJECT_TRANSLATION_STRATEGY.md for full batching strategy
        // Send progress: translating
        (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'progress', {
            status: 'uploading',
            statusMessage: `Translating ${uniqueIdentifiers.length} identifiers to ${targetLang.toUpperCase()}...`,
            progress: 50,
        });
        // Call API to translate
        const { translateProject } = await Promise.resolve().then(() => __importStar(require('./api/client')));
        const translateResponse = await translateProject(origin, targetLang, uniqueIdentifiers, allComments, workspaceRoot);
        if (translateResponse.success && translateResponse.data) {
            (0, protocol_1.log)(`Translation complete: ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments`);
            // Save dictionary
            (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'progress', {
                status: 'downloading',
                statusMessage: 'Saving dictionary...',
                progress: 90,
            });
            const { apiToLocalDictionary } = await Promise.resolve().then(() => __importStar(require('./api/client')));
            const newDictionary = apiToLocalDictionary(translateResponse.data);
            dictionaryManager.import(JSON.stringify(newDictionary));
            // Send completion
            (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'complete', {
                status: 'complete',
                statusMessage: `Translated ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments`,
                progress: 100,
                autoClose: true,
                autoCloseDelay: 3000,
            });
            // Show success notification
            const { sendBroadcast } = await Promise.resolve().then(() => __importStar(require('./ipc/protocol')));
            sendBroadcast('muninn', 'notification', {
                severity: 'success',
                summary: 'Project Translation Complete',
                detail: `Translated ${translateResponse.data.totalTerms} terms and ${translateResponse.data.totalComments} comments. Open any file to see translations.`,
                life: 8000
            });
            return {
                success: true,
                termsTranslated: translateResponse.data.totalTerms,
                commentsTranslated: translateResponse.data.totalComments,
                filesScanned: files.length,
            };
        }
        else {
            throw new Error(translateResponse.error || 'Translation failed');
        }
    }
    catch (error) {
        (0, protocol_1.log)(`Scan project error: ${error.message}`);
        // Send progress error
        (0, protocol_1.sendProgress)(taskId, 'Project Scan', 'error', {
            status: 'error',
            error: error.message || 'Project scan failed',
            autoClose: false,
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
async function handleFileSaved(message) {
    const { code, filePath, origin, sourceLang: providedSourceLang, targetLang: providedTargetLang } = message.data;
    const taskId = `file-save-${Date.now()}`;
    const startTime = Date.now();
    try {
        (0, protocol_1.log)(`[FileSave] Processing file save for ${filePath}`);
        // Validate required fields
        if (!code) {
            (0, protocol_1.log)(`[FileSave] No code content provided, skipping`);
            return {
                success: true,
                code: code,
                translated: false,
                message: 'No code content provided',
            };
        }
        // Origin should be enriched by Muninn before routing to this handler
        if (!origin) {
            (0, protocol_1.log)(`[FileSave] No origin provided by Muninn, skipping translation`);
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
        const sourceLang = providedSourceLang && providedSourceLang !== 'auto'
            ? providedSourceLang
            : 'en'; // Fallback to 'en' - caller should always provide sourceLang for save
        const targetLang = providedTargetLang || 'en';
        (0, protocol_1.log)(`[FileSave] Translation: ${sourceLang} → ${targetLang}`);
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
            (0, protocol_1.log)(`[FileSave] No terms need translation to ${targetLang}`);
            return {
                success: true,
                code: code,
                translated: false,
                message: `No terms need translation to ${targetLang}`,
            };
        }
        (0, protocol_1.log)(`[FileSave] Found ${termsToTranslate.length} terms to translate to ${targetLang}`);
        // Step 3: Load dictionary for the language pair
        const { dictionary } = await dictionaryManager.loadMultiLang(origin, sourceLang, targetLang);
        // Step 4: Identify new terms that aren't in dictionary
        const newTermsToTranslate = termsToTranslate.filter(term => !dictionary.hasTerm(term));
        if (newTermsToTranslate.length > 0) {
            (0, protocol_1.log)(`[FileSave] Found ${newTermsToTranslate.length} NEW terms, uploading for translation...`);
            // Send progress notification
            (0, protocol_1.sendProgress)(taskId, 'Translating New Terms', 'started', {
                status: 'processing',
                statusMessage: `Translating ${newTermsToTranslate.length} new ${sourceLang.toUpperCase()} terms to ${targetLang.toUpperCase()}...`,
            });
            // Upload new terms to API for translation
            const context = { filePath, fileContent: code };
            const response = await (0, client_1.translateTerms)(origin, sourceLang, newTermsToTranslate, context);
            if (response.success && response.data) {
                (0, protocol_1.log)(`[FileSave] Successfully translated ${Object.keys(response.data.translations).length} new terms`);
                // Add translated terms to dictionary
                // The API returns { foreignTerm: englishTerm } mapping
                // We need to store as { englishTerm: foreignTerm } in the dictionary
                const termsToAdd = {};
                for (const [foreignTerm, englishTerm] of Object.entries(response.data.translations)) {
                    termsToAdd[englishTerm] = foreignTerm;
                }
                if (Object.keys(termsToAdd).length > 0) {
                    dictionaryManager.addTerms(origin, sourceLang, termsToAdd);
                }
                (0, protocol_1.sendProgress)(taskId, 'Translating New Terms', 'complete', {
                    status: 'complete',
                    statusMessage: `Translated ${Object.keys(response.data.translations).length} new terms`,
                    autoClose: true,
                    autoCloseDelay: 2000,
                });
            }
            else {
                (0, protocol_1.log)(`[FileSave] Warning: Failed to translate new terms: ${response.error}`);
                (0, protocol_1.sendProgress)(taskId, 'Translating New Terms', 'error', {
                    status: 'error',
                    error: response.error || 'Failed to translate new terms',
                    autoClose: true,
                    autoCloseDelay: 3000,
                });
            }
        }
        // Step 5: Reload dictionary and translate code to target language
        const { dictionary: finalDict } = await dictionaryManager.loadMultiLang(origin, sourceLang, targetLang);
        const translator = new unifiedTranslator_1.UnifiedTranslator(finalDict);
        const translateStartTime = Date.now();
        const result = translator.translate(code, sourceLang, targetLang);
        (0, protocol_1.log)(`[FileSave] Code translated in ${Date.now() - translateStartTime}ms, tokens: ${result.translatedTokens.length}`);
        const totalTime = Date.now() - startTime;
        (0, protocol_1.log)(`[FileSave] Total processing time: ${totalTime}ms`);
        // Log any unmapped terms (terms without translation in dictionary)
        if (result.unmappedTokens.length > 0) {
            (0, protocol_1.log)(`[FileSave] Warning: ${result.unmappedTokens.length} terms could not be translated to ${targetLang}: ${result.unmappedTokens.slice(0, 5).join(', ')}${result.unmappedTokens.length > 5 ? '...' : ''}`);
        }
        return {
            success: true,
            code: result.code,
            translated: true,
            translatedTokens: result.translatedTokens,
            unmappedTokens: result.unmappedTokens,
        };
    }
    catch (error) {
        (0, protocol_1.log)(`[FileSave] Error: ${error.message}`);
        (0, protocol_1.sendProgress)(taskId, 'File Save Translation', 'error', {
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
async function handleActivePath(message) {
    const { origin, dictionaryVersion, currentLanguage } = message.data;
    // Only sync if we have a target language and it's not English
    if (!currentLanguage || currentLanguage === 'en') {
        return;
    }
    // Check if dictionary exists locally
    if (!dictionaryManager.exists(origin, currentLanguage)) {
        (0, protocol_1.log)(`[ActivePath] Dictionary doesn't exist locally: ${origin} (${currentLanguage})`);
        return;
    }
    try {
        // Load local dictionary to get lastSyncDate
        const dictionary = dictionaryManager.load(origin, currentLanguage);
        const lastSyncDate = dictionary.metadata.lastSyncDate;
        if (!lastSyncDate) {
            (0, protocol_1.log)(`[ActivePath] No lastSyncDate in dictionary, skipping sync`);
            return;
        }
        if (!dictionaryVersion) {
            (0, protocol_1.log)(`[ActivePath] No dictionaryVersion in active-path response, skipping sync`);
            return;
        }
        // Compare timestamps (lexicographic comparison works for ISO 8601)
        if (dictionaryVersion > lastSyncDate) {
            (0, protocol_1.log)(`[ActivePath] Dictionary has updates (local: ${lastSyncDate}, remote: ${dictionaryVersion}), syncing...`);
            // Sync dictionary
            const termCount = await dictionaryManager.sync(origin, currentLanguage);
            if (termCount > 0) {
                (0, protocol_1.log)(`[ActivePath] Synced ${termCount} new terms for ${currentLanguage}`);
            }
        }
        else {
            (0, protocol_1.log)(`[ActivePath] Dictionary is up to date (local: ${lastSyncDate}, remote: ${dictionaryVersion})`);
        }
    }
    catch (error) {
        (0, protocol_1.log)(`[ActivePath] Sync error: ${error.message}`);
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
async function handleHeadChanged(message) {
    const { origin, oldSha, newSha, workspaceRoot, reason } = message.data || {};
    (0, protocol_1.log)(`[HeadChanged] Git HEAD changed: ${oldSha?.substring(0, 7)} → ${newSha?.substring(0, 7)} (${reason || 'unknown'})`);
    if (!origin || !workspaceRoot) {
        (0, protocol_1.log)(`[HeadChanged] Missing origin or workspaceRoot, skipping scan`);
        return;
    }
    // Check if we have any dictionaries for this origin
    const allDictionaries = dictionaryManager.listAll();
    const originDictionaries = allDictionaries.filter(d => d.origin === origin);
    if (originDictionaries.length === 0) {
        (0, protocol_1.log)(`[HeadChanged] No dictionaries exist for ${origin}, skipping scan`);
        return;
    }
    // Get the user's current language preference (use first dictionary's language as fallback)
    // In practice, this should come from the active Huginn client's language setting
    const targetLang = originDictionaries[0].language;
    (0, protocol_1.log)(`[HeadChanged] Triggering project scan for ${origin} -> ${targetLang}`);
    // Show notification to user
    (0, protocol_1.sendBroadcast)('muninn', 'notification', {
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
    }).catch((error) => {
        (0, protocol_1.log)(`[HeadChanged] Project scan failed: ${error.message}`);
        (0, protocol_1.sendBroadcast)('muninn', 'notification', {
            severity: 'error',
            summary: 'Scan Failed',
            detail: `Failed to scan for new terms: ${error.message}`,
            life: 8000
        });
    });
}
/**
 * TEMPORARY TEST: Progress event tester
 * Sends progress events every 5 seconds (completes after 2 seconds)
 * To start: send { domain: 'i18n', action: 'test-progress', data: { start: true } }
 * To stop: send { domain: 'i18n', action: 'test-progress', data: { stop: true } }
 */
let testProgressInterval = null;
async function handleTestProgress(message) {
    const { start, stop } = message.data;
    if (stop) {
        if (testProgressInterval) {
            clearInterval(testProgressInterval);
            testProgressInterval = null;
            (0, protocol_1.log)('[TEST] Progress test stopped');
            return { success: true, message: 'Progress test stopped' };
        }
        else {
            return { success: false, message: 'No progress test running' };
        }
    }
    if (start) {
        // Stop existing test if running
        if (testProgressInterval) {
            clearInterval(testProgressInterval);
        }
        (0, protocol_1.log)('[TEST] Starting progress test (new task every 5s, completes after 2s)');
        let taskCounter = 0;
        const runTest = () => {
            taskCounter++;
            const taskId = `test-task-${taskCounter}-${Date.now()}`;
            // Random duration between 2 and 15 seconds
            const duration = Math.floor(Math.random() * (15000 - 2000 + 1)) + 2000;
            const midpoint = duration / 2;
            (0, protocol_1.log)(`[TEST] Starting task: ${taskId} (duration: ${duration}ms)`);
            // Send started event
            (0, protocol_1.sendProgress)(taskId, `Test Task #${taskCounter}`, 'started', {
                status: 'processing',
                statusMessage: `Testing progress events (${(duration / 1000).toFixed(1)}s)...`,
                progress: 0,
            });
            // Send progress update at 25%
            setTimeout(() => {
                (0, protocol_1.log)(`[TEST] Progress 25% for: ${taskId}`);
                (0, protocol_1.sendProgress)(taskId, `Test Task #${taskCounter}`, 'progress', {
                    status: 'processing',
                    statusMessage: 'Making progress...',
                    progress: 25,
                });
            }, duration * 0.25);
            // Send progress update at 50%
            setTimeout(() => {
                (0, protocol_1.log)(`[TEST] Progress 50% for: ${taskId}`);
                (0, protocol_1.sendProgress)(taskId, `Test Task #${taskCounter}`, 'progress', {
                    status: 'processing',
                    statusMessage: 'Halfway through...',
                    progress: 50,
                });
            }, midpoint);
            // Send progress update at 75%
            setTimeout(() => {
                (0, protocol_1.log)(`[TEST] Progress 75% for: ${taskId}`);
                (0, protocol_1.sendProgress)(taskId, `Test Task #${taskCounter}`, 'progress', {
                    status: 'processing',
                    statusMessage: 'Almost done...',
                    progress: 75,
                });
            }, duration * 0.75);
            // Complete after random duration
            setTimeout(() => {
                (0, protocol_1.log)(`[TEST] Completing task: ${taskId}`);
                (0, protocol_1.sendProgress)(taskId, `Test Task #${taskCounter}`, 'complete', {
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
function handleAuthInfo(message) {
    const data = message.data;
    (0, store_1.setAuthState)(data);
    // No response needed for broadcast messages
}
/**
 * Handle extension:ready broadcast from Muninn
 * Signals that Muninn is ready and provides initial auth state
 */
function handleExtensionReady(message) {
    (0, protocol_1.log)('[Extension] Received extension:ready from Muninn');
    // Store auth state from the ready message
    const data = message.data;
    if (data) {
        (0, store_1.setAuthState)(data);
        (0, protocol_1.log)(`[Extension] Auth state initialized: authenticated=${data.authenticated}`);
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
async function handleDirectTranslateCode(message, caw) {
    const { code, filePath, targetLang } = message.data;
    (0, protocol_1.log)(`[Direct] translate-code for ${filePath} -> ${targetLang}`);
    // Get origin from cache or Muninn
    const originResult = await (0, server_1.getOriginForPath)(filePath);
    if (!originResult) {
        return {
            success: false,
            error: 'Could not determine repository origin. Is this file in a git repository?'
        };
    }
    // For display translation, source is ALWAYS English.
    // Files on disk are stored in English - that's our design.
    // Create enriched message and delegate to existing handler
    const enrichedMessage = {
        ...message,
        data: {
            ...message.data,
            origin: originResult.origin,
            sourceLang: 'en' // Files on disk are always English
        }
    };
    return handleTranslateCode(enrichedMessage);
}
/**
 * Handle direct file-saved request from Huginn
 * Translates foreign content to English for saving
 */
async function handleDirectFileSaved(message, caw) {
    const { code, filePath } = message.data;
    (0, protocol_1.log)(`[Direct] file-saved for ${filePath}`);
    // Get origin from cache or Muninn
    const originResult = await (0, server_1.getOriginForPath)(filePath);
    if (!originResult) {
        return {
            success: false,
            error: 'Could not determine repository origin. Is this file in a git repository?'
        };
    }
    // Get source language from our local state
    const sourceLang = (0, server_1.getLanguage)(caw);
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
    const enrichedMessage = {
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
async function handleDirectSetLanguage(message, caw) {
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
    (0, server_1.setLanguage)(caw, lang);
    (0, protocol_1.log)(`[Direct] Set language for CAW ${caw}: ${lang}`);
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
async function handleDirectGetLanguage(message, caw) {
    const lang = (0, server_1.getLanguage)(caw);
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
    (0, protocol_1.log)(`=== Kawa i18n Extension v${VERSION} ===`);
    // -------------------------------------------------------------------------
    // STDIN HANDLERS (Muninn communication)
    // -------------------------------------------------------------------------
    // Register response interceptor to handle our own Muninn requests
    (0, handlers_1.addResponseInterceptor)(server_1.handleMuninnResponse);
    // Register request handlers for Muninn routing
    (0, handlers_1.registerHandler)('i18n', 'translate-code', handleTranslateCode);
    (0, handlers_1.registerHandler)('i18n', 'file-saved', handleFileSaved);
    (0, handlers_1.registerHandler)('i18n', 'scan-project', handleScanProject);
    (0, handlers_1.registerHandler)('i18n', 'load-dictionary', handleLoadDictionary);
    (0, handlers_1.registerHandler)('i18n', 'add-terms', handleAddTerms);
    (0, handlers_1.registerHandler)('i18n', 'list-dictionaries', handleListDictionaries);
    (0, handlers_1.registerHandler)('i18n', 'extract-identifiers', handleExtractIdentifiers);
    // TEMPORARY: Register test handler
    (0, handlers_1.registerHandler)('i18n', 'test-progress', handleTestProgress);
    // Register intent translation handlers under i18n domain (routed to extension)
    // These use the i18n domain to bypass Gardener's intent handling
    (0, handlers_1.registerHandler)('i18n', 'normalize-intent', handlers_2.handleNormalizeIntent);
    (0, handlers_1.registerHandler)('i18n', 'translate-intent-metadata', handlers_2.handleTranslateIntentMetadata);
    // Register intent handlers (for Muninn routing - legacy, may be intercepted by Gardener)
    (0, handlers_1.registerHandler)('intent', 'get-for-file', handlers_2.handleGetIntentsForFile);
    (0, handlers_1.registerHandler)('intent', 'get-for-lines', handlers_2.handleGetIntentsForLines);
    (0, handlers_1.registerHandler)('intent', 'normalize', handlers_2.handleNormalizeIntent);
    (0, handlers_1.registerHandler)('intent', 'translate-metadata', handlers_2.handleTranslateIntentMetadata);
    (0, handlers_1.registerHandler)('intent-block', 'get-content-translated', handlers_2.handleGetBlockContentTranslated);
    // Register broadcast handlers
    (0, handlers_1.registerHandler)('repo', 'active-path', handleActivePath);
    (0, handlers_1.registerHandler)('repo', 'head-changed', handleHeadChanged);
    // Register auth handler to receive tokens from Muninn
    (0, handlers_1.registerHandler)('auth', 'info', handleAuthInfo);
    // Register extension:ready handler to know when Muninn is ready
    (0, handlers_1.registerHandler)('extension', 'ready', handleExtensionReady);
    // Start listening on stdin for Muninn messages
    (0, handlers_1.startListening)();
    // -------------------------------------------------------------------------
    // DIRECT IPC SERVER (Huginn communication)
    // -------------------------------------------------------------------------
    // Register direct handlers for Huginn clients
    (0, server_1.registerDirectHandler)('i18n', 'translate-code', handleDirectTranslateCode);
    (0, server_1.registerDirectHandler)('i18n', 'file-saved', handleDirectFileSaved);
    (0, server_1.registerDirectHandler)('user', 'set-language', handleDirectSetLanguage);
    (0, server_1.registerDirectHandler)('user', 'get-language', handleDirectGetLanguage);
    // Register intent direct handlers for Huginn clients
    (0, server_1.registerDirectHandler)('intent', 'get-for-file', handlers_2.handleDirectGetIntentsForFile);
    (0, server_1.registerDirectHandler)('intent', 'get-for-lines', handlers_2.handleDirectGetIntentsForLines);
    (0, server_1.registerDirectHandler)('intent-block', 'get-content-translated', handlers_2.handleDirectGetBlockContentTranslated);
    // Start the direct IPC server for Huginn clients
    try {
        await (0, server_1.startDirectServer)();
        (0, protocol_1.log)('Direct IPC server started - Huginn clients can connect directly');
    }
    catch (error) {
        (0, protocol_1.log)(`[Warning] Failed to start direct IPC server: ${error.message}`);
        (0, protocol_1.log)('Huginn clients will use Muninn routing as fallback');
    }
    (0, protocol_1.log)('i18n extension ready (Muninn stdin + Direct IPC)');
}
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    (0, protocol_1.log)(`[Fatal] Uncaught exception: ${error.message}`);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    (0, protocol_1.log)(`[Fatal] Unhandled rejection: ${reason}`);
    process.exit(1);
});
// Start
main().catch((error) => {
    (0, protocol_1.log)(`[Fatal] Failed to start: ${error.message}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map