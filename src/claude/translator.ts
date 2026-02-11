/**
 * Local Translation Service
 *
 * High-level translation functions that use the Claude CLI.
 * All translation happens locally on the user's machine.
 *
 * Features:
 * - Batching (10 comments, 100 identifiers per CLI call)
 * - Response parsing
 * - Identifier validation
 * - Error handling with fallback to original
 */

import { callClaudeWithRetry, isClaudeCliAvailable } from './cli';
import {
  buildIdentifierTranslationPrompt,
  buildCommentTranslationPrompt,
  buildTextTranslationPrompt,
  parseNumberedListResponse,
  parseCommentTranslationResponse,
} from './prompts';
import { LanguageCode } from '../core/types';
import { log } from '../ipc/protocol';

/** Progress callback for translation batching */
export type TranslationProgressCallback = (info: {
  type: 'identifiers' | 'comments' | 'text';
  batchNum: number;
  totalBatches: number;
  batchSize: number;
  status: 'processing' | 'retrying' | 'failed' | 'complete';
  retryAttempt?: number;
  maxRetries?: number;
}) => void;

/** Batch sizes for different content types */
const IDENTIFIER_BATCH_SIZE = 100;
const COMMENT_BATCH_SIZE = 30;
const COMMENT_MAX_CHARS = 30_000;
const TEXT_BATCH_SIZE = 30;

/** Delays between batches to avoid rate limiting */
const IDENTIFIER_BATCH_DELAY_MS = 1000;
const COMMENT_BATCH_DELAY_MS = 200;
const TEXT_BATCH_DELAY_MS = 200;

/**
 * Validate that a string is a valid JavaScript identifier.
 *
 * Rules:
 * - Cannot start with a digit
 * - Cannot contain spaces, hyphens, or special punctuation
 * - Unicode characters are allowed
 */
