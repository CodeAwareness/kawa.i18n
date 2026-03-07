# i18n Extension Event Flow to Kawa Code

This document explains how the kawa.i18n extension sends events (progress updates, notifications) to the Kawa Code UI.

---

## Overview

The i18n extension communicates with Kawa Code using **broadcast messages** sent via STDOUT. These broadcasts are specifically designed for UI updates and don't require a response.

---

## Message Types

The extension uses three types of messages:

### 1. Response (`flow: 'res'`)
**Purpose**: Reply to a request
**Direction**: Extension → Caller (VSCode, Kawa Code, etc.)
**Example**: Returning translated code

### 2. Error (`flow: 'err'`)
**Purpose**: Report an error for a specific request
**Direction**: Extension → Caller
**Example**: Dictionary not found error

### 3. **Broadcast (`flow: 'brdc')** ← **Used for Kawa Code UI events**
**Purpose**: Send unsolicited updates to Kawa Code UI
**Direction**: Extension → Kawa Code UI only
**Target**: Always `caw: '0'` (Kawa Code's identifier)
**Example**: Translation progress updates

---

## Broadcast Message Structure

```typescript
{
  flow: 'brdc',           // Broadcast (no response expected)
  domain: 'i18n',         // Extension domain
  action: 'progress',     // Action type (usually 'progress')
  caw: '0',               // Always '0' for Kawa Code
  data: {
    taskId: string,       // Unique task identifier
    taskName: string,     // Human-readable task name
    status: string,       // 'started' | 'progress' | 'complete' | 'error'
    ...details            // Additional status information
  }
}
```

---

## How It Works

### Step-by-Step Flow

```
1. VSCode sends request to i18n extension
   ↓
2. Extension receives via STDIN
   ↓
3. Extension starts processing
   ↓
4. Extension sends BROADCAST to Kawa Code UI (via STDOUT)
   {
     flow: 'brdc',
     domain: 'i18n',
     action: 'progress',
     caw: '0',
     data: { status: 'started', ... }
   }
   ↓
5. Kawa Code UI receives broadcast and shows progress notification
   ↓
6. Extension continues processing
   ↓
7. Extension sends another BROADCAST (progress update)
   {
     flow: 'brdc',
     domain: 'i18n',
     action: 'progress',
     caw: '0',
     data: { status: 'complete', ... }
   }
   ↓
8. Kawa Code UI updates notification (e.g., shows success, auto-closes)
   ↓
9. Extension sends RESPONSE to VSCode
   {
     flow: 'res',
     domain: 'i18n',
     action: 'translate-code',
     data: { success: true, code: '...' }
   }
   ↓
10. VSCode receives translated code
```

---

## Code Implementation

### Sending Broadcasts

**File**: `src/ipc/protocol.ts`

```typescript
/**
 * Send broadcast message (progress updates to Kawa Code UI)
 */
export function sendBroadcast(domain: string, action: string, data: any): void {
  const broadcast: IPCMessage = {
    flow: 'brdc',
    domain,
    action,
    caw: '0', // Kawa Code is always caw '0'
    data,
  };

  process.stdout.write(JSON.stringify(broadcast) + '\n');
}
```

### Sending Progress Updates

**File**: `src/ipc/protocol.ts`

```typescript
/**
 * Send progress update to Kawa Code UI
 */
export function sendProgress(
  taskId: string,
  taskName: string,
  status: 'started' | 'progress' | 'complete' | 'error',
  details: any
): void {
  sendBroadcast('i18n', 'progress', {
    taskId,
    taskName,
    status,
    ...details,
  });
}
```

---

## Example: Translation Progress

**File**: `src/index.ts` (handleTranslateCode)

```typescript
async function handleTranslateCode(message: IPCMessage): Promise<any> {
  const { code, filePath, sourceLang, targetLang, origin } = message.data;
  const taskId = `translate-${targetLang}-${Date.now()}`;

  try {
    // 1. Send "started" broadcast
    sendProgress(taskId, 'Code Translation', 'started', {
      status: 'processing',
      statusMessage: `Translating to ${targetLang.toUpperCase()}...`,
    });

    // 2. Do the actual work
    const dictionary = dictionaryManager.load(origin, targetLang);
    const translator = new Translator(dictionary.terms);
    const result = translator.toCustom(code);

    // 3. Send "complete" broadcast
    sendProgress(taskId, 'Code Translation', 'complete', {
      status: 'complete',
      statusMessage: `Translated ${result.translatedTokens.length} terms`,
      details: {
        translatedTokens: result.translatedTokens.length,
        unmappedTokens: result.unmappedTokens.length,
      },
      autoClose: true,      // Tell Kawa Code to auto-close notification
      autoCloseDelay: 2000, // After 2 seconds
    });

    // 4. Return response to VSCode
    return {
      success: true,
      code: result.code,
      translatedTokens: result.translatedTokens,
      unmappedTokens: result.unmappedTokens,
    };

  } catch (error: any) {
    // Send "error" broadcast
    sendProgress(taskId, 'Code Translation', 'error', {
      status: 'error',
      error: error.message || 'Translation failed',
      autoClose: false, // Keep error visible
    });

    throw error;
  }
}
```

---

## What Kawa Code Does With Broadcasts

When Kawa Code receives a broadcast from the i18n extension:

### 1. **Broadcast Router**
Kawa Code's extension router identifies the message:
- `flow === 'brdc'` → Broadcast message
- `caw === '0'` → Intended for Kawa Code UI
- `domain === 'i18n'` → From i18n extension
- `action === 'progress'` → Progress update

### 2. **UI Handler**
Kawa Code passes the broadcast to the UI layer (Vue.js):
```javascript
// In Kawa Code Vue.js frontend
eventBus.emit('extension-progress', {
  extension: 'i18n',
  taskId: 'translate-ja-1234567890',
  taskName: 'Code Translation',
  status: 'started',
  statusMessage: 'Translating to JA...'
})
```

### 3. **Notification Display**
The Kawa Code UI shows a notification/toast:
```
┌─────────────────────────────────┐
│ 🔄 Code Translation             │
│ Translating to JA...            │
└─────────────────────────────────┘
```

### 4. **Status Update**
When status changes to 'complete':
```
┌─────────────────────────────────┐
│ ✅ Code Translation             │
│ Translated 11 terms             │
│ (Auto-closing in 2s...)         │
└─────────────────────────────────┘
```

---

## Message Flow Diagram

```
┌─────────────┐
│   VSCode    │
└──────┬──────┘
       │ 1. Request: "Translate this code"
       │    flow: 'req'
       │    domain: 'i18n'
       │    action: 'translate-code'
       ↓
┌──────────────────┐
│  i18n Extension  │
└────┬────────┬────┘
     │        │
     │        │ 2. Broadcast: "Started"
     │        │    flow: 'brdc'
     │        │    caw: '0'
     │        │    status: 'started'
     │        ↓
     │    ┌─────────┐
     │    │ Kawa Code  │
     │    │   UI    │ → Shows: "🔄 Translating..."
     │    └─────────┘
     │
     │ 3. Processing...
     │
     │        │ 4. Broadcast: "Complete"
     │        │    flow: 'brdc'
     │        │    caw: '0'
     │        │    status: 'complete'
     │        ↓
     │    ┌─────────┐
     │    │ Kawa Code  │
     │    │   UI    │ → Shows: "✅ Translated 11 terms"
     │    └─────────┘
     │
     │ 5. Response: Translated code
     │    flow: 'res'
     ↓
┌─────────────┐
│   VSCode    │ → Receives translated code
└─────────────┘
```

---

## Key Points

### 1. **No Response Required**
Broadcasts (`flow: 'brdc'`) don't expect a response. They're fire-and-forget messages for UI updates.

### 2. **Always Target Kawa Code**
Broadcasts always use `caw: '0'` which is Kawa Code's identifier. This ensures they go to the UI layer.

### 3. **Parallel Communication**
The extension can send broadcasts to Kawa Code while also returning responses to VSCode. They're independent communication channels.

### 4. **Task Identification**
Each task gets a unique `taskId` (e.g., `translate-ja-1702123456789`) so Kawa Code can track multiple concurrent operations.

### 5. **Rich Status Information**
Broadcasts can include:
- `statusMessage` - User-friendly text
- `details` - Additional data (token counts, etc.)
- `autoClose` - Should notification auto-dismiss?
- `autoCloseDelay` - How long to wait before closing
- `error` - Error message if failed

---

## Progress Status Lifecycle

### Typical Lifecycle
```
started → [progress]* → complete
   ↓
  error (if something fails)
```

### Example Timeline
```
0ms:    started   - "Translating to JA..."
50ms:   progress  - "Loading dictionary..."
100ms:  progress  - "Parsing code..."
200ms:  progress  - "Applying translations..."
250ms:  complete  - "Translated 11 terms" (auto-close in 2s)
```

### Error Handling
```
0ms:    started  - "Translating to JA..."
50ms:   error    - "Dictionary not found for origin:..."
```

---

## Kawa Code UI Integration Points

### Expected Kawa Code Handlers

Kawa Code should handle these broadcasts:

1. **`i18n:progress`** - Translation progress updates
   ```typescript
   {
     domain: 'i18n',
     action: 'progress',
     data: {
       taskId: string,
       taskName: string,
       status: 'started' | 'progress' | 'complete' | 'error',
       statusMessage?: string,
       details?: object,
       error?: string,
       autoClose?: boolean,
       autoCloseDelay?: number
     }
   }
   ```

2. **Future broadcasts** (not implemented yet):
   - `i18n:dictionary-updated` - Dictionary was modified
   - `i18n:sync-complete` - Cloud sync finished
   - `i18n:conflict-detected` - Dictionary conflict found

---

## Testing Broadcasts

You can manually test broadcast messages:

```typescript
// In extension code
import { sendProgress } from './ipc/protocol';

// Send test broadcast
sendProgress(
  'test-task-123',
  'Test Task',
  'started',
  {
    statusMessage: 'Testing broadcast system...',
    details: { foo: 'bar' }
  }
);
```

This will output to STDOUT:
```json
{"flow":"brdc","domain":"i18n","action":"progress","caw":"0","data":{"taskId":"test-task-123","taskName":"Test Task","status":"started","statusMessage":"Testing broadcast system...","details":{"foo":"bar"}}}
```

Kawa Code should receive and display this as a notification.

---

## Summary

**How i18n injects events into Kawa Code**:

1. **Mechanism**: STDOUT broadcast messages with `flow: 'brdc'` and `caw: '0'`
2. **Format**: JSON objects following Kawa IPC protocol
3. **Purpose**: Progress updates, notifications, status changes
4. **Examples**: Translation started/complete, errors, dictionary updates
5. **Kawa Code's Role**: Receive broadcasts via extension router, display in UI

**Key Functions**:
- `sendBroadcast(domain, action, data)` - Generic broadcast
- `sendProgress(taskId, taskName, status, details)` - Specific progress updates

**Result**: Real-time UI updates in Kawa Code while the extension processes requests!
