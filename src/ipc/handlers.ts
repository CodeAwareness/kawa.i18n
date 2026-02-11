import * as readline from 'readline';
import { IPCMessage, sendResponse, sendError, log } from './protocol';
import { CircularStreamBuffer } from './stream-buffer';

/**
 * Message handler function type
 */
export type MessageHandler = (message: IPCMessage) => Promise<any> | any;

/**
 * Registry of message handlers by domain:action
 */
const handlers = new Map<string, MessageHandler>();

/**
 * Response interceptors - called before normal handler processing
 * Return true if the message was handled (response to our own request)
 */
type ResponseInterceptor = (message: IPCMessage) => boolean;
const responseInterceptors: ResponseInterceptor[] = [];

/**
 * Stream buffer for reading large requests from Muninn
 */
let requestStream: CircularStreamBuffer | null = null;

/**
 * Set the request stream buffer (called during initialization)
 */
export function setRequestStream(stream: CircularStreamBuffer): void {
  requestStream = stream;
}

/**
 * Add a response interceptor
 */
export function addResponseInterceptor(interceptor: ResponseInterceptor): void {
  responseInterceptors.push(interceptor);
}

/**
 * Register a handler for a specific domain:action
 */
export function registerHandler(
  domain: string,
  action: string,
  handler: MessageHandler
): void {
  const key = `${domain}:${action}`;
  handlers.set(key, handler);
  log(`Registered handler: ${key}`);
}

/**
 * Dispatch a parsed IPC message to the appropriate handler.
 */
async function dispatchMessage(message: IPCMessage): Promise<void> {
  // Check response interceptors first (for our own Muninn requests)
  for (const interceptor of responseInterceptors) {
    if (interceptor(message)) {
      log(`Message intercepted as response: ${message.domain}:${message.action}`);
      return;
    }
  }

  const key = `${message.domain}:${message.action}`;

  log(`Parsed message - flow: ${message.flow}, domain: ${message.domain}, action: ${message.action}, _msgId: ${message._msgId || 'none'}`);

  const handler = handlers.get(key);
  if (!handler) {
    // For broadcast messages, no handler is not an error (just ignore)
    if (message.flow === 'brdc') {
      log(`No handler for broadcast: ${key} (ignoring)`);
      return;
    }

    log(`No handler for: ${key} (available: ${Array.from(handlers.keys()).join(', ')})`);
    sendError(message, `No handler registered for ${key}`);
    return;
  }

  log(`Executing handler for: ${key}`);

  // Execute handler
  const result = await handler(message);

  // Only send response for request messages, not broadcasts
  if (message.flow === 'req') {
    log(`Handler completed for: ${key}, sending response`);
    sendResponse(message, result);
    log(`Response sent for: ${key}`);
  } else {
    log(`Handler completed for: ${key} (no response for ${message.flow})`);
  }
}

/**
 * Start listening for IPC messages on stdin
 */
export function startListening(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    // Log raw message receipt
    log(`Received raw line: ${line.substring(0, 200)}${line.length > 200 ? '...' : ''}`);

    try {
      const message = JSON.parse(line);

      // Check if this is a stream notification (large payload in stream file)
      if ((message as any)._streamNotification) {
        log(`Stream notification received for domain: ${(message as any).domain}`);
        if (requestStream) {
          const actualMessage = requestStream.read();
          if (actualMessage) {
            await dispatchMessage(actualMessage as IPCMessage);
          } else {
            log('Stream notification received but no data in request stream');
          }
        } else {
          log('Stream notification received but no request stream configured');
        }
        return;
      }

      await dispatchMessage(message as IPCMessage);
    } catch (error: any) {
      log(`Error processing message: ${error.message}`, error.stack);

      // Try to send error response
      try {
        const message: IPCMessage = JSON.parse(line);
        // Only send error for request messages
        if (message.flow === 'req') {
          sendError(message, error);
          log(`Error response sent for failed message`);
        }
      } catch {
        // Can't parse message, log only
        log(`Failed to parse message: ${line}`);
      }
    }
  });

  rl.on('close', () => {
    log('STDIN closed, exiting');
    process.exit(0);
  });

  log('IPC listener started on STDIN');
}
