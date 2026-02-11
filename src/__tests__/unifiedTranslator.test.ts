/**
 * Tests for UnifiedTranslator (AST-based translation)
 */

import { UnifiedTranslator } from '../core/unifiedTranslator';
import { MultiLangDictionary } from '../dictionary/multiLang';
import { Dictionary, TranslationScope } from '../core/types';

// Helper to create a Dictionary object
const createDictionary = (terms: Record<string, string>): Dictionary => ({
  origin: 'github.com:test/repo',
  language: 'ja',
  terms,
  metadata: {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: '1.0.0',
  },
});

describe('UnifiedTranslator', () => {
  let dictionary: MultiLangDictionary;
  let translator: UnifiedTranslator;

  beforeEach(() => {
    // Create dictionary with test terms
    dictionary = new MultiLangDictionary(createDictionary({
      'calculate': '計算する',
      'result': '結果',
      'value': '値',
      'sum': '合計',
      'multiply': '掛ける',
      'add': '足す',
      'subtract': '引く',
    }));
    translator = new UnifiedTranslator(dictionary);
  });

  describe('Basic translation', () => {
    it('should translate EN→JA', () => {
      const code = 'function calculate(value) { return value * 2; }';
      const result = translator.translate(code, 'en', 'ja');

      expect(result.code).toContain('計算する');
      expect(result.code).toContain('値');
      expect(result.translatedTokens).toContain('calculate');
      expect(result.translatedTokens).toContain('value');
    });

    it('should translate JA→EN', () => {
      const code = 'function 計算する(値) { return 値 * 2; }';
      const result = translator.translate(code, 'ja', 'en');

      expect(result.code).toContain('calculate');
      expect(result.code).toContain('value');
    });

    it('should return same code when source and target lang are equal', () => {
      const code = 'const x = 1;';
      const result = translator.translate(code, 'en', 'en');

      expect(result.code).toBe(code);
      expect(result.translatedTokens).toEqual([]);
    });
  });

  describe('Roundtrip translation', () => {
    it('should preserve code structure in EN→JA→EN roundtrip', () => {
      const originalCode = `
function calculate(value) {
  const result = value * 2;
  return result;
}
      `.trim();

      // EN → JA
      const japanese = translator.translate(originalCode, 'en', 'ja');
      expect(japanese.code).toContain('計算する');
      expect(japanese.code).toContain('結果');
      expect(japanese.code).toContain('値');

      // JA → EN
      const backToEnglish = translator.translate(japanese.code, 'ja', 'en');

      // Normalize whitespace for comparison
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      expect(normalize(backToEnglish.code)).toBe(normalize(originalCode));
    });

    it('should handle complex code with multiple functions', () => {
      const originalCode = `
function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

const sum = add(1, 2);
      `.trim();

      const japanese = translator.translate(originalCode, 'en', 'ja');
      const backToEnglish = translator.translate(japanese.code, 'ja', 'en');

      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      expect(normalize(backToEnglish.code)).toBe(normalize(originalCode));
    });
  });

  describe('Formatting preservation', () => {
    it('should preserve comments', () => {
      const code = `
// This is a comment
const result = 42;
/* Multi-line
   comment */
      `.trim();

      const result = translator.translate(code, 'en', 'ja');

      expect(result.code).toContain('// This is a comment');
      expect(result.code).toContain('/* Multi-line');
    });

    it('should preserve string literals', () => {
      const code = 'const result = "result string";';
      const result = translator.translate(code, 'en', 'ja');

      // Variable 'result' should be translated
      expect(result.code).toContain('結果');
      // String content should NOT be translated
      expect(result.code).toContain('"result string"');
    });

    it('should preserve template literals', () => {
      const code = 'const result = `Template with ${value}`;';
      const result = translator.translate(code, 'en', 'ja');

      expect(result.code).toContain('結果');
      expect(result.code).toContain('値');
      expect(result.code).toContain('`Template with');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty code', () => {
      const result = translator.translate('', 'en', 'ja');

      expect(result.code).toBe('');
      expect(result.translatedTokens).toEqual([]);
    });

    it('should handle code with no translatable identifiers', () => {
      // Use a longer identifier (single letters are excluded from tracking)
      const code = 'const myVariable = 1 + 2;';
      const result = translator.translate(code, 'en', 'ja');

      // 'myVariable' is not in dictionary, should remain unchanged
      expect(result.code).toContain('myVariable');
      expect(result.unmappedTokens).toContain('myVariable');
    });

    it('should not translate TypeScript keywords', () => {
      const dict = new MultiLangDictionary(createDictionary({
        'function': '関数',  // Should NOT be translated (keyword)
        'myFunc': '私の関数',
      }));
      const trans = new UnifiedTranslator(dict);

      const code = 'function myFunc() {}';
      const result = trans.translate(code, 'en', 'ja');

      // Keyword should remain
      expect(result.code).toContain('function');
      // User identifier should be translated
      expect(result.code).toContain('私の関数');
    });

    it('should handle generics', () => {
      const dict = new MultiLangDictionary(createDictionary({
        'Container': 'コンテナ',
        'Item': 'アイテム',
      }));
      const trans = new UnifiedTranslator(dict);

      const code = 'class Container<Item> { items: Item[]; }';
      const result = trans.translate(code, 'en', 'ja');

      expect(result.code).toContain('コンテナ');
      expect(result.code).toContain('アイテム');
    });

    it('should handle nested structures', () => {
      const code = `
const result = {
  calculate: () => {
    const value = 1;
    return value;
  }
};
      `;
      const result = translator.translate(code, 'en', 'ja');

      expect(result.code).toContain('結果');
      expect(result.code).toContain('計算する');
      expect(result.code).toContain('値');
    });
  });

  describe('Translation scope', () => {
    it('should translate only identifiers when scope.comments=false', () => {
      const code = '// This is a comment\nconst result = 1;';
      const scope: TranslationScope = {
        identifiers: true,
        comments: false,
        stringLiterals: false,
        keywords: false,
        punctuation: false,
        markdownFiles: false,
      };

      const result = translator.translate(code, 'en', 'ja', scope);

      // Identifier should be translated
      expect(result.code).toContain('結果');
      // Comment should NOT be translated (scope.comments=false)
      expect(result.code).toContain('// This is a comment');
    });

    it('should translate only comments when scope.identifiers=false', () => {
      const code = '// Comment here\nconst result = 1;';
      const scope: TranslationScope = {
        identifiers: false,
        comments: true,
        stringLiterals: false,
        keywords: false,
        punctuation: false,
        markdownFiles: false,
      };

      const result = translator.translate(code, 'en', 'ja', scope);

      // Identifier should NOT be translated
      expect(result.code).toContain('result');
    });
  });

  describe('Unmapped tokens tracking', () => {
    it('should track unmapped tokens correctly', () => {
      const code = 'function unknownFunc(unknownParam) { return result; }';
      const result = translator.translate(code, 'en', 'ja');

      // 'result' is in dictionary, should be translated
      expect(result.translatedTokens).toContain('result');

      // 'unknownFunc' and 'unknownParam' are NOT in dictionary
      expect(result.unmappedTokens).toContain('unknownFunc');
      expect(result.unmappedTokens).toContain('unknownParam');
    });
  });
});
