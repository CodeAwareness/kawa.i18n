# Issue #4: Multi-Language Support Strategy

## Executive Summary

**Critical Decision Point**: How should kawa.i18n support multiple programming languages?

**Current State**: Only TypeScript/JavaScript supported
**Goal**: Support top 10+ programming languages
**Impact**: Determines entire architecture, affects all phases

**Status**: Pre-Phase 2 Decision Document (MUST be resolved before implementation)

---

## Table of Contents

1. [Language Analysis](#language-analysis)
2. [Parser Options](#parser-options)
3. [Architecture Proposals](#architecture-proposals)
4. [Decision Matrix](#decision-matrix)
5. [Recommendations](#recommendations)
6. [Implementation Roadmap](#implementation-roadmap)

---

## 1. Language Analysis

### 1.1 Top Programming Languages (2024)

Based on TIOBE Index, GitHub usage, and developer surveys:

| Rank | Language | Syntax Family | Complexity | Priority |
|------|----------|---------------|------------|----------|
| 1 | **JavaScript/TypeScript** | C-like | Medium | ✅ Done |
| 2 | **Python** | Whitespace | Low | 🔴 High |
| 3 | **Java** | C-like | High | 🟡 Medium |
| 4 | **C/C++** | C-like | Very High | 🟢 Low |
| 5 | **C#** | C-like | High | 🟡 Medium |
| 6 | **Go** | C-like | Low | 🔴 High |
| 7 | **Rust** | C-like | High | 🟡 Medium |
| 8 | **PHP** | C-like | Medium | 🟢 Low |
| 9 | **Swift** | C-like | Medium | 🟢 Low |
| 10 | **Kotlin** | C-like | Medium | 🟢 Low |
| 11 | **Ruby** | Ruby-like | Low | 🟢 Low |

**Recommended Priority Order**:
1. TypeScript/JavaScript ✅
2. Python (most different syntax)
3. Go (simple, growing)
4. Java (enterprise)
5. Rust (modern C++)
6. Others (lower priority)

---

### 1.2 Language Characteristics

#### JavaScript/TypeScript ✅ (Current)
```typescript
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
```

**Features**:
- C-like syntax
- Keywords: `class`, `function`, `const`, `let`, `return`
- Identifiers: camelCase
- Parser: TypeScript Compiler API

---

#### Python 🔴 (High Priority)
```python
class Calculator:
    def add(self, a: int, b: int) -> int:
        return a + b
```

**Features**:
- Whitespace-significant (indentation)
- Keywords: `class`, `def`, `return`, `if`, `elif`, `else`
- Identifiers: snake_case
- Parser options: `ast` module (builtin), tree-sitter

**Challenges**:
- Indentation must be preserved
- Different naming convention
- Built-in AST vs external parser

---

#### Go 🔴 (High Priority)
```go
type Calculator struct{}

func (c *Calculator) Add(a, b int) int {
    return a + b
}
```

**Features**:
- C-like syntax
- Keywords: `type`, `struct`, `func`, `return`
- Identifiers: PascalCase for exported, camelCase for private
- Parser: `go/parser` package

**Challenges**:
- Two naming conventions (public/private)
- Package management
- Interfaces

---

#### Java 🟡 (Medium Priority)
```java
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
```

**Features**:
- C-like syntax
- Keywords: `public`, `class`, `int`, `return`
- Identifiers: camelCase (methods), PascalCase (classes)
- Parser options: tree-sitter, custom

**Challenges**:
- Verbosity
- Multiple files per class
- Generics

---

#### Rust 🟡 (Medium Priority)
```rust
struct Calculator;

impl Calculator {
    fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }
}
```

**Features**:
- C-like syntax with Rust-specific features
- Keywords: `struct`, `impl`, `fn`, `let`, `mut`
- Identifiers: snake_case
- Parser: `syn` crate

**Challenges**:
- Macros
- Lifetimes (generic parameters)
- Ownership concepts

---

### 1.3 Common Patterns

**Similarities**:
- All have classes/structs
- All have functions/methods
- All have variables
- Most use C-like `{}` blocks

**Differences**:
- Naming conventions vary
- Whitespace significance (Python)
- Type systems
- Access modifiers

**Key Insight**: Most languages are similar enough for unified approach

---

## 2. Parser Options

### 2.1 Option A: Language-Specific Parsers

**TypeScript**: TypeScript Compiler API ✅
**Python**: `ast` module (Python builtin)
**Go**: `go/parser` package
**Java**: JavaParser library, tree-sitter
**Rust**: `syn` crate

**Pros**:
- Official, maintained parsers
- Language-specific optimizations
- Full feature support

**Cons**:
- Different API per language
- Requires language runtime installed
- Complex integration

---

### 2.2 Option B: Tree-sitter (Universal Parser)

**What is Tree-sitter?**
- Universal parsing library
- Used by GitHub, Atom, Neovim
- Supports 50+ languages
- Incremental parsing

**Example**:
```typescript
import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'
import Python from 'tree-sitter-python'

const parser = new Parser()

// Parse TypeScript
parser.setLanguage(TypeScript)
const tsTree = parser.parse(tsCode)

// Parse Python
parser.setLanguage(Python)
const pyTree = parser.parse(pyCode)

// Same API for both!
```

**Supported Languages**:
✅ JavaScript/TypeScript
✅ Python
✅ Go
✅ Java
✅ Rust
✅ C/C++
✅ Ruby
✅ PHP
✅ Swift
✅ Kotlin

**Pros**:
- Unified API across languages
- No language runtime needed
- Fast, incremental
- Actively maintained
- npm package available: `tree-sitter`, `tree-sitter-*`

**Cons**:
- Extra dependency
- Learning curve
- May not support cutting-edge language features immediately

---

### 2.3 Option C: LSP (Language Server Protocol)

**What is LSP?**
- Protocol for editor ↔ language server communication
- Provides symbols, definitions, references
- Used by VSCode, etc.

**Example**:
```typescript
// Query LSP for symbols in file
const symbols = await lspClient.getDocumentSymbols(fileUri)

// symbols = [
//   { name: "Calculator", kind: "class", range: ... },
//   { name: "add", kind: "method", range: ... }
// ]
```

**Pros**:
- Already running in editors
- High-level symbol info
- No parsing needed

**Cons**:
- Requires LSP server running
- Not standalone
- Overkill for identifier extraction

**Verdict**: Not suitable for kawa.i18n (too heavyweight)

---

### 2.4 Comparison Table

| Feature | Language-Specific | Tree-sitter | LSP |
|---------|------------------|-------------|-----|
| **Unified API** | ❌ | ✅ | ✅ |
| **Standalone** | ⚠️ (needs runtime) | ✅ | ❌ (needs server) |
| **Language Coverage** | ⚠️ (manual per lang) | ✅ (50+) | ✅ (many) |
| **Accuracy** | ✅ | ✅ | ✅ |
| **Performance** | ✅ | ✅ | ⚠️ (IPC overhead) |
| **Ease of Use** | ❌ (different APIs) | ✅ | ⚠️ (complex) |
| **Binary Size** | ⚠️ (varies) | ✅ (small) | ❌ (large) |
| **Maintenance** | ❌ (per language) | ✅ (unified) | ⚠️ (per language) |

**Winner**: Tree-sitter (best balance of features)

---

## 3. Architecture Proposals

### 3.1 Proposal A: Single Extension with Language Plugins

**Structure**:
```
kawa.i18n/
├── src/
│   ├── core/
│   │   ├── translator.ts          # Core logic
│   │   └── ast-transformer.ts     # Generic transformer
│   ├── languages/                 # Language plugins
│   │   ├── typescript.ts          # TS-specific
│   │   ├── python.ts              # Python-specific
│   │   ├── go.ts                  # Go-specific
│   │   └── base.ts                # Common interface
│   └── index.ts
└── package.json (depends on tree-sitter)
```

**Language Plugin Interface**:
```typescript
interface LanguagePlugin {
  name: string
  extensions: string[]              // [".ts", ".tsx"]
  parse(code: string): AST
  extractIdentifiers(ast: AST): string[]
  replaceIdentifiers(code: string, mapping: Record<string, string>): string
}

// TypeScript plugin
class TypeScriptPlugin implements LanguagePlugin {
  name = "typescript"
  extensions = [".ts", ".tsx", ".js", ".jsx"]

  parse(code: string): AST {
    // Use tree-sitter-typescript
    return parser.parse(code)
  }

  extractIdentifiers(ast: AST): string[] {
    // Extract from tree-sitter AST
    return findIdentifiers(ast)
  }

  replaceIdentifiers(code: string, mapping: Record<string, string>): string {
    // Text-based replacement (current approach)
    return replaceInCode(code, mapping)
  }
}
```

**Pros**:
- Single extension to maintain
- Shared dictionary cache
- Common IPC protocol
- Easy to add languages (just add plugin file)

**Cons**:
- Larger binary (all languages bundled)
- Must include tree-sitter for all languages
- All-or-nothing updates

**Binary Size Estimate**:
- Core: ~500KB
- Tree-sitter parsers: ~200KB each × 5 languages = ~1MB
- Total: ~1.5MB (acceptable!)

---

### 3.2 Proposal B: Separate Extension Per Language

**Structure**:
```
kawa.i18n-typescript/  (existing)
kawa.i18n-python/
kawa.i18n-go/
kawa.i18n-java/
...
```

**Each Extension**:
- Own manifest: `extension.json`
- Own domain: `i18n-typescript`, `i18n-python`, etc.
- Own binary
- Shared dictionary cache (same location)

**Pros**:
- Smaller binaries per language
- Independent updates
- Users install only what they need

**Cons**:
- Code duplication (core logic repeated)
- Dictionary management complexity
- Multiple extensions to maintain
- Confusing for users

**Binary Size Estimate**:
- Per language: ~700KB
- If user has 5 languages: ~3.5MB total

---

### 3.3 Proposal C: Hybrid (Single Extension + Optional Language Packs)

**Structure**:
```
kawa.i18n/              # Core extension (TS/JS builtin)
kawa.i18n-python/       # Optional Python support
kawa.i18n-go/           # Optional Go support
...
```

**Core Extension**:
- Includes TypeScript/JavaScript
- Provides plugin API
- Manages dictionaries

**Language Packs**:
- Register with core extension
- Provide parser for their language
- Share dictionary infrastructure

**Pros**:
- Core stays small
- Users choose languages
- Modular architecture

**Cons**:
- Complex plugin system
- Inter-extension communication
- Most complex to implement

---

## 4. Decision Matrix

### 4.1 Evaluation Criteria

| Criterion | Weight | Single Extension | Separate Extensions | Hybrid |
|-----------|--------|------------------|---------------------|--------|
| **Ease of Implementation** | 20% | ⭐⭐⭐⭐ (4) | ⭐⭐ (2) | ⭐⭐⭐ (3) |
| **User Experience** | 25% | ⭐⭐⭐⭐⭐ (5) | ⭐⭐⭐ (3) | ⭐⭐⭐⭐ (4) |
| **Maintainability** | 20% | ⭐⭐⭐⭐⭐ (5) | ⭐⭐ (2) | ⭐⭐⭐ (3) |
| **Binary Size** | 10% | ⭐⭐⭐ (3) | ⭐⭐⭐⭐ (4) | ⭐⭐⭐⭐⭐ (5) |
| **Scalability** | 15% | ⭐⭐⭐⭐ (4) | ⭐⭐⭐ (3) | ⭐⭐⭐⭐⭐ (5) |
| **Time to Market** | 10% | ⭐⭐⭐⭐⭐ (5) | ⭐⭐ (2) | ⭐⭐⭐ (3) |

**Weighted Scores**:
- **Single Extension**: 4.35 / 5
- Separate Extensions: 2.65 / 5
- Hybrid: 3.75 / 5

**Winner**: Single Extension with Language Plugins

---

## 5. Recommendations

### 5.1 Recommended Architecture: **Single Extension**

**Rationale**:
1. **Simplest to implement** - familiar TypeScript pattern
2. **Best UX** - users install once, get all languages
3. **Maintainable** - one codebase, unified testing
4. **Acceptable size** - ~1.5MB is small for modern apps
5. **Fast time to market** - can ship Python support in days

**Implementation**:
```
kawa.i18n/
├── src/
│   ├── core/                      # Shared logic
│   │   ├── types.ts
│   │   ├── translator.ts
│   │   └── ast-base.ts            # Base AST transformer
│   ├── languages/                 # Language plugins
│   │   ├── typescript/
│   │   │   ├── parser.ts          # Tree-sitter wrapper
│   │   │   ├── transformer.ts     # TS-specific logic
│   │   │   └── index.ts
│   │   ├── python/
│   │   │   ├── parser.ts
│   │   │   ├── transformer.ts
│   │   │   └── index.ts
│   │   └── registry.ts            # Language registration
│   ├── dictionary/                # Shared cache
│   ├── ipc/                       # Shared IPC
│   └── index.ts
└── package.json
```

---

### 5.2 Parser Choice: **Tree-sitter**

**Rationale**:
1. **Unified API** - same code for all languages
2. **No runtime deps** - works standalone
3. **Well-supported** - 50+ languages
4. **npm packages** - easy integration
5. **Fast** - incremental parsing

**Package Dependencies**:
```json
{
  "dependencies": {
    "typescript": "^5.3.3",              // Current (TS Compiler API)
    "tree-sitter": "^0.20.4",            // Core
    "tree-sitter-typescript": "^0.20.3", // TS/JS
    "tree-sitter-python": "^0.20.4",     // Python
    "tree-sitter-go": "^0.20.0",         // Go
    "tree-sitter-java": "^0.20.2"        // Java (future)
  }
}
```

**Migration Strategy**:
- **Keep** TypeScript Compiler API for TS/JS (proven, working)
- **Add** tree-sitter for other languages
- **Future**: Could migrate TS/JS to tree-sitter for consistency

---

### 5.3 Language Priority

**Phase 2-4**: TypeScript/JavaScript only (current)

**Phase 7** (after Phases 5-6 complete):
- Add Python support (2-3 days)
- Add Go support (1-2 days)

**Phase 8**:
- Add Java support (2-3 days)
- Add Rust support (2-3 days)

**Future**:
- C/C++, Ruby, PHP, Swift, Kotlin (on-demand)

---

## 6. Implementation Roadmap

### 6.1 Phase 7: Python Support (First New Language)

**Goal**: Prove multi-language architecture works

**Tasks**:

#### Task 7.1: Install Tree-sitter
```bash
npm install tree-sitter tree-sitter-python
```

#### Task 7.2: Create Language Plugin Interface
```typescript
// src/languages/base.ts
export interface LanguagePlugin {
  name: string
  extensions: string[]
  isSupported(filePath: string): boolean
  parse(code: string): Promise<AST>
  extractIdentifiers(ast: AST): Identifier[]
  replaceIdentifiers(code: string, mapping: Record<string, string>): string
}
```

#### Task 7.3: Implement Python Plugin
```typescript
// src/languages/python/index.ts
import Parser from 'tree-sitter'
import Python from 'tree-sitter-python'

export class PythonPlugin implements LanguagePlugin {
  name = "python"
  extensions = [".py"]
  private parser: Parser

  constructor() {
    this.parser = new Parser()
    this.parser.setLanguage(Python)
  }

  async parse(code: string): Promise<Tree> {
    return this.parser.parse(code)
  }

  extractIdentifiers(tree: Tree): Identifier[] {
    // Walk tree-sitter AST
    // Find identifier nodes
    // Return list
  }

  replaceIdentifiers(code: string, mapping: Record<string, string>): string {
    // Same text-replacement approach as TypeScript
    const tree = this.parser.parse(code)
    const identifiers = this.extractIdentifiers(tree)

    // Sort by position (reverse)
    identifiers.sort((a, b) => b.start - a.start)

    // Replace from end to start
    let result = code
    for (const id of identifiers) {
      const translated = mapping[id.text]
      if (translated) {
        result = result.substring(0, id.start) +
                 translated +
                 result.substring(id.end)
      }
    }

    return result
  }
}
```

#### Task 7.4: Language Registry
```typescript
// src/languages/registry.ts
const languages = new Map<string, LanguagePlugin>()

export function registerLanguage(plugin: LanguagePlugin): void {
  languages.set(plugin.name, plugin)

  for (const ext of plugin.extensions) {
    languages.set(ext, plugin)
  }
}

export function getLanguageForFile(filePath: string): LanguagePlugin | null {
  const ext = path.extname(filePath)
  return languages.get(ext) || null
}

// Register all languages at startup
import { TypeScriptPlugin } from './typescript'
import { PythonPlugin } from './python'

registerLanguage(new TypeScriptPlugin())
registerLanguage(new PythonPlugin())
```

#### Task 7.5: Update Translation Logic
```typescript
// src/index.ts - translate-code handler
async function handleTranslateCode(message: IPCMessage): Promise<any> {
  const { code, filePath, sourceLang, targetLang, origin } = message.data

  // Auto-detect programming language
  const langPlugin = getLanguageForFile(filePath)

  if (!langPlugin) {
    throw new Error(`Unsupported file type: ${filePath}`)
  }

  // Load dictionary
  const dictionary = dictionaryCache.load(origin, targetLang)

  // Parse code
  const ast = await langPlugin.parse(code)

  // Extract identifiers
  const identifiers = langPlugin.extractIdentifiers(ast)

  // Build mapping
  const mapping = {}
  for (const id of identifiers) {
    mapping[id.text] = dictionary.terms[id.text] || id.text
  }

  // Replace identifiers
  const translatedCode = langPlugin.replaceIdentifiers(code, mapping)

  return {
    success: true,
    code: translatedCode
  }
}
```

**Estimated Effort**: 2-3 days

---

### 6.2 Phase 8: Go Support (Validate Pattern)

**Goal**: Confirm plugin pattern scales

**Tasks**:
- Install `tree-sitter-go`
- Create `src/languages/go/` plugin
- Register in registry
- Test with Go code

**Estimated Effort**: 1-2 days (faster, pattern proven)

---

### 6.3 Future Languages

**Each Additional Language**:
1. Install tree-sitter parser (~5 min)
2. Create plugin file (~2-4 hours)
3. Register (~5 min)
4. Test (~1 hour)

**Total per language**: ~Half a day (after first 2)

---

## 7. Alternative Considered: Keywords Translation

### 7.1 Current Approach: Identifiers Only

**What's Translated**:
```python
class Calculator:  # ← "Calculator" translated
    def add(...):  # ← "add" translated
```

**What's NOT Translated**:
```python
class Calculator:  # ← "class" NOT translated
    def add(...):  # ← "def" NOT translated
```

**Rationale**:
- Keywords stay in English for IDE support
- Type checking still works
- Linters work normally

---

### 7.2 Alternative: Translate Keywords Too

**Example** (if we translated keywords):
```python
# Original
class Calculator:
    def add(self, a, b):
        return a + b

# Translated to Japanese (hypothetical)
クラス 計算機:
    関数 追加(self, a, b):
        返す a + b
```

**Problems**:
1. **Breaks syntax** - `クラス` is not valid Python
2. **No IDE support** - syntax highlighting broken
3. **Can't run** - Python interpreter doesn't understand
4. **Linters fail** - everything breaks

**Verdict**: ❌ Bad idea, don't do this

**Keep Current Approach**: Only translate identifiers, keywords stay in English

---

## 8. Summary & Decision

### Recommended Decisions

| Decision Point | Recommendation | Rationale |
|----------------|----------------|-----------|
| **Architecture** | Single Extension | Best UX, maintainability |
| **Parser** | Tree-sitter | Unified API, multi-language |
| **Language Priority** | Python → Go → Java → Rust | Demand, diversity |
| **Keywords** | Do NOT translate | Preserve tooling support |
| **Timeline** | Phase 7-8 | After Phases 5-6 complete |

---

### Implementation Summary

**Phase 2-6**: TypeScript/JavaScript only (focus on core features)

**Phase 7**: Add Python support
- Implement language plugin system
- Add tree-sitter integration
- Prove multi-language pattern

**Phase 8**: Add Go support
- Validate pattern scales
- Refine plugin interface

**Future**: Add more languages on-demand
- ~0.5 day per language after pattern proven
- Prioritize by user requests

---

### Binary Size Impact

**Current** (TS/JS only): ~700KB

**With Python + Go + Java**:
- Core: ~500KB
- Tree-sitter: ~100KB
- TS parser: ~200KB
- Python parser: ~200KB
- Go parser: ~200KB
- Java parser: ~200KB
- **Total**: ~1.4MB

**Acceptable**: Yes! Most extensions are 5-10MB

---

### Breaking Changes

**None!** Multi-language support is additive:
- Existing TS/JS code works unchanged
- New languages just add more file type support
- Backward compatible

---

## Next Steps

1. ✅ **Decision Made**: Single extension + Tree-sitter + Language plugins
2. 📋 **Document in IMPLEMENTATION_PLAN.md**: Add Phase 7-8 details
3. 🚀 **Start Phase 2**: Focus on TS/JS, add multi-language later
4. 🔄 **Revisit in Phase 7**: Implement Python support

---

**Status**: ✅ Multi-Language Strategy Complete

**Decision**: Single extension with tree-sitter-based language plugins

**Ready for**: Phase 2 implementation!
