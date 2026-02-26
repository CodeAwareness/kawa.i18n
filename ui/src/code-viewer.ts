/**
 * i18n Code Viewer Web Component
 *
 * Displays translated code with syntax highlighting via Prism.js.
 * Built with Lit and uses Shadow DOM for style isolation.
 */

import { LitElement, html, css, PropertyValues, TemplateResult, nothing } from 'lit'
import { property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { sendIPCRequest, setupIPCListener, cleanupIPCListener } from './ipc-bridge'

// Translation scope (must match backend TranslationScope)
interface TranslationScope {
  comments: boolean
  stringLiterals: boolean
  identifiers: boolean
  keywords: boolean
  punctuation: boolean
  markdownFiles: boolean
}

// File tree node interface
interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children: FileTreeNode[]
  expanded?: boolean
}

// Intent decoration interfaces (matching backend types)
interface IntentBlock {
  startLine: number
  endLine: number
  contentSnippet: string
}

interface IntentDecoration {
  id: string
  title: string
  titleOriginal: string
  titleSourceLang: string
  description: string
  status: 'active' | 'committed' | 'pushed' | 'done' | 'abandoned'
  author: string
  templateType: 'feature' | 'refactor' | 'exploration'
  blocks: IntentBlock[]
  createdAt: string
  updatedAt: string
}

// Intent color map for template types
const INTENT_COLORS: Record<string, string> = {
  feature: '#4caf50',    // Green
  refactor: '#ff9800',   // Orange
  exploration: '#9c27b0', // Purple
}

// Prism theme CSS (Tomorrow Night inspired, using CSS custom properties)
const prismStyles = css`
  code[class*="language-"],
  pre[class*="language-"] {
    color: var(--kawa-code-text, #ccc);
    background: none;
    font-family: var(--kawa-code-font, 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace);
    font-size: var(--kawa-code-font-size, 13px);
    text-align: left;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    word-wrap: normal;
    line-height: var(--kawa-code-line-height, 1.5);
    tab-size: 2;
    hyphens: none;
  }

  .token.comment,
  .token.block-comment,
  .token.prolog,
  .token.doctype,
  .token.cdata { color: var(--kawa-code-comment, #6a9955); }

  .token.punctuation { color: var(--kawa-code-punctuation, #ccc); }

  .token.tag,
  .token.attr-name,
  .token.namespace,
  .token.deleted { color: var(--kawa-code-tag, #569cd6); }

  .token.function-name,
  .token.function { color: var(--kawa-code-function, #dcdcaa); }

  .token.boolean,
  .token.number { color: var(--kawa-code-number, #b5cea8); }

  .token.property,
  .token.class-name,
  .token.constant,
  .token.symbol { color: var(--kawa-code-property, #4ec9b0); }

  .token.selector,
  .token.important,
  .token.atrule,
  .token.keyword,
  .token.builtin { color: var(--kawa-code-keyword, #569cd6); }

  .token.string,
  .token.char,
  .token.attr-value,
  .token.regex,
  .token.variable { color: var(--kawa-code-string, #ce9178); }

  .token.operator,
  .token.entity,
  .token.url { color: var(--kawa-code-operator, #d4d4d4); }

  .token.inserted { color: var(--kawa-code-inserted, #27ae60); }
`

