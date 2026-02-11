/**
 * Local Claude Translation Module
 *
 * Provides translation capabilities using the local Claude CLI.
 * All code stays on the user's machine - zero-knowledge privacy model.
 */

export {
  translateIdentifiers,
  translateComments,
  translateText,
  translateProject,
  checkClaudeCliAvailable,
  isClaudeCliAvailable,
} from './translator';

export type { TranslationProgressCallback } from './translator';

export {
  callClaude,
  callClaudeWithRetry,
  extractJsonFromResponse,
} from './cli';

export {
  buildIdentifierTranslationPrompt,
  buildCommentTranslationPrompt,
  buildTextTranslationPrompt,
  parseNumberedListResponse,
  parseCommentTranslationResponse,
} from './prompts';
