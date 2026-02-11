/**
 * Intent Translation Cache
 *
 * LRU cache for translated intent metadata.
 * Persisted to disk per repository origin.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../ipc/protocol';
import { IntentCacheEntry, IntentMetadataCacheEntry, BlockContentCacheEntry } from './types';

/**
 * Cache configuration
 */
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get cache directory path
 */
function getCacheDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.kawa-code', 'i18n', 'intent-cache');
}

/**
 * Get cache file path for a repository origin
 */
function getCacheFilePath(origin: string): string {
  // Sanitize origin for filesystem
  const safeOrigin = origin.replace(/[^a-zA-Z0-9.-]/g, '_');
  return path.join(getCacheDir(), `${safeOrigin}.json`);
}

/**
 * LRU cache for intent translations
 */
export class IntentTranslationCache {
  private cache: Map<string, IntentCacheEntry>;
  private origin: string;
  private dirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(origin: string) {
    this.origin = origin;
    this.cache = new Map();
    this.load();
  }

  /**
   * Generate cache key from intent ID and target language
   */
  private getCacheKey(intentId: string, targetLang: string): string {
    return `${intentId}:${targetLang}`;
  }

  /**
   * Get cached translation
   */
  get(intentId: string, targetLang: string): IntentCacheEntry | null {
    const key = this.getCacheKey(intentId, targetLang);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      this.dirty = true;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  /**
   * Store translation in cache
   */
  set(intentId: string, targetLang: string, title: string, description: string): void {
    const key = this.getCacheKey(intentId, targetLang);

    // Evict oldest entry if at capacity
    if (this.cache.size >= CACHE_MAX_SIZE && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      title,
      description,
      timestamp: Date.now(),
    });

    this.dirty = true;
    this.scheduleSave();
  }

  /**
   * Get cached metadata translation (includes constraints)
   */
  getMetadata(intentId: string, targetLang: string): IntentMetadataCacheEntry | null {
    const key = `metadata:${this.getCacheKey(intentId, targetLang)}`;
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      this.dirty = true;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return {
      title: entry.title,
      description: entry.description,
      constraints: entry.constraints || [],
      timestamp: entry.timestamp,
    };
  }

  /**
   * Store metadata translation in cache (includes constraints)
   */
  setMetadata(
    intentId: string,
    targetLang: string,
    data: { title: string; description: string; constraints: string[] }
  ): void {
    const key = `metadata:${this.getCacheKey(intentId, targetLang)}`;

    // Evict oldest entry if at capacity
    if (this.cache.size >= CACHE_MAX_SIZE && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      title: data.title,
      description: data.description,
      constraints: data.constraints,
      timestamp: Date.now(),
    });

    this.dirty = true;
    this.scheduleSave();
  }

  /**
   * Clear all cached translations for this origin
   */
  clear(): void {
    this.cache.clear();
    this.dirty = true;
    this.save();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; origin: string } {
    return {
      size: this.cache.size,
      maxSize: CACHE_MAX_SIZE,
      origin: this.origin,
    };
  }

  /**
   * Load cache from disk
   */
  private load(): void {
    const filePath = getCacheFilePath(this.origin);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (data && typeof data === 'object') {
          // Restore cache entries, filtering expired ones
          const now = Date.now();
          for (const [key, entry] of Object.entries(data)) {
            const cacheEntry = entry as IntentCacheEntry;
            if (now - cacheEntry.timestamp < CACHE_TTL_MS) {
              this.cache.set(key, cacheEntry);
            }
          }
          log(`[IntentCache] Loaded ${this.cache.size} entries for ${this.origin}`);
        }
      }
    } catch (error: any) {
      log(`[IntentCache] Failed to load cache for ${this.origin}: ${error.message}`);
    }
  }

  /**
   * Save cache to disk (debounced)
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), 5000);
  }

  /**
   * Save cache to disk immediately
   */
  private save(): void {
    if (!this.dirty) {
      return;
    }

    const filePath = getCacheFilePath(this.origin);

    try {
      // Ensure directory exists
      const dir = getCacheDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Convert Map to object for JSON serialization
      const data: Record<string, IntentCacheEntry> = {};
      for (const [key, entry] of this.cache.entries()) {
        data[key] = entry;
      }

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
      log(`[IntentCache] Saved ${this.cache.size} entries for ${this.origin}`);
    } catch (error: any) {
      log(`[IntentCache] Failed to save cache for ${this.origin}: ${error.message}`);
    }
  }
}

/**
 * Cache manager - maintains per-origin caches
 */
class IntentCacheManager {
  private caches: Map<string, IntentTranslationCache> = new Map();

  /**
   * Get or create cache for an origin
   */
  getCache(origin: string): IntentTranslationCache {
    let cache = this.caches.get(origin);
    if (!cache) {
      cache = new IntentTranslationCache(origin);
      this.caches.set(origin, cache);
    }
    return cache;
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    this.caches.clear();
  }
}

// Singleton cache manager
export const intentCacheManager = new IntentCacheManager();

// ============================================================================
// Block Content Cache
// ============================================================================

/**
 * Cache configuration for block content
 * Shorter TTL than metadata since content changes more frequently
 */
const BLOCK_CONTENT_CACHE_MAX_SIZE = 100;
const BLOCK_CONTENT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * LRU cache for block content translations
 * In-memory only (no persistence) since content is easily re-fetched
 */
export class BlockContentCache {
  private cache: Map<string, BlockContentCacheEntry>;
  private origin: string;

  constructor(origin: string) {
    this.origin = origin;
    this.cache = new Map();
  }

  /**
   * Generate cache key from block location and target language
   */
  private getCacheKey(
    filePath: string,
    startLine: number,
    endLine: number,
    targetLang: string
  ): string {
    return `${filePath}:${startLine}-${endLine}:${targetLang}`;
  }

  /**
   * Get cached content translation
   */
  get(
    filePath: string,
    startLine: number,
    endLine: number,
    targetLang: string
  ): BlockContentCacheEntry | null {
    const key = this.getCacheKey(filePath, startLine, endLine, targetLang);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > BLOCK_CONTENT_CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  /**
   * Store content translation in cache
   */
  set(
    filePath: string,
    startLine: number,
    endLine: number,
    targetLang: string,
    content: string,
    translatedContent: string,
    language: string,
    sourceCommentLang: string
  ): void {
    const key = this.getCacheKey(filePath, startLine, endLine, targetLang);

    // Evict oldest entry if at capacity
    if (this.cache.size >= BLOCK_CONTENT_CACHE_MAX_SIZE && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      content,
      translatedContent,
      language,
      sourceCommentLang,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached content for this origin
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; origin: string } {
    return {
      size: this.cache.size,
      maxSize: BLOCK_CONTENT_CACHE_MAX_SIZE,
      origin: this.origin,
    };
  }
}

/**
 * Block content cache manager - maintains per-origin caches
 */
class BlockContentCacheManager {
  private caches: Map<string, BlockContentCache> = new Map();

  /**
   * Get or create cache for an origin
   */
  getCache(origin: string): BlockContentCache {
    let cache = this.caches.get(origin);
    if (!cache) {
      cache = new BlockContentCache(origin);
      this.caches.set(origin, cache);
    }
    return cache;
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    this.caches.clear();
  }
}

// Singleton block content cache manager
export const blockContentCacheManager = new BlockContentCacheManager();
