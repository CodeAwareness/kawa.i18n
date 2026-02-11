import crypto from 'crypto';
import { Dictionary, LanguageCode, CommentTranslations } from '../core/types';

/**
 * Multi-language dictionary abstraction
 *
 * Provides a unified API for translation between any language pair.
 * Internally uses English as a hub (matching backend storage), but callers
 * don't need to know this - they just call getTranslation(term, source, target).
 *
 * Example:
 *   const dict = new MultiLangDictionary(rawDictionary);
 *   dict.getTranslation('database', 'en', 'ja');  // → 'データベース'
 *   dict.getTranslation('データベース', 'ja', 'en');  // → 'database'
 */
export class MultiLangDictionary {
  private terms: Map<string, string>;  // EN → Target
  private reverseTerms: Map<string, string>;  // Target → EN
  private language: LanguageCode;  // The non-English language
  private origin: string;

  // Comment translations: hash → { en: "...", ja: "...", ... }
  private comments: Map<string, CommentTranslations>;
  // Reverse lookup: hash(translatedText) → englishText
  private reverseComments: Map<string, string>;

  constructor(dictionary: Dictionary) {
    this.origin = dictionary.origin;
    this.language = dictionary.language;

    // Build term maps
    this.terms = new Map(Object.entries(dictionary.terms));
    this.reverseTerms = new Map(
      Object.entries(dictionary.terms).map(([en, target]) => [target, en])
    );

    // Build comment maps, normalizing flat format if needed
    // Flat format: { originalComment: translatedComment }
    // Expected format: { md5Hash: { en: originalComment, [lang]: translatedComment } }
    const rawComments = dictionary.comments || {};
    const normalizedComments: Record<string, CommentTranslations> = {};

    for (const [key, value] of Object.entries(rawComments)) {
      if (typeof value === 'string') {
        // Flat format from old cache - convert to hash-keyed multi-lang
        const hash = this.hashComment(key);
        normalizedComments[hash] = {
          en: key,
          [dictionary.language]: value,
        };
      } else {
        // Already in correct format
        normalizedComments[key] = value;
      }
    }

    this.comments = new Map(Object.entries(normalizedComments));
    this.reverseComments = new Map();

    // Build reverse comment lookup for ALL translations
    for (const [_hash, translations] of this.comments.entries()) {
      for (const [lang, text] of Object.entries(translations)) {
        if (text) {
          const textHash = this.hashComment(text);
          // Map to English text (the hub)
          this.reverseComments.set(textHash, translations.en || '');
        }
      }
    }
  }

  /**
   * Get translation for a term in any direction
   * Uses English as internal hub for non-EN↔non-EN translations
   */
  getTranslation(term: string, sourceLang: LanguageCode, targetLang: LanguageCode): string | undefined {
    if (sourceLang === targetLang) {
      return term;  // No translation needed
    }

    if (sourceLang === 'en') {
      // EN → Target: direct lookup
      return this.terms.get(term);
    } else if (targetLang === 'en') {
      // Target → EN: reverse lookup
      return this.reverseTerms.get(term);
    } else {
      // Non-EN → Non-EN: hub through English
      // First get English, then get target
      const english = this.reverseTerms.get(term);
      return english ? this.terms.get(english) : undefined;
    }
  }

  /**
   * Get comment translation
   * Looks up by hash of the comment text (works for any language)
   */
  getCommentTranslation(commentText: string, targetLang: LanguageCode): string | undefined {
    const hash = this.hashComment(commentText);

    // Try direct lookup (if comment was originally in English)
    const translations = this.comments.get(hash);
    if (translations && translations[targetLang]) {
      return translations[targetLang];
    }

    // Try reverse lookup (if comment is in a translated language)
    const englishText = this.reverseComments.get(hash);
    if (englishText) {
      if (targetLang === 'en') {
        return englishText;
      }
      // For non-English target, look up the translation of the English text
      const englishHash = this.hashComment(englishText);
      const englishTranslations = this.comments.get(englishHash);
      return englishTranslations?.[targetLang];
    }

    return undefined;
  }

  /**
   * Check if a term exists in the dictionary (in any language)
   */
  hasTerm(term: string): boolean {
    return this.terms.has(term) || this.reverseTerms.has(term);
  }

  /**
   * Check if a term exists in the specified source language
   */
  hasTermInLanguage(term: string, lang: LanguageCode): boolean {
    if (lang === 'en') {
      return this.terms.has(term);
    } else {
      return this.reverseTerms.has(term);
    }
  }

  /**
   * Get all terms in the specified language
   */
  getAllTerms(lang: LanguageCode): string[] {
    if (lang === 'en') {
      return Array.from(this.terms.keys());
    } else {
      return Array.from(this.reverseTerms.keys());
    }
  }

  /**
   * Get the non-English language this dictionary supports
   */
  getLanguage(): LanguageCode {
    return this.language;
  }

  /**
   * Get the origin (repo) this dictionary is for
   */
  getOrigin(): string {
    return this.origin;
  }

  /**
   * Get term count
   */
  getTermCount(): number {
    return this.terms.size;
  }

  /**
   * Add terms to the dictionary in-place
   * Updates internal Maps without requiring a full reload
   * @param termsToAdd - Map of English terms to foreign translations
   */
  addTerms(termsToAdd: Record<string, string>): void {
    for (const [english, foreign] of Object.entries(termsToAdd)) {
      this.terms.set(english, foreign);
      this.reverseTerms.set(foreign, english);
    }
  }

  /**
   * Get raw comment translations for setting on translator
   */
  getRawComments(): Record<string, CommentTranslations> {
    return Object.fromEntries(this.comments.entries());
  }

  /**
   * Hash a comment for lookup
   */
  private hashComment(text: string): string {
    return crypto.createHash('md5').update(text.trim()).digest('hex');
  }
}
