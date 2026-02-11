/**
 * Represents a mapping between English TypeScript tokens and custom tokens
 */
export interface TokenMapping {
  [englishToken: string]: string;
}

/**
 * Configuration options for the translator
 */
export interface TranslatorOptions {
  /** If true, preserve comments in the translated code */
  preserveComments?: boolean;
  /** If true, throw errors on unmapped tokens, otherwise keep original */
  strictMode?: boolean;
}

/**
 * Result of a translation operation
 */
export interface TranslationResult {
  /** The translated source code */
  code: string;
  /** Tokens that were successfully translated */
  translatedTokens: string[];
  /** Tokens that were not found in the mapping */
  unmappedTokens: string[];
}

/**
 * Language codes supported by the i18n extension
 */
export type LanguageCode = 'en' | 'ja' | 'es' | 'fr' | 'de' | 'zh' | 'ko' | 'ru' | 'pt' | 'it' | 'ar';

/**
 * Dictionary structure for storing translations
 */
export interface Dictionary {
  origin: string;
  language: LanguageCode;
  terms: Record<string, string>;
  comments?: Record<string, CommentTranslations>;
  metadata: {
    createdAt: string;
    updatedAt: string;
    lastSyncDate?: string; // ISO 8601 timestamp of last sync with API
    version: string;
  };
}

/**
 * Comment translations for different languages
 * Key is the MD5 hash of the English comment, value is object with language codes
 */
export interface CommentTranslations {
  en: string;
  [languageCode: string]: string;
}

/**
 * Translation scope controlling what gets translated
 */
export interface TranslationScope {
  comments: boolean;
  stringLiterals: boolean;
  identifiers: boolean;
  keywords: boolean;
  /** When enabled, ASCII punctuation is replaced with full-width CJK equivalents (display-only) */
  punctuation: boolean;
  /** When enabled, markdown files (.md) in the project are translated during project scan */
  markdownFiles: boolean;
}
