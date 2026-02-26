/**
 * API Translation Backend
 *
 * Routes translation through kawa.api instead of local Claude CLI.
 * Users opt in to this mode — code identifiers and comments are sent
 * to the API (which calls Claude API). This is a conscious trade-off
 * of zero-knowledge for lower cost (no separate LLM subscription needed).
 */

import { LanguageCode } from '../core/types';
import type { TranslationProgressCallback } from '../claude/translator';
import { apiRequest } from '../api/client';
import { log } from '../ipc/protocol';
import type { TranslationBackend } from './backend';

interface TranslateResponse {
  translations: Record<string, string>;
  usage?: { count: number };
}

/** Max items per API request (matching API-side limits) */
const IDENTIFIER_BATCH_SIZE = 100;
const COMMENT_BATCH_SIZE = 30;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ApiBackend implements TranslationBackend {
  readonly name = 'api';

  async isAvailable(): Promise<boolean> {
    try {
      const result = await apiRequest<{ ok: boolean }>('/health', { method: 'GET' });
      return result.success;
    } catch {
      return false;
    }
  }

  async translateIdentifiers(
    terms: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>> {
    if (terms.length === 0) return {};
    if (sourceLang === targetLang) {
      return Object.fromEntries(terms.map(t => [t, t]));
    }

    const results: Record<string, string> = {};
    const uniqueTerms = [...new Set(terms)];

    log(`[ApiBackend] Translating ${uniqueTerms.length} identifiers ${sourceLang} → ${targetLang}`);

    for (let i = 0; i < uniqueTerms.length; i += IDENTIFIER_BATCH_SIZE) {
      const batch = uniqueTerms.slice(i, i + IDENTIFIER_BATCH_SIZE);
      const batchNum = Math.floor(i / IDENTIFIER_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(uniqueTerms.length / IDENTIFIER_BATCH_SIZE);

      onProgress?.({ type: 'identifiers', batchNum, totalBatches, batchSize: batch.length, status: 'processing' });

      const response = await apiRequest<TranslateResponse>('/translate-identifiers', {
        method: 'POST',
        body: JSON.stringify({ terms: batch, sourceLang, targetLang }),
      });

      if (!response.success || !response.data) {
        log(`[ApiBackend] Identifier batch ${batchNum} failed: ${response.error}`);
        onProgress?.({ type: 'identifiers', batchNum, totalBatches, batchSize: batch.length, status: 'failed' });

        if (response.error?.includes('429')) {
          throw new Error('Translation quota exceeded. Upgrade your plan or switch to local mode.');
        }
        if (response.error?.includes('401')) {
          throw new Error('Authentication expired. Please re-authenticate.');
        }

        for (const term of batch) {
          results[term] = term;
        }
        continue;
      }

      Object.assign(results, response.data.translations);

      // Fill in any missing terms with originals
      for (const term of batch) {
        if (!results[term]) results[term] = term;
      }

      if (i + IDENTIFIER_BATCH_SIZE < uniqueTerms.length) {
        await sleep(200);
      }
    }

    log(`[ApiBackend] Completed: ${Object.keys(results).length} identifier translations`);
    return results;
  }

  async translateComments(
    comments: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>> {
    if (comments.length === 0) return {};
    if (sourceLang === targetLang) {
      return Object.fromEntries(comments.map(c => [c, c]));
    }

    const results: Record<string, string> = {};
    const uniqueComments = [...new Set(comments)];

    log(`[ApiBackend] Translating ${uniqueComments.length} comments ${sourceLang} → ${targetLang}`);

    for (let i = 0; i < uniqueComments.length; i += COMMENT_BATCH_SIZE) {
      const batch = uniqueComments.slice(i, i + COMMENT_BATCH_SIZE);
      const batchNum = Math.floor(i / COMMENT_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(uniqueComments.length / COMMENT_BATCH_SIZE);

      onProgress?.({ type: 'comments', batchNum, totalBatches, batchSize: batch.length, status: 'processing' });

      const response = await apiRequest<TranslateResponse>('/translate-comments', {
        method: 'POST',
        body: JSON.stringify({ comments: batch, sourceLang, targetLang }),
      });

      if (!response.success || !response.data) {
        log(`[ApiBackend] Comment batch ${batchNum} failed: ${response.error}`);
        onProgress?.({ type: 'comments', batchNum, totalBatches, batchSize: batch.length, status: 'failed' });

        if (response.error?.includes('429')) {
          throw new Error('Translation quota exceeded. Upgrade your plan or switch to local mode.');
        }
        if (response.error?.includes('401')) {
          throw new Error('Authentication expired. Please re-authenticate.');
        }

        for (const comment of batch) {
          results[comment] = comment;
        }
        continue;
      }

      Object.assign(results, response.data.translations);

      for (const comment of batch) {
        if (!results[comment]) results[comment] = comment;
      }

      if (i + COMMENT_BATCH_SIZE < uniqueComments.length) {
        await sleep(200);
      }
    }

    log(`[ApiBackend] Completed: ${Object.keys(results).length} comment translations`);
    return results;
  }

  async translateText(
    texts: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>> {
    // Reuse the existing translate-text endpoint
    if (texts.length === 0) return {};
    if (sourceLang === targetLang) {
      return Object.fromEntries(texts.map(t => [t, t]));
    }

    log(`[ApiBackend] Translating ${texts.length} texts ${sourceLang} → ${targetLang}`);
    onProgress?.({ type: 'text', batchNum: 1, totalBatches: 1, batchSize: texts.length, status: 'processing' });

    const response = await apiRequest<TranslateResponse>('/translate-text', {
      method: 'POST',
      body: JSON.stringify({ texts, sourceLang, targetLang }),
    });

    if (!response.success || !response.data) {
      log(`[ApiBackend] Text translation failed: ${response.error}`);
      onProgress?.({ type: 'text', batchNum: 1, totalBatches: 1, batchSize: texts.length, status: 'failed' });

      if (response.error?.includes('429')) {
        throw new Error('Translation quota exceeded. Upgrade your plan or switch to local mode.');
      }

      return Object.fromEntries(texts.map(t => [t, t]));
    }

    return response.data.translations;
  }

  async translateProject(
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
    log(`[ApiBackend] Starting project translation: ${identifiers.length} identifiers, ${comments.length} comments`);

    const [terms, translatedComments] = await Promise.all([
      this.translateIdentifiers(identifiers, sourceLang, targetLang, onProgress),
      this.translateComments(comments, sourceLang, targetLang, onProgress),
    ]);

    return {
      terms,
      comments: translatedComments,
      totalTerms: Object.keys(terms).length,
      totalComments: Object.keys(translatedComments).length,
    };
  }
}
