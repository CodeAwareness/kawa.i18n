/**
 * Tests for MultiLangDictionary
 *
 * Tests the hub-based translation system where English acts as the central hub.
 */

import { MultiLangDictionary } from '../dictionary/multiLang';
import { Dictionary } from '../core/types';

describe('MultiLangDictionary', () => {
  // Helper to create a Dictionary object
  const createDictionary = (
    terms: Record<string, string>,
    language: 'ja' | 'es' | 'fr' = 'ja',
    comments: Record<string, { en: string; [key: string]: string }> = {}
  ): Dictionary => ({
    origin: 'github.com:test/repo',
    language,
    terms,
    comments,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0',
    },
  });

  describe('Basic translation', () => {
    it('should translate EN→JA', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'calculate': '計算する',
          'result': '結果',
          'value': '値',
        })
      );

      expect(dict.getTranslation('calculate', 'en', 'ja')).toBe('計算する');
      expect(dict.getTranslation('result', 'en', 'ja')).toBe('結果');
      expect(dict.getTranslation('value', 'en', 'ja')).toBe('値');
    });

    it('should translate JA→EN (reverse lookup)', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'calculate': '計算する',
          'result': '結果',
          'value': '値',
        })
      );

      expect(dict.getTranslation('計算する', 'ja', 'en')).toBe('calculate');
      expect(dict.getTranslation('結果', 'ja', 'en')).toBe('result');
      expect(dict.getTranslation('値', 'ja', 'en')).toBe('value');
    });

    it('should return same term when source equals target', () => {
      const dict = new MultiLangDictionary(
        createDictionary({ 'test': 'テスト' })
      );

      expect(dict.getTranslation('test', 'en', 'en')).toBe('test');
      expect(dict.getTranslation('テスト', 'ja', 'ja')).toBe('テスト');
    });

    it('should return undefined for unknown terms', () => {
      const dict = new MultiLangDictionary(
        createDictionary({ 'known': '既知' })
      );

      expect(dict.getTranslation('unknown', 'en', 'ja')).toBeUndefined();
      expect(dict.getTranslation('不明', 'ja', 'en')).toBeUndefined();
    });
  });

  describe('hasTerm', () => {
    it('should detect terms in either language', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'hello': 'こんにちは',
          'world': '世界',
        })
      );

      // English terms
      expect(dict.hasTerm('hello')).toBe(true);
      expect(dict.hasTerm('world')).toBe(true);

      // Japanese terms
      expect(dict.hasTerm('こんにちは')).toBe(true);
      expect(dict.hasTerm('世界')).toBe(true);

      // Unknown
      expect(dict.hasTerm('unknown')).toBe(false);
    });
  });

  describe('hasTermInLanguage', () => {
    it('should check term existence in specific language', () => {
      const dict = new MultiLangDictionary(
        createDictionary({ 'test': 'テスト' })
      );

      expect(dict.hasTermInLanguage('test', 'en')).toBe(true);
      expect(dict.hasTermInLanguage('テスト', 'ja')).toBe(true);
      expect(dict.hasTermInLanguage('test', 'ja')).toBe(false);
      expect(dict.hasTermInLanguage('テスト', 'en')).toBe(false);
    });
  });

  describe('getAllTerms', () => {
    it('should return all English terms', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'hello': 'こんにちは',
          'world': '世界',
          'calculate': '計算する',
        })
      );

      const enTerms = dict.getAllTerms('en');
      expect(enTerms).toContain('hello');
      expect(enTerms).toContain('world');
      expect(enTerms).toContain('calculate');
      expect(enTerms.length).toBe(3);
    });

    it('should return all target language terms', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'hello': 'こんにちは',
          'world': '世界',
        })
      );

      const jaTerms = dict.getAllTerms('ja');
      expect(jaTerms).toContain('こんにちは');
      expect(jaTerms).toContain('世界');
      expect(jaTerms.length).toBe(2);
    });
  });

  describe('Metadata', () => {
    it('should return correct language', () => {
      const jaDict = new MultiLangDictionary(createDictionary({}, 'ja'));
      const esDict = new MultiLangDictionary(createDictionary({}, 'es'));

      expect(jaDict.getLanguage()).toBe('ja');
      expect(esDict.getLanguage()).toBe('es');
    });

    it('should return correct origin', () => {
      const dict = new MultiLangDictionary(createDictionary({}));
      expect(dict.getOrigin()).toBe('github.com:test/repo');
    });

    it('should return correct term count', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'a': 'あ',
          'b': 'び',
          'c': 'し',
        })
      );

      expect(dict.getTermCount()).toBe(3);
    });
  });

  describe('Comment translations', () => {
    it('should translate comments by hash', () => {
      const crypto = require('crypto');
      const englishComment = 'This is a comment';
      const hash = crypto.createHash('md5').update(englishComment.trim()).digest('hex');

      const dict = new MultiLangDictionary(
        createDictionary({}, 'ja', {
          [hash]: {
            en: englishComment,
            ja: 'これはコメントです',
          },
        })
      );

      expect(dict.getCommentTranslation(englishComment, 'ja')).toBe('これはコメントです');
    });

    it('should reverse translate comments to English', () => {
      const crypto = require('crypto');
      const englishComment = 'Test comment';
      const hash = crypto.createHash('md5').update(englishComment.trim()).digest('hex');

      const dict = new MultiLangDictionary(
        createDictionary({}, 'ja', {
          [hash]: {
            en: englishComment,
            ja: 'テストコメント',
          },
        })
      );

      expect(dict.getCommentTranslation('テストコメント', 'en')).toBe(englishComment);
    });

    it('should return undefined for unknown comments', () => {
      const dict = new MultiLangDictionary(createDictionary({}));
      expect(dict.getCommentTranslation('Unknown comment', 'ja')).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty dictionary', () => {
      const dict = new MultiLangDictionary(createDictionary({}));

      expect(dict.getTermCount()).toBe(0);
      expect(dict.getAllTerms('en')).toEqual([]);
      expect(dict.hasTerm('anything')).toBe(false);
    });

    it('should handle terms with special characters', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'user_name': 'ユーザー名',
          'getData': 'データ取得',
          '$value': '値',
        })
      );

      expect(dict.getTranslation('user_name', 'en', 'ja')).toBe('ユーザー名');
      expect(dict.getTranslation('getData', 'en', 'ja')).toBe('データ取得');
      expect(dict.getTranslation('$value', 'en', 'ja')).toBe('値');
    });
  });

  describe('addTerms (in-place update)', () => {
    it('should add new terms to the dictionary', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'existing': '既存',
        })
      );

      expect(dict.getTermCount()).toBe(1);

      dict.addTerms({
        'newTerm': '新しい用語',
        'anotherTerm': '別の用語',
      });

      expect(dict.getTermCount()).toBe(3);
      expect(dict.getTranslation('newTerm', 'en', 'ja')).toBe('新しい用語');
      expect(dict.getTranslation('anotherTerm', 'en', 'ja')).toBe('別の用語');
      // Original term still works
      expect(dict.getTranslation('existing', 'en', 'ja')).toBe('既存');
    });

    it('should support reverse lookup for added terms', () => {
      const dict = new MultiLangDictionary(createDictionary({}));

      dict.addTerms({
        'calculate': '計算する',
        'result': '結果',
      });

      // Reverse lookup (JA → EN)
      expect(dict.getTranslation('計算する', 'ja', 'en')).toBe('calculate');
      expect(dict.getTranslation('結果', 'ja', 'en')).toBe('result');
    });

    it('should update hasTerm for added terms', () => {
      const dict = new MultiLangDictionary(createDictionary({}));

      expect(dict.hasTerm('newTerm')).toBe(false);
      expect(dict.hasTerm('新しい')).toBe(false);

      dict.addTerms({ 'newTerm': '新しい' });

      expect(dict.hasTerm('newTerm')).toBe(true);
      expect(dict.hasTerm('新しい')).toBe(true);
    });

    it('should overwrite existing terms', () => {
      const dict = new MultiLangDictionary(
        createDictionary({
          'value': '値',
        })
      );

      expect(dict.getTranslation('value', 'en', 'ja')).toBe('値');

      // Overwrite with different translation
      dict.addTerms({ 'value': '数値' });

      expect(dict.getTranslation('value', 'en', 'ja')).toBe('数値');
      expect(dict.getTermCount()).toBe(1); // Still only one term
    });

    it('should handle empty addTerms call', () => {
      const dict = new MultiLangDictionary(
        createDictionary({ 'test': 'テスト' })
      );

      dict.addTerms({});

      expect(dict.getTermCount()).toBe(1);
      expect(dict.getTranslation('test', 'en', 'ja')).toBe('テスト');
    });
  });
});
