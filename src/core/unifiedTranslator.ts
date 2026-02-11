import * as ts from 'typescript';
import crypto from 'crypto';
import { TranslationResult, LanguageCode, TranslationScope } from './types';
import { MultiLangDictionary } from '../dictionary/multiLang';
import { CommentExtractor } from './commentExtractor';

/**
 * Unified Translator for bidirectional TypeScript code translation
 *
 * Unlike the original Translator (which has separate toEnglish/toCustom methods),
 * this class provides a single translate(code, sourceLang, targetLang) method
 * that works uniformly for any language pair.
 *
 * Uses MultiLangDictionary which handles the English hub model internally.
 */
export class UnifiedTranslator {
  private dictionary: MultiLangDictionary;
  private commentExtractor: CommentExtractor;

  constructor(dictionary: MultiLangDictionary) {
    this.dictionary = dictionary;
    this.commentExtractor = new CommentExtractor();
  }

  /** Default scope: translate identifiers and comments (original behavior) */
  private static readonly DEFAULT_SCOPE: TranslationScope = {
    comments: true,
    stringLiterals: false,
    identifiers: true,
    keywords: false,
    punctuation: false,
    markdownFiles: false, // Only applies to project scan, not per-file translation
  };

  /**
   * Translate code from source language to target language
   * Works uniformly for any language pair (EN→JA, JA→EN, JA→ES, etc.)
   *
   * @param scope - Optional translation scope controlling what gets translated.
   *                Defaults to identifiers + comments (original behavior).
   */
  translate(
    sourceCode: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    scope?: TranslationScope
  ): TranslationResult {
    if (sourceLang === targetLang) {
      return {
        code: sourceCode,
        translatedTokens: [],
        unmappedTokens: [],
      };
    }

    const effectiveScope = scope || UnifiedTranslator.DEFAULT_SCOPE;
    const translatedTokens = new Set<string>();
    const unmappedTokens = new Set<string>();

    // Parse source code
    const sourceFile = ts.createSourceFile(
      'source.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    // Collect replacements
    interface Replacement {
      start: number;
      end: number;
      newText: string;
      oldText: string;
    }
    const replacements: Replacement[] = [];

    // Collect identifier replacements
    if (effectiveScope.identifiers) {
      const collectIdentifierReplacements = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
          const originalText = node.text;
          const translated = this.dictionary.getTranslation(originalText, sourceLang, targetLang);

          if (translated && translated !== originalText) {
            translatedTokens.add(originalText);
            replacements.push({
              start: node.getStart(sourceFile),
              end: node.getEnd(),
              newText: translated,
              oldText: originalText,
            });
          } else if (!this.isBuiltInIdentifier(originalText)) {
            unmappedTokens.add(originalText);
          }
        }

        ts.forEachChild(node, collectIdentifierReplacements);
      };

      collectIdentifierReplacements(sourceFile);
    }

    // Collect string literal replacements
    if (effectiveScope.stringLiterals) {
      const collectStringLiteralReplacements = (node: ts.Node) => {
        if (ts.isStringLiteral(node)) {
          const originalText = node.text;
          if (this.shouldTranslateString(originalText)) {
            const translated = this.dictionary.getCommentTranslation(originalText, targetLang);
            if (translated && translated !== originalText) {
              translatedTokens.add(originalText);
              // Preserve the original quote style
              const fullText = node.getText(sourceFile);
              const quote = fullText.charAt(0);
              replacements.push({
                start: node.getStart(sourceFile),
                end: node.getEnd(),
                newText: `${quote}${translated}${quote}`,
                oldText: fullText,
              });
            }
          }
        }

        ts.forEachChild(node, collectStringLiteralReplacements);
      };

      collectStringLiteralReplacements(sourceFile);
    }

