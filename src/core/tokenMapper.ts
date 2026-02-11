import { TokenMapping } from './types';

/**
 * Manages bidirectional token mappings
 */
export class TokenMapper {
  private forwardMap: Map<string, string>;
  private reverseMap: Map<string, string>;

  constructor(mapping: TokenMapping) {
    this.forwardMap = new Map(Object.entries(mapping));
    this.reverseMap = new Map(
      Object.entries(mapping).map(([key, value]) => [value, key])
    );
  }

  /**
   * Translates an English token to a custom token
   */
  toCustom(token: string): string | undefined {
    return this.forwardMap.get(token);
  }

  /**
   * Translates a custom token back to English
   */
  toEnglish(token: string): string | undefined {
    return this.reverseMap.get(token);
  }

  /**
   * Checks if a token exists in the forward mapping
   */
  hasCustom(token: string): boolean {
    return this.forwardMap.has(token);
  }

  /**
   * Checks if a token exists in the reverse mapping
   */
  hasEnglish(token: string): boolean {
    return this.reverseMap.has(token);
  }

  /**
   * Gets all English tokens
   */
  getAllEnglishTokens(): string[] {
    return Array.from(this.forwardMap.keys());
  }

  /**
   * Gets all custom tokens
   */
  getAllCustomTokens(): string[] {
    return Array.from(this.reverseMap.keys());
  }
}