function isValidIdentifier(str: string): boolean {
  if (!str || str.length === 0) return false;

  // Cannot start with a digit (0-9)
  if (/^\d/.test(str)) {
    return false;
  }

  // Check for invalid characters
  const invalidChars = /[\s\-\.,:;!?@#%^&*()\[\]{}<>+=\/\\|`~'"]/;
  if (invalidChars.test(str)) {
    return false;
  }

  return true;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Translate code identifiers (variable/function names).
 *
 * @param terms - Array of identifier names to translate
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @returns Map of { originalTerm: translatedTerm }
 */
export async function translateIdentifiers(
  terms: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  onProgress?: TranslationProgressCallback
): Promise<Record<string, string>> {
  if (terms.length === 0) {
    return {};
  }

  // Same language - no translation needed
  if (sourceLang === targetLang) {
    return Object.fromEntries(terms.map(t => [t, t]));
  }

  const results: Record<string, string> = {};
  const uniqueTerms = [...new Set(terms)]; // Deduplicate

  log(`[LocalTranslator] Translating ${uniqueTerms.length} identifiers ${sourceLang} → ${targetLang}`);

  // Process in batches
  for (let i = 0; i < uniqueTerms.length; i += IDENTIFIER_BATCH_SIZE) {
    const batch = uniqueTerms.slice(i, i + IDENTIFIER_BATCH_SIZE);
    const batchNum = Math.floor(i / IDENTIFIER_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueTerms.length / IDENTIFIER_BATCH_SIZE);

    log(`[LocalTranslator] Processing identifier batch ${batchNum}/${totalBatches} (${batch.length} terms)`);
    onProgress?.({ type: 'identifiers', batchNum, totalBatches, batchSize: batch.length, status: 'processing' });

    try {
      const prompt = buildIdentifierTranslationPrompt(batch, sourceLang, targetLang);
      const response = await callClaudeWithRetry(prompt, undefined, {
        onRetry: (attempt, maxRetries) => {
          onProgress?.({ type: 'identifiers', batchNum, totalBatches, batchSize: batch.length, status: 'retrying', retryAttempt: attempt, maxRetries });
        },
      });
      const translations = parseNumberedListResponse(response, batch.length);

      // Validate and store translations
      for (let j = 0; j < batch.length; j++) {
        const original = batch[j];
        const translated = translations[j];

        if (translated && isValidIdentifier(translated)) {
          results[original] = translated;
        } else if (translated) {
          // Log invalid translation and fallback to original
          log(`[LocalTranslator] Invalid identifier rejected: "${translated}" (from "${original}")`);
          results[original] = original;
        } else {
          // No translation returned - keep original
          results[original] = original;
        }
      }
    } catch (error: any) {
      log(`[LocalTranslator] Identifier batch ${batchNum} failed: ${error.message}`);
      onProgress?.({ type: 'identifiers', batchNum, totalBatches, batchSize: batch.length, status: 'failed' });
      // Fallback: keep original terms
      for (const term of batch) {
        results[term] = term;
      }
    }

    // Delay between batches (except for last batch)
    if (i + IDENTIFIER_BATCH_SIZE < uniqueTerms.length) {
      await sleep(IDENTIFIER_BATCH_DELAY_MS);
    }
  }

  log(`[LocalTranslator] Completed: ${Object.keys(results).length} identifier translations`);
  return results;
}

/**
 * Translate code comments.
 *
 * @param comments - Array of comment strings to translate
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @returns Map of { originalComment: translatedComment }
 */
export async function translateComments(
  comments: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  onProgress?: TranslationProgressCallback
): Promise<Record<string, string>> {
  if (comments.length === 0) {
    return {};
  }

  // Same language - no translation needed
  if (sourceLang === targetLang) {
    return Object.fromEntries(comments.map(c => [c, c]));
  }

  const results: Record<string, string> = {};
  const uniqueComments = [...new Set(comments)]; // Deduplicate

  log(`[LocalTranslator] Translating ${uniqueComments.length} comments ${sourceLang} → ${targetLang}`);

  // Build batches respecting both count and character limits
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBatchChars = 0;

  for (const comment of uniqueComments) {
    // Start new batch if current would exceed limits
    if (
      currentBatch.length >= COMMENT_BATCH_SIZE ||
      currentBatchChars + comment.length > COMMENT_MAX_CHARS
    ) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [];
      currentBatchChars = 0;
    }

    currentBatch.push(comment);
    currentBatchChars += comment.length;
  }

  // Don't forget the last batch
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  // Process batches
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    log(`[LocalTranslator] Processing comment batch ${batchNum}/${batches.length} (${batch.length} comments)`);
    onProgress?.({ type: 'comments', batchNum, totalBatches: batches.length, batchSize: batch.length, status: 'processing' });

    try {
      const prompt = buildCommentTranslationPrompt(batch, sourceLang, targetLang);
      const response = await callClaudeWithRetry(prompt, undefined, {
        onRetry: (attempt, maxRetries) => {
          onProgress?.({ type: 'comments', batchNum, totalBatches: batches.length, batchSize: batch.length, status: 'retrying', retryAttempt: attempt, maxRetries });
        },
      });
      const translations = parseCommentTranslationResponse(response, batch.length);

      // Store translations
      for (let j = 0; j < batch.length; j++) {
        const original = batch[j];
        const translated = translations[j];
        results[original] = translated || original;
      }
    } catch (error: any) {
      log(`[LocalTranslator] Comment batch ${batchNum} failed: ${error.message}`);
      onProgress?.({ type: 'comments', batchNum, totalBatches: batches.length, batchSize: batch.length, status: 'failed' });
      // Fallback: keep original comments
      for (const comment of batch) {
        results[comment] = comment;
      }
    }

    // Delay between batches (except for last batch)
    if (i < batches.length - 1) {
      await sleep(COMMENT_BATCH_DELAY_MS);
    }
  }

  log(`[LocalTranslator] Completed: ${Object.keys(results).length} comment translations`);
  return results;
}

/**
 * Translate natural language text (intent titles, descriptions, etc.).
 *
 * @param texts - Array of text strings to translate
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @returns Map of { originalText: translatedText }
 */