// Component styles
const componentStyles = css`
  :host {
    display: flex;
    flex-direction: row;
    height: 100%;
    width: 100%;
    background: var(--kawa-bg-primary, #1e1e1e);
    color: var(--kawa-text-primary, #d4d4d4);
    font-family: var(--kawa-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  }

  /* Sidebar - File Tree */
  .sidebar {
    width: 280px;
    min-width: 200px;
    max-width: 400px;
    border-right: 1px solid var(--kawa-border, #3c3c3c);
    display: flex;
    flex-direction: column;
    background: var(--kawa-bg-secondary, #252526);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--kawa-text-secondary, #969696);
    border-bottom: 1px solid var(--kawa-border, #3c3c3c);
  }

  .file-tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  /* Sidebar loading state */
  .sidebar-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    color: var(--kawa-text-secondary, #969696);
    font-size: 12px;
    gap: 12px;
  }

  .sidebar-loading .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--kawa-border, #3c3c3c);
    border-top-color: var(--kawa-accent, #0c719c);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .sidebar-loading .loading-text {
    text-align: center;
  }

  .sidebar-loading .sync-status {
    font-size: 11px;
    color: var(--kawa-accent, #0c719c);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  /* Tree node styles */
  .tree-node {
    user-select: none;
  }

  .tree-item {
    padding: 3px 8px;
    padding-left: calc(8px + var(--depth, 0) * 16px);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--kawa-text-primary, #d4d4d4);
    transition: background var(--kawa-transition-fast, 150ms ease);
  }

  .tree-item:hover {
    background: var(--kawa-bg-hover, #2a2d2e);
  }

  .tree-item.selected {
    background: var(--kawa-bg-selected, #094771);
  }

  .tree-item.directory {
    font-weight: 500;
  }

  .expand-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: var(--kawa-text-secondary, #969696);
    transition: transform 150ms ease;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  .expand-icon.hidden {
    visibility: hidden;
  }

  .file-icon {
    width: 16px;
    text-align: center;
    font-size: 14px;
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .tree-children {
    display: none;
  }

  .tree-children.expanded {
    display: block;
  }

  /* Main Content */
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 13px 9px 15px;
    background: var(--kawa-bg-secondary, #252526);
    border-bottom: 1px solid var(--kawa-border, #3c3c3c);
    flex-shrink: 0;
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-label {
    font-size: 12px;
    color: var(--kawa-text-secondary, #969696);
  }

  .language-select {
    padding: 4px 8px;
    border-radius: var(--kawa-radius-md, 4px);
    border: 1px solid var(--kawa-border, #3c3c3c);
    background: var(--kawa-bg-primary, #1e1e1e);
    color: var(--kawa-text-primary, #d4d4d4);
    font-size: 12px;
    cursor: pointer;
    outline: none;
  }

  .language-select:focus {
    border-color: var(--kawa-border-focus, #007fd4);
  }

  .file-path {
    flex: 1;
    font-size: 12px;
    color: var(--kawa-text-secondary, #969696);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Code Container */
  .code-container {
    flex: 1;
    overflow: auto;
    background: var(--kawa-bg-primary, #1e1e1e);
  }

  /* Table-based layout guarantees line number and code alignment */
  .code-table {
    display: table;
    width: 100%;
    border-collapse: collapse;
    font-family: var(--kawa-code-font, 'JetBrains Mono', monospace);
    font-size: var(--kawa-code-font-size, 13px);
    line-height: var(--kawa-code-line-height, 1.5);
  }

  .code-line {
    display: table-row;
  }

  .code-line:hover {
    background: var(--kawa-bg-hover, rgba(255,255,255,0.04));
  }

  .line-number-cell {
    display: table-cell;
    text-align: right;
    user-select: none;
    padding: 0 8px 0 12px;
    background: var(--kawa-bg-secondary, #252526);
    border-right: 1px solid var(--kawa-border, #3c3c3c);
    color: var(--kawa-line-number, #858585);
    vertical-align: top;
    white-space: nowrap;
    width: 1%;  /* Shrink to content */
  }

  .line-number-inner {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .code-cell {
    display: table-cell;
    padding: 0 16px;
    vertical-align: top;
    white-space: pre;
  }

  /* First and last row padding */
  .code-line:first-child .line-number-cell,
  .code-line:first-child .code-cell {
    padding-top: 16px;
  }

  .code-line:last-child .line-number-cell,
  .code-line:last-child .code-cell {
    padding-bottom: 16px;
  }

  /* Legacy styles for backwards compatibility */
  pre {
    margin: 0;
    padding: 0;
  }

  /* Loading State */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--kawa-text-secondary, #969696);
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--kawa-border, #3c3c3c);
    border-top-color: var(--kawa-accent, #0c719c);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 12px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--kawa-text-secondary, #969696);
    text-align: center;
    padding: 32px;
  }

  .empty-state-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .empty-state-text {
    font-size: 14px;
    max-width: 300px;
    line-height: 1.5;
  }

  /* Translating indicator */
  .translating-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--kawa-accent, #0c719c);
  }

  .translating-indicator .spinner {
    width: 14px;
    height: 14px;
    margin-right: 0;
  }

  /* Intent badge on file tree */
  .intent-badge {
    background: var(--kawa-accent, #0c719c);
    color: white;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 8px;
    margin-left: auto;
    font-weight: 500;
  }

  /* Intent indicators in line numbers */
  .line-number-cell.has-intent {
    cursor: pointer;
  }

  .line-number-cell.has-intent:hover {
    background: var(--kawa-bg-selected, #094771);
  }

  .intent-indicators {
    display: inline-flex;
    gap: 2px;
    min-width: 16px;
    align-items: center;
    justify-content: flex-end;
  }

  .intent-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    opacity: 0.8;
    flex-shrink: 0;
  }

  .intent-dot:hover {
    opacity: 1;
    transform: scale(1.2);
  }

  .intent-overflow {
    font-size: 8px;
    color: var(--kawa-text-secondary, #969696);
  }

  .line-num-text {
    min-width: 30px;
    text-align: right;
    padding-right: 8px;
  }

  /* Intent loading indicator in gutter */
  .intent-loading-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 10px;
    color: var(--kawa-text-secondary, #969696);
    border-bottom: 1px solid var(--kawa-border, #3c3c3c);
  }

  .intent-loading-indicator .mini-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--kawa-border, #3c3c3c);
    border-top-color: var(--kawa-accent, #0c719c);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  /* Intent tooltip */
  .intent-tooltip {
    position: fixed;
    z-index: 1000;
    background: var(--kawa-bg-secondary, #252526);
    border: 1px solid var(--kawa-border, #3c3c3c);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-width: 400px;
    font-size: 12px;
    overflow: hidden;
  }

  .tooltip-header {
    padding: 8px 12px;
    background: var(--kawa-bg-primary, #1e1e1e);
    border-bottom: 1px solid var(--kawa-border, #3c3c3c);
    font-weight: 600;
    color: var(--kawa-text-secondary, #969696);
  }

  .intent-card {
    padding: 10px 12px;
    border-bottom: 1px solid var(--kawa-border, #3c3c3c);
  }

  .intent-card:last-child {
    border-bottom: none;
  }

  .intent-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .template-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 500;
  }

  .template-badge.feature {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .template-badge.refactor {
    background: rgba(255, 152, 0, 0.2);
    color: #ff9800;
  }

  .template-badge.exploration {
    background: rgba(156, 39, 176, 0.2);
    color: #9c27b0;
  }

  .intent-author {
    font-size: 11px;
    color: var(--kawa-text-secondary, #969696);
  }

  .intent-title {
    font-weight: 500;
    color: var(--kawa-text-primary, #d4d4d4);
    margin-bottom: 4px;
  }

  .intent-description {
    font-size: 11px;
    color: var(--kawa-text-secondary, #969696);
    line-height: 1.4;
  }
`

