/**
 * i18n Settings Web Component
 *
 * Provides translation scope configuration:
 * - Preset selector (quick/comprehensive/full)
 * - Individual scope checkboxes (comments, strings, identifiers, keywords)
 *
 * Built with Lit and uses Shadow DOM for style isolation.
 * Supports multiple languages via kawa-language-changed events from Muninn.
 */

import { LitElement, html, css } from 'lit'
import { property, state } from 'lit/decorators.js'
import { sendIPCRequest, setupIPCListener, cleanupIPCListener } from './ipc-bridge'

// Translation scope interface
interface TranslationScope {
  comments: boolean
  stringLiterals: boolean
  identifiers: boolean
  keywords: boolean
  punctuation: boolean
  markdownFiles: boolean
}

type TranslationPreset = 'quick' | 'comprehensive' | 'full' | 'custom'

// Preset definitions (markdownFiles is always false in presets - it's an independent opt-in)
const PRESET_DEFINITIONS: Record<Exclude<TranslationPreset, 'custom'>, TranslationScope> = {
  quick:         { comments: true,  stringLiterals: true,  identifiers: false, keywords: false, punctuation: false, markdownFiles: false },
  comprehensive: { comments: true,  stringLiterals: true,  identifiers: true,  keywords: false, punctuation: false, markdownFiles: false },
  full:          { comments: true,  stringLiterals: true,  identifiers: true,  keywords: true,  punctuation: true,  markdownFiles: false },
}

// UI translations
type SupportedLanguage = 'en' | 'ja' | 'de' | 'he' | 'zh' | 'ko' | 'ru' | 'ar'

interface Translations {
  description: string
  preset: string
  quick: string
  comprehensive: string
  fullImmersion: string
  comments: string
  commentsHint: string
  stringLiterals: string
  stringLiteralsHint: string
  identifiers: string
  identifiersHint: string
  keywords: string
  keywordsHint: string
  punctuation: string
  punctuationHint: string
  markdownFiles: string
  markdownFilesHint: string
  loading: string
}

