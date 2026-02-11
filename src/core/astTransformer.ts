import * as ts from 'typescript';
import crypto from 'crypto';
import { TokenMapper } from './tokenMapper';
import { TranslatorOptions, TranslationResult, CommentTranslations } from './types';
import { CommentExtractor } from './commentExtractor';

/**
 * AST Transformer that replaces tokens in TypeScript source code
 */
export class ASTTransformer {
  private mapper: TokenMapper;
  private options: TranslatorOptions;
  private translatedTokens: Set<string>;
  private unmappedTokens: Set<string>;
  private commentExtractor: CommentExtractor;
  private commentTranslations?: Record<string, CommentTranslations>;

  constructor(mapper: TokenMapper, options: TranslatorOptions = {}) {
    this.mapper = mapper;
    this.options = {
      preserveComments: true,
      strictMode: false,
      ...options,
    };
    this.translatedTokens = new Set();
    this.unmappedTokens = new Set();
    this.commentExtractor = new CommentExtractor();
  }

  /**
   * Set comment translations for use during translation
   * @param translations - Comment translations keyed by hash
   */
  setCommentTranslations(translations: Record<string, CommentTranslations>): void {
    this.commentTranslations = translations;
  }

  /**
   * Translates English TypeScript to custom token version
   * Only translates identifiers (user-defined names), keywords remain unchanged
   * Uses TWO-PASS strategy to avoid position conflicts:
   *   Pass 1: Translate identifiers
   *   Pass 2: Translate comments (in the already-translated code)
   */
  translateToCustom(sourceCode: string, targetLanguage?: string): TranslationResult {
    this.translatedTokens.clear();
    this.unmappedTokens.clear();

    // Pass 1: Translate identifiers only
    let code = this.translateIdentifiersOnly(sourceCode);

    // Pass 2: Translate comments only (if we have translations)
    if (this.commentTranslations && targetLanguage) {
      code = this.translateCommentsOnly(code, targetLanguage);
    }

    return {
      code,
      translatedTokens: Array.from(this.translatedTokens),
      unmappedTokens: Array.from(this.unmappedTokens),
    };
  }

