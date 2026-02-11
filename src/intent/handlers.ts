/**
 * Intent Decoration Handlers
 *
 * Handlers for querying and translating intent metadata.
 * Uses English as pivot language for multilingual teams.
 */

import { IPCMessage, log } from '../ipc/protocol';
import { requestFromMuninn, getLanguage } from '../ipc/server';
import { intentCacheManager, blockContentCacheManager } from './cache';
import {
  translateText as localTranslateText,
  translateIdentifiers as localTranslateIdentifiers,
} from '../claude';
import {
  IntentDecoration,
  GardenerIntentsForFileResponse,
  GardenerIntent,
  IntentsForFileResponse,
  NormalizeIntentResponse,
  IntentTemplateType,
  IntentStatus,
  GardenerBlockContentResponse,
  BlockContentTranslatedResponse,
} from './types';
import { LanguageCode } from '../core/types';

/**
 * Simple language detection based on character analysis
 * Returns 'en' for ASCII-only text, or a likely non-English code
 */
function detectLanguage(text: string): LanguageCode {
  if (!text) return 'en';

  // Check for non-ASCII characters
  const hasNonAscii = /[^\x00-\x7F]/.test(text);
  if (!hasNonAscii) return 'en';

  // Check for Japanese characters (hiragana, katakana, kanji)
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)) return 'ja';

  // Check for Chinese characters (excluding Japanese-specific)
  if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'zh';

  // Check for Korean characters
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return 'ko';

  // Check for Cyrillic (Russian)
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';

  // Check for Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';

  // Default to English for other non-ASCII
  return 'en';
}

/**
 * Translate text from English to target language using local Claude CLI
 */
async function translateToTargetLang(
  _origin: string,
  text: string,
  targetLang: LanguageCode
): Promise<string> {
  if (!text || targetLang === 'en') {
    return text;
  }

  try {
    // Use local translation via Claude CLI
    const translations = await localTranslateText([text], 'en', targetLang);
    return translations[text] || text;
  } catch (error: any) {
    log(`[Intent] Translation failed: ${error.message}`);
    return text;
  }
}

/**
 * Translate text between any two languages using local Claude CLI
 */
async function translateBetweenLanguages(
  _origin: string,
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): Promise<string> {
  if (!text || sourceLang === targetLang) {
    return text;
  }

  try {
    // Use local translation via Claude CLI
    const translations = await localTranslateText([text], sourceLang, targetLang);
    return translations[text] || text;
  } catch (error: any) {
    log(`[Intent] Translation failed: ${error.message}`);
    return text;
  }
}

/**
 * Translate an intent to the user's target language
 */