export class I18nCodeViewer extends LitElement {
  static styles = [prismStyles, componentStyles]

  // Properties passed from Muninn via ExtensionScreen
  @property({ type: String }) caw = '0'
  @property({ type: String }) origin = ''
  @property({ type: String, attribute: 'project-root' }) projectRoot = ''
  @property({ type: String, attribute: 'auth-token' }) authToken = ''
  @property({ type: String }) language = 'en'
  @property({ type: String, attribute: 'active-path' }) activePath = ''
  @property({ type: String, attribute: 'initial-state' }) initialState = ''

  // Flag to track if initial state has been restored
  private initialStateRestored = false

  // Internal state
  @state() private fileTree: FileTreeNode[] = []
  @state() private expandedPaths: Set<string> = new Set()
  @state() private selectedFile: string | null = null
  @state() private originalCode: string = ''
  @state() private translatedCode: string = ''
  @state() private codeLanguage: string = 'typescript'
  @state() private targetLanguage: string = 'en'
  @state() private isLoading: boolean = false
  @state() private isTranslating: boolean = false
  @state() private error: string | null = null
  @state() private fileTreeLoaded: boolean = false

  // Intent state
  @state() private fileIntents: IntentDecoration[] = []
  @state() private lineIntentMap: Map<number, string[]> = new Map()
  @state() private hoveredIntentLine: number | null = null
  @state() private intentTooltipPosition: { x: number, y: number } = { x: 0, y: 0 }
  @state() private fileIntentCounts: Map<string, number> = new Map()
  @state() private intentsLoading: boolean = false

  // Translation scope (loaded from settings on init)
  @state() private translationScope: TranslationScope | null = null
  private translationScopePromise: Promise<void> | null = null

  // Sync status state
  @state() private fileTreeLoading: boolean = false
  @state() private syncStatus: string = ''

  // Cache projectRoot from the list-files response - this is the authoritative value
  // that matches the file paths we have. Using this avoids race conditions with
  // property updates from the parent component.
  private loadedProjectRoot: string = ''

  // Request counter for debugging and race condition handling
  private requestId: number = 0

  // AbortController for cancelling in-flight translation requests
  private translateAbortController: AbortController | null = null

  private supportedLanguages = [
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語 (Japanese)' },
    { code: 'es', name: 'Español (Spanish)' },
    { code: 'fr', name: 'Français (French)' },
    { code: 'de', name: 'Deutsch (German)' },
    { code: 'zh', name: '中文 (Chinese)' },
    { code: 'ko', name: '한국어 (Korean)' },
    { code: 'pt', name: 'Português (Portuguese)' },
    { code: 'ru', name: 'Русский (Russian)' },
    { code: 'it', name: 'Italiano (Italian)' },
  ]

  connectedCallback() {
    super.connectedCallback()
    setupIPCListener(this)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    cleanupIPCListener(this)
    // Emit final state before disconnect
    this.emitStateChange()
  }

  /**
   * Emit current state to parent for persistence
   */
  private emitStateChange() {
    const state = {
      selectedFile: this.selectedFile,
      expandedPaths: Array.from(this.expandedPaths),
      targetLanguage: this.targetLanguage,
    }
    this.dispatchEvent(new CustomEvent('kawa-state-change', {
      bubbles: true,
      composed: true,
      detail: { state }
    }))
  }

  /**
   * Restore state from initialState property
   */
  private restoreState() {
    if (!this.initialState || this.initialStateRestored) return

    try {
      const state = JSON.parse(this.initialState)
      console.log('[code-viewer] Restoring state:', state)

      if (state.expandedPaths) {
        this.expandedPaths = new Set(state.expandedPaths)
      }
      if (state.targetLanguage) {
        this.targetLanguage = state.targetLanguage
      }
      // selectedFile will be restored after file tree loads
      this.initialStateRestored = true

      // Return the selected file to restore after tree loads
      return state.selectedFile
    } catch (err) {
      console.error('[code-viewer] Failed to restore state:', err)
      return null
    }
  }

