# i18n Extension Events Registration

## Overview

The kawa.i18n extension uses **domain-based routing** as documented in `kawa.dev-doc/EXTENSIBILITY.md:137`. Extensions explicitly register domains they handle via the `extension.json` manifest.

---

## How Extensions Register Domains

### 1. **Explicit Domain Registration**

Extensions register domains they want to handle in `extension.json`:

```json
{
  "id": "i18n",
  "name": "Internationalization",
  "version": "1.0.0",
  "domains": {
    "subscribe": ["i18n"]
  }
}
```

Muninn builds a **routing table** from all registered extensions:

```
code               → gardener
repo               → gardener
auth               → gardener
i18n               → i18n-extension
extension-progress → [Muninn UI Progress Handler]
*                  → [all extensions] (broadcast)
```

### 2. **Dual Domain Usage**

The i18n extension uses **TWO domains**:

#### Domain 1: `i18n` (Request Handling)
- **Purpose**: Handle incoming requests from VSCode/Muninn
- **Flow**: `req` → `res` or `err`
- **Registration**: Listed in `domains.subscribe` in manifest
- **Examples**: translate-code, load-dictionary, add-terms

```typescript
// Request from VSCode
{
  flow: 'req',
  domain: 'i18n',              // Routes to i18n extension
  action: 'translate-code',
  caw: 'vscode-1',
  data: { code, filePath, targetLang, origin }
}

// Response from i18n extension
{
  flow: 'res',
  domain: 'i18n',
  action: 'translate-code',
  caw: 'vscode-1',
  data: { success: true, code: '...', translatedTokens: [...] }
}
```

#### Domain 2: `extension-progress` (Progress Broadcasting)
- **Purpose**: Send progress updates to Muninn UI
- **Flow**: `brdc` (broadcast, no response expected)
- **Registration**: Built-in Muninn handler, no registration needed
- **Examples**: Task started, progress updates, completion

```typescript
// Broadcast from i18n extension
{
  flow: 'brdc',
  domain: 'extension-progress',  // Routes to Muninn UI progress handler
  action: 'started' | 'progress' | 'complete' | 'error',
  caw: '0',                       // Always '0' for Muninn
  data: {
    extensionId: 'i18n',          // Identifies which extension
    taskId: string,               // Unique task ID
    title: string,                // Task title
    status: string,               // Current status
    statusMessage?: string,       // Optional message
    progress?: number,            // Optional progress %
    // ... other optional fields
  }
}
```

---

## How It Works

### Step 1: Extension Manifest Declares Domains

**File**: `extension.json`

```json
{
  "id": "i18n",
  "name": "Internationalization",
  "version": "1.0.0",
  "domains": {
    "subscribe": ["i18n"]
  }
}
```

**Key Points**:
- `domains.subscribe` lists domains this extension **handles**
- When Muninn receives a message with `domain: 'i18n'`, it routes to this extension
- The `extension-progress` domain is a **built-in Muninn handler** - no registration needed

---

### Step 2: Muninn Builds Routing Table

When Muninn starts:
1. Scans `~/.kawa-code/extensions/` directory
2. Reads each `extension.json` manifest
3. Builds routing table from `domains.subscribe` arrays
4. Spawns extension processes

**Routing Table Example**:
```
i18n               → i18n extension binary
extension-progress → Muninn UI Progress Handler (built-in)
gardener           → gardener sidecar (built-in)
```

**Result**: When a message arrives with `domain: 'i18n'`, Muninn routes it to the i18n extension.

---

### Step 3: Extension Handles Requests (Domain: `i18n`)

**File**: `src/index.ts`

When a request arrives with `domain: 'i18n'`, the extension handles it:

```typescript
async function handleMessage(message: IPCMessage): Promise<void> {
  if (message.domain !== 'i18n') return; // Only handle 'i18n' domain

  switch (message.action) {
    case 'translate-code':
      const result = await handleTranslateCode(message);
      sendResponse(message, result);
      break;
    case 'load-dictionary':
      const dict = await handleLoadDictionary(message);
      sendResponse(message, dict);
      break;
    // ... other actions
  }
}
```