    // Collect comment replacements
    if (effectiveScope.comments) {
      const comments = this.commentExtractor.extractWithPositions(sourceCode);

      for (const comment of comments) {
        const translated = this.dictionary.getCommentTranslation(comment.text, targetLang);

        if (translated && translated !== comment.text) {
          const newComment = this.formatComment(translated, comment.kind, comment.fullText);
          replacements.push({
            start: comment.pos,
            end: comment.end,
            newText: newComment,
            oldText: comment.fullText,
          });
        }
      }
    }

    // Sort replacements by position (reverse order to preserve positions)
    replacements.sort((a, b) => b.start - a.start);

    // Apply replacements from end to beginning
    let code = sourceCode;
    for (const replacement of replacements) {
      code =
        code.substring(0, replacement.start) +
        replacement.newText +
        code.substring(replacement.end);
    }

    // Keyword translation (text-based post-processing after AST replacements)
    if (effectiveScope.keywords) {
      code = this.translateKeywords(code, targetLang);
    }

    // Punctuation translation (character-level, global — last step for full immersion)
    if (effectiveScope.punctuation) {
      code = this.translatePunctuation(code, targetLang);
    }

    return {
      code,
      translatedTokens: Array.from(translatedTokens),
      unmappedTokens: Array.from(unmappedTokens),
    };
  }

  /**
   * Format a translated comment preserving the original format
   */
  private formatComment(
    text: string,
    kind: 'SingleLine' | 'MultiLine',
    originalFullText: string
  ): string {
    if (kind === 'SingleLine') {
      return `// ${text}`;
    }

    // Multi-line comment
    const isJSDoc = originalFullText.trimStart().startsWith('/**');
    const lines = text.split('\n');

    if (isJSDoc) {
      if (lines.length === 1) {
        return `/**\n * ${text}\n */`;
      } else {
        return `/**\n${lines.map(line => ` * ${line}`).join('\n')}\n */`;
      }
    } else {
      if (lines.length === 1) {
        return `/* ${text} */`;
      } else {
        return `/*\n${lines.map(line => ` * ${line}`).join('\n')}\n */`;
      }
    }
  }

  /**
   * Heuristic: should we attempt to translate this string literal?
   * Skips URLs, file paths, CSS classes, config keys, etc.
   */
  private shouldTranslateString(text: string): boolean {
    if (text.length < 3) return false;
    // URLs
    if (/^https?:\/\//.test(text)) return false;
    // File paths
    if (/^[.\/\\]/.test(text) || /\.[a-z]{2,4}$/.test(text)) return false;
    // CSS selectors / class names
    if (/^[.#][\w-]+/.test(text)) return false;
    // Looks like a config key (dot-separated, no spaces)
    if (/^[\w-]+(\.[\w-]+)+$/.test(text)) return false;
    // Template literal placeholders
    if (/^\$\{/.test(text)) return false;
    // Pure numbers / hex / color codes
    if (/^[#]?[0-9a-fA-F]+$/.test(text)) return false;
    // MIME types
    if (/^(application|text|image|audio|video)\//.test(text)) return false;
    // Contains at least one alphabetic word to be worth translating
    return /[a-zA-Z]{2,}/.test(text);
  }

  /**
   * Keyword dictionaries for translating reserved words
   * Only languages with non-Latin scripts benefit from keyword translation
   */
  private static readonly KEYWORD_DICTIONARIES: Partial<Record<LanguageCode, Record<string, string>>> = {
    ja: {
      'const': '定数',
      'let': '変数',
      'var': '変数宣言',
      'function': '関数',
      'return': '返す',
      'if': 'もし',
      'else': 'それ以外',
      'for': '繰り返し',
      'while': 'の間',
      'do': '実行',
      'switch': '分岐',
      'case': '場合',
      'break': '中断',
      'continue': '続行',
      'class': 'クラス',
      'extends': '継承',
      'implements': '実装',
      'interface': 'インターフェース',
      'type': '型',
      'enum': '列挙',
      'import': '取込',
      'export': '公開',
      'default': '既定',
      'from': 'から',
      'as': 'として',
      'new': '新規',
      'this': 'これ',
      'super': '親',
      'true': '真',
      'false': '偽',
      'null': 'ヌル',
      'undefined': '未定義',
      'async': '非同期',
      'await': '待機',
      'try': '試行',
      'catch': '捕捉',
      'finally': '最終',
      'throw': '投げる',
      'typeof': '型判定',
      'instanceof': 'インスタンス判定',
      'in': '含む',
      'of': 'の',
      'void': '無',
      'delete': '削除',
      'yield': '譲渡',
    },
  };

  /**
   * Translate reserved keywords using text-based replacement
   * Applied as post-processing after AST-based replacements.
   * Splits code into protected (comments/strings) and unprotected segments
   * so keywords inside comments and string literals are left untouched.
   */
  private translateKeywords(code: string, targetLang: LanguageCode): string {
    const dict = UnifiedTranslator.KEYWORD_DICTIONARIES[targetLang];
    if (!dict) return code;

    // Split code into segments, protecting comments and string literals
    const segments = this.splitCodeSegments(code);

    return segments.map(segment => {
      if (segment.isProtected) {
        return segment.text;
      }
      let text = segment.text;
      for (const [keyword, translation] of Object.entries(dict)) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'g');
        text = text.replace(regex, translation);
      }
      return text;
    }).join('');
  }

  /**
   * Split code into protected (comments, string literals) and unprotected (code) segments.
   * Protected segments are returned verbatim during keyword translation.
   */
  private splitCodeSegments(code: string): Array<{ text: string; isProtected: boolean }> {
    const segments: Array<{ text: string; isProtected: boolean }> = [];
    // Match single-line comments, multi-line comments, and string literals
    const protectedRegex = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g;
    let lastEnd = 0;
    let match;

    while ((match = protectedRegex.exec(code)) !== null) {
      if (match.index > lastEnd) {
        segments.push({ text: code.slice(lastEnd, match.index), isProtected: false });
      }
      segments.push({ text: match[0], isProtected: true });
      lastEnd = match.index + match[0].length;
    }

    if (lastEnd < code.length) {
      segments.push({ text: code.slice(lastEnd), isProtected: false });
    }

    return segments;
  }

  /**
   * Punctuation dictionaries mapping ASCII characters to full-width CJK equivalents.
   * Characters in the Unicode FF00–FF5E range (Fullwidth Forms).
   */
  private static readonly PUNCTUATION_DICTIONARIES: Partial<Record<LanguageCode, Record<string, string>>> = {
    ja: {
      '.': '．', ',': '，', ':': '：', ';': '；', "'": '＇', '"': '＂', '`': '｀',
      '(': '（', ')': '）', '{': '｛', '}': '｝', '[': '［', ']': '］', '<': '＜', '>': '＞',
      '=': '＝', '+': '＋', '-': '－', '*': '＊', '/': '／', '\\': '＼', '|': '｜',
      '&': '＆', '^': '＾', '~': '～', '!': '！', '?': '？', '@': '＠', '#': '＃',
      '$': '＄', '%': '％', '_': '＿',
    },
  };

  /**
   * Replace ASCII punctuation with full-width equivalents for visual immersion.
   * Applied globally (all characters, everywhere) as the last translation step.
   */
  private translatePunctuation(code: string, targetLang: LanguageCode): string {
    const dict = UnifiedTranslator.PUNCTUATION_DICTIONARIES[targetLang];
    if (!dict) return code;

    let result = '';
    for (const ch of code) {
      result += dict[ch] ?? ch;
    }
    return result;
  }

  /**
   * Check if an identifier is a built-in TypeScript/JavaScript identifier
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
      // Node.js
      'require', 'module', 'exports', 'process', 'Buffer',
      // Common imports
      'default', 'React', 'Component', 'useState', 'useEffect',
    ]);

    return builtIns.has(text);
  }
}
