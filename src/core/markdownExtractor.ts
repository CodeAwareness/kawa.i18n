/**
 * Markdown Content Extractor
 *
 * Extracts translatable text blocks from markdown files.
 * Used during project scan when markdownFiles option is enabled.
 *
 * Extracts:
 * - Headings (# Heading)
 * - Paragraphs
 * - List items (- item, * item, 1. item)
 * - Blockquotes (> quote)
 * - Table cells
 *
 * Skips:
 * - Code blocks (``` and indented code)
 * - Inline code (`code`)
 * - URLs and image paths
 * - HTML tags
 */

/**
 * Extracted markdown block information
 */
export interface MarkdownBlock {
  text: string;      // The translatable text content
  type: 'heading' | 'paragraph' | 'listItem' | 'blockquote' | 'tableCell';
  line: number;      // Line number in source (1-indexed)
}

/**
 * Extract translatable text blocks from markdown content
 */
export class MarkdownExtractor {
  /**
   * Extract all translatable text from markdown content
   * Returns unique text blocks (deduplicated)
   */
  extract(content: string, filePath?: string): string[] {
    const blocks = this.extractWithPositions(content, filePath);

    // Deduplicate by text content
    const uniqueTexts = new Set<string>();

    for (const block of blocks) {
      const trimmed = block.text.trim();
      // Only add non-empty blocks with actual content
      if (trimmed.length > 0 && this.isTranslatableText(trimmed)) {
        uniqueTexts.add(trimmed);
      }
    }

    return Array.from(uniqueTexts);
  }

  /**
   * Extract text blocks with position information
   */
  extractWithPositions(content: string, _filePath?: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = content.split('\n');

    let inCodeBlock = false;
    let inFrontMatter = false;
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;
      const trimmedLine = line.trim();

      // Handle YAML front matter (--- at start of file)
      if (lineNumber === 1 && trimmedLine === '---') {
        inFrontMatter = true;
        continue;
      }
      if (inFrontMatter) {
        if (trimmedLine === '---') {
          inFrontMatter = false;
        }
        continue;
      }

      // Handle code blocks (``` or ~~~)
      if (trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) {
        continue;
      }

      // Skip indented code blocks (4+ spaces)
      if (line.startsWith('    ') && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('*')) {
        continue;
      }

      // Skip empty lines
      if (trimmedLine.length === 0) {
        continue;
      }

      // Skip horizontal rules
      if (/^[-*_]{3,}$/.test(trimmedLine)) {
        continue;
      }

      // Skip HTML comments
      if (trimmedLine.startsWith('<!--')) {
        continue;
      }

      // Extract headings (# Heading)
      const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const headingText = this.cleanInlineElements(headingMatch[2]);
        if (headingText) {
          blocks.push({
            text: headingText,
            type: 'heading',
            line: lineNumber,
          });
        }
        continue;
      }

      // Extract blockquotes (> quote)
      if (trimmedLine.startsWith('>')) {
        const quoteText = this.cleanInlineElements(trimmedLine.replace(/^>+\s*/, ''));
        if (quoteText) {
          blocks.push({
            text: quoteText,
            type: 'blockquote',
            line: lineNumber,
          });
        }
        continue;
      }

      // Extract list items (-, *, +, or numbered)
      const listMatch = trimmedLine.match(/^[-*+]|\d+\.\s+(.*)$/);
      if (trimmedLine.match(/^[-*+]\s+/) || trimmedLine.match(/^\d+\.\s+/)) {
        const itemText = this.cleanInlineElements(
          trimmedLine.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')
        );
        if (itemText) {
          blocks.push({
            text: itemText,
            type: 'listItem',
            line: lineNumber,
          });
        }
        continue;
      }

      // Extract table cells (| cell | cell |)
      if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
        // Skip separator rows (|---|---|)
        if (/^\|[\s\-:]+\|$/.test(trimmedLine)) {
          continue;
        }
        const cells = trimmedLine
          .split('|')
          .slice(1, -1) // Remove first and last empty elements
          .map(cell => this.cleanInlineElements(cell.trim()))
          .filter(cell => cell.length > 0);

        for (const cell of cells) {
          blocks.push({
            text: cell,
            type: 'tableCell',
            line: lineNumber,
          });
        }
        continue;
      }

      // Regular paragraph text
      const paragraphText = this.cleanInlineElements(trimmedLine);
      if (paragraphText) {
        blocks.push({
          text: paragraphText,
          type: 'paragraph',
          line: lineNumber,
        });
      }
    }

    return blocks;
  }

  /**
   * Clean inline markdown elements from text
   * Removes: inline code, links, images, emphasis markers
   * Keeps: the actual text content
   */
  private cleanInlineElements(text: string): string {
    let result = text;

    // Remove inline code (`code`)
    result = result.replace(/`[^`]+`/g, '');

    // Extract link text from [text](url) - keep text, remove url
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Extract link text from [text][ref] - keep text, remove ref
    result = result.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');

    // Remove images ![alt](url)
    result = result.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

    // Remove HTML tags
    result = result.replace(/<[^>]+>/g, '');

    // Remove emphasis markers but keep content
    // Bold: **text** or __text__
    result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
    result = result.replace(/__([^_]+)__/g, '$1');

    // Italic: *text* or _text_
    result = result.replace(/\*([^*]+)\*/g, '$1');
    result = result.replace(/_([^_]+)_/g, '$1');

    // Strikethrough: ~~text~~
    result = result.replace(/~~([^~]+)~~/g, '$1');

    // Clean up extra whitespace
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Check if text is worth translating
   * Filters out URLs, file paths, code-like content
   */
  private isTranslatableText(text: string): boolean {
    // Skip if too short (likely not meaningful)
    if (text.length < 3) {
      return false;
    }

    // Skip URLs
    if (/^https?:\/\//.test(text)) {
      return false;
    }

    // Skip file paths
    if (/^[.\/~].*\.[a-z]+$/i.test(text)) {
      return false;
    }

    // Skip if mostly code-like (camelCase, snake_case, or contains special chars)
    const codeChars = text.match(/[{}()\[\]<>|&;$@#]/g);
    if (codeChars && codeChars.length > text.length * 0.1) {
      return false;
    }

    // Skip if no letters (just numbers/symbols)
    if (!/[a-zA-Z\u00C0-\u024F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) {
      return false;
    }

    return true;
  }
}
