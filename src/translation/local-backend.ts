/**
 * Local Translation Backend
 *
 * Wraps the existing Claude CLI translator functions.
 * All translation happens locally on the user's machine (zero-knowledge).
 */

import { LanguageCode } from '../core/types';
import type { TranslationProgressCallback } from '../claude/translator';
import {
  translateIdentifiers,
  translateComments,
  translateText,
  translateProject,
  isClaudeCliAvailable,
} from '../claude';
import type { TranslationBackend } from './backend';

export class LocalBackend implements TranslationBackend {
  readonly name = 'local';

  async isAvailable(): Promise<boolean> {
    return isClaudeCliAvailable();
  }

  async translateIdentifiers(
    terms: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>> {
    return translateIdentifiers(terms, sourceLang, targetLang, onProgress);
  }

  async translateComments(
    comments: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>> {
    return translateComments(comments, sourceLang, targetLang, onProgress);
  }

  async translateText(
    texts: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    onProgress?: TranslationProgressCallback
  ): Promise<Record<string, string>> {
    return translateText(texts, sourceLang, targetLang, onProgress);
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
    return translateProject(identifiers, comments, sourceLang, targetLang, onProgress);
  }
}
