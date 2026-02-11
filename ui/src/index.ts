/**
 * i18n Extension UI - Web Components Entry Point
 *
 * This module registers all custom elements for the i18n extension.
 * Components are built with Lit and use Shadow DOM for style isolation.
 */

// Import components
import { I18nCodeViewer } from './code-viewer'
import { I18nSettings } from './settings'

// Import Prism.js core
import Prism from 'prismjs'

// Import Prism language components
// These need to be imported after the core
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-scss'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-markup'

// Make Prism available globally for components
;(window as any).Prism = Prism

// Register custom elements with the browser
// The tag name must match what's declared in extension.json screens[].id
// Muninn will look for: <{extensionId}-{screenId}> = <i18n-code-viewer>
if (!customElements.get('i18n-code-viewer')) {
  customElements.define('i18n-code-viewer', I18nCodeViewer)
  console.log('[i18n-ui] Registered custom element: i18n-code-viewer')
} else {
  console.log('[i18n-ui] Custom element already registered: i18n-code-viewer')
}

// Register settings component for the Settings page
// The tag name matches what's declared in extension.json ui.settings.webComponent
if (!customElements.get('i18n-settings')) {
  customElements.define('i18n-settings', I18nSettings)
  console.log('[i18n-ui] Registered custom element: i18n-settings')
} else {
  console.log('[i18n-ui] Custom element already registered: i18n-settings')
}

// Export for potential direct usage
export { I18nCodeViewer, I18nSettings }

console.log('[i18n-ui] Extension UI initialized')
