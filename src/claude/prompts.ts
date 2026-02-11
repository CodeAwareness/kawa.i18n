/**
 * Translation Prompts for Claude CLI
 *
 * Prompts ported from kawa.api translation services.
 * These prompts are designed for:
 * 1. Code identifier translation (camelCase terms)
 * 2. Comment translation (preserving structure)
 * 3. Natural language text translation (intent titles/descriptions)
 */

import { LanguageCode } from '../core/types';

/** Language display names for prompts */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  vi: 'Vietnamese',
  th: 'Thai',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  cs: 'Czech',
  sv: 'Swedish',
};

/**
 * Get language display name for prompts
 */
function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

/**
 * Build prompt for translating code identifiers (variable/function names).
 *
 * Critical rules embedded in prompt:
 * - Must be valid JavaScript identifiers
 * - Cannot start with digits
 * - Cannot contain spaces, hyphens, or special punctuation
 * - Unicode characters are allowed (for native language scripts)
 * - Preserves underscore prefixes for private variables
 *
 * @param terms - Array of identifier names to translate
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @returns The prompt string for Claude
 */
export function buildIdentifierTranslationPrompt(
  terms: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): string {
  const sourceLanguage = getLanguageName(sourceLang);
  const targetLanguage = getLanguageName(targetLang);

  // Number the terms for response parsing
  const numberedTerms = terms.map((term, i) => `${i + 1}. ${term}`).join('\n');

  return `You are a specialized translator for programming identifiers.

Translate the following ${sourceLanguage} programming identifiers to ${targetLanguage}.
These are variable names, function names, or other code identifiers.

IMPORTANT - OUTPUT FORMAT:
Return ONLY a numbered list matching the input order:
1. [translation for item 1]
2. [translation for item 2]
...

CRITICAL VALIDATION RULES - MUST FOLLOW:
1. All translations MUST be valid JavaScript identifiers
2. MUST NOT start with a digit (0-9)
3. MUST NOT contain: spaces, hyphens (-), dots (.), colons (:), semicolons (;),
   exclamation marks (!), question marks (?), at signs (@), hash signs (#),
   percent signs (%), carets (^), ampersands (&), asterisks (*),
   parentheses (()), brackets ([]), braces ({}), angle brackets (<>),
   plus signs (+), equals signs (=), slashes (/\\), pipes (|),
   backticks (\`), tildes (~), quotes ('"')
4. CAN use Unicode characters (native language scripts are allowed)
5. CAN start with underscore (_) for private/unused variables

IMPORTANT - NUMBERS IN IDENTIFIERS:
When translating terms containing numbers:
- If a spelled-out number appears at the START of a symbol name,
  you MUST NOT translate it into a digit.
  Examples:
    deleteOne → 一つを削除 (word form at start, not digit)
    deleteOne → 1つ削除 (INVALID: starts with digit 1)

LANGUAGE-SPECIFIC GUIDELINES:
- Use natural ${targetLanguage} terms with Unicode support
- For Japanese: Prefer kanji over katakana where natural
- Preserve technical abbreviations (id, url, api, http, etc.)
- Compound terms should be semantic compounds in target language
- Maintain consistency with similar terms
- Preserve underscore prefixes for private variables (_privateVar → _プライベート変数)

PROGRAMMING PREFIX/SUFFIX SEMANTICS:
Preserve these semantic meanings:
- un- (undo/remove): unalias → エイリアス解除
- re- (again): reload → 再読込
- pre- (before): preload → 事前読込
- post- (after): postprocess → 後処理
- de- (reverse): decode → 復号
- en- (make into): encode → 符号化
- dis- (opposite): disconnect → 切断
- is/has/can (boolean prefix): isEmpty → 空か
- get/set (accessor): getName → 名前取得
- to (conversion): toString → 文字列化

VALID EXAMPLES:
- toHexString → hex文字列に変換
- getUserName → ユーザー名を取得
- calculateTotal → 합계계산
- objIdA → オブジェクトIdA (preserve single-letter suffix without space)
- _privateVar → _プライベート変数

INVALID EXAMPLES (DO NOT produce these):
- toHexString → 16進文字列に変換 (INVALID: starts with digit)
- deleteOne → 1つ削除 (INVALID: starts with digit)
- post16 → ポスト-16 (INVALID: contains hyphen)
- objIdA → オブジェクトID A (INVALID: contains space before A)

Terms to translate:
${numberedTerms}`;
}

