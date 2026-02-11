/**
 * Direct IPC Server for Huginn Clients
 *
 * Accepts connections from editor extensions (VSCode, Emacs, Vim)
 * for direct translation requests, bypassing Muninn for the hot path.
 *
 * Socket location:
 * - Unix/macOS: ~/.kawa-code/sockets/kawa.i18n
 * - Windows: \\.\pipe\kawa.i18n
 */
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log, IPCMessage } from './protocol';

const isWindows = os.platform() === 'win32';
const SOCKET_NAME = 'kawa.i18n';
const SOCKET_DIR = path.join(os.homedir(), '.kawa-code', 'sockets');
const SOCKET_PATH = isWindows
  ? `\\\\.\\pipe\\${SOCKET_NAME}`
  : path.join(SOCKET_DIR, SOCKET_NAME);

// Connected clients by CAW ID
const clients = new Map<string, net.Socket>();

// Language preference per CAW (defaults to 'en')
const langByCAW = new Map<string, string>();

// Request handler type
type DirectRequestHandler = (message: IPCMessage, caw: string) => Promise<any>;
const directHandlers = new Map<string, DirectRequestHandler>();

// Pending Muninn requests for correlation
const pendingMuninnRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

let muninnRequestCounter = 0;

/**
 * Send a request to Muninn via stdout and wait for response
 */
export async function requestFromMuninn(message: Omit<IPCMessage, '_msgId'>): Promise<any> {
  return new Promise((resolve, reject) => {
    const msgId = `direct-${++muninnRequestCounter}-${Date.now()}`;

    const timeout = setTimeout(() => {
      pendingMuninnRequests.delete(msgId);
      reject(new Error(`Muninn request timeout: ${message.domain}:${message.action}`));
    }, 10000);

    pendingMuninnRequests.set(msgId, { resolve, reject, timeout });

    const fullMessage: IPCMessage = {
      ...message,
      _msgId: msgId
    } as IPCMessage;

    process.stdout.write(`MUNINN START:0 ${JSON.stringify(fullMessage)}\n`);
    log(`[DirectIPC] Sent request to Muninn: ${message.domain}:${message.action} (${msgId})`);
  });
}

/**
 * Handle response from Muninn (called from stdin handler)
 */
export function handleMuninnResponse(message: IPCMessage): boolean {
  const msgId = message._msgId;
  if (!msgId || !pendingMuninnRequests.has(msgId)) {
    return false; // Not a response to our request
  }

  const pending = pendingMuninnRequests.get(msgId)!;
  pendingMuninnRequests.delete(msgId);
  clearTimeout(pending.timeout);

  if (message.flow === 'err') {
    pending.reject(new Error(message.data?.error || 'Muninn request failed'));
  } else {
    pending.resolve(message.data);
  }

  return true;
}

/**
 * Register a handler for direct Huginn requests
 */
export function registerDirectHandler(
  domain: string,
  action: string,
  handler: DirectRequestHandler
): void {
  const key = `${domain}:${action}`;
  directHandlers.set(key, handler);
  log(`[DirectIPC] Registered handler: ${key}`);
}

/**
 * Get language for a CAW
 */
export function getLanguage(caw: string): string {
  return langByCAW.get(caw) || 'en';
}

/**
 * Set language for a CAW
 */
export function setLanguage(caw: string, lang: string): void {
  langByCAW.set(caw, lang);
  log(`[DirectIPC] Set language for CAW ${caw}: ${lang}`);
}

/**
 * Get origin for a file path from Muninn
 */
export async function getOriginForPath(fpath: string): Promise<{ origin: string; projectRoot: string } | null> {
  try {
    log(`[DirectIPC] Querying Muninn for origin: ${fpath}`);
    const response = await requestFromMuninn({
      flow: 'req',
      domain: 'repo',
      action: 'get-origin',
      caw: '0',
      data: { fpath }
    });

    if (response && response.origin && response.projectRoot) {
      return { origin: response.origin, projectRoot: response.projectRoot };
    }

    log(`[DirectIPC] No origin returned from Muninn for ${fpath}`);
    return null;
  } catch (error: any) {
    log(`[DirectIPC] Failed to get origin from Muninn: ${error.message}`);
    return null;
  }
}

/**
 * Send a message to a specific client
 */
function sendToClient(caw: string, message: IPCMessage): boolean {
  const client = clients.get(caw);
  if (!client || client.destroyed) {
    log(`[DirectIPC] Client ${caw} not found or disconnected`);
    return false;
  }

  try {
    const data = JSON.stringify(message) + '\n';
    client.write(data);
    log(`[DirectIPC] Sent to ${caw}: ${message.domain}:${message.action}`);
    return true;
  } catch (error: any) {
    log(`[DirectIPC] Failed to send to ${caw}: ${error.message}`);
    return false;
  }
}

/**
 * Broadcast message to all connected Huginn clients
 */
export function broadcastToClients(message: Omit<IPCMessage, 'caw'>): void {
  for (const [caw, client] of clients) {
    if (!client.destroyed) {
      try {
        client.write(JSON.stringify({ ...message, caw }) + '\n');
      } catch (error: any) {
        log(`[DirectIPC] Failed to broadcast to ${caw}: ${error.message}`);
      }
    }
  }
}