### Step 4: Extension Sends Progress Updates (Domain: `extension-progress`)

**File**: `src/ipc/protocol.ts`

While processing a request, the extension broadcasts progress to Muninn UI:

```typescript
export function sendProgress(
  taskId: string,
  taskName: string,
  action: 'started' | 'progress' | 'complete' | 'error',
  details: {
    status: 'scanning' | 'processing' | 'uploading' | 'downloading' | 'complete' | 'error';
    statusMessage?: string;
    progress?: number;
    // ... other fields
  }
): void {
  const message = {
    flow: 'brdc',
    domain: 'extension-progress',  // Routes to Muninn UI Progress Handler
    action,
    caw: '0',
    data: {
      extensionId: 'i18n',         // Identifies this extension
      taskId,
      title: taskName,
      ...details,
    },
  };

  process.stdout.write(JSON.stringify(message) + '\n');
}
```

---

### Step 5: Muninn Routes Messages

**Muninn IPC Router** (Rust → Extension or UI)

#### For Request Messages (`domain: 'i18n'`):
1. Muninn receives message from VSCode with `domain: 'i18n'`
2. Looks up routing table: `i18n → i18n extension`
3. Routes message to i18n extension via STDIN
4. Extension processes and sends response
5. Muninn routes response back to VSCode

#### For Broadcast Messages (`domain: 'extension-progress'`):
1. Extension sends broadcast via STDOUT with `domain: 'extension-progress'`
2. Muninn sees `domain: 'extension-progress'`
3. Routes to **Progress Store** (Vue.js UI component)
4. **Progress Store** identifies extension by `extensionId: 'i18n'`
5. **Progress UI Component** displays notification in Muninn UI

---

## Complete Message Flow Diagram

### Flow 1: VSCode Request → i18n Extension (Domain: `i18n`)

```
┌─────────────┐
│   VSCode    │
└──────┬──────┘
       │ 1. Request: translate-code
       │    domain: 'i18n'
       │    action: 'translate-code'
       │    flow: 'req'
       ↓
┌──────────────────┐
│ Muninn IPC Router│
└────────┬─────────┘
         │ 2. Routing table lookup
         │    'i18n' → i18n extension
         ↓
┌──────────────────┐
│  i18n Extension  │
│   (STDIN)        │
└────────┬─────────┘
         │ 3. Process translation
         │ 4. Send response
         │    domain: 'i18n'
         │    flow: 'res'
         ↓
┌──────────────────┐
│ Muninn IPC Router│
└────────┬─────────┘
         │ 5. Route response back
         ↓
┌─────────────┐
│   VSCode    │ ← Receives translated code
└─────────────┘
```

### Flow 2: i18n Extension → Muninn UI (Domain: `extension-progress`)

```
┌──────────────────┐
│  i18n Extension  │
│   (STDOUT)       │
└────────┬─────────┘
         │ 1. Broadcast progress
         │    domain: 'extension-progress'
         │    action: 'started'
         │    flow: 'brdc'
         │    data: {
         │      extensionId: 'i18n',
         │      taskId: 'translate-ja-123',
         │      title: 'Code Translation'
         │    }
         ↓
┌──────────────────┐
│ Muninn IPC Router│
└────────┬─────────┘
         │ 2. Routing table lookup
         │    'extension-progress' → UI Progress Handler
         ↓
┌──────────────────┐
│  Progress Store  │
│    (Vue.js)      │
└────────┬─────────┘
         │ 3. Identify extension: 'i18n'
         │ 4. Update task map
         ↓
┌──────────────────┐
│   Progress UI    │
│  Component       │
└──────────────────┘
         │ 5. Display notification
         ↓
    ┌─────────────────────────────────┐
    │ 🔄 Code Translation             │
    │ Translating to JA...            │
    └─────────────────────────────────┘
```

---

