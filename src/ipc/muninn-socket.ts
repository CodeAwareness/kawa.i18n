/**
 * Kawa Code Socket Transport for Extension Client Mode
 *
 * Connects to Kawa Code's Huginn IPC socket as an extension client,
 * replacing stdin/stdout communication with socket-based IPC.
 *
 * Used when:
 * - KAWA_CODE_SOCKET env var is set
 * - --kawa-code-socket CLI arg is provided
 * - Running as standalone extension outside of Kawa Code's process management
 */
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable, Writable, PassThrough } from 'stream';
import { log } from './protocol';

const EXTENSION_ID = 'i18n';
const EXTENSION_DOMAINS = ['i18n', 'auth', 'intent', 'intent-block', 'extension', 'repo', 'user'];

/**
 * Resolve the project root directory.
 *
 * Works whether running via tsx (src/ipc/) or compiled JS (dist/ipc/).
 */
function getProjectRoot(): string {
  // __dirname is src/ipc or dist/ipc — go up two levels
  return path.resolve(__dirname, '..', '..');
}

/**
 * Load the extension manifest (extension.json) from the project root.
 * Returns the parsed JSON object, or null if not found.
 */
function loadExtensionManifest(): Record<string, unknown> | null {
  const manifestPath = path.join(getProjectRoot(), 'extension.json');
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    log(`[KawaCodeSocket] Warning: Could not load extension.json: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Load the UI bundle JS content from disk.
 *
 * Reads the webComponent path from the manifest, resolving it relative
 * to the project root. Returns the JS source string, or null if unavailable.
 */
function loadUiBundle(manifest: Record<string, unknown> | null): string | null {
  if (!manifest) return null;

  const ui = manifest.ui as Record<string, unknown> | undefined;
  const wc = ui?.webComponent as Record<string, unknown> | undefined;
  if (!wc?.enabled || !wc?.path) return null;

  const bundlePath = path.join(getProjectRoot(), wc.path as string);
  try {
    return fs.readFileSync(bundlePath, 'utf-8');
  } catch (e) {
    log(`[KawaCodeSocket] Warning: Could not load UI bundle at ${bundlePath}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Kawa Code's Tauri bundle identifier.
 *
 * Used on macOS to locate the App Sandbox container when Kawa Code is
 * installed from the App Store. Third-party extension developers
 * should use this constant to discover the Kawa Code socket path.
 */
const KAWA_CODE_BUNDLE_ID = 'com.codeawareness.muninn';

export interface KawaCodeTransport {
  readable: Readable;
  writable: Writable;
  close: () => void;
}

/**
 * Get the default Kawa Code socket path for the current platform.
 *
 * On macOS, checks the App Sandbox container first (for App Store builds),
 * then falls back to the non-sandboxed path (for development builds).
 * Non-sandboxed processes CAN access files inside another app's container,
 * so third-party extensions work without special entitlements.
 */
export function getDefaultKawaCodeSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\muninn';
  }
  if (process.platform === 'darwin') {
    // App Store (sandboxed) Kawa Code: socket may be inside the sandbox container
    const containerSocketPath = path.join(
      os.homedir(),
      'Library', 'Containers', KAWA_CODE_BUNDLE_ID, 'Data',
      'Library', 'Application Support', 'Kawa Code', 'sockets', 'muninn'
    );
    if (fs.existsSync(containerSocketPath)) {
      log(`[KawaCodeSocket] Found sandbox socket at ${containerSocketPath}`);
      return containerSocketPath;
    }
  }
  // All platforms (incl. macOS dev/brew): ~/.kawa-code/sockets/muninn
  // Matches Kawa Code's paths.rs: sockets_dir().join("muninn")
  return path.join(os.homedir(), '.kawa-code', 'sockets', 'muninn');
}

/**
 * Connect to Kawa Code's Huginn socket as an extension client.
 *
 * Sends an extension handshake with clientType: "extension" and
 * the extension's domain subscriptions. Returns a transport object
 * with readable/writable streams that can be used in place of
 * stdin/stdout.
 */