const TRANSLATIONS: Record<SupportedLanguage, Translations> = {
  en: {
    description: 'Control what gets translated when viewing code in your preferred language.',
    preset: 'Preset',
    quick: 'Quick',
    comprehensive: 'Comprehensive',
    fullImmersion: 'Full Immersion',
    comments: 'Comments',
    commentsHint: 'Translate code comments',
    stringLiterals: 'String Literals',
    stringLiteralsHint: 'Translate user-facing text in quotes',
    identifiers: 'Identifiers',
    identifiersHint: 'Translate variable and function names',
    keywords: 'Reserved Keywords',
    keywordsHint: 'Translate const, let, function, if, else, etc.',
    punctuation: 'Punctuation',
    punctuationHint: 'Replace ASCII punctuation with full-width characters (asian languages)',
    markdownFiles: 'Markdown Files',
    markdownFilesHint: 'Translate README and documentation (.md files) during project scan',
    loading: 'Loading settings...',
  },
  ja: {
    description: 'コードを希望の言語で表示する際に翻訳される内容を制御します。',
    preset: 'プリセット',
    quick: 'クイック',
    comprehensive: '包括的',
    fullImmersion: 'フルイマージョン',
    comments: 'コメント',
    commentsHint: 'コードのコメントを翻訳',
    stringLiterals: '文字列リテラル',
    stringLiteralsHint: '引用符内のユーザー向けテキストを翻訳',
    identifiers: '識別子',
    identifiersHint: '変数名と関数名を翻訳',
    keywords: '予約キーワード',
    keywordsHint: 'const、let、function、if、else などを翻訳',
    punctuation: '句読点',
    punctuationHint: 'ASCII句読点を全角文字に置換',
    markdownFiles: 'Markdownファイル',
    markdownFilesHint: 'プロジェクトスキャン時にREADMEやドキュメント（.mdファイル）を翻訳',
    loading: '設定を読み込み中...',
  },
  de: {
    description: 'Steuern Sie, was übersetzt wird, wenn Sie Code in Ihrer bevorzugten Sprache anzeigen.',
    preset: 'Voreinstellung',
    quick: 'Schnell',
    comprehensive: 'Umfassend',
    fullImmersion: 'Vollständig',
    comments: 'Kommentare',
    commentsHint: 'Code-Kommentare übersetzen',
    stringLiterals: 'String-Literale',
    stringLiteralsHint: 'Benutzertext in Anführungszeichen übersetzen',
    identifiers: 'Bezeichner',
    identifiersHint: 'Variablen- und Funktionsnamen übersetzen',
    keywords: 'Reservierte Schlüsselwörter',
    keywordsHint: 'const, let, function, if, else usw. übersetzen',
    punctuation: 'Satzzeichen',
    punctuationHint: 'ASCII-Satzzeichen durch Vollbreite-Zeichen ersetzen',
    markdownFiles: 'Markdown-Dateien',
    markdownFilesHint: 'README und Dokumentation (.md-Dateien) beim Projekt-Scan übersetzen',
    loading: 'Einstellungen werden geladen...',
  },
  he: {
    description: 'שלוט במה שמתורגם בעת צפייה בקוד בשפה המועדפת עליך.',
    preset: 'הגדרה מוגדרת מראש',
    quick: 'מהיר',
    comprehensive: 'מקיף',
    fullImmersion: 'מלא',
    comments: 'הערות',
    commentsHint: 'תרגם הערות קוד',
    stringLiterals: 'מחרוזות',
    stringLiteralsHint: 'תרגם טקסט למשתמש במירכאות',
    identifiers: 'מזהים',
    identifiersHint: 'תרגם שמות משתנים ופונקציות',
    keywords: 'מילות מפתח שמורות',
    keywordsHint: 'תרגם const, let, function, if, else וכו׳',
    punctuation: 'סימני פיסוק',
    punctuationHint: 'החלף סימני פיסוק ASCII בתווים ברוחב מלא',
    markdownFiles: 'קבצי Markdown',
    markdownFilesHint: 'תרגם README ותיעוד (קבצי .md) בסריקת פרויקט',
    loading: 'טוען הגדרות...',
  },
  zh: {
    description: '控制以首选语言查看代码时翻译的内容。',
    preset: '预设',
    quick: '快速',
    comprehensive: '全面',
    fullImmersion: '完全沉浸',
    comments: '注释',
    commentsHint: '翻译代码注释',
    stringLiterals: '字符串字面量',
    stringLiteralsHint: '翻译引号内的用户文本',
    identifiers: '标识符',
    identifiersHint: '翻译变量名和函数名',
    keywords: '保留关键字',
    keywordsHint: '翻译 const、let、function、if、else 等',
    punctuation: '标点符号',
    punctuationHint: '将ASCII标点替换为全角字符',
    markdownFiles: 'Markdown 文件',
    markdownFilesHint: '在项目扫描时翻译 README 和文档（.md 文件）',
    loading: '正在加载设置...',
  },
  ko: {
    description: '선호하는 언어로 코드를 볼 때 번역되는 내용을 제어합니다.',
    preset: '프리셋',
    quick: '빠른',
    comprehensive: '포괄적',
    fullImmersion: '완전 몰입',
    comments: '주석',
    commentsHint: '코드 주석 번역',
    stringLiterals: '문자열 리터럴',
    stringLiteralsHint: '따옴표 안의 사용자 텍스트 번역',
    identifiers: '식별자',
    identifiersHint: '변수명과 함수명 번역',
    keywords: '예약 키워드',
    keywordsHint: 'const, let, function, if, else 등 번역',
    punctuation: '구두점',
    punctuationHint: 'ASCII 구두점을 전각 문자로 교체',
    markdownFiles: 'Markdown 파일',
    markdownFilesHint: '프로젝트 스캔 시 README 및 문서(.md 파일) 번역',
    loading: '설정 로드 중...',
  },
  ru: {
    description: 'Управляйте тем, что переводится при просмотре кода на предпочитаемом языке.',
    preset: 'Пресет',
    quick: 'Быстрый',
    comprehensive: 'Комплексный',
    fullImmersion: 'Полное погружение',
    comments: 'Комментарии',
    commentsHint: 'Переводить комментарии в коде',
    stringLiterals: 'Строковые литералы',
    stringLiteralsHint: 'Переводить текст в кавычках',
    identifiers: 'Идентификаторы',
    identifiersHint: 'Переводить имена переменных и функций',
    keywords: 'Зарезервированные ключевые слова',
    keywordsHint: 'Переводить const, let, function, if, else и т.д.',
    punctuation: 'Знаки препинания',
    punctuationHint: 'Заменить ASCII-знаки на полноширинные символы',
    markdownFiles: 'Файлы Markdown',
    markdownFilesHint: 'Переводить README и документацию (.md файлы) при сканировании проекта',
    loading: 'Загрузка настроек...',
  },
  ar: {
    description: 'تحكم فيما يتم ترجمته عند عرض الكود بلغتك المفضلة.',
    preset: 'إعداد مسبق',
    quick: 'سريع',
    comprehensive: 'شامل',
    fullImmersion: 'انغماس كامل',
    comments: 'التعليقات',
    commentsHint: 'ترجمة تعليقات الكود',
    stringLiterals: 'النصوص الحرفية',
    stringLiteralsHint: 'ترجمة النص بين علامات الاقتباس',
    identifiers: 'المعرّفات',
    identifiersHint: 'ترجمة أسماء المتغيرات والدوال',
    keywords: 'الكلمات المحجوزة',
    keywordsHint: 'ترجمة const، let، function، if، else، إلخ.',
    punctuation: 'علامات الترقيم',
    punctuationHint: 'استبدال علامات الترقيم ASCII بأحرف كاملة العرض',
    markdownFiles: 'ملفات Markdown',
    markdownFilesHint: 'ترجمة README والتوثيق (ملفات .md) أثناء فحص المشروع',
    loading: 'جارٍ تحميل الإعدادات...',
  },
}