## Benefits of This Design

### 1. **Domain-Based Routing**
- Clear separation of concerns: each extension owns its domain
- Muninn automatically routes messages based on domain
- No collision between extensions (each has unique domain)

### 2. **Dual Domain Pattern**
- **Custom domain** (`i18n`): Handle requests specific to this extension
- **Standard domain** (`extension-progress`): Universal progress UI for all extensions
- Best of both worlds: custom functionality + standard UI

### 3. **Explicit Registration**
- `domains.subscribe` clearly declares what the extension handles
- Muninn builds routing table at startup
- Easy to see which extension handles which domain

### 4. **Universal Progress UI**
- All extensions use same `extension-progress` domain for progress
- Consistent user experience across all extensions
- Muninn provides generic UI - no custom progress handlers needed

### 5. **Extension Isolation**
- Each extension has dedicated domain (`i18n`, `linter`, `formatter`)
- Extensions identified by `extensionId` in progress broadcasts
- Multiple extensions can run simultaneously without conflicts

### 6. **Simple Protocol**
- Two message flows: request/response and broadcast
- Works with any language (TypeScript, Rust, Python, etc.)
- No complex API - just STDIN/STDOUT JSON messages

---

## Comparison: Without vs With Domain Registration

### ❌ WITHOUT Domain Registration (Hypothetical)

```typescript
// Extension would need to manually hook into Muninn
Muninn.registerHandlers({
  extensionId: 'i18n',
  handlers: {
    'translate-code': handleTranslateCode,
    'load-dictionary': handleLoadDictionary,
  }
});

// Muninn would need to know about every extension
if (extensionId === 'i18n') {
  callI18nHandler();
} else if (extensionId === 'linter') {
  callLinterHandler();
}
```

**Problems**:
- Tight coupling between Muninn and extensions
- Muninn needs code for each extension
- Hard to add new extensions
- No clear separation of concerns

### ✅ WITH Domain Registration (Actual Design)

**Manifest** (`extension.json`):
```json
{
  "id": "i18n",
  "domains": {
    "subscribe": ["i18n"]
  }
}
```

**Extension Code**:
```typescript
// Extension just handles messages on its domain
async function handleMessage(message: IPCMessage): Promise<void> {
  if (message.domain !== 'i18n') return;

  switch (message.action) {
    case 'translate-code':
      sendResponse(message, await handleTranslateCode(message));
      break;
  }
}
```

**Muninn Code**:
```rust
// Generic routing - no extension-specific code
fn route_message(message: IPCMessage) {
  let handler = routing_table.get(message.domain);
  handler.send_message(message);
}
```

**Advantages**:
- Declarative domain registration via manifest
- Zero coupling - Muninn doesn't know about specific extensions
- Generic routing logic works for all extensions
- Easy to add new extensions - just add manifest entry

---

## Extension Lifecycle

### 1. **Extension Startup**

```
Muninn starts
  ↓
Discovers i18n extension
  ↓
Reads extension.json
  ↓
Registers "i18n" domain for requests
  ↓
Spawns extension process
  ↓
Extension starts listening on STDIN
  ↓
Ready to receive requests and send events
```

### 2. **Handling a Request**

```
VSCode sends: {
  domain: 'i18n',
  action: 'translate-code'
}
  ↓
Muninn routes to i18n extension (by domain)
  ↓
Extension receives request
  ↓
Extension sends: {
  domain: 'extension-progress',
  action: 'started',
  data: { extensionId: 'i18n', ... }
}
  ↓
Muninn displays progress UI
  ↓
Extension processes request
  ↓
Extension sends: {
  domain: 'extension-progress',
  action: 'complete'
}
  ↓
Extension sends response to VSCode
```

---

## Standard Fields Reference

### Required Fields

```typescript
{
  extensionId: string,      // Extension identifier (from extension.json)
  taskId: string,           // Unique task ID (e.g., 'translate-ja-1234567890')
  title: string,            // Human-readable title (e.g., 'Code Translation')
  status: string,           // Current status (e.g., 'processing', 'complete')
}
```