export function connectToKawaCode(socketPath: string): Promise<KawaCodeTransport> {
  return new Promise((resolve, reject) => {
    log(`[KawaCodeSocket] Connecting to Kawa Code catalog at ${socketPath}...`);

    // Pre-load manifest and UI bundle before connecting
    const manifest = loadExtensionManifest();
    const uiBundle = loadUiBundle(manifest);

    // The readable stream for the extension to consume (replaces stdin)
    const readable = new PassThrough();

    // activeSocket is reassigned on Windows after catalog→client pipe handoff.
    // The writable listener writes to whichever socket is currently active.
    let activeSocket: net.Socket | null = null;

    // The writable stream for the extension to write to (replaces stdout)
    // Messages written here go directly to Kawa Code via the active socket
    const writable = new PassThrough();
    writable.on('data', (chunk: Buffer) => {
      if (!activeSocket) return;
      const data = chunk.toString();
      // Strip "MUNINN START:<caw> " prefix if present (legacy format)
      const lines = data.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const stripped = line.replace(/^MUNINN START:\S+\s/, '');
        activeSocket.write(stripped + '\n');
      }
    });

    let handshakeReceived = false;
    let switchedToClientPipe = false; // Windows: true after catalog→client pipe handoff
    let buffer = '';

    const catalogSocket = net.createConnection(socketPath, () => {
      log(`[KawaCodeSocket] Connected to Kawa Code catalog socket`);

      // Build handshake data with manifest + UI bundle for self-registration.
      // On Windows the catalog pipe uses a 4KB read buffer so only send the
      // small manifest here; the UI bundle is skipped (the Windows catalog
      // handler does not process it and it would overflow the buffer).
      const handshakeData: Record<string, unknown> = {
        clientType: 'extension',
        extensionId: EXTENSION_ID,
        domains: EXTENSION_DOMAINS,
      };

      if (manifest) {
        handshakeData.manifest = manifest;
        log(`[KawaCodeSocket] Including manifest in handshake (${JSON.stringify(manifest).length} bytes)`);
      }

      if (uiBundle) {
        handshakeData.uiBundle = uiBundle;
        log(`[KawaCodeSocket] Including UI bundle in handshake (${uiBundle.length} bytes)`);
      }

      const handshake = JSON.stringify({
        domain: 'system',
        action: 'handshake',
        data: handshakeData,
      });

      catalogSocket.write(handshake + '\n');
      log(`[KawaCodeSocket] Sent extension handshake`);
    });

    catalogSocket.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        if (!handshakeReceived) {
          // First message should be handshake response
          try {
            const msg = JSON.parse(line);
            if (msg.domain === 'system' && msg.action === 'handshake') {
              handshakeReceived = true;
              log(`[KawaCodeSocket] Handshake complete: caw=${msg.data?.caw}, extensionId=${msg.data?.extensionId}`);

              const pipePath: string | undefined = msg.data?.pipePath;

              if (pipePath) {
                // Windows two-pipe protocol: catalog pipe only handles registration.
                // Connect to the dedicated client pipe for bidirectional I/O.
                switchedToClientPipe = true;
                log(`[KawaCodeSocket] Switching to client pipe: ${pipePath}`);
                catalogSocket.destroy();
                setTimeout(() => {
                  connectClientPipe(pipePath, readable, writable, activeSocket, resolve, reject,
                    (sock) => { activeSocket = sock; });
                }, 50);
              } else {
                // Unix: single persistent connection
                activeSocket = catalogSocket;
                const transport: KawaCodeTransport = {
                  readable,
                  writable,
                  close: () => { catalogSocket.destroy(); },
                };
                resolve(transport);
              }
              continue;
            }
          } catch (e) {
            // Not valid JSON, pass through
          }
        }

        // Forward message to the extension's readable stream
        readable.push(line + '\n');
      }
    });

    catalogSocket.on('error', (err: Error) => {
      log(`[KawaCodeSocket] Catalog socket error: ${err.message}`);
      if (!handshakeReceived) {
        reject(new Error(`Failed to connect to Kawa Code: ${err.message}`));
      }
    });

    catalogSocket.on('close', () => {
      // On Windows the catalog pipe closes after handshake — expected, skip EOF.
      // On Unix the catalog socket IS the transport, so closing means EOF.
      if (!switchedToClientPipe) {
        log(`[KawaCodeSocket] Socket closed`);
        readable.push(null); // Signal EOF
      }
    });

    // Timeout for handshake
    setTimeout(() => {
      if (!handshakeReceived) {
        catalogSocket.destroy();
        reject(new Error('Kawa Code handshake timeout (10s)'));
      }
    }, 10000);
  });
}

/**
 * Connect to the dedicated client pipe returned in the Windows handshake.
 * On Windows, Kawa Code creates a per-client named pipe (\\.\pipe\caw.<id>)
 * for bidirectional communication after the catalog registration.
 */
function connectClientPipe(
  pipePath: string,
  readable: PassThrough,
  writable: PassThrough,
  _activeSocket: net.Socket | null,
  resolve: (transport: KawaCodeTransport) => void,
  reject: (err: Error) => void,
  setActiveSocket: (sock: net.Socket) => void,
): void {
  log(`[KawaCodeSocket] Connecting to client pipe: ${pipePath}`);

  let buffer = '';
  const clientSocket = net.createConnection(pipePath, () => {
    log(`[KawaCodeSocket] Client pipe connected`);
    setActiveSocket(clientSocket);

    const transport: KawaCodeTransport = {
      readable,
      writable,
      close: () => { clientSocket.destroy(); },
    };
    resolve(transport);
  });

  clientSocket.on('data', (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      readable.push(line + '\n');
    }
  });

  clientSocket.on('error', (err: Error) => {
    log(`[KawaCodeSocket] Client pipe error: ${err.message}`);
    reject(new Error(`Failed to connect to Kawa Code client pipe: ${err.message}`));
  });

  clientSocket.on('close', () => {
    log(`[KawaCodeSocket] Client pipe closed`);
    readable.push(null); // Signal EOF
  });
}