  protected firstUpdated(_changedProperties: PropertyValues) {
    // Load translation scope settings (store promise so translateCode can await it)
    this.translationScopePromise = this.loadTranslationScope()

    // Restore state from initial-state property
    const selectedFileToRestore = this.restoreState()

    // Load file tree on first render if origin or projectRoot is available
    if (this.origin || this.projectRoot) {
      this.loadFileTree().then(() => {
        // After file tree loads, restore selected file if we had one
        if (selectedFileToRestore && this.fileTree.length > 0) {
          console.log('[code-viewer] Restoring selected file:', selectedFileToRestore)
          this.selectFile(selectedFileToRestore)
        } else if (this.activePath && this.fileTree.length > 0) {
          // Fallback: use activePath from editor if no restored state
          const relativePath = this.toRelativePath(this.activePath)
          if (relativePath) {
            console.log('[code-viewer] Using activePath as initial file:', relativePath)
            this.expandPathToFile(relativePath)
            this.selectFile(relativePath)
          }
        }
      })
    }
  }

  protected updated(changedProperties: PropertyValues) {
    // Reload file tree if origin or projectRoot changes after initial load
    const originChanged = changedProperties.has('origin') && changedProperties.get('origin') !== undefined
    const rootChanged = changedProperties.has('projectRoot') && changedProperties.get('projectRoot') !== undefined

    if ((originChanged || rootChanged) && (this.origin || this.projectRoot)) {
      // Clear cached state to prevent using stale data from previous project
      this.loadedProjectRoot = ''
      this.fileTree = []
      this.selectedFile = null
      this.originalCode = ''
      this.translatedCode = ''
      this.error = null
      this.fileTreeLoaded = false

      this.loadFileTree()
    }

    // React to activePath changes from the editor (VSCode file switch)
    if (changedProperties.has('activePath') && this.activePath && this.fileTreeLoaded && this.loadedProjectRoot) {
      // Convert absolute path to relative path if needed
      const relativePath = this.toRelativePath(this.activePath)
      if (relativePath && relativePath !== this.selectedFile) {
        console.log('[code-viewer] Active path changed from editor:', relativePath)
        this.expandPathToFile(relativePath)
        this.selectFile(relativePath)
      }
    }
  }

