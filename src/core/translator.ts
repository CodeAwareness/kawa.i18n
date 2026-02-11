import { TokenMapper } from './tokenMapper';
import { ASTTransformer } from './astTransformer';
import { TokenMapping, TranslatorOptions, TranslationResult, CommentTranslations, LanguageCode } from './types';

/**
 * Main Translator class for bidirectional TypeScript token translation
 *
 * Note: TypeScript keywords (function, const, if, return, etc.) are NOT translated.
 * Only user-defined identifiers (variable names, function names, class names, etc.) are translated.
 * This ensures the code remains valid TypeScript with full IDE/tooling support.
 *
 * @example
 * ```typescript
 * const translator = new Translator({
 *   'Calculator': 'Calculadora',
 *   'add': 'sumar',
 *   'result': 'resultado'
 * });
 *
 * const code = 'class Calculator { add() { const result = 42; return result; } }';
 * const result = translator.toCustom(code);
 * // Output: class Calculadora { sumar() { const resultado = 42; return resultado; } }
 * // Notice: 'class', 'const', 'return' stay in English!
 *
 * const original = translator.toEnglish(result.code);
 * // Perfectly restores the original code
 * ```
 */
export class Translator {
  private mapper: TokenMapper;
  private transformer: ASTTransformer;
  private targetLanguage?: LanguageCode;

  /**
   * Creates a new Translator instance
   * @param mapping - Object mapping English tokens to custom tokens
   * @param options - Optional configuration for translation behavior
   * @param targetLanguage - Optional target language code for comment translation
   */
  constructor(mapping: TokenMapping, options?: TranslatorOptions, targetLanguage?: LanguageCode) {
    this.mapper = new TokenMapper(mapping);
    this.transformer = new ASTTransformer(this.mapper, options);
    this.targetLanguage = targetLanguage;
  }

  /**
   * Set comment translations for the translator
   * @param commentTranslations - Comment translations keyed by hash
   */
  setCommentTranslations(commentTranslations: Record<string, CommentTranslations>): void {
    this.transformer.setCommentTranslations(commentTranslations);
  }

  /**
   * Set target language for comment translation
   * @param language - Target language code
   */
  setTargetLanguage(language: LanguageCode): void {
    this.targetLanguage = language;
  }

  /**
   * Translates English TypeScript code to use custom tokens
   * @param sourceCode - The TypeScript source code to translate
   * @returns Translation result with code and metadata
   */
  toCustom(sourceCode: string): TranslationResult {
    return this.transformer.translateToCustom(sourceCode, this.targetLanguage);
  }

  /**
   * Translates custom token code back to English TypeScript
   * @param sourceCode - The custom token source code to translate
   * @returns Translation result with code and metadata
   */
  toEnglish(sourceCode: string): TranslationResult {
    return this.transformer.translateToEnglish(sourceCode);
  }

  /**
   * Gets the token mapper instance for advanced usage
   */
  getMapper(): TokenMapper {
    return this.mapper;
  }
}
