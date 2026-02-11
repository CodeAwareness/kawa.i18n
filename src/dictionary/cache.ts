import * as fs from 'fs';
import * as path from 'path';
import { Dictionary, LanguageCode } from '../core/types';

/**
 * Simple file-based dictionary cache with in-memory layer
 * Stores dictionaries in ~/.kawa-code/i18n/dictionaries/
 *
 * Performance optimization: Keeps recently loaded dictionaries in memory
 * to avoid repeated disk I/O on every operation (significant for large dictionaries)
 */
export class DictionaryCache {
  private cacheDir: string;
  private memoryCache: Map<string, Dictionary> = new Map();

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.cacheDir = path.join(homeDir, '.kawa-code', 'i18n', 'dictionaries');
    this.ensureCacheDir();
  }

  /**
   * Generate cache key for memory cache
   */
  private getCacheKey(origin: string, language: LanguageCode): string {
    return `${origin}::${language}`;
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get cache file path for a dictionary
   */
  private getCacheFilePath(origin: string, language: LanguageCode): string {
    // Sanitize origin to create a valid filename
    const sanitized = origin
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
    return path.join(this.cacheDir, `${sanitized}_${language}.json`);
  }

  /**
   * Load dictionary from cache
   * Returns null if not found
   * Uses in-memory cache to avoid repeated disk I/O
   */
  load(origin: string, language: LanguageCode): Dictionary | null {
    const cacheKey = this.getCacheKey(origin, language);

    // Check memory cache first
    const cached = this.memoryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fall back to disk
    const filePath = this.getCacheFilePath(origin, language);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const dictionary = JSON.parse(content) as Dictionary;

      // Store in memory cache for future access
      this.memoryCache.set(cacheKey, dictionary);

      return dictionary;
    } catch (error) {
      console.error(`[DictionaryCache] Failed to load dictionary: ${error}`);
      return null;
    }
  }

  /**
   * Save dictionary to cache
   * Updates both memory cache and disk
   */
  save(dictionary: Dictionary): void {
    const filePath = this.getCacheFilePath(dictionary.origin, dictionary.language);
    const cacheKey = this.getCacheKey(dictionary.origin, dictionary.language);

    try {
      const content = JSON.stringify(dictionary, null, 2);
      fs.writeFileSync(filePath, content, 'utf-8');

      // Update memory cache
      this.memoryCache.set(cacheKey, dictionary);
    } catch (error) {
      console.error(`[DictionaryCache] Failed to save dictionary: ${error}`);
      throw error;
    }
  }

  /**
   * Check if dictionary exists in cache
   */
  exists(origin: string, language: LanguageCode): boolean {
    const filePath = this.getCacheFilePath(origin, language);
    return fs.existsSync(filePath);
  }

  /**
   * Delete dictionary from cache
   */
  delete(origin: string, language: LanguageCode): void {
    const filePath = this.getCacheFilePath(origin, language);
    const cacheKey = this.getCacheKey(origin, language);

    // Remove from memory cache
    this.memoryCache.delete(cacheKey);

    // Remove from disk
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * List all cached dictionaries
   */
  listAll(): Array<{ origin: string; language: LanguageCode }> {
    if (!fs.existsSync(this.cacheDir)) {
      return [];
    }

    const files = fs.readdirSync(this.cacheDir);
    const dictionaries: Array<{ origin: string; language: LanguageCode }> = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(this.cacheDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const dict = JSON.parse(content) as Dictionary;
        dictionaries.push({
          origin: dict.origin,
          language: dict.language,
        });
      } catch (error) {
        // Skip invalid files
      }
    }

    return dictionaries;
  }

  /**
   * Clear all cached dictionaries
   */
  clearAll(): void {
    // Clear memory cache
    this.memoryCache.clear();

    // Clear disk cache
    if (!fs.existsSync(this.cacheDir)) {
      return;
    }

    const files = fs.readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    }
  }
}
