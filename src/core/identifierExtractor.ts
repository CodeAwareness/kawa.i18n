import * as ts from 'typescript';

/**
 * Extracted identifier information
 */
export interface ExtractedIdentifier {
  name: string;
  type: 'class' | 'function' | 'method' | 'variable' | 'property' | 'parameter' | 'interface' | 'type' | 'enum' | 'struct' | 'trait' | 'impl' | 'mod';
  line: number;
  count: number; // Number of occurrences
}

/**
 * Extract all user-defined identifiers from source code
 * Supports TypeScript, JavaScript, Vue, and Rust files
 */
export class IdentifierExtractor {
  private builtIns = new Set([
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
    // MongoDB reserved fields (to avoid conflicts with ObjectId fields)
    '_id',
  ]);

  /**
   * Extract all identifiers from source code
   * Automatically detects file type based on extension
   */
  extract(sourceCode: string, filePath?: string): ExtractedIdentifier[] {
    const ext = filePath ? filePath.split('.').pop()?.toLowerCase() : 'ts';

    // Handle Vue files - extract script section
    if (ext === 'vue') {
      return this.extractFromVue(sourceCode, filePath);
    }

    // Handle Rust files
    if (ext === 'rs') {
      return this.extractFromRust(sourceCode, filePath);
    }

    // TypeScript/JavaScript files
    return this.extractFromTypeScript(sourceCode, filePath);
  }

  /**
   * Extract identifiers from Vue single-file component
   */
  private extractFromVue(sourceCode: string, filePath?: string): ExtractedIdentifier[] {
    // Extract <script> or <script setup> content
    const scriptMatch = sourceCode.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) {
      return [];
    }

