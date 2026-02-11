/**
 * Tests for DictionaryCache
 *
 * Tests the file-based cache with in-memory layer for performance optimization.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DictionaryCache } from '../dictionary/cache';
import { Dictionary } from '../core/types';

describe('DictionaryCache', () => {
  let cache: DictionaryCache;
  let testCacheDir: string;

  // Helper to create a Dictionary object
  const createDictionary = (
    origin: string,
    language: 'ja' | 'es' | 'fr' = 'ja',
    terms: Record<string, string> = {}
  ): Dictionary => ({
    origin,
    language,
    terms,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0',
    },
  });

  beforeEach(() => {
    cache = new DictionaryCache();
    // Get the cache directory path for cleanup
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    testCacheDir = path.join(homeDir, '.kawa-code', 'i18n', 'dictionaries');
  });

  afterEach(() => {
    // Clean up test dictionaries
    const testOrigins = ['test/memory-cache-repo', 'test/cache-repo-1', 'test/cache-repo-2'];
    for (const origin of testOrigins) {
      try {
        cache.delete(origin, 'ja');
        cache.delete(origin, 'es');
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Basic operations', () => {
    it('should save and load a dictionary', () => {
      const dict = createDictionary('test/cache-repo-1', 'ja', {
        'hello': 'こんにちは',
      });

      cache.save(dict);
      const loaded = cache.load('test/cache-repo-1', 'ja');

      expect(loaded).not.toBeNull();
      expect(loaded?.origin).toBe('test/cache-repo-1');
      expect(loaded?.language).toBe('ja');
      expect(loaded?.terms['hello']).toBe('こんにちは');
    });

    it('should return null for non-existent dictionary', () => {
      const loaded = cache.load('non/existent', 'ja');
      expect(loaded).toBeNull();
    });

    it('should check existence correctly', () => {
      const dict = createDictionary('test/cache-repo-1', 'ja');

      expect(cache.exists('test/cache-repo-1', 'ja')).toBe(false);

      cache.save(dict);

      expect(cache.exists('test/cache-repo-1', 'ja')).toBe(true);
      expect(cache.exists('test/cache-repo-1', 'es')).toBe(false);
    });

    it('should delete a dictionary', () => {
      const dict = createDictionary('test/cache-repo-1', 'ja');
      cache.save(dict);

      expect(cache.exists('test/cache-repo-1', 'ja')).toBe(true);

      cache.delete('test/cache-repo-1', 'ja');

      expect(cache.exists('test/cache-repo-1', 'ja')).toBe(false);
      expect(cache.load('test/cache-repo-1', 'ja')).toBeNull();
    });
  });

  describe('In-memory caching', () => {
    it('should return cached dictionary on subsequent loads without disk read', () => {
      const dict = createDictionary('test/memory-cache-repo', 'ja', {
        'test': 'テスト',
      });

      cache.save(dict);

      // First load (may read from disk)
      const firstLoad = cache.load('test/memory-cache-repo', 'ja');

      // Second load should return the same object from memory
      const secondLoad = cache.load('test/memory-cache-repo', 'ja');

      expect(firstLoad).toBe(secondLoad); // Same object reference
    });

    it('should update memory cache when saving', () => {
      const dict1 = createDictionary('test/memory-cache-repo', 'ja', {
        'original': '元の',
      });

      cache.save(dict1);
      const firstLoad = cache.load('test/memory-cache-repo', 'ja');
      expect(firstLoad?.terms['original']).toBe('元の');

      // Save updated dictionary
      const dict2 = createDictionary('test/memory-cache-repo', 'ja', {
        'updated': '更新された',
      });
      cache.save(dict2);

      // Should get the updated version from memory
      const secondLoad = cache.load('test/memory-cache-repo', 'ja');
      expect(secondLoad?.terms['updated']).toBe('更新された');
      expect(secondLoad?.terms['original']).toBeUndefined();
    });

    it('should clear memory cache entry on delete', () => {
      const dict = createDictionary('test/memory-cache-repo', 'ja', {
        'test': 'テスト',
      });

      cache.save(dict);

      // Load to populate memory cache
      const firstLoad = cache.load('test/memory-cache-repo', 'ja');
      expect(firstLoad).not.toBeNull();

      // Delete
      cache.delete('test/memory-cache-repo', 'ja');

      // Should return null (not cached object)
      const afterDelete = cache.load('test/memory-cache-repo', 'ja');
      expect(afterDelete).toBeNull();
    });

    it('should clear all memory cache entries on clearAll', () => {
      const dict1 = createDictionary('test/cache-repo-1', 'ja');
      const dict2 = createDictionary('test/cache-repo-2', 'ja');

      cache.save(dict1);
      cache.save(dict2);

      // Populate memory cache
      cache.load('test/cache-repo-1', 'ja');
      cache.load('test/cache-repo-2', 'ja');

      cache.clearAll();

      // Memory cache should be cleared
      expect(cache.load('test/cache-repo-1', 'ja')).toBeNull();
      expect(cache.load('test/cache-repo-2', 'ja')).toBeNull();
    });

    it('should handle multiple languages for same origin independently', () => {
      const dictJa = createDictionary('test/memory-cache-repo', 'ja', {
        'hello': 'こんにちは',
      });
      const dictEs = createDictionary('test/memory-cache-repo', 'es', {
        'hello': 'hola',
      });

      cache.save(dictJa);
      cache.save(dictEs);

      const loadedJa = cache.load('test/memory-cache-repo', 'ja');
      const loadedEs = cache.load('test/memory-cache-repo', 'es');

      expect(loadedJa?.terms['hello']).toBe('こんにちは');
      expect(loadedEs?.terms['hello']).toBe('hola');

      // Delete only Japanese
      cache.delete('test/memory-cache-repo', 'ja');

      expect(cache.load('test/memory-cache-repo', 'ja')).toBeNull();
      expect(cache.load('test/memory-cache-repo', 'es')?.terms['hello']).toBe('hola');
    });
  });

  describe('Disk persistence', () => {
    it('should persist dictionary to disk', () => {
      const dict = createDictionary('test/cache-repo-1', 'ja', {
        'persist': '永続化',
      });

      cache.save(dict);

      // Verify file exists on disk
      const sanitized = 'test/cache-repo-1'
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
      const filePath = path.join(testCacheDir, `${sanitized}_ja.json`);

      expect(fs.existsSync(filePath)).toBe(true);

      // Verify content
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.terms['persist']).toBe('永続化');
    });

    it('should load from disk when not in memory cache', () => {
      const dict = createDictionary('test/cache-repo-1', 'ja', {
        'fromDisk': 'ディスクから',
      });

      // Save directly to disk (bypassing memory cache simulation)
      const sanitized = 'test/cache-repo-1'
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
      const filePath = path.join(testCacheDir, `${sanitized}_ja.json`);

      // Ensure directory exists
      if (!fs.existsSync(testCacheDir)) {
        fs.mkdirSync(testCacheDir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(dict), 'utf-8');

      // Create new cache instance (empty memory cache)
      const freshCache = new DictionaryCache();
      const loaded = freshCache.load('test/cache-repo-1', 'ja');

      expect(loaded?.terms['fromDisk']).toBe('ディスクから');

      // Cleanup
      freshCache.delete('test/cache-repo-1', 'ja');
    });
  });
});