  /**
   * Pass 1: Translate only identifiers (no comments)
   * This prevents comment replacements from interfering with identifier positions
   */
  private translateIdentifiersOnly(sourceCode: string): string {
    const sourceFile = ts.createSourceFile(
      'source.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    interface Replacement {
      start: number;
      end: number;
      newText: string;
      oldText: string;
    }
    const replacements: Replacement[] = [];

    const collectReplacements = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const originalText = node.text;
        const customToken = this.mapper.toCustom(originalText);

        if (customToken) {
          this.translatedTokens.add(originalText);
          replacements.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            newText: customToken,
            oldText: originalText,
          });
        } else {
          // Only track as unmapped if it's not a built-in
          if (!this.isBuiltInIdentifier(originalText)) {
            this.unmappedTokens.add(originalText);
          }

          if (this.options.strictMode && this.mapper.hasCustom(originalText)) {
            throw new Error(`No mapping found for token: ${originalText}`);
          }
        }
      }

      ts.forEachChild(node, collectReplacements);
    };

    collectReplacements(sourceFile);

    // Sort replacements by position (reverse order)
    replacements.sort((a, b) => b.start - a.start);

    // Apply replacements from end to beginning to preserve positions
    let code = sourceCode;
    for (const replacement of replacements) {
      code =
        code.substring(0, replacement.start) +
        replacement.newText +
        code.substring(replacement.end);
    }

    return code;
  }

  /**
   * Pass 2: Translate only comments (assumes identifiers are already translated)
   * This operates on the identifier-translated code, avoiding position conflicts
   */
  private translateCommentsOnly(sourceCode: string, targetLanguage: string): string {
    const comments = this.commentExtractor.extractWithPositions(sourceCode);

    interface Replacement {
      start: number;
      end: number;
      newText: string;
      oldText: string;
    }
    const replacements: Replacement[] = [];

    for (const comment of comments) {
      const hash = this.hashComment(comment.text);
      const translations = this.commentTranslations?.[hash];

      if (translations && translations[targetLanguage]) {
        const translatedText = translations[targetLanguage];

        // Reconstruct the comment preserving the ORIGINAL format
        let newComment: string;
        if (comment.kind === 'SingleLine') {
          newComment = `// ${translatedText}`;
        } else {
          // Multi-line comment - ALWAYS preserve multi-line format
          const isJSDoc = comment.fullText.trimStart().startsWith('/**');
          const lines = translatedText.split('\n');

          if (isJSDoc) {
            // JSDoc format: /**\n * ...\n */
            if (lines.length === 1) {
              newComment = `/**\n * ${translatedText}\n */`;
            } else {
              newComment = `/**\n${lines.map(line => ` * ${line}`).join('\n')}\n */`;
            }
          } else {
            // Block comment format: /*\n * ...\n */
            if (lines.length === 1) {
              newComment = `/*\n * ${translatedText}\n */`;
            } else {
              newComment = `/*\n${lines.map(line => ` * ${line}`).join('\n')}\n */`;
            }
          }
        }

        replacements.push({
          start: comment.pos,
          end: comment.end,
          newText: newComment,
          oldText: comment.fullText,
        });
      }
    }

    // Sort replacements by position (reverse order)
    replacements.sort((a, b) => b.start - a.start);

    // Apply replacements from end to beginning
    let code = sourceCode;
    for (const replacement of replacements) {
      code =
        code.substring(0, replacement.start) +
        replacement.newText +
        code.substring(replacement.end);
    }

    return code;
  }

  /**
   * Translates custom token version back to English TypeScript
   * Only translates identifiers, keywords remain unchanged
   * Uses text-based replacement to avoid TypeScript printer issues with unicode identifiers
   */
  translateToEnglish(sourceCode: string): TranslationResult {
    this.translatedTokens.clear();
    this.unmappedTokens.clear();

    const sourceFile = ts.createSourceFile(
      'source.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    // Collect all identifier replacements with their positions
    interface Replacement {
      start: number;
      end: number;
      newText: string;
      oldText: string;
    }
    const replacements: Replacement[] = [];

    const collectReplacements = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const customText = node.text;
        const englishToken = this.mapper.toEnglish(customText);

        if (englishToken) {
          this.translatedTokens.add(customText);
          replacements.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            newText: englishToken,
            oldText: customText,
          });
        } else {
          // Only track as unmapped if it looks like a custom token
          if (!this.isBuiltInIdentifier(customText)) {
            this.unmappedTokens.add(customText);
          }

          if (this.options.strictMode && this.mapper.hasEnglish(customText)) {
            throw new Error(`No mapping found for custom token: ${customText}`);
          }
        }
      }

      ts.forEachChild(node, collectReplacements);
    };

    collectReplacements(sourceFile);

    // Add comment replacements if we have translations (translate back to English)
    if (this.commentTranslations) {
      // Build reverse lookup: hash of translated text → English text
      const reverseCommentLookup = new Map<string, string>();
      for (const [_englishHash, translations] of Object.entries(this.commentTranslations)) {
        for (const [lang, text] of Object.entries(translations)) {
          if (lang !== 'en' && text) {
            const translatedHash = this.hashComment(text);
            reverseCommentLookup.set(translatedHash, translations.en || '');
          }
        }
      }

      const comments = this.commentExtractor.extractWithPositions(sourceCode);

      for (const comment of comments) {
        const hash = this.hashComment(comment.text);
        const englishText = reverseCommentLookup.get(hash) || this.commentTranslations[hash]?.en;

        if (englishText) {

          // Reconstruct the comment with the same format
          let newComment: string;
          if (comment.kind === 'SingleLine') {
            newComment = `// ${englishText}`;
          } else {
            // Multi-line comment
            const lines = englishText.split('\n');
            if (lines.length === 1) {
              newComment = `/* ${englishText} */`;
            } else {
              newComment = `/*\n${lines.map(line => `   * ${line}`).join('\n')}\n   */`;
            }
          }

          replacements.push({
            start: comment.pos,
            end: comment.end,
            newText: newComment,
            oldText: comment.fullText,
          });
        }
      }
    }

    // Sort replacements by position (reverse order so we don't mess up positions)
    replacements.sort((a, b) => b.start - a.start);

    // Apply replacements from end to beginning
    let code = sourceCode;
    for (const replacement of replacements) {
      code =
        code.substring(0, replacement.start) +
        replacement.newText +
        code.substring(replacement.end);
    }

    return {
      code,
      translatedTokens: Array.from(this.translatedTokens),
      unmappedTokens: Array.from(this.unmappedTokens),
    };
  }

  /**
   * Checks if an identifier is a built-in TypeScript/JavaScript identifier
   * These are typically not translated and shouldn't be marked as unmapped
   */
  private isBuiltInIdentifier(text: string): boolean {
    const builtIns = new Set([
      // Common built-ins
      'Object', 'Array', 'String', 'Number', 'Boolean', 'Function',
      'Date', 'RegExp', 'Error', 'Map', 'Set', 'Promise',
      'console', 'window', 'document', 'Math', 'JSON',
      // Common methods
      'prototype', 'constructor', 'toString', 'valueOf', 'length',
      'push', 'pop', 'shift', 'unshift', 'slice', 'splice',
      'forEach', 'map', 'filter', 'reduce', 'find', 'findIndex',
      'indexOf', 'includes', 'join', 'split',
      // TypeScript types
      'any', 'unknown', 'never', 'void',
      // Common single letters (often used as parameters)
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k',
      'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    ]);

    return builtIns.has(text);
  }

  /**
   * Hash a comment to create a unique identifier (same as backend)
   */
  private hashComment(comment: string): string {
    return crypto.createHash('md5').update(comment.trim()).digest('hex');
  }
}
