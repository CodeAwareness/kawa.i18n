/**
 * IPC Protocol for Muninn Extension Communication
 *
 * Messages follow the Kawa IPC structure:
 * {
 *   flow: 'req' | 'res' | 'err' | 'brdc',
 *   domain: string,
 *   action: string,
 *   caw: string,
 *   data: any,
 *   _msgId?: string
 * }
 */

import { CircularStreamBuffer, STREAM_THRESHOLD_BYTES } from './stream-buffer';

export interface IPCMessage {
  flow: 'req' | 'res' | 'err' | 'brdc';
  domain: string;
  action: string;
  caw: string;
  data: any;
  _msgId?: string;
}

/**
 * Stream buffer for writing large responses back to Muninn
 */
let responseStream: CircularStreamBuffer | null = null;

/**
 * Set the response stream buffer (called during initialization)
 */
export function setResponseStream(stream: CircularStreamBuffer): void {
  responseStream = stream;
}

/**
 * Send response message to stdout, or via stream buffer for large payloads
 */
export function sendResponse(request: IPCMessage, data: any): void {
  const response: IPCMessage = {
    flow: 'res',
    domain: request.domain,
    action: request.action,
    caw: request.caw,
    data,
    _msgId: request._msgId,
  };

  const serialized = JSON.stringify(response);
  const byteLength = Buffer.byteLength(serialized, 'utf-8');

  if (byteLength >= STREAM_THRESHOLD_BYTES && responseStream) {
    try {
      responseStream.write(response);
      // Send a lightweight notification via STDOUT so Muninn knows to read from stream
      const notification = JSON.stringify({
        flow: 'res',
        domain: request.domain,
        action: request.action,
        caw: request.caw,
        _msgId: request._msgId,
        _streamResponse: true,
      });
      process.stdout.write(`MUNINN START:0 ${notification}\n`);
      log(`Large response via stream (${byteLength} bytes) for ${request.domain}:${request.action}`);
    } catch (err: any) {
      log(`Stream write failed (${err.message}), falling back to STDOUT`);
      process.stdout.write(`MUNINN START:0 ${serialized}\n`);
    }
  } else {
    process.stdout.write(`MUNINN START:0 ${serialized}\n`);
  }
}

/**
 * Send error message to stdout
 */
export function sendError(request: IPCMessage, error: Error | string): void {
  const errorMessage = typeof error === 'string' ? error : error.message;

  const response: IPCMessage = {
    flow: 'err',
    domain: request.domain,
    action: request.action,
    caw: request.caw,
    data: {
      error: errorMessage,
    },
    _msgId: request._msgId,
  };

  process.stdout.write(`MUNINN START:0 ${JSON.stringify(response)}\n`);
}

/**
 * Send broadcast message (progress updates to Muninn UI)
 */
export function sendBroadcast(domain: string, action: string, data: any): void {
  const broadcast: IPCMessage = {
    flow: 'brdc',
    domain,
    action,
    caw: '0', // Muninn is always caw '0'
    data,
  };

  process.stdout.write(`MUNINN START:0 ${JSON.stringify(broadcast)}\n`);
}

/**
 * Send progress update to Muninn UI
 * Uses the standard extension-progress protocol
 */
export function sendProgress(
  taskId: string,
  taskName: string,
  action: 'started' | 'progress' | 'complete' | 'error',
  details: {
    status: 'scanning' | 'processing' | 'uploading' | 'downloading' | 'complete' | 'error' | 'retrying';
    statusMessage?: string;
    progress?: number;
    currentStep?: number;
    totalSteps?: number;
    details?: Record<string, any>;
    error?: string;
    autoClose?: boolean;
    autoCloseDelay?: number;
  }
): void {
  const message: IPCMessage = {
    flow: 'brdc',
    domain: 'extension-progress',
    action,
    caw: '0', // Muninn
    data: {
      extensionId: 'i18n',
      taskId,
      title: taskName,
      ...details,
    },
  };

  process.stdout.write(`MUNINN START:0 ${JSON.stringify(message)}\n`);
}

/**
 * Flush stdout so the last progress message (e.g. complete) is delivered to Muninn
 * before the handler returns. Call after sendProgress(..., 'complete', ...).
 */
export function flushProgressToMuninn(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write('', () => resolve());
  });
}

import * as fs from 'fs';
import * as path from 'path';

// Log file path
const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.kawa-code', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'i18n.log');

// Ensure log directory exists
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (error) {
  console.error('[i18n] Failed to create log directory:', error);
}

/**
 * Log to both stderr and file
 */
export function log(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [i18n] ${message}`;
  const fullMessage = args.length > 0
    ? `${formattedMessage} ${args.map(a => JSON.stringify(a)).join(' ')}`
    : formattedMessage;

  // Log to stderr (for Muninn to see)
  console.error(fullMessage);

  // Log to file
  try {
    fs.appendFileSync(LOG_FILE, fullMessage + '\n', 'utf-8');
  } catch (error) {
    // Don't fail if we can't write to log file
    console.error('[i18n] Failed to write to log file:', error);
  }
}
