/**
 * IPC Bridge for communicating with Muninn
 *
 * Web Components dispatch 'kawa-ipc' events which Muninn's
 * ExtensionScreen component intercepts and routes to the appropriate
 * domain handler (Gardener or extensions).
 */

let requestIdCounter = 0
const pendingRequests = new Map<string, {
  resolve: (data: any) => void
  reject: (error: any) => void
}>()

/**
 * Send an IPC request to Muninn
 *
 * @param element - The custom element dispatching the event
 * @param domain - The domain to route to (e.g., 'i18n', 'repo', 'file')
 * @param action - The action within the domain
 * @param data - The request payload
 * @param signal - Optional AbortSignal to cancel the request
 * @returns Promise resolving to the response data
 */
export function sendIPCRequest(
  element: HTMLElement,
  domain: string,
  action: string,
  data: any,
  signal?: AbortSignal,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const requestId = `req-${++requestIdCounter}-${Date.now()}`

    pendingRequests.set(requestId, { resolve, reject })

    if (signal) {
      signal.addEventListener('abort', () => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId)
          reject(new DOMException('Aborted', 'AbortError'))
        }
      }, { once: true })
    }

    element.dispatchEvent(new CustomEvent('kawa-ipc', {
      bubbles: true,
      composed: true, // Cross shadow DOM boundary
      detail: { domain, action, data, requestId }
    }))

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        reject(new Error(`IPC request timeout: ${domain}:${action}`))
      }
    }, 30000)
  })
}

/**
 * Handle IPC response from Muninn
 *
 * @param event - The kawa-ipc-response CustomEvent
 */
export function handleIPCResponse(event: Event): void {
  const customEvent = event as CustomEvent
  const { requestId, success, data, error } = customEvent.detail

  const pending = pendingRequests.get(requestId)
  if (!pending) {
    console.warn('[ipc-bridge] Received response for unknown request:', requestId)
    return
  }

  pendingRequests.delete(requestId)

  if (success) {
    pending.resolve(data)
  } else {
    pending.reject(new Error(error || 'Unknown error'))
  }
}

/**
 * Setup IPC response listener on an element
 *
 * @param element - The element to listen on
 */
export function setupIPCListener(element: HTMLElement): void {
  element.addEventListener('kawa-ipc-response', handleIPCResponse)
}

/**
 * Cleanup IPC listener
 *
 * @param element - The element to remove listener from
 */
export function cleanupIPCListener(element: HTMLElement): void {
  element.removeEventListener('kawa-ipc-response', handleIPCResponse)
}

/**
 * Get count of pending requests (for debugging)
 */
export function getPendingRequestCount(): number {
  return pendingRequests.size
}
