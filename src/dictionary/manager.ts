import { Dictionary, LanguageCode } from '../core/types';
import { DictionaryCache } from './cache';
import { downloadDictionary, apiToLocalDictionary } from '../api/client';
import { log } from '../ipc/protocol';
import { MultiLangDictionary } from './multiLang';

/**
 * Dictionary Manager
 * Provides high-level CRUD operations for dictionaries
 */
export class DictionaryManager {
  private cache: DictionaryCache;

  constructor() {
    this.cache = new DictionaryCache();
  }

  /**
   * Create a new dictionary
   */
  create(origin: string, language: LanguageCode, initialTerms: Record<string, string> = {}): Dictionary {
    // Check if dictionary already exists
    if (this.cache.exists(origin, language)) {
      throw new Error(`Dictionary already exists for origin "${origin}" and language "${language}"`);
    }

    const now = new Date().toISOString();
    const dictionary: Dictionary = {
      origin,
      language,
      terms: initialTerms,
      metadata: {
        createdAt: now,
        updatedAt: now,
        lastSyncDate: now,
        version: '1.0.0',
      },
    };

    this.cache.save(dictionary);
    return dictionary;
  }

  /**
   * Load dictionary from cache
   * Throws error if not found
   */
  load(origin: string, language: LanguageCode): Dictionary {
    const dictionary = this.cache.load(origin, language);

    if (!dictionary) {
      throw new Error(`Dictionary not found for origin "${origin}" and language "${language}"`);
    }

    return dictionary;
  }

  /**
   * Load dictionary or create if not exists
   * Tries to download from API before creating empty dictionary
   * Checks cache staleness and syncs if needed
   */
  async loadOrCreate(origin: string, language: LanguageCode): Promise<{ dictionary: Dictionary; existsOnAPI: boolean }> {
    let dictionary: Dictionary | null = null;
    let loadedFromCache = false;

    try {
      // Try loading from local cache first
      dictionary = this.load(origin, language);
      loadedFromCache = true;
    } catch (error) {
      // Not in cache yet
      loadedFromCache = false;
    }

    // Check if cached dictionary is stale (older than 1 hour)
    const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
    let isCacheStale = false;

    if (loadedFromCache && dictionary) {
      const lastSyncDate = dictionary.metadata.lastSyncDate;
      if (lastSyncDate) {
        const lastSyncTime = new Date(lastSyncDate).getTime();
        const now = Date.now();
        isCacheStale = (now - lastSyncTime) > CACHE_MAX_AGE_MS;

        if (isCacheStale) {
          log(`[DictionaryManager] Cache is stale (last sync: ${lastSyncDate}), will attempt to sync`);
        }
      }
    }

    // If dictionary exists in cache and is NOT empty AND is NOT stale, use it
    if (loadedFromCache && dictionary && Object.keys(dictionary.terms).length > 0 && !isCacheStale) {
      log(`[DictionaryManager] Loaded from cache: ${Object.keys(dictionary.terms).length} terms`);
      return { dictionary, existsOnAPI: true };
    }

    // If cache is stale but has data, try to sync incrementally
    if (loadedFromCache && dictionary && Object.keys(dictionary.terms).length > 0 && isCacheStale) {
      log(`[DictionaryManager] Attempting incremental sync for stale cache`);
      const syncedTerms = await this.sync(origin, language);

      if (syncedTerms > 0) {
        log(`[DictionaryManager] Synced ${syncedTerms} new terms`);
        // Reload the updated dictionary
        dictionary = this.load(origin, language);
        return { dictionary, existsOnAPI: true };
      } else {
        // No new terms, but update lastSyncDate to prevent repeated sync attempts
        dictionary.metadata.lastSyncDate = new Date().toISOString();
        this.cache.save(dictionary);
        log(`[DictionaryManager] No new terms, cache refreshed`);
        return { dictionary, existsOnAPI: true };
      }
    }

    // Dictionary doesn't exist OR is empty - try downloading from API
    log(`[DictionaryManager] Dictionary ${loadedFromCache ? 'is empty' : 'not in cache'}, attempting API download: ${origin} (${language})`);

    const apiResponse = await downloadDictionary(origin, language);

    if (apiResponse.success && apiResponse.data) {
      log(`[DictionaryManager] Successfully downloaded from API: ${Object.keys(apiResponse.data.terms).length} terms`);

      // Convert API format to local format
      const newDictionary = apiToLocalDictionary(apiResponse.data);

      // Save to local cache
      this.cache.save(newDictionary);

      return { dictionary: newDictionary, existsOnAPI: true };
    } else {
      log(`[DictionaryManager] API download failed: ${apiResponse.error || 'unknown error'}`);

      // API download failed
      if (loadedFromCache && dictionary) {
        // Use cached empty dictionary
        log(`[DictionaryManager] Using cached empty dictionary`);
        return { dictionary, existsOnAPI: false };
      } else {
        // Create new empty dictionary
        log(`[DictionaryManager] Creating empty dictionary`);
        const newDictionary = this.create(origin, language);
        return { dictionary: newDictionary, existsOnAPI: false };
      }
    }
  }