/**
 * Build prompt for translating code comments.
 *
 * Key features:
 * - Preserves exact line count (multi-line comments stay multi-line)
 * - Keeps JSDoc annotations intact (@param, @returns, etc.)
 * - Preserves code examples exactly as-is
 * - Keeps TODO/FIXME/NOTE markers unchanged
 *
 * @param comments - Array of comment strings to translate
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @returns The prompt string for Claude
 */
export function buildCommentTranslationPrompt(
  comments: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): string {
  const sourceLanguage = getLanguageName(sourceLang);
  const targetLanguage = getLanguageName(targetLang);

  // Base64 encode comments to prevent JSON parsing errors
  const encodedComments = comments.map((comment, i) => {
    const encoded = Buffer.from(comment).toString('base64');
    return `${i + 1}. ${encoded}`;
  }).join('\n');

  return `You are a specialized translator for code comments.

Translate the following ${sourceLanguage} code comments to ${targetLanguage}.

IMPORTANT - INPUT FORMAT:
Comments are base64-encoded to preserve special characters.
Decode each comment, translate it, then respond with the translation.

IMPORTANT - OUTPUT FORMAT:
Return ONLY a numbered list matching the input order.
For multi-line comments, use \\n to represent line breaks within the single numbered response:
1. [translated comment 1 - if multi-line, use \\n to represent line breaks]
2. [translated comment 2]
...

STRUCTURE PRESERVATION RULES:
1. Keep EXACT same number of lines as original
2. Keep JSDoc annotations (@param, @returns, @example, @throws) on their own lines
   - Only translate the description text, keep the annotation itself
   - Example: @param name The user name → @param name ユーザー名
3. Keep code examples EXACTLY as they appear (do NOT translate code!)
4. Keep TODO, FIXME, NOTE, HACK, XXX markers unchanged
5. Keep blank lines where they exist
6. Each line of original maps to exactly one line in translation

TRANSLATION GUIDELINES:
- Keep technical terms and API names unchanged (ObjectId, MongoDB, $ne, $gt)
- Preserve tone and style (formal/informal)
- Translate naturally as a native ${targetLanguage} speaker would write
- Do NOT add explanations or notes, only the translation

Comments to translate (base64-encoded):
${encodedComments}`;
}

/**
 * Build prompt for translating natural language text.
 *
 * Used for:
 * - Intent titles and descriptions
 * - User-written content (not code)
 * - Documentation fragments
 *
 * @param texts - Array of text strings to translate
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @returns The prompt string for Claude
 */
export function buildTextTranslationPrompt(
  texts: string[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): string {
  const sourceLanguage = getLanguageName(sourceLang);
  const targetLanguage = getLanguageName(targetLang);

  // Number the texts for response parsing
  const numberedTexts = texts.map((text, i) => `${i + 1}. ${text}`).join('\n');

  return `You are a professional translator.

Translate the following ${sourceLanguage} text to ${targetLanguage}.
These are short descriptions or titles (e.g., for tasks, features, or documentation).

IMPORTANT - OUTPUT FORMAT:
Return ONLY a numbered list matching the input order:
1. [translation for item 1]
2. [translation for item 2]
...

TRANSLATION GUIDELINES:
- Translate naturally as a native ${targetLanguage} speaker would write
- Keep technical terms that are commonly used in ${targetLanguage} as-is
- Preserve any formatting (e.g., markdown, punctuation)
- Do NOT add explanations or notes, only the translation
- Match the formality level of the original text

Texts to translate:
${numberedTexts}`;
}

/**
 * Parse numbered list response from Claude.
 *
 * Handles various formats:
 * - "1. translation"
 * - "1: translation"
 * - "1) translation"
 *
 * @param response - The response text from Claude
 * @param expectedCount - Expected number of items
 * @returns Array of translations in order
 */
export function parseNumberedListResponse(response: string, expectedCount: number): string[] {
  const results: string[] = new Array(expectedCount).fill('');
  const lines = response.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Match patterns like "1. text", "1: text", "1) text"
    const match = line.match(/^(\d+)[.\):]\s*(.+)$/);
    if (match) {
      const index = parseInt(match[1], 10) - 1;
      const translation = match[2].trim();
      if (index >= 0 && index < expectedCount) {
        results[index] = translation;
      }
    }
  }

  return results;
}

/**
 * Parse comment translations that may contain \\n for line breaks.
 *
 * @param response - The response text from Claude
 * @param expectedCount - Expected number of items
 * @returns Array of translations with newlines restored
 */
export function parseCommentTranslationResponse(response: string, expectedCount: number): string[] {
  const results = parseNumberedListResponse(response, expectedCount);

  // Restore newlines from \\n encoding
  return results.map(translation =>
    translation.replace(/\\n/g, '\n')
  );
}
