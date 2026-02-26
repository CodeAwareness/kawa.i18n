/**
 * Translation Backend Interface
 *
 * Abstraction over translation providers (local Claude CLI vs API).
 * Both backends implement the same interface so callers don't need
 * to know which one is active.
 */

import { LanguageCode } from '../core/types';
import type { TranslationProgressCallback } from '../claude/translator';

export interface TranslationBackend {
  /** Human-readable name for logging */
  readonly name: string;

  /** Check if this backend is available (e.g., CLI installed, API reachable) */
  isAvailable(): Promise<boolean>;

  /** Translate code identifiers (variable/function names) */
  translateIdentifiers(
    terms: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>>;

  /** Translate code comments */
  translateComments(
    comments: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>>;

  /** Translate natural language text (intent titles, descriptions) */
  translateText(
    texts: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>>;

  /** Translate an entire project's identifiers and comments */
  translateProject(
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
  }>;
}