// Convert scope to preset name
// Note: markdownFiles is ignored for preset matching since it's an independent option
function scopeToPreset(scope: TranslationScope): TranslationPreset {
  for (const [preset, def] of Object.entries(PRESET_DEFINITIONS) as [Exclude<TranslationPreset, 'custom'>, TranslationScope][]) {
    if (
      scope.comments === def.comments &&
      scope.stringLiterals === def.stringLiterals &&
      scope.identifiers === def.identifiers &&
      scope.keywords === def.keywords &&
      scope.punctuation === def.punctuation
      // markdownFiles intentionally excluded - it's independent of presets
    ) {
      return preset
    }
  }
  return 'custom'
}

export class I18nSettings extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      color: var(--text-color, #e0e0e0);
    }

    .settings-container {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .description {
      color: var(--text-color-secondary, #a0a0a0);
      font-size: 0.85rem;
      margin: 0;
      line-height: 1.4;
    }

    .preset-section {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .section-label {
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--text-color-secondary, #a0a0a0);
    }

    .preset-buttons {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .preset-btn {
      padding: 0.5rem 1rem;
      border: 1px solid var(--surface-border, #3f3f3f);
      border-radius: 4px;
      background: var(--surface-card, #2a2a2a);
      color: var(--text-color, #e0e0e0);
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .preset-btn:hover {
      background: var(--surface-hover, #3a3a3a);
      border-color: var(--primary-color, #6366f1);
    }

    .preset-btn.active {
      background: var(--primary-color, #6366f1);
      border-color: var(--primary-color, #6366f1);
      color: white;
    }

    .scope-section {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .scope-item {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .checkbox-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .checkbox-wrapper input {
      position: absolute;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
      margin: 0;
    }

    .checkbox-visual {
      width: 18px;
      height: 18px;
      border: 2px solid var(--surface-border, #3f3f3f);
      border-radius: 3px;
      background: var(--surface-card, #2a2a2a);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .checkbox-wrapper input:checked + .checkbox-visual {
      background: var(--primary-color, #6366f1);
      border-color: var(--primary-color, #6366f1);
    }

    .checkbox-wrapper input:focus + .checkbox-visual {
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3);
    }

    .checkmark {
      display: none;
      width: 10px;
      height: 10px;
    }

    .checkbox-wrapper input:checked + .checkbox-visual .checkmark {
      display: block;
    }

    .scope-label {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      cursor: pointer;
    }

    .scope-label .label-text {
      font-size: 0.9rem;
      color: var(--text-color, #e0e0e0);
    }

    .scope-label .hint {
      font-size: 0.75rem;
      color: var(--text-color-secondary, #a0a0a0);
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-color-secondary, #a0a0a0);
      font-size: 0.85rem;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--surface-border, #3f3f3f);
      border-top-color: var(--primary-color, #6366f1);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error {
      color: var(--red-500, #ef4444);
      font-size: 0.85rem;
    }
  `

  @state()
  private loading = true

  @state()
  private error: string | null = null

  @state()
  private scope: TranslationScope = { ...PRESET_DEFINITIONS.comprehensive }

  @state()
  private saving = false

  @state()
  private uiLang: SupportedLanguage = 'en'

  private boundLanguageHandler = this.handleLanguageChange.bind(this)

  connectedCallback() {
    super.connectedCallback()
    setupIPCListener(this)
    this.addEventListener('kawa-language-changed', this.boundLanguageHandler)
    this.loadSettings()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    cleanupIPCListener(this)
    this.removeEventListener('kawa-language-changed', this.boundLanguageHandler)
  }

  private handleLanguageChange(event: Event) {
    const customEvent = event as CustomEvent
    const newLang = customEvent.detail?.language as string
    if (newLang && ['en', 'ja', 'de', 'he', 'zh', 'ko', 'ru', 'ar'].includes(newLang)) {
      this.uiLang = newLang as SupportedLanguage
    }
  }

  private get t(): Translations {
    return TRANSLATIONS[this.uiLang] || TRANSLATIONS.en
  }

  private async loadSettings() {
    try {
      this.loading = true
      this.error = null

      const response = await sendIPCRequest(this, 'i18n', 'get-settings', {})

      if (response?.translationScope) {
        this.scope = {
          comments: response.translationScope.comments ?? true,
          stringLiterals: response.translationScope.stringLiterals ?? true,
          identifiers: response.translationScope.identifiers ?? true,
          keywords: response.translationScope.keywords ?? false,
          punctuation: response.translationScope.punctuation ?? false,
          markdownFiles: response.translationScope.markdownFiles ?? false,
        }
      }
    } catch (e) {
      console.error('[i18n-settings] Failed to load settings:', e)
      // Use defaults on error
      this.scope = { ...PRESET_DEFINITIONS.comprehensive, punctuation: false, markdownFiles: false }
    } finally {
      this.loading = false
    }
  }

  private async saveSettings() {
    try {
      this.saving = true
      await sendIPCRequest(this, 'i18n', 'set-settings', {
        translationScope: this.scope
      })
    } catch (e) {
      console.error('[i18n-settings] Failed to save settings:', e)
      this.error = 'Failed to save settings'
    } finally {
      this.saving = false
    }
  }

  private onPresetSelect(preset: Exclude<TranslationPreset, 'custom'>) {
    // Preserve markdownFiles setting when changing presets (it's independent)
    this.scope = { ...PRESET_DEFINITIONS[preset], markdownFiles: this.scope.markdownFiles }
    this.saveSettings()
  }

  private onScopeChange(field: keyof TranslationScope, checked: boolean) {
    this.scope = { ...this.scope, [field]: checked }
    this.saveSettings()
  }

  private get activePreset(): TranslationPreset {
    return scopeToPreset(this.scope)
  }

  render() {
    if (this.loading) {
      return html`
        <div class="loading">
          <div class="spinner"></div>
          <span>${this.t.loading}</span>
        </div>
      `
    }

    const preset = this.activePreset

    return html`
      <div class="settings-container">
        <p class="description">
          ${this.t.description}
        </p>

        <div class="preset-section">
          <span class="section-label">${this.t.preset}</span>
          <div class="preset-buttons">
            <button
              class="preset-btn ${preset === 'quick' ? 'active' : ''}"
              @click=${() => this.onPresetSelect('quick')}
              ?disabled=${this.saving}
            >
              ${this.t.quick}
            </button>
            <button
              class="preset-btn ${preset === 'comprehensive' ? 'active' : ''}"
              @click=${() => this.onPresetSelect('comprehensive')}
              ?disabled=${this.saving}
            >
              ${this.t.comprehensive}
            </button>
            <button
              class="preset-btn ${preset === 'full' ? 'active' : ''}"
              @click=${() => this.onPresetSelect('full')}
              ?disabled=${this.saving}
            >
              ${this.t.fullImmersion}
            </button>
          </div>
        </div>

        <div class="scope-section">
          ${this.renderScopeItem('comments', this.t.comments, this.t.commentsHint)}
          ${this.renderScopeItem('stringLiterals', this.t.stringLiterals, this.t.stringLiteralsHint)}
          ${this.renderScopeItem('identifiers', this.t.identifiers, this.t.identifiersHint)}
          ${this.renderScopeItem('keywords', this.t.keywords, this.t.keywordsHint)}
          ${this.renderScopeItem('punctuation', this.t.punctuation, this.t.punctuationHint)}
          ${this.renderScopeItem('markdownFiles', this.t.markdownFiles, this.t.markdownFilesHint)}
        </div>

        ${this.error ? html`<p class="error">${this.error}</p>` : ''}
      </div>
    `
  }

  private renderScopeItem(field: keyof TranslationScope, label: string, hint: string) {
    const id = `scope-${field}`
    return html`
      <div class="scope-item">
        <label class="checkbox-wrapper">
          <input
            type="checkbox"
            id=${id}
            .checked=${this.scope[field]}
            @change=${(e: Event) => this.onScopeChange(field, (e.target as HTMLInputElement).checked)}
            ?disabled=${this.saving}
          />
          <div class="checkbox-visual">
            <svg class="checkmark" viewBox="0 0 10 10" fill="none">
              <path d="M1 5L4 8L9 2" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </label>
        <label class="scope-label" for=${id}>
          <span class="label-text">${label}</span>
          <span class="hint">${hint}</span>
        </label>
      </div>
    `
  }
}
