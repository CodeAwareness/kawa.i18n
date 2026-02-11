import * as ts from 'typescript';

/**
 * Extracted comment information
 */
export interface ExtractedComment {
  text: string;        // The actual comment text (without // or /* */)
  fullText: string;    // The full comment including delimiters
  pos: number;         // Start position in source
  end: number;         // End position in source
  kind: 'SingleLine' | 'MultiLine';
}

/**
 * Extract all comments from source code
 * Supports TypeScript, JavaScript, Vue, and Rust files
 */
export class CommentExtractor {
  /**
   * Extract all comments from source code
   * Returns unique comment texts (deduplicated)
   */
  extract(sourceCode: string, filePath?: string): string[] {
    const ext = filePath ? filePath.split('.').pop()?.toLowerCase() : 'ts';

    // Handle Vue files - extract comments from template and script
    if (ext === 'vue') {
      return this.extractFromVue(sourceCode, filePath);
    }

    // Handle Rust files
    if (ext === 'rs') {
      return this.extractFromRust(sourceCode);
    }

    // TypeScript/JavaScript files
    const comments = this.extractWithPositions(sourceCode, filePath);

    // Deduplicate by comment text
    const uniqueComments = new Set<string>();

    for (const comment of comments) {
      // Only add non-empty comments
      const trimmed = comment.text.trim();
      if (trimmed.length > 0) {
        uniqueComments.add(trimmed);
      }
    }

    return Array.from(uniqueComments);
  }

  /**
   * Extract comments from Vue single-file component
   */
  private extractFromVue(sourceCode: string, filePath?: string): string[] {
    const comments = new Set<string>();

    // Extract comments from <script> section
    const scriptMatch = sourceCode.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      const scriptComments = this.extractFromTypeScript(scriptMatch[1], filePath);
      scriptComments.forEach(c => comments.add(c));
    }

    // Extract HTML comments from template: <!-- comment -->
    const htmlCommentRegex = /<!--([\s\S]*?)-->/g;
    let match;
    while ((match = htmlCommentRegex.exec(sourceCode)) !== null) {
      const text = match[1].trim();
      if (text.length > 0) {
        comments.add(text);
      }
    }

    return Array.from(comments);
  }

  /**
   * Extract comments from Rust source code
   */
  private extractFromRust(sourceCode: string): string[] {
    const comments = new Set<string>();

    // Single-line comments: // comment
    const singleLineRegex = /\/\/(?!\/)(.*)$/gm;
    let match;
    while ((match = singleLineRegex.exec(sourceCode)) !== null) {
      const text = match[1].trim();
      // Skip empty comments and common markers
      if (text.length > 0 && !text.startsWith('!') && text !== '=') {
        comments.add(text);
      }
    }

    // Doc comments: /// comment or //! comment
    const docCommentRegex = /\/\/[\/!]\s*(.*)$/gm;
    while ((match = docCommentRegex.exec(sourceCode)) !== null) {
      const text = match[1].trim();
      if (text.length > 0) {
        comments.add(text);
      }
    }

    // Multi-line comments: /* comment */
    const multiLineRegex = /\/\*(?!\*)([\s\S]*?)\*\//g;
    while ((match = multiLineRegex.exec(sourceCode)) !== null) {
      const text = match[1]
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
      if (text.length > 0) {
        comments.add(text);
      }
    }

    // Doc block comments: /** comment */ or /*! comment */
    const docBlockRegex = /\/\*[\*!]([\s\S]*?)\*\//g;
    while ((match = docBlockRegex.exec(sourceCode)) !== null) {
      const text = match[1]
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
      if (text.length > 0) {
        comments.add(text);
      }
    }

    return Array.from(comments);
  }

  /**
   * Extract comments from TypeScript/JavaScript (internal helper)
   */
  private extractFromTypeScript(sourceCode: string, filePath?: string): string[] {
    const comments = this.extractWithPositions(sourceCode, filePath);
    const uniqueComments = new Set<string>();

    for (const comment of comments) {
      const trimmed = comment.text.trim();
      if (trimmed.length > 0) {
        uniqueComments.add(trimmed);
      }
    }

    return Array.from(uniqueComments);
  }

  /**
   * Extract all comments with their positions in the source code
   * Useful for replacing comments during translation
   */
  extractWithPositions(sourceCode: string, filePath?: string): ExtractedComment[] {
    const sourceFile = ts.createSourceFile(
      filePath || 'source.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true // setParentNodes
    );

    const comments: ExtractedComment[] = [];

    // Get all comment ranges from the source file
    const commentRanges = this.getCommentRanges(sourceCode, sourceFile);

    for (const range of commentRanges) {
      const fullText = sourceCode.substring(range.pos, range.end);
      const text = this.extractCommentText(fullText, range.kind);

      comments.push({
        text,
        fullText,
        pos: range.pos,
        end: range.end,
        kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'SingleLine' : 'MultiLine',
      });
    }

    return comments;
  }

  /**
   * Get all comment ranges in the source file
   * Uses AST traversal to find all comments reliably
   */
  private getCommentRanges(
    sourceCode: string,
    sourceFile: ts.SourceFile
  ): Array<{ pos: number; end: number; kind: ts.SyntaxKind }> {
    const ranges: Array<{ pos: number; end: number; kind: ts.SyntaxKind }> = [];
    const seen = new Set<string>(); // Track unique positions to avoid duplicates

    // Helper to add comment if not already seen
    const addComments = (commentRanges: ts.CommentRange[] | undefined) => {
      if (!commentRanges) return;
      for (const comment of commentRanges) {
        const key = `${comment.pos}-${comment.end}`;
        if (!seen.has(key)) {
          seen.add(key);
          ranges.push(comment);
        }
      }
    };

    // Traverse the entire AST to find all comments
    const visit = (node: ts.Node) => {
      const fullText = sourceCode;
      const nodeStart = node.getFullStart();
      const nodeEnd = node.getEnd();

      // Get leading comments (comments before this node)
      const leadingComments = ts.getLeadingCommentRanges(fullText, nodeStart);
      addComments(leadingComments);

      // Get trailing comments (comments after this node, on same line)
      const trailingComments = ts.getTrailingCommentRanges(fullText, nodeEnd);
      addComments(trailingComments);

      // Recursively visit children
      ts.forEachChild(node, visit);
    };

    // Start traversal from root
    visit(sourceFile);

    // Also scan the entire text to catch any comments that might be missed
    // (e.g., comments at the end of the file with no following tokens)
    let pos = 0;
    while (pos < sourceCode.length) {
      const leadingComments = ts.getLeadingCommentRanges(sourceCode, pos);
      if (leadingComments && leadingComments.length > 0) {
        addComments(leadingComments);
        pos = leadingComments[leadingComments.length - 1].end;
      } else {
        pos++;
      }
    }

    return ranges;
  }

  /**
   * Extract comment text without delimiters
   */
  private extractCommentText(fullText: string, kind: ts.SyntaxKind): string {
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia) {
      // Remove '//' prefix
      return fullText.replace(/^\/\/\s?/, '');
    } else {
      // Remove '/*' prefix and '*/' suffix, and clean up interior '*' markers
      return fullText
        .replace(/^\/\*\s?/, '')
        .replace(/\s?\*\/$/, '')
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trimEnd())
        .join('\n')
        .trim();
    }
  }
}