  /**
   * Load dictionary as MultiLangDictionary for unified translation API
   * Automatically determines which language dictionary to load based on source/target
   *
   * @param origin - Repository origin
   * @param sourceLang - Source language of the code
   * @param targetLang - Target language for translation
   * @returns MultiLangDictionary wrapper for unified translation
   */
  async loadMultiLang(
    origin: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode
  ): Promise<{ dictionary: MultiLangDictionary; existsOnAPI: boolean }> {
    // Determine which language dictionary to load
    // Dictionary is stored under the non-English language
    const dictLang = sourceLang === 'en' ? targetLang : sourceLang;

    const { dictionary: rawDict, existsOnAPI } = await this.loadOrCreate(origin, dictLang);
    const multiLang = new MultiLangDictionary(rawDict);

    return { dictionary: multiLang, existsOnAPI };
  }

  /**
   * Add terms to existing dictionary
   */
  addTerms(origin: string, language: LanguageCode, newTerms: Record<string, string>): Dictionary {
    const dictionary = this.load(origin, language);

    // Merge new terms
    dictionary.terms = {
      ...dictionary.terms,
      ...newTerms,
    };

    // Update metadata
    dictionary.metadata.updatedAt = new Date().toISOString();
    this.incrementVersion(dictionary);

    this.cache.save(dictionary);
    return dictionary;
  }

  /**
   * Update a single term
   */
  updateTerm(origin: string, language: LanguageCode, term: string, translation: string): Dictionary {
    return this.addTerms(origin, language, { [term]: translation });
  }

  /**
   * Remove term from dictionary
   */
  removeTerm(origin: string, language: LanguageCode, term: string): Dictionary {
    const dictionary = this.load(origin, language);

    if (!(term in dictionary.terms)) {
      throw new Error(`Term "${term}" not found in dictionary`);
    }

    delete dictionary.terms[term];

    // Update metadata
    dictionary.metadata.updatedAt = new Date().toISOString();
    this.incrementVersion(dictionary);

    this.cache.save(dictionary);
    return dictionary;
  }

  /**
   * Delete entire dictionary
   */
  delete(origin: string, language: LanguageCode): void {
    this.cache.delete(origin, language);
  }

  /**
   * Check if dictionary exists
   */
  exists(origin: string, language: LanguageCode): boolean {
    return this.cache.exists(origin, language);
  }

  /**
   * List all cached dictionaries
   */
  listAll(): Array<{ origin: string; language: LanguageCode }> {
    return this.cache.listAll();
  }

  /**
   * Get translation for a term
   * Returns original term if not found
   */
  getTranslation(origin: string, language: LanguageCode, term: string): string {
    try {
      const dictionary = this.load(origin, language);
      return dictionary.terms[term] || term;
    } catch (error) {
      return term;
    }
  }

