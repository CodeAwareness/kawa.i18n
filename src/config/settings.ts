/**
 * Configuration Settings for i18n Extension
 *
 * Reads settings from ~/.kawa-code/config (JSON format)
 * Translation scope stored in ~/.kawa-code/i18n/settings.json
 * Provides defaults for all settings
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from '../ipc/protocol';
import { TranslationScope } from '../core/types';

// Re-export for convenience
export { TranslationScope };

/**
 * Default translation scope (comprehensive preset)
 */
export const DEFAULT_TRANSLATION_SCOPE: TranslationScope = {
  comments: true,
  stringLiterals: true,
  identifiers: true,
  keywords: false,
  punctuation: false,
  markdownFiles: false, // Opt-in: translate .md files during project scan
};

/**
 * i18n-specific settings
 */
export interface I18nSettings {
  /**
   * Whether to process English source code on save
   * When false (default), file-saved events for English code are skipped
   * When true, all code is processed (useful for detecting foreign terms in English codebases)
   */
  translateEnglishOnSave: boolean;
}

/**
 * Full config structure
 */
export interface Config {
  i18n?: Partial<I18nSettings>;
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: I18nSettings = {
  translateEnglishOnSave: false,
};

/**
 * Config file path
 */
const CONFIG_PATH = path.join(os.homedir(), '.kawa-code', 'config');

/**
 * Cached config and last load time
 */
let cachedConfig: Config | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 30000; // Reload config every 30 seconds

/**
 * Load config from disk
 */
function loadConfig(): Config {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return {};
    }

    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content) as Config;
    return config;
  } catch (error: any) {
    log(`[Config] Failed to load config: ${error.message}`);
    return {};
  }
}

/**
 * Get config with caching
 */
function getConfig(): Config {
  const now = Date.now();

  if (cachedConfig && (now - lastLoadTime) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  cachedConfig = loadConfig();
  lastLoadTime = now;

  return cachedConfig;
}

/**
 * Get i18n settings with defaults
 */
export function getI18nSettings(): I18nSettings {
  const config = getConfig();

  return {
    translateEnglishOnSave: config.i18n?.translateEnglishOnSave ?? DEFAULT_SETTINGS.translateEnglishOnSave,
  };
}

/**
 * Check if English code should be processed on save
 */
export function shouldTranslateEnglishOnSave(): boolean {
  return getI18nSettings().translateEnglishOnSave;
}

/**
 * Force reload config (useful for testing or after config changes)
 */
export function reloadConfig(): void {
  cachedConfig = null;
  lastLoadTime = 0;
}

// ============================================================================
// Translation Scope Settings (stored in ~/.kawa-code/i18n/settings.json)
// ============================================================================

const I18N_SETTINGS_DIR = path.join(os.homedir(), '.kawa-code', 'i18n');
const I18N_SETTINGS_PATH = path.join(I18N_SETTINGS_DIR, 'settings.json');

interface I18nUserSettings {
  translationScope?: TranslationScope;
}

/**
 * Ensure the i18n settings directory exists
 */
function ensureI18nSettingsDir(): void {
  if (!fs.existsSync(I18N_SETTINGS_DIR)) {
    fs.mkdirSync(I18N_SETTINGS_DIR, { recursive: true });
  }
}

/**
 * Load i18n user settings from disk
 */
function loadI18nUserSettings(): I18nUserSettings {
  try {
    if (!fs.existsSync(I18N_SETTINGS_PATH)) {
      return {};
    }
    const content = fs.readFileSync(I18N_SETTINGS_PATH, 'utf-8');
    return JSON.parse(content) as I18nUserSettings;
  } catch (error: any) {
    log(`[Config] Failed to load i18n user settings: ${error.message}`);
    return {};
  }
}

/**
 * Save i18n user settings to disk
 */
function saveI18nUserSettings(settings: I18nUserSettings): void {
  try {
    ensureI18nSettingsDir();
    fs.writeFileSync(I18N_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    log(`[Config] Saved i18n user settings`);
  } catch (error: any) {
    log(`[Config] Failed to save i18n user settings: ${error.message}`);
  }
}

/**
 * Get current translation scope
 */
export function getTranslationScope(): TranslationScope {
  const settings = loadI18nUserSettings();
  return settings.translationScope ?? { ...DEFAULT_TRANSLATION_SCOPE };
}

/**
 * Set translation scope
 */
export function setTranslationScope(scope: TranslationScope): void {
  const settings = loadI18nUserSettings();
  settings.translationScope = scope;
  saveI18nUserSettings(settings);
}
