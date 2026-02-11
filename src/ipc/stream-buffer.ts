/**
 * CircularStreamBuffer - TypeScript port of Rust stream_buffer.rs
 *
 * Wire-format compatible with the Rust implementation:
 *   <byte-length-as-decimal>\n<json-payload>\n
 *
 * Metadata (.meta JSON file, snake_case keys):
 *   {"write_pos": 0, "read_pos": 0, "size": 1048576, "last_rotation": 1707234567890}
 *
 * Used for bidirectional large-message IPC between Muninn and extensions.
 */

import * as fs from 'fs';

/** Threshold above which messages should use stream buffers instead of STDOUT */
export const STREAM_THRESHOLD_BYTES = 65_536; // 64KB

const DEFAULT_BUFFER_SIZE = 1_048_576; // 1MB
const ROTATION_THRESHOLD_MS = 30_000;  // 30 seconds

interface StreamMeta {
  write_pos: number;
  read_pos: number;
  size: number;
  last_rotation: number;
}

export class CircularStreamBuffer {
  private streamPath: string;
  private metaPath: string;
  private bufferSize: number;
  private rotationThresholdMs: number;

  constructor(streamPath: string, bufferSize: number = DEFAULT_BUFFER_SIZE) {
    this.streamPath = streamPath;
    this.metaPath = `${streamPath}.meta`;
    this.bufferSize = bufferSize;
    this.rotationThresholdMs = ROTATION_THRESHOLD_MS;

    this.ensureStreamFile();
  }

  /**
   * Write a JSON-serializable object to the stream buffer.
   */
  write(data: object): void {
    // Reload meta from disk (cross-process sync)
    const meta = this.loadMeta();

    const json = JSON.stringify(data);
    const byteLength = Buffer.byteLength(json, 'utf-8');
    // Wire format: "<byteLength>\n<json>\n"
    const message = `${byteLength}\n${json}\n`;
    const messageBytes = Buffer.from(message, 'utf-8');

    // Check available space
    let available = this.getAvailableSpace(meta);

    if (messageBytes.length > available) {
      // Try rotation if reader is caught up and enough time has passed
      if (this.canRotate(meta)) {
        this.rotate(meta);
        // After rotation, full buffer is available
        available = meta.size;
      } else {
        throw new Error(
          `Stream buffer full: need ${messageBytes.length} bytes, have ${available}`
        );
      }
    }

    // Write the message, handling circular wrapping
    const fd = fs.openSync(this.streamPath, 'r+');
    try {
      let written = 0;
      while (written < messageBytes.length) {
        const writePos = (meta.write_pos + written) % meta.size;
        const remaining = messageBytes.length - written;
        const toEnd = meta.size - writePos;
        const chunkSize = Math.min(remaining, toEnd);

        fs.writeSync(fd, messageBytes, written, chunkSize, writePos);
        written += chunkSize;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // Update write position and save meta
    meta.write_pos = (meta.write_pos + messageBytes.length) % meta.size;
    this.saveMeta(meta);
  }

  /**
   * Read the next message from the stream buffer.
   * Returns the parsed object, or null if buffer is empty.
   */
  read(): object | null {
    // Reload meta from disk (cross-process sync)
    const meta = this.loadMeta();

    // Buffer empty?
    if (meta.read_pos === meta.write_pos) {
      return null;
    }

    const fd = fs.openSync(this.streamPath, 'r');
    try {
      // Read the length prefix (digits until newline)
      let lengthStr = '';
      let pos = meta.read_pos;

      while (true) {
        const readPos = pos % meta.size;
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, readPos);
        pos = (pos + 1) % meta.size;

        if (buf[0] === 0x0a) { // newline
          break;
        }

        lengthStr += String.fromCharCode(buf[0]);

        // Prevent infinite loop if we've caught up to write position
        if (pos === meta.write_pos) {
          return null;
        }
      }

      const messageLength = parseInt(lengthStr, 10);
      if (isNaN(messageLength) || messageLength === 0) {
        // Invalid or zero-length message; advance read_pos past the length prefix
        meta.read_pos = pos;
        this.saveMeta(meta);
        return null;
      }

      // Read the message data
      const messageBuf = Buffer.alloc(messageLength);
      let bytesRead = 0;

      while (bytesRead < messageLength) {
        const readPos = (pos + bytesRead) % meta.size;
        const remaining = messageLength - bytesRead;
        const toEnd = meta.size - readPos;
        const chunkSize = Math.min(remaining, toEnd);

        fs.readSync(fd, messageBuf, bytesRead, chunkSize, readPos);
        bytesRead += chunkSize;
      }

      // Skip trailing newline
      pos = (pos + messageLength + 1) % meta.size;

      // Update read position
      meta.read_pos = pos;
      this.saveMeta(meta);

      // Parse and return
      const jsonStr = messageBuf.toString('utf-8');
      return JSON.parse(jsonStr);
    } finally {
      fs.closeSync(fd);
    }
  }

  // -- Private helpers -------------------------------------------------------

  private loadMeta(): StreamMeta {
    if (fs.existsSync(this.metaPath)) {
      try {
        const raw = fs.readFileSync(this.metaPath, 'utf-8').trim();
        if (raw.length > 0) {
          return JSON.parse(raw) as StreamMeta;
        }
      } catch {
        // Fall through to defaults
      }
    }

    return {
      write_pos: 0,
      read_pos: 0,
      size: this.bufferSize,
      last_rotation: Date.now(),
    };
  }

  private saveMeta(meta: StreamMeta): void {
    fs.writeFileSync(this.metaPath, JSON.stringify(meta), 'utf-8');
  }

  private ensureStreamFile(): void {
    if (!fs.existsSync(this.streamPath)) {
      fs.writeFileSync(this.streamPath, Buffer.alloc(this.bufferSize));
    } else {
      const stat = fs.statSync(this.streamPath);
      if (stat.size !== this.bufferSize) {
        fs.writeFileSync(this.streamPath, Buffer.alloc(this.bufferSize));
        // Reset meta since file was recreated
        this.saveMeta({
          write_pos: 0,
          read_pos: 0,
          size: this.bufferSize,
          last_rotation: Date.now(),
        });
      }
    }
  }

  private getAvailableSpace(meta: StreamMeta): number {
    if (meta.write_pos >= meta.read_pos) {
      return (meta.size - meta.write_pos) + meta.read_pos;
    } else {
      return meta.read_pos - meta.write_pos;
    }
  }

  private canRotate(meta: StreamMeta): boolean {
    const timeSinceRotation = Date.now() - meta.last_rotation;
    const readerCaughtUp = meta.read_pos === meta.write_pos;
    return readerCaughtUp && timeSinceRotation >= this.rotationThresholdMs;
  }

  private rotate(meta: StreamMeta): void {
    meta.write_pos = 0;
    meta.read_pos = 0;
    meta.last_rotation = Date.now();
    this.saveMeta(meta);

    // Clear the file
    fs.writeFileSync(this.streamPath, Buffer.alloc(this.bufferSize));
  }
}
