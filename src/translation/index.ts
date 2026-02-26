/**
 * Translation Backend Factory
 *
 * Returns the appropriate translation backend based on user settings.
 * Caches the backend instance and resets on setting change.
 */

import { getTranslationMode } from '../config/settings';
import { log } from '../ipc/protocol';
import type { TranslationBackend } from './backend';
import { LocalBackend } from './local-backend';
import { ApiBackend } from './api-backend';

export type { TranslationBackend } from './backend';

let cachedBackend: TranslationBackend | null = null;
let cachedMode: string | null = null;

/**
 * Get the active translation backend based on user settings.
 * Caches the instance — call resetTranslationBackend() when settings change.
 */
export function getTranslationBackend(): TranslationBackend {
  const mode = getTranslationMode();

  if (cachedBackend && cachedMode === mode) {
    return cachedBackend;
  }

  if (mode === 'api') {
    log('[Translation] Using API backend');
    cachedBackend = new ApiBackend();
  } else {
    log('[Translation] Using local backend (Claude CLI)');
    cachedBackend = new LocalBackend();
  }

  cachedMode = mode;
  return cachedBackend;
}

/**
 * Reset the cached backend instance.
 * Call this when the translation mode setting changes.
 */
export function resetTranslationBackend(): void {
  cachedBackend = null;
  cachedMode = null;
}