async function translateIntent(
  origin: string,
  intent: GardenerIntent,
  targetLang: LanguageCode
): Promise<IntentDecoration> {
  const cache = intentCacheManager.getCache(origin);

  // Detect source language from intent content
  const sourceLang = detectLanguage(intent.title);

  // Check cache first
  const cached = cache.get(intent.id, targetLang);
  if (cached) {
    log(`[Intent] Cache hit for ${intent.id} -> ${targetLang}`);
    return {
      id: intent.id,
      title: cached.title,
      titleOriginal: intent.title,
      originalLang: sourceLang,
      description: cached.description,
      descriptionOriginal: intent.description,
      status: intent.status as IntentStatus,
      author: intent.author,
      templateType: intent.templateType as IntentTemplateType,
      blocks: intent.blocks,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    };
  }

  // Translate if target differs from source
  let translatedTitle = intent.title;
  let translatedDescription = intent.description;

  if (targetLang !== sourceLang) {
    log(`[Intent] Translating intent ${intent.id} from ${sourceLang} to ${targetLang}`);
    [translatedTitle, translatedDescription] = await Promise.all([
      translateBetweenLanguages(origin, intent.title, sourceLang, targetLang),
      translateBetweenLanguages(origin, intent.description, sourceLang, targetLang),
    ]);

    // Cache the translations
    cache.set(intent.id, targetLang, translatedTitle, translatedDescription);
  }

  return {
    id: intent.id,
    title: translatedTitle,
    titleOriginal: intent.title,
    originalLang: sourceLang,
    description: translatedDescription,
    descriptionOriginal: intent.description,
    status: intent.status as IntentStatus,
    author: intent.author,
    templateType: intent.templateType as IntentTemplateType,
    blocks: intent.blocks,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

/**
 * Handle get-for-file request
 *
 * Queries Gardener for intents covering a file, translates titles/descriptions
 * to the user's preferred language.
 */
export async function handleGetIntentsForFile(message: IPCMessage): Promise<IntentsForFileResponse> {
  const { repoOrigin, filePath, targetLang } = message.data;

  if (!repoOrigin || !filePath) {
    return {
      success: false,
      intents: [],
      lineMap: {},
      blockCount: 0,
      error: 'Missing repoOrigin or filePath',
    };
  }

  const lang: LanguageCode = targetLang || 'en';

  try {
    log(`[Intent] Getting intents for file: ${filePath} (${lang})`);

    // Query Gardener for intents
    const response = await requestFromMuninn({
      flow: 'req',
      domain: 'intent-block',
      action: 'get-for-file',
      caw: message.caw,
      data: { repoOrigin, filePath },
    }) as GardenerIntentsForFileResponse;

    if (!response.success) {
      return {
        success: false,
        intents: [],
        lineMap: {},
        blockCount: 0,
        error: response.error || 'Failed to get intents from Gardener',
      };
    }

    // Translate intents to target language
    const translatedIntents = await Promise.all(
      response.intents.map((intent) => translateIntent(repoOrigin, intent, lang))
    );

    log(`[Intent] Returning ${translatedIntents.length} intents for ${filePath}`);

    return {
      success: true,
      intents: translatedIntents,
      lineMap: response.lineMap,
      blockCount: response.blockCount,
    };
  } catch (error: any) {
    log(`[Intent] Error getting intents for file: ${error.message}`);
    return {
      success: false,
      intents: [],
      lineMap: {},
      blockCount: 0,
      error: error.message,
    };
  }
}

/**
 * Handle get-for-lines request
 *
 * Queries Gardener for intents covering specific lines.
 */
export async function handleGetIntentsForLines(message: IPCMessage): Promise<IntentsForFileResponse> {
  const { repoOrigin, filePath, startLine, endLine, targetLang } = message.data;

  if (!repoOrigin || !filePath || !startLine || !endLine) {
    return {
      success: false,
      intents: [],
      lineMap: {},
      blockCount: 0,
      error: 'Missing required parameters',
    };
  }

  const lang: LanguageCode = targetLang || 'en';

  try {
    log(`[Intent] Getting intents for lines ${startLine}-${endLine} in ${filePath}`);

    // Query Gardener for intents
    const response = await requestFromMuninn({
      flow: 'req',
      domain: 'intent-block',
      action: 'get-for-lines',
      caw: message.caw,
      data: { repoOrigin, filePath, startLine, endLine },
    });

    if (!response.success) {
      return {
        success: false,
        intents: [],
        lineMap: {},
        blockCount: 0,
        error: response.error || 'Failed to get intents from Gardener',
      };
    }

    // Translate intents to target language
    const translatedIntents = await Promise.all(
      response.intents.map((intent: GardenerIntent) => translateIntent(repoOrigin, intent, lang))
    );

    return {
      success: true,
      intents: translatedIntents,
      lineMap: {},
      blockCount: response.intents.length,
    };
  } catch (error: any) {
    log(`[Intent] Error getting intents for lines: ${error.message}`);
    return {
      success: false,
      intents: [],
      lineMap: {},
      blockCount: 0,
      error: error.message,
    };
  }
}

/**
 * Handle normalize intent request
 *
 * Translates intent title/description/constraints to English for storage.
 * Used when creating new intents to normalize to English pivot.
 */
export async function handleNormalizeIntent(message: IPCMessage): Promise<NormalizeIntentResponse> {
  const { title, description, constraints = [], origin } = message.data;

  if (!title || !origin) {
    return {
      success: false,
      titleEn: title || '',
      descriptionEn: description || '',
      constraintsEn: constraints,
      detectedSourceLang: 'en',
      titleOriginal: title || '',
      descriptionOriginal: description || '',
      constraintsOriginal: constraints,
      error: 'Missing title or origin',
    };
  }

  try {
    // Detect language of title
    const detectedLang = detectLanguage(title);
    log(`[Intent] Detected language for title: ${detectedLang}`);

    // If already English, no translation needed
    if (detectedLang === 'en') {
      return {
        success: true,
        titleEn: title,
        descriptionEn: description || '',
        constraintsEn: constraints,
        detectedSourceLang: 'en',
        titleOriginal: title,
        descriptionOriginal: description || '',
        constraintsOriginal: constraints,
      };
    }

    // Translate to English using local Claude CLI
    log(`[Intent] Normalizing intent from ${detectedLang} to English locally`);

    // Build list of all texts to translate
    const textsToTranslate: string[] = [title];
    if (description) textsToTranslate.push(description);
    if (constraints.length > 0) textsToTranslate.push(...constraints.filter(Boolean));

    // Use local translation via Claude CLI
    const translations = await localTranslateText(textsToTranslate, detectedLang as LanguageCode, 'en');

    const titleEn = translations[title] || title;
    const descriptionEn = description ? (translations[description] || description) : '';
    const constraintsEn = constraints.map((c: string) => c ? (translations[c] || c) : c);

    return {
      success: true,
      titleEn,
      descriptionEn,
      constraintsEn,
      detectedSourceLang: detectedLang,
      titleOriginal: title,
      descriptionOriginal: description || '',
      constraintsOriginal: constraints,
    };
  } catch (error: any) {
    log(`[Intent] Normalization error: ${error.message}`);
    return {
      success: false,
      titleEn: title,
      descriptionEn: description || '',
      constraintsEn: constraints,
      detectedSourceLang: 'en',
      titleOriginal: title,
      descriptionOriginal: description || '',
      constraintsOriginal: constraints,
      error: error.message,
    };
  }
}

/**
 * Handle detect language request
 *
 * Detects the language of the provided text.
 */
export async function handleDetectLanguage(message: IPCMessage): Promise<any> {
  const { text, origin } = message.data;

  if (!text) {
    return {
      success: false,
      detectedLang: 'en',
      error: 'Missing text',
    };
  }

  try {
    const detectedLang = detectLanguage(text);
    log(`[Intent] Detected language: ${detectedLang}`);
    return {
      success: true,
      detectedLang,
    };
  } catch (error: any) {
    log(`[Intent] Language detection error: ${error.message}`);
    return {
      success: false,
      detectedLang: 'en',
      error: error.message,
    };
  }
}

/**
 * Handle translate intent metadata request
 *
 * Translates intent title/description/constraints from source to target language.
 * Used when displaying intents in user's preferred language.
 */
export async function handleTranslateIntentMetadata(message: IPCMessage): Promise<any> {
  const { intentId, title, description, constraints = [], sourceLang, targetLang, origin } = message.data;

  // Support both old (titleEn) and new (title + sourceLang) formats for backward compatibility
  const sourceTitle = title || message.data.titleEn || '';
  const sourceDescription = description || message.data.descriptionEn || '';
  const sourceConstraints = constraints.length > 0 ? constraints : (message.data.constraintsEn || []);
  const sourceLanguage = sourceLang || 'en';

  if (!intentId || !origin) {
    return {
      success: false,
      intentId: intentId || '',
      title: sourceTitle,
      description: sourceDescription,
      constraints: sourceConstraints,
      targetLang: targetLang || 'en',
      cached: false,
      error: 'Missing intentId or origin',
    };
  }

  // If source and target are the same, return as-is
  if (sourceLanguage === targetLang) {
    return {
      success: true,
      intentId,
      title: sourceTitle,
      description: sourceDescription,
      constraints: sourceConstraints,
      targetLang,
      cached: false,
    };
  }

  try {
    // Check cache first
    const cache = intentCacheManager.getCache(origin);
    const cached = cache.getMetadata(intentId, targetLang);

    if (cached) {
      log(`[Intent] Metadata cache hit for ${intentId} -> ${targetLang}`);
      return {
        success: true,
        intentId,
        title: cached.title,
        description: cached.description,
        constraints: cached.constraints || sourceConstraints,
        targetLang,
        cached: true,
      };
    }

    log(`[Intent] Translating intent metadata ${intentId} from ${sourceLanguage} to ${targetLang}`);

    // Build list of all texts to translate
    const textsToTranslate: string[] = [];
    if (sourceTitle) textsToTranslate.push(sourceTitle);
    if (sourceDescription) textsToTranslate.push(sourceDescription);
    const nonEmptyConstraints = sourceConstraints.filter(Boolean);
    if (nonEmptyConstraints.length > 0) textsToTranslate.push(...nonEmptyConstraints);

    if (textsToTranslate.length === 0) {
      return {
        success: true,
        intentId,
        title: '',
        description: '',
        constraints: [],
        targetLang,
        cached: false,
      };
    }

    // Use local translation via Claude CLI
    const translations = await localTranslateText(textsToTranslate, sourceLanguage as LanguageCode, targetLang as LanguageCode);

    const translatedTitle = sourceTitle ? (translations[sourceTitle] || sourceTitle) : '';
    const translatedDescription = sourceDescription ? (translations[sourceDescription] || sourceDescription) : '';
    const translatedConstraints = nonEmptyConstraints.map((c: string) => translations[c] || c);

    // Cache the translations
    cache.setMetadata(intentId, targetLang, { title: translatedTitle, description: translatedDescription, constraints: translatedConstraints });

    return {
      success: true,
      intentId,
      title: translatedTitle,
      description: translatedDescription,
      constraints: translatedConstraints,
      targetLang,
      cached: false,
    };
  } catch (error: any) {
    log(`[Intent] Metadata translation error: ${error.message}`);
    return {
      success: false,
      intentId,
      title: sourceTitle,
      description: sourceDescription,
      constraints: sourceConstraints,
      targetLang,
      cached: false,
      error: error.message,
    };
  }
}

/**
 * Direct handler for get-for-file (from Huginn clients)
 */
export async function handleDirectGetIntentsForFile(message: IPCMessage, caw: string): Promise<IntentsForFileResponse> {
  // Get user's language preference
  const targetLang = message.data.targetLang || getLanguage(caw);

  // Enrich message with target language
  const enrichedMessage: IPCMessage = {
    ...message,
    data: {
      ...message.data,
      targetLang,
    },
  };

  return handleGetIntentsForFile(enrichedMessage);
}

/**
 * Direct handler for get-for-lines (from Huginn clients)
 */
export async function handleDirectGetIntentsForLines(message: IPCMessage, caw: string): Promise<IntentsForFileResponse> {
  // Get user's language preference
  const targetLang = message.data.targetLang || getLanguage(caw);

  // Enrich message with target language
  const enrichedMessage: IPCMessage = {
    ...message,
    data: {
      ...message.data,
      targetLang,
    },
  };

  return handleGetIntentsForLines(enrichedMessage);
}

// ============================================================================
// Block Content Handlers
// ============================================================================

/**
 * Extract comments from code content
 * Returns array of comment strings with their line ranges
 */
function extractComments(content: string, language: string): Array<{
  text: string;
  startLine: number;
  endLine: number;
  type: 'line' | 'block';
}> {
  const comments: Array<{
    text: string;
    startLine: number;
    endLine: number;
    type: 'line' | 'block';
  }> = [];

  const lines = content.split('\n');

  // Different comment patterns based on language
  let lineCommentPrefix = '//';
  let blockCommentStart = '/*';
  let blockCommentEnd = '*/';

  if (['python', 'ruby', 'bash', 'shell'].includes(language)) {
    lineCommentPrefix = '#';
    blockCommentStart = '"""';
    blockCommentEnd = '"""';
  } else if (language === 'html' || language === 'xml') {
    lineCommentPrefix = ''; // No line comments
    blockCommentStart = '<!--';
    blockCommentEnd = '-->';
  } else if (language === 'lua') {
    lineCommentPrefix = '--';
    blockCommentStart = '--[[';
    blockCommentEnd = ']]';
  } else if (language === 'lisp' || language === 'clojure') {
    lineCommentPrefix = ';';
    blockCommentStart = '';
    blockCommentEnd = '';
  }

  let inBlockComment = false;
  let blockCommentText = '';
  let blockCommentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Handle block comments
    if (blockCommentStart) {
      if (inBlockComment) {
        const endIdx = line.indexOf(blockCommentEnd);
        if (endIdx !== -1) {
          blockCommentText += '\n' + line.substring(0, endIdx);
          comments.push({
            text: blockCommentText.trim(),
            startLine: blockCommentStartLine,
            endLine: lineNum,
            type: 'block',
          });
          inBlockComment = false;
          blockCommentText = '';
        } else {
          blockCommentText += '\n' + line;
        }
        continue;
      }

      const startIdx = line.indexOf(blockCommentStart);
      if (startIdx !== -1) {
        const endIdx = line.indexOf(blockCommentEnd, startIdx + blockCommentStart.length);
        if (endIdx !== -1) {
          // Single-line block comment
          const text = line.substring(startIdx + blockCommentStart.length, endIdx);
          comments.push({
            text: text.trim(),
            startLine: lineNum,
            endLine: lineNum,
            type: 'block',
          });
        } else {
          // Start of multi-line block comment
          inBlockComment = true;
          blockCommentStartLine = lineNum;
          blockCommentText = line.substring(startIdx + blockCommentStart.length);
        }
        continue;
      }
    }

    // Handle line comments
    if (lineCommentPrefix) {
      const trimmed = line.trim();
      if (trimmed.startsWith(lineCommentPrefix)) {
        const text = trimmed.substring(lineCommentPrefix.length).trim();
        if (text) {
          comments.push({
            text,
            startLine: lineNum,
            endLine: lineNum,
            type: 'line',
          });
        }
      } else {
        // Check for inline comment
        const commentIdx = line.indexOf(lineCommentPrefix);
        if (commentIdx !== -1) {
          // Make sure it's not inside a string (simple check)
          const beforeComment = line.substring(0, commentIdx);
          const singleQuotes = (beforeComment.match(/'/g) || []).length;
          const doubleQuotes = (beforeComment.match(/"/g) || []).length;
          const backticks = (beforeComment.match(/`/g) || []).length;

          // If all quote counts are even, we're not in a string
          if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0 && backticks % 2 === 0) {
            const text = line.substring(commentIdx + lineCommentPrefix.length).trim();
            if (text) {
              comments.push({
                text,
                startLine: lineNum,
                endLine: lineNum,
                type: 'line',
              });
            }
          }
        }
      }
    }
  }

  return comments;
}

/**
 * Replace comments in code with translated versions
 */
function replaceComments(
  content: string,
  language: string,
  translations: Record<string, string>
): string {
  let result = content;

  // Determine comment prefix based on language
  let lineCommentPrefix = '//';
  if (['python', 'ruby', 'bash', 'shell'].includes(language)) {
    lineCommentPrefix = '#';
  } else if (language === 'lua') {
    lineCommentPrefix = '--';
  } else if (language === 'lisp' || language === 'clojure') {
    lineCommentPrefix = ';';
  }

  // Replace comments with translations
  for (const [original, translated] of Object.entries(translations)) {
    if (original && translated && original !== translated) {
      // Escape special regex characters in original
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      result = result.replace(regex, translated);
    }
  }

  return result;
}

/**
 * Handle get-content-translated request
 *
 * Fetches full code content for a block and translates comments/strings
 * to the user's preferred language.
 */
export async function handleGetBlockContentTranslated(
  message: IPCMessage
): Promise<BlockContentTranslatedResponse> {
  const { repoOrigin, filePath, startLine, endLine, targetLang } = message.data;

  if (!repoOrigin || !filePath || !startLine || !endLine) {
    return {
      success: false,
      startLine: startLine || 0,
      endLine: endLine || 0,
      totalLines: 0,
      translated: false,
      error: 'Missing required parameters (repoOrigin, filePath, startLine, endLine)',
    };
  }

  const lang: LanguageCode = targetLang || 'en';

  try {
    log(`[BlockContent] Getting content for ${filePath}:${startLine}-${endLine} (${lang})`);

    // Check cache first
    const cache = blockContentCacheManager.getCache(repoOrigin);
    const cached = cache.get(filePath, startLine, endLine, lang);
    if (cached) {
      log(`[BlockContent] Cache hit for ${filePath}:${startLine}-${endLine}`);
      return {
        success: true,
        content: cached.content,
        translatedContent: cached.translatedContent,
        language: cached.language,
        sourceCommentLang: cached.sourceCommentLang,
        startLine,
        endLine,
        totalLines: cached.content.split('\n').length,
        translated: cached.content !== cached.translatedContent,
      };
    }

    // Fetch raw content from Gardener
    const response = await requestFromMuninn({
      flow: 'req',
      domain: 'intent-block',
      action: 'get-content',
      caw: message.caw,
      data: { repoOrigin, filePath, startLine, endLine },
    }) as GardenerBlockContentResponse;

    if (!response.success || !response.content) {
      return {
        success: false,
        startLine,
        endLine,
        totalLines: 0,
        translated: false,
        error: response.error || 'Failed to get content from Gardener',
      };
    }

    const { content, language: progLang } = response;

    // If target is English, no translation needed
    if (lang === 'en') {
      // Cache even for English to avoid repeated Gardener calls
      cache.set(filePath, startLine, endLine, lang, content, content, progLang || 'text', 'en');

      return {
        success: true,
        content,
        translatedContent: content,
        language: progLang,
        sourceCommentLang: 'en',
        startLine: response.startLine,
        endLine: response.endLine,
        totalLines: response.totalLines,
        translated: false,
      };
    }

    // Extract comments from the code
    const comments = extractComments(content, progLang || 'javascript');

    if (comments.length === 0) {
      // No comments to translate
      cache.set(filePath, startLine, endLine, lang, content, content, progLang || 'text', 'en');

      return {
        success: true,
        content,
        translatedContent: content,
        language: progLang,
        sourceCommentLang: 'en',
        startLine: response.startLine,
        endLine: response.endLine,
        totalLines: response.totalLines,
        translated: false,
      };
    }

    // Detect source language of comments
    const allCommentText = comments.map(c => c.text).join(' ');
    const sourceCommentLang = detectLanguage(allCommentText);

    // If source already matches target, no translation needed
    if (sourceCommentLang === lang) {
      cache.set(filePath, startLine, endLine, lang, content, content, progLang || 'text', sourceCommentLang);

      return {
        success: true,
        content,
        translatedContent: content,
        language: progLang,
        sourceCommentLang,
        startLine: response.startLine,
        endLine: response.endLine,
        totalLines: response.totalLines,
        translated: false,
      };
    }

    // Translate comments
    log(`[BlockContent] Translating ${comments.length} comments from ${sourceCommentLang} to ${lang} locally`);

    const commentTexts = comments.map(c => c.text);
    let translations: Record<string, string> = {};

    try {
      // Use local translation via Claude CLI
      translations = await localTranslateIdentifiers(commentTexts, sourceCommentLang, lang);
    } catch (error: any) {
      log(`[BlockContent] Local translation failed: ${error.message}`);
      // Continue with original content if translation fails
    }

    // Apply translations to content
    const translatedContent = Object.keys(translations).length > 0
      ? replaceComments(content, progLang || 'javascript', translations)
      : content;

    const wasTranslated = translatedContent !== content;

    // Cache the result
    cache.set(
      filePath,
      startLine,
      endLine,
      lang,
      content,
      translatedContent,
      progLang || 'text',
      sourceCommentLang
    );

    return {
      success: true,
      content,
      translatedContent,
      language: progLang,
      sourceCommentLang,
      startLine: response.startLine,
      endLine: response.endLine,
      totalLines: response.totalLines,
      translated: wasTranslated,
    };
  } catch (error: any) {
    log(`[BlockContent] Error: ${error.message}`);
    return {
      success: false,
      startLine,
      endLine,
      totalLines: 0,
      translated: false,
      error: error.message,
    };
  }
}

/**
 * Direct handler for get-content-translated (from Huginn clients)
 */
export async function handleDirectGetBlockContentTranslated(
  message: IPCMessage,
  caw: string
): Promise<BlockContentTranslatedResponse> {
  // Get user's language preference
  const targetLang = message.data.targetLang || getLanguage(caw);

  // Enrich message with target language
  const enrichedMessage: IPCMessage = {
    ...message,
    data: {
      ...message.data,
      targetLang,
    },
  };

  return handleGetBlockContentTranslated(enrichedMessage);
}
