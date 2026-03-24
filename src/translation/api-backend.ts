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
import { EventEmitter } from 'events';
import { apiRequest, downloadDictionary, apiToLocalDictionary } from '../api/client';
import { log } from '../ipc/protocol';
import type { TranslationBackend } from './backend';
import { DictionaryManager } from '../dictionary/manager';

/**
 * SSE translation event emitter for code translation jobs.
 * Shared with intent handlers — both use the same SSE forwarding from Muninn.
 */
export const codeTranslationEvents = new EventEmitter();
codeTranslationEvents.setMaxListeners(50);

export function emitCodeTranslationEvent(event: any): void {
  const jobId = event.jobId;
  if (jobId) {
    log(`[ApiBackend] SSE event received for job ${jobId}: ${event.type}`);
    codeTranslationEvents.emit(jobId, event);
  }
}

interface TranslateResponse {
  translations: Record<string, string>;
  usage?: { count: number };
}

interface JobAcceptedResponse {
  jobId: string;
  status: string;
  message?: string;
}

interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

/** Max items per API request (matching API-side limits) */
const IDENTIFIER_BATCH_SIZE = 100;
const COMMENT_BATCH_SIZE = 30;
const JOB_POLL_INTERVAL = 2000; // 2 seconds between polls
const JOB_POLL_TIMEOUT = 30 * 60 * 1000; // 30 minute max wait

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a translation job to complete via SSE event.
 * Does NOT return translations — caller downloads dictionary after all jobs complete.
 */
/**
 * Poll a job until completion (fallback when SSE is down)
 */
async function pollUntilDone(jobId: string): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < JOB_POLL_TIMEOUT) {
    await sleep(3000);
    const status = await apiRequest<JobStatusResponse>(`/translate-status?jobId=${jobId}`, { method: 'GET' });
    if (status.data?.status === 'completed') { log(`[ApiBackend] Job ${jobId} completed (via polling)`); return; }
    if (status.data?.status === 'failed') { throw new Error(status.data?.error || 'Translation job failed'); }
  }
  throw new Error(`Translation job ${jobId} timed out`);
}

/**
 * Wait for a translation job to complete via SSE event.
 * Falls back to polling if SSE connection drops.
 * Does NOT return translations — caller downloads dictionary after all jobs complete.
 */
async function waitForJob(
  jobId: string,
  type: 'identifiers' | 'comments',
  batchNum: number,
  totalBatches: number,
  batchSize: number,
  onProgress?: TranslationProgressCallback
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let polling = false;

    const cleanup = () => {
      clearTimeout(timeout);
      codeTranslationEvents.removeAllListeners(jobId);
      codeTranslationEvents.removeListener('sse-disconnected', onDisconnect);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Translation job ${jobId} timed out after ${JOB_POLL_TIMEOUT / 1000}s`));
    }, JOB_POLL_TIMEOUT);

    // SSE disconnect fallback: switch to polling
    const onDisconnect = () => {
      if (polling) return;
      polling = true;
      log(`[ApiBackend] SSE disconnected, switching to polling for job ${jobId}`);
      cleanup();
      pollUntilDone(jobId).then(resolve).catch(reject);
    };
    codeTranslationEvents.on('sse-disconnected', onDisconnect);

    // Primary: SSE events
    codeTranslationEvents.on(jobId, (event: any) => {
      if (event.type === 'translation:progress') {
        onProgress?.({ type, batchNum, totalBatches, batchSize, status: 'processing' });
      }
      if (event.type === 'translation:complete') {
        cleanup();
        log(`[ApiBackend] Job ${jobId} completed (via SSE)`);
        resolve();
      }
      if (event.type === 'translation:failed') {
        cleanup();
        reject(new Error(event.error || 'Translation job failed'));
      }
    });
  });
}

/**
 * Download the dictionary from the API and merge into local cache.
 * This is the single source of truth — same path for the requesting client and team members.
 */
async function syncDictionaryFromAPI(origin: string, language: LanguageCode): Promise<Record<string, string>> {
  log(`[ApiBackend] Downloading dictionary ${origin}:${language} from API`);
  const response = await downloadDictionary(origin, language);
  if (!response.success || !response.data) {
    log(`[ApiBackend] Dictionary download failed: ${response.error}`);
    return {};
  }

  const localDict = apiToLocalDictionary(response.data);
  const manager = new DictionaryManager();
  manager.import(JSON.stringify(localDict));
  log(`[ApiBackend] Dictionary synced: ${Object.keys(localDict.terms).length} terms`);
  return localDict.terms;
}

export class ApiBackend implements TranslationBackend {
  readonly name = 'api';

  /** Repository origin — set before translating so results are saved to the right dictionary */
  origin: string = '';

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

      const response = await apiRequest<JobAcceptedResponse>('/translate-identifiers', {
        method: 'POST',
        body: JSON.stringify({ terms: batch, sourceLang, targetLang, origin: this.origin }),
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
        continue;
      }

      // Wait for worker to finish and save to dictionaries collection
      log(`[ApiBackend] Identifier batch ${batchNum} queued as job ${response.data.jobId}`);
      await waitForJob(response.data.jobId, 'identifiers', batchNum, totalBatches, batch.length, onProgress);

      if (i + IDENTIFIER_BATCH_SIZE < uniqueTerms.length) {
        await sleep(200);
      }
    }

    // Download dictionary from API (single source of truth)
    if (this.origin) {
      const dictTerms = await syncDictionaryFromAPI(this.origin, targetLang);
      Object.assign(results, dictTerms);
    }

    // Fill in any missing terms with originals
    for (const term of uniqueTerms) {
      if (!results[term]) results[term] = term;
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

      const response = await apiRequest<JobAcceptedResponse>('/translate-comments', {
        method: 'POST',
        body: JSON.stringify({ comments: batch, sourceLang, targetLang, origin: this.origin }),
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
        continue;
      }

      // Wait for worker to finish and save to dictionaries collection
      log(`[ApiBackend] Comment batch ${batchNum} queued as job ${response.data.jobId}`);
      await waitForJob(response.data.jobId, 'comments', batchNum, totalBatches, batch.length, onProgress);

      if (i + COMMENT_BATCH_SIZE < uniqueComments.length) {
        await sleep(200);
      }
    }

    // Download dictionary from API — comments are stored as { hash: { en, [lang] } }
    // The sync will update the local dictionary cache; callers read from cache
    if (this.origin) {
      await syncDictionaryFromAPI(this.origin, targetLang);
    }

    // For the return value, we still need comment → translation map
    // Callers expect { originalComment: translatedComment }
    // Since dictionary is now synced locally, just return originals as-is
    // The UnifiedTranslator will look up translations from the dictionary
    for (const comment of uniqueComments) {
      results[comment] = comment; // placeholder — actual lookup happens via dictionary
    }

    log(`[ApiBackend] Completed: ${uniqueComments.length} comment translations`);
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