    const scriptContent = scriptMatch[1];
    // Check if it's TypeScript
    const isTypeScript = /<script[^>]*\slang=["']ts["'][^>]*>/i.test(sourceCode) ||
                         /<script[^>]*\slang=["']typescript["'][^>]*>/i.test(sourceCode);

    // Use .vue.ts or .vue.js to avoid conflicts with same-name .ts files
    const virtualPath = filePath ? `${filePath}${isTypeScript ? '.ts' : '.js'}` : 'component.vue.ts';
    return this.extractFromTypeScript(scriptContent, virtualPath);
  }

  /**
   * Extract identifiers from Rust source code
   */
  private extractFromRust(sourceCode: string, filePath?: string): ExtractedIdentifier[] {
    const identifiers = new Map<string, ExtractedIdentifier>();
    const lines = sourceCode.split('\n');

    // Rust built-ins to skip
    const rustBuiltIns = new Set([
      // Primitive types
      'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
      'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
      'f32', 'f64', 'bool', 'char', 'str',
      // Common types
      'Self', 'self', 'Option', 'Result', 'Vec', 'String', 'Box', 'Rc', 'Arc',
      'HashMap', 'HashSet', 'BTreeMap', 'BTreeSet',
      'Ok', 'Err', 'Some', 'None', 'true', 'false',
      // Common traits
      'Clone', 'Copy', 'Debug', 'Default', 'Eq', 'PartialEq', 'Ord', 'PartialOrd',
      'Hash', 'Send', 'Sync', 'Sized', 'Drop', 'Fn', 'FnMut', 'FnOnce',
      'Iterator', 'IntoIterator', 'From', 'Into', 'TryFrom', 'TryInto',
      'AsRef', 'AsMut', 'Borrow', 'BorrowMut', 'ToOwned', 'ToString',
      'Serialize', 'Deserialize',
      // Common macros/keywords
      'pub', 'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl',
      'trait', 'type', 'mod', 'use', 'crate', 'super', 'where', 'async', 'await',
      'match', 'if', 'else', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue',
      // Single letters
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k',
      'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      '_',
    ]);

    // Patterns for Rust declarations
    const patterns: Array<{ regex: RegExp; type: ExtractedIdentifier['type'] }> = [
      // fn function_name
      { regex: /\bfn\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, type: 'function' },
      // struct StructName
      { regex: /\bstruct\s+([A-Z][a-zA-Z0-9_]*)/g, type: 'struct' },
      // enum EnumName
      { regex: /\benum\s+([A-Z][a-zA-Z0-9_]*)/g, type: 'enum' },
      // trait TraitName
      { regex: /\btrait\s+([A-Z][a-zA-Z0-9_]*)/g, type: 'trait' },
      // impl [TraitName for] TypeName
      { regex: /\bimpl(?:\s*<[^>]*>)?\s+(?:[A-Z][a-zA-Z0-9_]*\s+for\s+)?([A-Z][a-zA-Z0-9_]*)/g, type: 'impl' },
      // type TypeAlias
      { regex: /\btype\s+([A-Z][a-zA-Z0-9_]*)/g, type: 'type' },
      // mod module_name
      { regex: /\bmod\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, type: 'mod' },
      // const CONST_NAME or let variable_name
      { regex: /\b(?:const|static)\s+([A-Z_][A-Z0-9_]*)/g, type: 'variable' },
      { regex: /\blet\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/g, type: 'variable' },
    ];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
        continue;
      }

      for (const { regex, type } of patterns) {
        // Reset regex state
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(line)) !== null) {
          const name = match[1];
          if (!rustBuiltIns.has(name) && name.length > 1) {
            this.addIdentifier(identifiers, name, type, lineNum + 1);
          }
        }
      }
    }

    return Array.from(identifiers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Extract identifiers from TypeScript/JavaScript source code
   */
  private extractFromTypeScript(sourceCode: string, filePath?: string): ExtractedIdentifier[] {
    const sourceFile = ts.createSourceFile(
      filePath || 'source.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const identifiers = new Map<string, ExtractedIdentifier>();

    const visit = (node: ts.Node) => {
      // Class declaration
      if (ts.isClassDeclaration(node) && node.name) {
        this.addIdentifier(identifiers, node.name.text, 'class', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Function declaration
      else if (ts.isFunctionDeclaration(node) && node.name) {
        this.addIdentifier(identifiers, node.name.text, 'function', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Method declaration
      else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        this.addIdentifier(identifiers, node.name.text, 'method', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Variable declaration
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        this.addIdentifier(identifiers, node.name.text, 'variable', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Property declaration
      else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
        this.addIdentifier(identifiers, node.name.text, 'property', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Parameter declaration
      else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        this.addIdentifier(identifiers, node.name.text, 'parameter', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Interface declaration
      else if (ts.isInterfaceDeclaration(node) && node.name) {
        this.addIdentifier(identifiers, node.name.text, 'interface', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Type alias
      else if (ts.isTypeAliasDeclaration(node) && node.name) {
        this.addIdentifier(identifiers, node.name.text, 'type', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      // Enum declaration
      else if (ts.isEnumDeclaration(node) && node.name) {
        this.addIdentifier(identifiers, node.name.text, 'enum', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return Array.from(identifiers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Extract unique identifier names (for dictionary building)
   */
  extractNames(sourceCode: string, filePath?: string): string[] {
    const identifiers = this.extract(sourceCode, filePath);
    return identifiers.map(id => id.name);
  }

  /**
   * Add identifier to map, incrementing count if already exists
   */
  private addIdentifier(
    identifiers: Map<string, ExtractedIdentifier>,
    name: string,
    type: ExtractedIdentifier['type'],
    line: number
  ): void {
    // Skip built-ins
    if (this.builtIns.has(name)) {
      return;
    }

    if (identifiers.has(name)) {
      const existing = identifiers.get(name)!;
      existing.count++;
    } else {
      identifiers.set(name, { name, type, line, count: 1 });
    }
  }

  /**
   * Check if an identifier is a built-in
   */
  isBuiltIn(name: string): boolean {
    return this.builtIns.has(name);
  }
}