/**
 * Get count of connected clients
 */
export function getConnectedClientCount(): number {
  let count = 0;
  for (const client of clients.values()) {
    if (!client.destroyed) count++;
  }
  return count;
}

/**
 * Start the direct IPC server for Huginn clients
 */
export function startDirectServer(): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    // Ensure socket directory exists (Unix only)
    if (!isWindows) {
      try {
        fs.mkdirSync(SOCKET_DIR, { recursive: true });

        // Remove existing socket file if present
        if (fs.existsSync(SOCKET_PATH)) {
          fs.unlinkSync(SOCKET_PATH);
          log(`[DirectIPC] Removed existing socket: ${SOCKET_PATH}`);
        }
      } catch (error: any) {
        log(`[DirectIPC] Warning: Failed to prepare socket directory: ${error.message}`);
      }
    }

    const server = net.createServer((socket) => {
      let buffer = '';
      let clientCAW: string | null = null;

      socket.setEncoding('utf8');

      log(`[DirectIPC] New connection from ${socket.remoteAddress || 'local'}`);

      socket.on('data', async (data) => {
        buffer += data;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message: IPCMessage = JSON.parse(line);
            log(`[DirectIPC] Received: ${message.domain}:${message.action} from CAW ${message.caw || clientCAW || 'unknown'}`);

            // Handle hello/handshake - client identifying itself
            if (message.domain === 'system' && message.action === 'hello') {
              clientCAW = message.caw || message.data?.caw;
              if (clientCAW) {
                // Remove any existing connection for this CAW
                const existing = clients.get(clientCAW);
                if (existing && existing !== socket && !existing.destroyed) {
                  log(`[DirectIPC] Replacing existing connection for CAW ${clientCAW}`);
                  existing.destroy();
                }

                clients.set(clientCAW, socket);
                log(`[DirectIPC] Client registered: CAW ${clientCAW}`);

                // Send ready response
                sendToClient(clientCAW, {
                  flow: 'res',
                  domain: 'system',
                  action: 'ready',
                  caw: clientCAW,
                  data: { success: true, socketPath: SOCKET_PATH }
                });
              } else {
                log(`[DirectIPC] Hello without CAW, ignoring`);
              }
              continue;
            }

            // Require CAW for all other messages
            const caw = message.caw || clientCAW;
            if (!caw) {
              log(`[DirectIPC] Message without CAW, ignoring`);
              continue;
            }

            // Update clientCAW if not set
            if (!clientCAW) {
              clientCAW = caw;
              clients.set(clientCAW, socket);
            }

            // Find handler for this domain:action
            const key = `${message.domain}:${message.action}`;
            const handler = directHandlers.get(key);

            if (!handler) {
              log(`[DirectIPC] No handler for ${key}`);
              sendToClient(caw, {
                flow: 'err',
                domain: message.domain,
                action: message.action,
                caw,
                data: { error: `No handler registered for ${key}` },
                _msgId: message._msgId
              });
              continue;
            }

            // Execute handler
            try {
              const result = await handler(message, caw);

              // Only send response for request messages
              if (message.flow === 'req') {
                sendToClient(caw, {
                  flow: 'res',
                  domain: message.domain,
                  action: message.action,
                  caw,
                  data: result,
                  _msgId: message._msgId
                });
              }
            } catch (error: any) {
              log(`[DirectIPC] Handler error for ${key}: ${error.message}`);
              sendToClient(caw, {
                flow: 'err',
                domain: message.domain,
                action: message.action,
                caw,
                data: { error: error.message },
                _msgId: message._msgId
              });
            }
          } catch (parseError: any) {
            log(`[DirectIPC] Failed to parse message: ${parseError.message}`);
          }
        }
      });

      socket.on('close', () => {
        if (clientCAW) {
          clients.delete(clientCAW);
          langByCAW.delete(clientCAW);
          log(`[DirectIPC] Client disconnected: CAW ${clientCAW}`);
        }
      });

      socket.on('error', (error: any) => {
        log(`[DirectIPC] Socket error for CAW ${clientCAW || 'unknown'}: ${error.message}`);
        if (clientCAW) {
          clients.delete(clientCAW);
        }
      });
    });

    server.on('error', (error: any) => {
      log(`[DirectIPC] Server error: ${error.message}`);
      reject(error);
    });

    server.listen(SOCKET_PATH, () => {
      log(`[DirectIPC] Server listening on ${SOCKET_PATH}`);

      // Set socket permissions on Unix
      if (!isWindows) {
        try {
          fs.chmodSync(SOCKET_PATH, 0o660);
        } catch (e) {
          // Ignore permission errors
        }
      }

      resolve(server);
    });
  });
}

/**
 * Stop the direct IPC server
 */
export function stopDirectServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    // Close all client connections
    for (const [caw, client] of clients) {
      if (!client.destroyed) {
        client.destroy();
      }
    }
    clients.clear();
    langByCAW.clear();

    server.close(() => {
      log('[DirectIPC] Server stopped');

      // Clean up socket file on Unix
      if (!isWindows && fs.existsSync(SOCKET_PATH)) {
        try {
          fs.unlinkSync(SOCKET_PATH);
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      resolve();
    });
  });
}
