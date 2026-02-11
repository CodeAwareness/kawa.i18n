/**
 * Intent Decoration Types
 *
 * Types for displaying team member intents in the code viewer.
 * Supports multilingual display using English as a pivot language.
 */

/**
 * Template types for intents
 */
export type IntentTemplateType = 'feature' | 'refactor' | 'exploration';

/**
 * Intent status
 */
export type IntentStatus = 'active' | 'committed' | 'pushed' | 'done' | 'abandoned';

/**
 * A code block covered by an intent
 */
export interface IntentBlock {
  startLine: number;
  endLine: number;
  contentSnippet: string;
  /** For line range queries, overlap bounds */
  overlapStart?: number;
  overlapEnd?: number;
}

/**
 * Intent decoration for UI display
 *
 * Contains both original and translated text to support:
 * - Direct display when user's language matches author's language
 * - On-demand translation from originalLang to user's target language
 */
export interface IntentDecoration {
  id: string;
  /** Title in user's target language */
  title: string;
  /** Original title in author's language */
  titleOriginal: string;
  /** ISO 639-1 code of original language */
  originalLang: string;
  /** Description in user's target language */
  description: string;
  /** Original description */
  descriptionOriginal: string;
  /** Intent status */
  status: IntentStatus;
  /** Author email or identifier */
  author: string;
  /** Type of work */
  templateType: IntentTemplateType;
  /** Code blocks covered by this intent in the current file */
  blocks: IntentBlock[];
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

/**
 * Response from Gardener for get-for-file request
 */
export interface GardenerIntentsForFileResponse {
  success: boolean;
  intents: GardenerIntent[];
  /** Map of line number (as string) to array of intent IDs */
  lineMap: Record<string, string[]>;
  blockCount: number;
  error?: string;
}

/**
 * Intent as returned from Gardener (raw, not translated)
 */
export interface GardenerIntent {
  id: string;
  title: string;
  description: string;
  status: string;
  author: string;
  templateType: string;
  createdAt: string;
  updatedAt: string;
  blocks: IntentBlock[];
}

/**
 * Response from translation handlers
 */
export interface IntentsForFileResponse {
  success: boolean;
  intents: IntentDecoration[];
  /** Map of line number (as string) to array of intent IDs */
  lineMap: Record<string, string[]>;
  blockCount: number;
  error?: string;
}

/**
 * Request for detecting language of text
 */
export interface DetectLanguageRequest {
  text: string;
  origin: string;
}

/**
 * Response from language detection
 */
export interface DetectLanguageResponse {
  success: boolean;
  detectedLang: string;
  error?: string;
}

/**
 * Request for normalizing intent text to English (legacy - kept for backward compatibility)
 */
export interface NormalizeIntentRequest {
  title: string;
  description: string;
  constraints?: string[];
  origin: string;
}

/**
 * Response from normalizing intent text (legacy - kept for backward compatibility)
 */
export interface NormalizeIntentResponse {
  success: boolean;
  titleEn: string;
  descriptionEn: string;
  constraintsEn: string[];
  detectedSourceLang: string;
  titleOriginal: string;
  descriptionOriginal: string;
  constraintsOriginal: string[];
  error?: string;
}

/**
 * Request for translating intent metadata to a target language
 */
export interface TranslateIntentMetadataRequest {
  intentId: string;
  /** Title in source language */
  title: string;
  /** Description in source language */
  description: string;
  /** Constraints in source language */
  constraints: string[];
  /** Source language code (e.g., 'en', 'ja') */
  sourceLang: string;
  /** Target language code (e.g., 'en', 'ja') */
  targetLang: string;
  origin: string;
}

/**
 * Response from translating intent metadata
 */
export interface TranslateIntentMetadataResponse {
  success: boolean;
  intentId: string;
  title: string;
  description: string;
  constraints: string[];
  targetLang: string;
  cached: boolean;
  error?: string;
}

/**
 * Cache key for translated intent metadata
 */
export interface IntentCacheKey {
  intentId: string;
  targetLang: string;
}

/**
 * Cached translation entry
 */
export interface IntentCacheEntry {
  title: string;
  description: string;
  constraints?: string[];
  timestamp: number;
}

/**
 * Metadata cache entry (for translate-metadata results)
 */
export interface IntentMetadataCacheEntry {
  title: string;
  description: string;
  constraints: string[];
  timestamp: number;
}

// ============================================================================
// Block Content Types (for displaying full code in expanded blocks)
// ============================================================================

/**
 * Request to get full content for a block's line range
 */
export interface GetBlockContentRequest {
  repoOrigin: string;
  filePath: string;
  startLine: number;
  endLine: number;
  targetLang?: string;
}

/**
 * Response from Gardener for get-content request
 */
export interface GardenerBlockContentResponse {
  success: boolean;
  content?: string;
  language?: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  error?: string;
}

/**
 * Response from translation handler for get-content-translated request
 */
export interface BlockContentTranslatedResponse {
  success: boolean;
  /** Original code content */
  content?: string;
  /** Translated code content (comments/strings translated) */
  translatedContent?: string;
  /** Programming language (for syntax highlighting) */
  language?: string;
  /** Detected source language of comments */
  sourceCommentLang?: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** Whether translation was performed */
  translated: boolean;
  error?: string;
}

/**
 * Cache entry for block content translations
 */
export interface BlockContentCacheEntry {
  content: string;
  translatedContent: string;
  language: string;
  sourceCommentLang: string;
  timestamp: number;
}
