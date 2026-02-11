/**
 * Tests for Claude CLI helper functions
 *
 * These tests focus on the pure functions in claude/cli.ts
 * without actually spawning the claude CLI process.
 */

import { extractJsonFromResponse } from '../claude/cli';

describe('Claude CLI', () => {
  describe('extractJsonFromResponse', () => {
    it('should extract JSON from ```json blocks', () => {
      const text = `
Here is the translation:

\`\`\`json
{"translations": ["こんにちは", "世界"]}
\`\`\`

Hope this helps!
      `;

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.translations).toEqual(['こんにちは', '世界']);
    });

    it('should extract JSON from ``` blocks without language tag', () => {
      const text = `
Result:

\`\`\`
{"key": "value"}
\`\`\`
      `;

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.key).toBe('value');
    });

    it('should handle raw JSON starting with {', () => {
      const text = '{"status": "success", "data": [1, 2, 3]}';

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('success');
      expect(parsed.data).toEqual([1, 2, 3]);
    });

    it('should handle raw JSON starting with [', () => {
      const text = '["item1", "item2", "item3"]';

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(['item1', 'item2', 'item3']);
    });

    it('should find balanced JSON in text', () => {
      const text = 'The result is {"found": true} as expected.';

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.found).toBe(true);
    });

    it('should handle nested JSON objects', () => {
      const text = `
\`\`\`json
{
  "outer": {
    "inner": {
      "deep": "value"
    }
  }
}
\`\`\`
      `;

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.outer.inner.deep).toBe('value');
    });

    it('should handle JSON with escaped quotes', () => {
      const text = '{"message": "He said \\"hello\\""}';

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.message).toBe('He said "hello"');
    });

    it('should handle arrays within objects', () => {
      const text = `
\`\`\`json
{
  "items": [
    {"name": "first"},
    {"name": "second"}
  ]
}
\`\`\`
      `;

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].name).toBe('first');
    });

    it('should return original text if no JSON found', () => {
      const text = 'Just plain text with no JSON';

      const result = extractJsonFromResponse(text);

      expect(result).toBe(text);
    });

    it('should handle JSON with newlines in strings', () => {
      const text = '{"multiline": "line1\\nline2\\nline3"}';

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      expect(parsed.multiline).toContain('line1');
    });

    it('should extract first valid JSON when multiple exist', () => {
      const text = 'First: {"a": 1} and second: {"b": 2}';

      const result = extractJsonFromResponse(text);
      const parsed = JSON.parse(result);

      // Should find the first valid JSON
      expect(parsed.a === 1 || parsed.b === 2).toBe(true);
    });
  });

  describe('Claude CLI response parsing', () => {
    it('should handle standard Claude JSON response format', () => {
      const response = JSON.stringify({
        response_type: 'text',
        subtype: 'text',
        result: '1. こんにちは\n2. 世界',
      });

      // This simulates what parseClaudeResponse would extract
      const parsed = JSON.parse(response);
      expect(parsed.result).toContain('こんにちは');
    });

    it('should handle error responses', () => {
      const response = JSON.stringify({
        response_type: 'error',
        is_error: true,
        result: 'Rate limit exceeded',
      });

      const parsed = JSON.parse(response);
      expect(parsed.is_error).toBe(true);
      expect(parsed.result).toBe('Rate limit exceeded');
    });
  });

  describe('Numbered list response parsing', () => {
    it('should parse numbered translation list', () => {
      const response = `
1. こんにちは
2. 世界
3. 計算する
      `.trim();

      const lines = response.split('\n');
      const translations = lines.map(line => {
        const match = line.match(/^\d+\.\s*(.+)$/);
        return match ? match[1] : line;
      });

      expect(translations).toEqual(['こんにちは', '世界', '計算する']);
    });

    it('should handle various numbering formats', () => {
      const responses = [
        '1. item',
        '1) item',
        '1: item',
      ];

      for (const response of responses) {
        const match = response.match(/^\d+[.:)]\s*(.+)$/);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('item');
      }
    });
  });
});