### Optional Fields

```typescript
{
  statusMessage?: string,   // Custom message (e.g., 'Translating 11 terms...')
  progress?: number,        // Progress percentage (0-100)
  currentStep?: number,     // Current step (e.g., batch 3)
  totalSteps?: number,      // Total steps (e.g., 10 batches)
  details?: object,         // Extension-specific details
  error?: string,           // Error message (for 'error' action)
  autoClose?: boolean,      // Auto-close on complete (default: true)
  autoCloseDelay?: number   // Delay before auto-close in ms (default: 3000)
}
```

---

## Example: Full Translation Flow

```typescript
const taskId = `translate-ja-${Date.now()}`;

// 1. Start
sendProgress(taskId, 'Code Translation', 'started', {
  status: 'scanning',
  statusMessage: 'Scanning project for identifiers...',
  details: {
    origin: 'github.com:user/repo',
    language: 'ja'
  }
});

// 2. Progress (optional)
sendProgress(taskId, 'Code Translation', 'progress', {
  status: 'processing',
  statusMessage: 'Translating 285 terms to Japanese...',
  progress: 45,
  currentStep: 3,
  totalSteps: 10,
  details: {
    termsProcessed: 128,
    termsTotal: 285
  }
});

// 3. Complete
sendProgress(taskId, 'Code Translation', 'complete', {
  status: 'complete',
  statusMessage: 'Successfully translated 285 terms',
  details: {
    totalTerms: 285,
    totalComments: 43
  },
  autoClose: true,
  autoCloseDelay: 3000
});
```

**Result**: Muninn shows a progress dialog that updates in real-time and auto-closes after 3 seconds.

---

## Summary

### How Domain Registration Works

1. **Declare Domains**: Extensions list domains in `extension.json` under `domains.subscribe`
2. **Muninn Builds Routing Table**: At startup, scans all manifests and creates routing map
3. **Generic Routing**: Muninn routes all messages based on `domain` field
4. **Extension Handles**: Extension receives messages on its domain(s) via STDIN
5. **Dual Domain Pattern**: Custom domain for requests + `extension-progress` for UI updates

### Key Points

**For Request Handling**:
- ✅ Declare domain in `domains.subscribe` array in `extension.json`
- ✅ Use `domain: 'i18n'` for all incoming requests
- ✅ Handle messages on STDIN, respond via STDOUT
- ✅ Send responses with `flow: 'res'` or `flow: 'err'`

**For Progress Updates**:
- ✅ Use `domain: 'extension-progress'` for all progress broadcasts
- ✅ Include `extensionId: 'i18n'` in data to identify your extension
- ✅ Follow standard message structure
- ✅ Use predefined `action` types: started, progress, complete, error
- ✅ Muninn's generic UI handles display automatically

### Architecture Principles

1. **Separation of Concerns**: Each extension owns its domain
2. **Explicit Registration**: Manifest declares capabilities upfront
3. **Generic Routing**: Muninn knows nothing about specific extensions
4. **Universal UI**: Standard progress protocol for consistent UX
5. **Zero Coupling**: Extensions independent from Muninn core

### Reference

- **Extensibility Spec**: `/Users/markvasile/Code/CodeAwareness/Odin/kawa.dev-doc/EXTENSIBILITY.md:137`
- **Progress Protocol**: `/Users/markvasile/Code/CodeAwareness/Odin/kawa.dev-doc/EXTENSION_PROGRESS_PROTOCOL.md`
- **Manifest**: `extension.json` (domains.subscribe)
- **Protocol Implementation**: `src/ipc/protocol.ts` (sendProgress, sendResponse)
- **Message Handler**: `src/index.ts` (handleMessage, handleTranslateCode)

---

**The beauty of this design**:
- Extensions declare domains once in manifest
- Muninn routes automatically via generic logic
- Zero coupling between extensions and core
- Universal progress UI provides consistent UX
