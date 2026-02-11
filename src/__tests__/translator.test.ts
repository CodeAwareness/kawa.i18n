/**
 * Tests for core Translator class
 */

import { Translator } from '../core/translator';

describe('Translator', () => {
  describe('Basic translation', () => {
    it('should translate identifiers using provided mapping', () => {
      const mapping = {
        'hello': 'こんにちは',
        'world': '世界',
        'calculate': '計算する',
      };

      const translator = new Translator(mapping);
      const code = 'const hello = "test"; function calculate() { return world; }';
      const result = translator.toCustom(code);

      expect(result.code).toContain('こんにちは');
      expect(result.code).toContain('計算する');
      expect(result.code).toContain('世界');
    });

    it('should track translated tokens', () => {
      const mapping = {
        'foo': 'フー',
        'bar': 'バー',
      };

      const translator = new Translator(mapping);
      const code = 'const foo = bar;';
      const result = translator.toCustom(code);

      expect(result.translatedTokens).toContain('foo');
      expect(result.translatedTokens).toContain('bar');
    });

    it('should track unmapped tokens', () => {
      const mapping = {
        'foo': 'フー',
      };

      const translator = new Translator(mapping);
      const code = 'const foo = unmappedVar;';
      const result = translator.toCustom(code);

      expect(result.unmappedTokens).toContain('unmappedVar');
    });
  });

  describe('Reverse translation (toEnglish)', () => {
    it('should translate back to English', () => {
      const mapping = {
        'add': '加算',
        'subtract': '減算',
      };

      const translator = new Translator(mapping);
      const japaneseCode = 'function 加算(a, b) { return a + b; }';
      const result = translator.toEnglish(japaneseCode);

      expect(result.code).toContain('add');
    });
  });

  describe('Roundtrip translation', () => {
    it('should produce identical code after EN→JA→EN roundtrip', () => {
      const mapping = {
        'calculate': '計算',
        'result': '結果',
        'value': '値',
      };

      const translator = new Translator(mapping);
      const originalCode = 'function calculate(value) { const result = value * 2; return result; }';

      // EN → JA
      const japanese = translator.toCustom(originalCode);
      expect(japanese.code).toContain('計算');
      expect(japanese.code).toContain('結果');
      expect(japanese.code).toContain('値');

      // JA → EN
      const backToEnglish = translator.toEnglish(japanese.code);

      // Should match original (ignoring whitespace)
      expect(backToEnglish.code.replace(/\s+/g, ' ').trim())
        .toBe(originalCode.replace(/\s+/g, ' ').trim());
    });
  });

  describe('Edge cases', () => {
    it('should handle empty code', () => {
      const translator = new Translator({});
      const result = translator.toCustom('');

      expect(result.code).toBe('');
      expect(result.translatedTokens).toEqual([]);
    });

    it('should handle code with no identifiers to translate', () => {
      const translator = new Translator({});
      const code = '// Just a comment';
      const result = translator.toCustom(code);

      expect(result.code).toBe(code);
    });

    it('should not translate keywords', () => {
      const mapping = {
        'function': '関数',  // Should NOT be translated - it's a keyword
        'const': '定数',     // Should NOT be translated
        'myFunc': '私の関数', // Should be translated
      };

      const translator = new Translator(mapping);
      const code = 'const myFunc = function() {};';
      const result = translator.toCustom(code);

      // Keywords should remain unchanged
      expect(result.code).toContain('const');
      expect(result.code).toContain('function');
      // User identifier should be translated
      expect(result.code).toContain('私の関数');
    });

    it('should preserve string literals', () => {
      const mapping = {
        'hello': 'こんにちは',
      };

      const translator = new Translator(mapping);
      const code = 'const hello = "hello world";';
      const result = translator.toCustom(code);

      // Variable 'hello' should be translated
      expect(result.code).toContain('こんにちは');
      // String content should NOT be translated
      expect(result.code).toContain('"hello world"');
    });

    it('should handle complex nested structures', () => {
      const mapping = {
        'outer': '外側',
        'inner': '内側',
        'callback': 'コールバック',
      };

      const translator = new Translator(mapping);
      const code = `
        const outer = {
          inner: {
            callback: () => {}
          }
        };
      `;
      const result = translator.toCustom(code);

      expect(result.code).toContain('外側');
      expect(result.code).toContain('内側');
      expect(result.code).toContain('コールバック');
    });
  });

  describe('Unicode handling', () => {
    it('should handle identifiers with unicode characters', () => {
      // Mapping is English → custom (Japanese)
      const mapping = {
        'variable': '変数',
        'functionName': '関数名',
      };

      const translator = new Translator(mapping);
      // Test toEnglish: Japanese → English
      const japaneseCode = 'const 変数 = 関数名();';
      const result = translator.toEnglish(japaneseCode);

      expect(result.code).toContain('variable');
      expect(result.code).toContain('functionName');
    });
  });
});