  /**
   * Get all terms in dictionary
   */
  getTerms(origin: string, language: LanguageCode): Record<string, string> {
    const dictionary = this.load(origin, language);
    return { ...dictionary.terms };
  }

  /**
   * Get dictionary statistics
   */
  getStats(origin: string, language: LanguageCode): {
    termCount: number;
    createdAt: string;
    updatedAt: string;
    version: string;
  } {
    const dictionary = this.load(origin, language);
    return {
      termCount: Object.keys(dictionary.terms).length,
      createdAt: dictionary.metadata.createdAt,
      updatedAt: dictionary.metadata.updatedAt,
      version: dictionary.metadata.version,
    };
  }

  /**
   * Increment version number (semver patch)
   */
  private incrementVersion(dictionary: Dictionary): void {
    const parts = dictionary.metadata.version.split('.');
    const patch = parseInt(parts[2] || '0', 10) + 1;
    dictionary.metadata.version = `${parts[0]}.${parts[1]}.${patch}`;
  }

  /**
   * Export dictionary to JSON string
   */
  export(origin: string, language: LanguageCode): string {
    const dictionary = this.load(origin, language);
    return JSON.stringify(dictionary, null, 2);
  }

  /**
   * Import dictionary from JSON string
   */
  import(jsonString: string): Dictionary {
    const dictionary = JSON.parse(jsonString) as Dictionary;

    // Validate structure
    if (!dictionary.origin || !dictionary.language || !dictionary.terms) {
      throw new Error('Invalid dictionary format');
    }

    // Ensure metadata exists
    if (!dictionary.metadata) {
      const now = new Date().toISOString();
      dictionary.metadata = {
        createdAt: now,
        updatedAt: now,
        version: '1.0.0',
      };
    }

    this.cache.save(dictionary);
    return dictionary;
  }

  /**
   * Sync dictionary with API (incremental update)
   * Downloads only changes since lastSyncDate and merges them into local cache
   *
   * @param origin - Repository origin
   * @param language - Target language
   * @returns Number of terms synced, or 0 if no updates
   */
  async sync(origin: string, language: LanguageCode): Promise<number> {
    try {
      // Load local dictionary
      const dictionary = this.load(origin, language);
      const lastSyncDate = dictionary.metadata.lastSyncDate;

      if (!lastSyncDate) {
        log(`[DictionaryManager] No lastSyncDate found, skipping sync`);
        return 0;
      }

      // Download incremental changes from API
      log(`[DictionaryManager] Syncing ${origin} (${language}) since ${lastSyncDate}`);
      const apiResponse = await downloadDictionary(origin, language, lastSyncDate);

      if (!apiResponse.success || !apiResponse.data) {
        log(`[DictionaryManager] Sync failed: ${apiResponse.error}`);
        return 0;
      }

      const newTerms = apiResponse.data.terms;
      const newComments = apiResponse.data.comments;
      const termCount = Object.keys(newTerms).length;
      const commentCount = newComments ? Object.keys(newComments).length : 0;

      if (termCount === 0 && commentCount === 0) {
        log(`[DictionaryManager] No new terms or comments to sync`);
        return 0;
      }

      // Merge new terms into dictionary (last-write-wins)
      Object.assign(dictionary.terms, newTerms);

      // Merge new comments into dictionary (last-write-wins)
      if (newComments) {
        if (!dictionary.comments) {
          dictionary.comments = {};
        }
        Object.assign(dictionary.comments, newComments);
      }

      // Update metadata
      dictionary.metadata.updatedAt = new Date().toISOString();
      dictionary.metadata.lastSyncDate = new Date().toISOString();
      this.incrementVersion(dictionary);

      // Save to cache
      this.cache.save(dictionary);

      log(`[DictionaryManager] Synced ${termCount} terms and ${commentCount} comments`);
      return termCount;
    } catch (error: any) {
      log(`[DictionaryManager] Sync error: ${error.message}`);
      return 0;
    }
  }

  /**
   * Clear all cached dictionaries
   */
  clearAll(): void {
    this.cache.clearAll();
  }
}