export async function translateText(
  texts: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  onProgress?: TranslationProgressCallback
): Promise<Record<string, string>> {
  if (texts.length === 0) {
    return {};
  }

  // Same language - no translation needed
  if (sourceLang === targetLang) {
    return Object.fromEntries(texts.map(t => [t, t]));
  }

  const results: Record<string, string> = {};
  const uniqueTexts = [...new Set(texts)]; // Deduplicate

  log(`[LocalTranslator] Translating ${uniqueTexts.length} texts ${sourceLang} → ${targetLang}`);

  // Process in batches
  for (let i = 0; i < uniqueTexts.length; i += TEXT_BATCH_SIZE) {
    const batch = uniqueTexts.slice(i, i + TEXT_BATCH_SIZE);
    const batchNum = Math.floor(i / TEXT_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueTexts.length / TEXT_BATCH_SIZE);

    log(`[LocalTranslator] Processing text batch ${batchNum}/${totalBatches} (${batch.length} texts)`);
    onProgress?.({ type: 'text', batchNum, totalBatches, batchSize: batch.length, status: 'processing' });

    try {
      const prompt = buildTextTranslationPrompt(batch, sourceLang, targetLang);
      const response = await callClaudeWithRetry(prompt, undefined, {
        onRetry: (attempt, maxRetries) => {
          onProgress?.({ type: 'text', batchNum, totalBatches, batchSize: batch.length, status: 'retrying', retryAttempt: attempt, maxRetries });
        },
      });
      const translations = parseNumberedListResponse(response, batch.length);

      // Store translations
      for (let j = 0; j < batch.length; j++) {
        const original = batch[j];
        const translated = translations[j];
        results[original] = translated || original;
      }
    } catch (error: any) {
      log(`[LocalTranslator] Text batch ${batchNum} failed: ${error.message}`);
      onProgress?.({ type: 'text', batchNum, totalBatches, batchSize: batch.length, status: 'failed' });
      // Fallback: keep original texts
      for (const text of batch) {
        results[text] = text;
      }
    }

    // Delay between batches (except for last batch)
    if (i + TEXT_BATCH_SIZE < uniqueTexts.length) {
      await sleep(TEXT_BATCH_DELAY_MS);
    }
  }

  log(`[LocalTranslator] Completed: ${Object.keys(results).length} text translations`);
  return results;
}

/**
 * Translate an entire project's identifiers and comments.
 *
 * This is used for initial project scanning when no dictionary exists.
 *
 * @param identifiers - All unique identifier names from the project
 * @param comments - All unique comments from the project
 * @param sourceLang - Source language (usually 'en')
 * @param targetLang - Target language (e.g., 'ja')
 * @returns Object with translated terms and comments
 */
export async function translateProject(
  identifiers: string[],
  comments: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  onProgress?: TranslationProgressCallback
): Promise<{
  terms: Record<string, string>;
  comments: Record<string, string>;
  totalTerms: number;
  totalComments: number;
}> {
  log(`[LocalTranslator] Starting project translation: ${identifiers.length} identifiers, ${comments.length} comments`);

  // Translate both in parallel (they use separate batches anyway)
  const [terms, translatedComments] = await Promise.all([
    translateIdentifiers(identifiers, sourceLang, targetLang, onProgress),
    translateComments(comments, sourceLang, targetLang, onProgress),
  ]);

  return {
    terms,
    comments: translatedComments,
    totalTerms: Object.keys(terms).length,
    totalComments: Object.keys(translatedComments).length,
  };
}

/**
 * Check if the Claude CLI is available for translation.
 * Should be called on startup to verify the environment.
 */
export async function checkClaudeCliAvailable(): Promise<boolean> {
  const available = await isClaudeCliAvailable();
  if (!available) {
    log('[LocalTranslator] Claude CLI not found. Translation features will be unavailable.');
    log('[LocalTranslator] Install Claude CLI: https://docs.anthropic.com/claude-code/getting-started');
  }
  return available;
}

// Re-export for convenience
export { isClaudeCliAvailable };