  /** Normalize path separators to forward slash (so Windows paths build a proper tree) */
  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/')
  }

  /**
   * Build a tree structure from flat file paths
   */
  private buildFileTree(files: string[]): FileTreeNode[] {
    const root: FileTreeNode[] = []
    const nodeMap = new Map<string, FileTreeNode>()

    // Sort files so directories come before files at the same level
    const sortedFiles = [...files].sort((a, b) => {
      const aParts = this.normalizePath(a).split('/')
      const bParts = this.normalizePath(b).split('/')

      // Compare path parts
      for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        if (aParts[i] !== bParts[i]) {
          return aParts[i].localeCompare(bParts[i])
        }
      }
      return aParts.length - bParts.length
    })

    for (const filePath of sortedFiles) {
      const parts = this.normalizePath(filePath).split('/')
      let currentPath = ''

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const parentPath = currentPath
        currentPath = currentPath ? `${currentPath}/${part}` : part
        const isFile = i === parts.length - 1

        if (!nodeMap.has(currentPath)) {
          const node: FileTreeNode = {
            name: part,
            path: currentPath,
            isDirectory: !isFile,
            children: [],
            expanded: false,
          }
          nodeMap.set(currentPath, node)

          if (parentPath) {
            const parent = nodeMap.get(parentPath)
            if (parent) {
              parent.children.push(node)
            }
          } else {
            root.push(node)
          }
        }
      }
    }

    // Sort children: directories first, then files, alphabetically
    const sortChildren = (nodes: FileTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
      for (const node of nodes) {
        if (node.children.length > 0) {
          sortChildren(node.children)
        }
      }
    }
    sortChildren(root)

    return root
  }

  /**
   * Load the file tree from the project
   */
  private async loadFileTree() {
    if (!this.origin && !this.projectRoot) {
      console.log('[code-viewer] No origin or project root, skipping file tree load')
      return
    }

    if (this.fileTreeLoaded) {
      console.log('[code-viewer] File tree already loaded, skipping')
      return
    }

    // Set loading state before starting
    this.fileTreeLoading = true
    this.syncStatus = 'Loading project...'
    this.fileTreeLoaded = true
    console.log('[code-viewer] Loading file tree for:', this.origin || this.projectRoot)

    try {
      // Update sync status while loading
      this.syncStatus = 'Syncing intents...'

      const response = await sendIPCRequest(this, 'repo', 'list-files', {
        origin: this.origin,
        projectRoot: this.projectRoot,
        include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.rs', '**/*.go', '**/*.java', '**/*.vue', '**/*.css', '**/*.scss', '**/*.html', '**/*.json', '**/*.yaml', '**/*.yml', '**/*.md']
      })

      // Cache the projectRoot from the response - this is authoritative
      // and will be used for all subsequent file reads
      if (response?.projectRoot) {
        this.loadedProjectRoot = response.projectRoot
        console.log('[code-viewer] ✓ Cached projectRoot:', this.loadedProjectRoot)
      } else {
        console.error('[code-viewer] ✗ Response missing projectRoot!', response)
      }

      const files = (response?.files || []).map((f: any) => f.path)
      this.fileTree = this.buildFileTree(files)
      console.log('[code-viewer] ✓ Loaded', files.length, 'files. projectRoot is now:', this.loadedProjectRoot || '(EMPTY)')

      // Clear loading state
      this.fileTreeLoading = false
      this.syncStatus = ''
    } catch (err) {
      console.error('[code-viewer] ✗ Failed to load file tree:', err)
      this.fileTree = []
      this.fileTreeLoading = false
      this.syncStatus = ''
    }
  }

  /**
   * Toggle folder expansion
   */
  private toggleFolder(path: string) {
    const newExpanded = new Set(this.expandedPaths)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    this.expandedPaths = newExpanded
    this.emitStateChange()
  }

  /**
   * Convert an absolute file path to a path relative to the loaded project root.
   * Returns null if the path is not within the project.
   */
  private toRelativePath(absolutePath: string): string | null {
    if (!this.loadedProjectRoot) return null
    const normRoot = this.normalizePath(this.loadedProjectRoot)
    const root = normRoot.endsWith('/') ? normRoot : normRoot + '/'
    const normPath = this.normalizePath(absolutePath)
    if (normPath.startsWith(root)) {
      return normPath.slice(root.length)
    }
    // Already a relative path - check if it exists in the tree
    if (this.findNodeByPath(this.fileTree, normPath)) {
      return normPath
    }
    return null
  }

  /**
   * Find a file tree node by path
   */
  private findNodeByPath(nodes: FileTreeNode[], path: string): FileTreeNode | null {
    const normPath = this.normalizePath(path)
    for (const node of nodes) {
      if (node.path === normPath) return node
      if (node.children.length > 0) {
        const found = this.findNodeByPath(node.children, normPath)
        if (found) return found
      }
    }
    return null
  }

  /**
   * Expand all parent directories in the sidebar so the given file path is visible
   */
  private expandPathToFile(filePath: string) {
    const parts = this.normalizePath(filePath).split('/')
    if (parts.length <= 1) return

    const newExpanded = new Set(this.expandedPaths)
    let current = ''
    // Expand all parent directories (not the file itself)
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i]
      newExpanded.add(current)
    }
    this.expandedPaths = newExpanded
  }

  /**
   * Select and load a file
   */
  private async selectFile(filePath: string) {
    if (this.selectedFile === filePath) return

    // Cancel any in-flight translation from the previous file
    if (this.translateAbortController) {
      this.translateAbortController.abort()
      this.translateAbortController = null
    }

    // Increment request ID for tracking
    const currentRequestId = ++this.requestId

    // Use the projectRoot that was returned when we loaded the file tree
    // This is the authoritative value that matches the file paths we have
    const projectRoot = this.loadedProjectRoot

    console.log(`[code-viewer] Request #${currentRequestId}: Selecting file:`, filePath,
      'projectRoot:', projectRoot || '(EMPTY)',
      'loadedProjectRoot:', this.loadedProjectRoot || '(EMPTY)')

    if (!projectRoot) {
      console.error(`[code-viewer] Request #${currentRequestId}: No projectRoot available`)
      this.error = 'Project not loaded. Please wait for the file tree to load.'
      return
    }

    // Set selected file immediately for UI feedback
    this.selectedFile = filePath
    this.isLoading = true
    this.error = null
    this.emitStateChange()

    // Clear previous file's intents immediately and start loading new ones
    this.fileIntents = []
    this.lineIntentMap = new Map()
    this.intentsLoading = true

    // Load intents in the background (don't await)
    this.loadIntentsForFile(filePath, currentRequestId)

    try {
      const response = await sendIPCRequest(this, 'repo', 'read-file', {
        origin: this.origin,
        filePath: filePath,
        projectRoot: projectRoot
      })

      // Check if this request is still the latest one
      if (this.requestId !== currentRequestId) {
        console.log(`[code-viewer] Request #${currentRequestId}: Discarding (superseded by #${this.requestId})`)
        return
      }

      // Also check if user has selected a different file
      if (this.selectedFile !== filePath) {
        console.log(`[code-viewer] Request #${currentRequestId}: Discarding (file changed to: ${this.selectedFile})`)
        return
      }

      if (response?.error) {
        throw new Error(response.error)
      }

      this.originalCode = response?.contents || ''
      this.codeLanguage = this.detectLanguage(filePath)

      const lineCount = this.originalCode.split('\n').length
      console.log(`[code-viewer] Request #${currentRequestId}: File loaded, language:`, this.codeLanguage, 'lines:', lineCount, 'bytes:', this.originalCode.length)

      if (this.targetLanguage !== 'en') {
        await this.translateCode()
      } else {
        this.translatedCode = this.originalCode
      }
    } catch (err: any) {
      // Only show error if this is still the current request
      if (this.requestId === currentRequestId && this.selectedFile === filePath) {
        this.error = err.message || 'Failed to load file'
        this.originalCode = ''
        this.translatedCode = ''
        console.error(`[code-viewer] Request #${currentRequestId}: Error loading file:`, err)
      }
    } finally {
      // Only clear loading state if this is still the current request
      if (this.requestId === currentRequestId && this.selectedFile === filePath) {
        this.isLoading = false
      }
    }
  }

  /**
   * Load intents for the selected file (runs in background)
   */
  private async loadIntentsForFile(filePath: string, requestId?: number) {
    const currentRequestId = requestId ?? this.requestId

    console.log('[code-viewer] loadIntentsForFile called with:', {
      filePath,
      origin: this.origin,
      targetLanguage: this.targetLanguage,
      requestId: currentRequestId,
    })

    if (!this.origin) {
      console.log('[code-viewer] No origin, skipping intent load')
      this.intentsLoading = false
      return
    }

    try {
      console.log('[code-viewer] Loading intents for:', filePath, 'origin:', this.origin)

      const response = await sendIPCRequest(this, 'intent-block', 'get-for-file', {
        repoOrigin: this.origin,
        filePath: filePath,
        targetLang: this.targetLanguage,
      })

      // Check if user has switched to a different file
      if (this.selectedFile !== filePath || this.requestId !== currentRequestId) {
        console.log('[code-viewer] Intent request stale, discarding')
        return
      }

      console.log('[code-viewer] Intent response:', response)

      if (response?.success) {
        this.fileIntents = response.intents || []

        // Convert lineMap from string keys to number keys
        // Build the map first, then assign to trigger Lit reactivity properly
        const newLineIntentMap = new Map<number, string[]>()
        if (response.lineMap) {
          for (const [line, intentIds] of Object.entries(response.lineMap)) {
            newLineIntentMap.set(parseInt(line, 10), intentIds as string[])
          }
        }
        this.lineIntentMap = newLineIntentMap

        console.log('[code-viewer] Loaded', this.fileIntents.length, 'intents,', this.lineIntentMap.size, 'lines with intents')
      } else {
        console.log('[code-viewer] Failed to load intents:', response?.error)
        this.fileIntents = []
        this.lineIntentMap = new Map()
      }
    } catch (error: any) {
      // Only update state if still on the same file
      if (this.selectedFile === filePath && this.requestId === currentRequestId) {
        console.error('[code-viewer] Error loading intents:', error)
        this.fileIntents = []
        this.lineIntentMap = new Map()
      }
    } finally {
      // Only clear loading state if still on the same file
      if (this.selectedFile === filePath && this.requestId === currentRequestId) {
        this.intentsLoading = false
      }
    }
  }

  /**
   * Get number of intents for a line
   */
  private getLineIntentCount(lineNum: number): number {
    return this.lineIntentMap.get(lineNum)?.length || 0
  }

  /**
   * Get intents for a line
   */
  private getIntentsForLine(lineNum: number): IntentDecoration[] {
    const intentIds = this.lineIntentMap.get(lineNum) || []
    return this.fileIntents.filter(intent => intentIds.includes(intent.id))
  }

  /**
   * Get color for intent template type
   */
  private getIntentColor(templateType: string): string {
    return INTENT_COLORS[templateType] || INTENT_COLORS.feature
  }

  /**
   * Show intent tooltip on hover
   */
  private showIntentTooltip(lineNum: number, event: MouseEvent) {
    const intentIds = this.lineIntentMap.get(lineNum) || []
    console.log('[code-viewer] showIntentTooltip called:', lineNum,
      'lineIntentMap size:', this.lineIntentMap.size,
      'intentIds for line:', intentIds,
      'fileIntents count:', this.fileIntents.length,
      'fileIntents:', this.fileIntents.map(i => i.id))
    const intents = this.getIntentsForLine(lineNum)
    console.log('[code-viewer] intents for line:', lineNum, intents.length, intents)
    if (intents.length === 0) return

    this.hoveredIntentLine = lineNum
    this.intentTooltipPosition = {
      x: event.clientX + 10,
      y: event.clientY + 10,
    }
    console.log('[code-viewer] Set hoveredIntentLine to:', this.hoveredIntentLine)
  }

  /**
   * Hide intent tooltip
   */
  private hideIntentTooltip() {
		console.log('HIDING TOOLTIP')
    this.hoveredIntentLine = null
  }

  /**
   * Load translation scope from backend settings
   */
  private async loadTranslationScope() {
    try {
      const response = await sendIPCRequest(this, 'i18n', 'get-settings', {})
      if (response?.translationScope) {
        this.translationScope = {
          comments: response.translationScope.comments ?? true,
          stringLiterals: response.translationScope.stringLiterals ?? true,
          identifiers: response.translationScope.identifiers ?? true,
          keywords: response.translationScope.keywords ?? false,
          punctuation: response.translationScope.punctuation ?? false,
          markdownFiles: response.translationScope.markdownFiles ?? false,
        }
        console.log('[code-viewer] Loaded translationScope:', this.translationScope)
      }
    } catch (err) {
      console.error('[code-viewer] Failed to load translation scope:', err)
    }
  }

  /**
   * Translate the current code
   */
  private async translateCode() {
    if (!this.originalCode) return

    // Cancel any in-flight translation before starting a new one
    if (this.translateAbortController) {
      this.translateAbortController.abort()
    }
    this.translateAbortController = new AbortController()
    const { signal } = this.translateAbortController

    // Wait for scope to finish loading if still pending
    if (!this.translationScope && this.translationScopePromise) {
      await this.translationScopePromise
    }

    if (signal.aborted) return

    if (!this.translationScope) {
      console.error('[code-viewer] Cannot translate: translationScope not loaded. Configure scope in Settings.')
      this.error = 'Translation scope not configured. Please check Settings.'
      return
    }

    this.isTranslating = true
    console.log('[code-viewer] Translating to:', this.targetLanguage)

    try {
      const response = await sendIPCRequest(this, 'i18n', 'translate-code', {
        code: this.originalCode,
        filePath: this.selectedFile,
        targetLang: this.targetLanguage,
        origin: this.origin,
        projectRoot: this.loadedProjectRoot || this.projectRoot,
        translationScope: this.translationScope,
      }, signal)

      if (signal.aborted) return

      this.translatedCode = response?.code || this.originalCode
      console.log('[code-viewer] Translation complete')
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.error('[code-viewer] Translation failed:', err)
      this.error = `Translation failed: ${err.message || 'Unknown error'}`
    } finally {
      if (!signal.aborted) {
        this.isTranslating = false
      }
    }
  }

  /**
   * Handle language selection change
   */
  private async onLanguageChange(event: Event) {
    const select = event.target as HTMLSelectElement
    this.targetLanguage = select.value
    this.emitStateChange()

    if (this.originalCode) {
      if (this.targetLanguage === 'en') {
        this.translatedCode = this.originalCode
      } else {
        await this.translateCode()
      }
    }
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'tsx',
      'js': 'javascript',
      'jsx': 'jsx',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'vue': 'markup',
      'html': 'markup',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
    }
    return langMap[ext || ''] || 'plaintext'
  }

  /**
   * Apply Prism.js syntax highlighting
   */
  private highlightCode(code: string): string {
    if (!code) return ''

    const Prism = (window as any).Prism
    if (!Prism) {
      console.warn('[code-viewer] Prism not loaded, returning plain code')
      return this.escapeHtml(code)
    }

    const grammar = Prism.languages[this.codeLanguage] || Prism.languages.plaintext
    if (!grammar) {
      return this.escapeHtml(code)
    }

    try {
      return Prism.highlight(code, grammar, this.codeLanguage)
    } catch (err) {
      console.error('[code-viewer] Prism highlight error:', err)
      return this.escapeHtml(code)
    }
  }

  /**
   * Get highlighted code split into lines
   * Returns array of HTML strings, one per line
   */
  private getHighlightedLines(code: string): string[] {
    if (!code) return []

    const highlighted = this.highlightCode(code)
    // Split by newline, preserving empty lines
    return highlighted.split('\n')
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * Get line count for line numbers
   */
  private getLineCount(code: string): number {
    if (!code) return 0
    return code.split('\n').length
  }

  /**
   * Get file icon based on extension
   */
  private getFileIcon(path: string, isDirectory: boolean): string {
    if (isDirectory) {
      return '📁'
    }
    const ext = path.split('.').pop()?.toLowerCase()
    const icons: Record<string, string> = {
      'ts': '📘',
      'tsx': '⚛️',
      'js': '📒',
      'jsx': '⚛️',
      'py': '🐍',
      'rs': '🦀',
      'go': '🐹',
      'java': '☕',
      'vue': '💚',
      'html': '🌐',
      'css': '🎨',
      'scss': '🎨',
      'json': '📋',
      'md': '📝',
      'yaml': '⚙️',
      'yml': '⚙️',
    }
    return icons[ext || ''] || '📄'
  }

  /**
   * Get intent count for a file path (from cached counts)
   */
  private getIntentCountForPath(filePath: string): number {
    return this.fileIntentCounts.get(filePath) || 0
  }

  /**
   * Render intent indicators for a line
   */
  private renderIntentIndicators(lineNum: number): TemplateResult | typeof nothing {
    const intentIds = this.lineIntentMap.get(lineNum) || []
    if (intentIds.length === 0) return nothing

    // Show up to 3 dots, then "+N"
    const dots = intentIds.slice(0, 3).map((id) => {
      const intent = this.fileIntents.find(i => i.id === id)
      const color = this.getIntentColor(intent?.templateType || 'feature')
      return html`<span class="intent-dot" style="background: ${color}"></span>`
    })

    const overflow = intentIds.length > 3
      ? html`<span class="intent-overflow">+${intentIds.length - 3}</span>`
      : nothing

    return html`${dots}${overflow}`
  }

  /**
   * Render the intent tooltip
   */
  private renderIntentTooltip(): TemplateResult | typeof nothing {
    console.log('RENDER INTENT TOOLTIP', this.hoveredIntentLine)
    if (this.hoveredIntentLine === null) return nothing

    const intents = this.getIntentsForLine(this.hoveredIntentLine)
    console.log('RENDER INTENT TOOLTIP', this.hoveredIntentLine, intents.length, this.intentTooltipPosition)
    if (intents.length === 0) return nothing

    return html`
      <div
        class="intent-tooltip"
        style="left: ${this.intentTooltipPosition.x}px; top: ${this.intentTooltipPosition.y}px;"
      >
        ${intents.length > 1 ? html`
          <div class="tooltip-header">
            ${intents.length} intents on this line
          </div>
        ` : nothing}
        ${intents.map(intent => html`
          <div class="intent-card">
            <div class="intent-header">
              <span class="template-badge ${intent.templateType}">
                ${intent.templateType}
              </span>
              <span class="intent-author">${intent.author}</span>
            </div>
            <div class="intent-title">${intent.title}</div>
            ${intent.description ? html`
              <div class="intent-description">${intent.description}</div>
            ` : nothing}
          </div>
        `)}
      </div>
    `
  }

  /**
   * Render a single tree node
   */
  private renderTreeNode(node: FileTreeNode, depth: number): TemplateResult {
    const isExpanded = this.expandedPaths.has(node.path)
    const isSelected = this.selectedFile === node.path
    const intentCount = this.getIntentCountForPath(node.path)

    return html`
      <div class="tree-node">
        <div
          class="tree-item ${node.isDirectory ? 'directory' : ''} ${isSelected ? 'selected' : ''}"
          style="--depth: ${depth}"
          @click=${() => node.isDirectory ? this.toggleFolder(node.path) : this.selectFile(node.path)}
        >
          <span class="expand-icon ${isExpanded ? 'expanded' : ''} ${!node.isDirectory ? 'hidden' : ''}">▶</span>
          <span class="file-icon">${this.getFileIcon(node.path, node.isDirectory)}</span>
          <span class="file-name">${node.name}</span>
          ${!node.isDirectory && intentCount > 0 ? html`
            <span class="intent-badge">${intentCount}</span>
          ` : ''}
        </div>
        ${node.isDirectory && node.children.length > 0 ? html`
          <div class="tree-children ${isExpanded ? 'expanded' : ''}">
            ${node.children.map(child => this.renderTreeNode(child, depth + 1))}
          </div>
        ` : ''}
      </div>
    `
  }

  render() {
    const displayCode = this.translatedCode || this.originalCode
    const lineCount = this.getLineCount(displayCode)

    return html`
      <div class="sidebar">
        <div class="sidebar-header">Explorer</div>
        <div class="file-tree">
          ${this.fileTreeLoading ? html`
            <div class="sidebar-loading">
              <div class="spinner"></div>
              <div class="loading-text">Loading files...</div>
              ${this.syncStatus ? html`
                <div class="sync-status">${this.syncStatus}</div>
              ` : ''}
            </div>
          ` : this.fileTree.length === 0 ? html`
            <div class="empty-state" style="padding: 16px;">
              <div class="empty-state-text" style="font-size: 12px;">
                ${this.projectRoot ? 'No files found' : 'Open a project to browse files'}
              </div>
            </div>
          ` : this.fileTree.map(node => this.renderTreeNode(node, 0))}
        </div>
      </div>

      <div class="main-content">
        <div class="toolbar">
          <div class="toolbar-section">
            <span class="toolbar-label">Translate to:</span>
            <select
              class="language-select"
              @change=${this.onLanguageChange}
              .value=${this.targetLanguage}
            >
              ${this.supportedLanguages.map(lang => html`
                <option value=${lang.code} ?selected=${lang.code === this.targetLanguage}>
                  ${lang.name}
                </option>
              `)}
            </select>
          </div>

          <div class="file-path">
            ${this.selectedFile || 'No file selected'}
          </div>

          ${this.isTranslating ? html`
            <div class="translating-indicator">
              <div class="spinner"></div>
              <span>Translating...</span>
            </div>
          ` : ''}
        </div>

        <div class="code-container">
          ${this.isLoading ? html`
            <div class="loading">
              <div class="spinner"></div>
              <span>Loading file...</span>
            </div>
          ` : this.error ? html`
            <div class="empty-state">
              <div class="empty-state-icon">⚠️</div>
              <div class="empty-state-text">${this.error}</div>
            </div>
          ` : !this.selectedFile ? html`
            <div class="empty-state">
              <div class="empty-state-icon">📂</div>
              <div class="empty-state-text">
                Select a file from the sidebar to view translated code
              </div>
            </div>
          ` : html`
            ${this.intentsLoading ? html`
              <div class="intent-loading-indicator">
                <div class="mini-spinner"></div>
                <span>Loading intents...</span>
              </div>
            ` : nothing}
            <div class="code-table">
              ${this.getHighlightedLines(displayCode).map((lineHtml, i) => {
                const lineNum = i + 1
                const hasIntent = this.getLineIntentCount(lineNum) > 0
                return html`
                  <div class="code-line">
                    <div
                      class="line-number-cell ${hasIntent ? 'has-intent' : ''}"
                      @mouseenter=${(e: MouseEvent) => this.showIntentTooltip(lineNum, e)}
                      @mouseleave=${this.hideIntentTooltip}
                    >
                      <div class="line-number-inner"
                      @mouseenter=${(e: MouseEvent) => this.showIntentTooltip(lineNum, e)}
                      @mouseleave=${this.hideIntentTooltip}
											>
                        <span class="intent-indicators">${this.renderIntentIndicators(lineNum)}</span>
                        <span class="line-num-text">${lineNum}</span>
                      </div>
                    </div>
                    <div class="code-cell language-${this.codeLanguage}">${unsafeHTML(lineHtml || '&nbsp;')}</div>
                  </div>
                `
              })}
            </div>
          `}
        </div>
      </div>
      ${this.renderIntentTooltip()}
    `
  }
}
