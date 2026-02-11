/**
 * Claude CLI Wrapper
 *
 * Spawns the claude CLI subprocess for local translation.
 * This keeps all code on the user's machine, maintaining the zero-knowledge privacy model.
 *
 * Pattern based on kawa.muninn's claude_api.rs implementation.
 */

import { spawn, ChildProcess } from 'child_process';
import { log } from '../ipc/protocol';

/** Response structure from claude CLI with --output-format json */
interface ClaudeJsonResponse {
  response_type: string;
  subtype: string;
  is_error?: boolean;
  result?: string;
}

/** Timeout for claude CLI process (5 minutes) */
const PROCESS_TIMEOUT_MS = 300_000;

/** Maximum prompt size (1MB) */
const MAX_PROMPT_SIZE = 1_000_000;

/**
 * Call the claude CLI with a prompt and return the response.
 *
 * Uses --print --output-format json for structured output.
 * Implements 5-minute timeout to prevent hanging.
 *
 * @param prompt - The prompt to send to Claude
 * @param workingDir - Optional working directory for the subprocess
 * @returns The response text from Claude
 * @throws Error if CLI fails, times out, or is not installed
 */
export async function callClaude(prompt: string, workingDir?: string): Promise<string> {
  // Validate prompt size
  if (prompt.length > MAX_PROMPT_SIZE) {
    throw new Error(`Prompt too large: ${prompt.length} bytes (max ${MAX_PROMPT_SIZE})`);
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timeoutId: NodeJS.Timeout;

    try {
      // Spawn claude CLI with JSON output format
      const args = ['--print', '--output-format', 'json'];

      child = spawn('claude', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure consistent behavior
          TERM: 'dumb',
        },
      });

      // Handle spawn error (e.g., claude not installed)
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeoutId);
        if (error.code === 'ENOENT') {
          reject(new Error(
            'Claude CLI not found. Please install it: https://docs.anthropic.com/claude-code/getting-started'
          ));
        } else {
          reject(new Error(`Failed to spawn claude CLI: ${error.message}`));
        }
      });

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!killed) {
          killed = true;
          log('[Claude CLI] Timeout after 5 minutes, killing process');
          child.kill('SIGTERM');
          // Give it a moment to terminate gracefully
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 1000);
          reject(new Error('Claude CLI timed out after 5 minutes'));
        }
      }, PROCESS_TIMEOUT_MS);

      // Collect stdout
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Collect stderr for debugging
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process exit
      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);

        if (killed) {
          return; // Already handled by timeout
        }

        if (code !== 0) {
          log(`[Claude CLI] Process exited with code ${code}`);
          if (stderr) {
            log(`[Claude CLI] stderr: ${stderr}`);
          }
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || 'Unknown error'}`));
          return;
        }

        try {
          // Parse JSON response
          const response = parseClaudeResponse(stdout);
          resolve(response);
        } catch (error: any) {
          log(`[Claude CLI] Failed to parse response: ${error.message}`);
          log(`[Claude CLI] Raw stdout: ${stdout.substring(0, 500)}...`);
          reject(error);
        }
      });

      // Write prompt to stdin and close it (signals EOF)
      if (child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      } else {
        clearTimeout(timeoutId);
        reject(new Error('Failed to write to claude CLI stdin'));
      }
    } catch (error: any) {
      reject(new Error(`Failed to call claude CLI: ${error.message}`));
    }
  });
}

/**
 * Parse the JSON response from claude CLI.
 *
 * The CLI returns a JSON object with response_type, subtype, and result fields.
 * The actual content is in the result field.
 */
function parseClaudeResponse(stdout: string): string {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error('Empty response from claude CLI');
  }

  try {
    const response: ClaudeJsonResponse = JSON.parse(trimmed);

    if (response.is_error) {
      throw new Error(`Claude CLI error: ${response.result || 'Unknown error'}`);
    }

    if (!response.result) {
      throw new Error('No result in claude CLI response');
    }

    return response.result;
  } catch (error: any) {
    if (error.message.includes('Claude CLI error')) {
      throw error;
    }

    // JSON parsing failed - try to extract content
    log('[Claude CLI] Response is not valid JSON, attempting extraction');
    return extractJsonFromResponse(trimmed);
  }
}

/**
 * Extract JSON content from a response that may be wrapped in markdown.
 *
 * Claude sometimes returns JSON wrapped in ```json ... ``` blocks.
 * This function handles various formats:
 * 1. ```json ... ``` blocks
 * 2. ``` ... ``` blocks
 * 3. Raw JSON starting with { or [
 * 4. JSON embedded in text
 */
export function extractJsonFromResponse(text: string): string {
  // 1. Try ```json ... ``` blocks first (most reliable)
  const jsonBlockMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    const extracted = jsonBlockMatch[1].trim();
    if (isBalancedJson(extracted)) {
      return extracted;
    }
  }

  // 2. Try ``` ... ``` blocks
  const codeBlockMatch = text.match(/```\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    if (isBalancedJson(extracted)) {
      return extracted;
    }
  }

  // 3. If starts with { or [, validate and return if balanced
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (isBalancedJson(trimmed)) {
      return trimmed;
    }
  }

  // 4. Find balanced JSON anywhere in text
  const found = findBalancedJson(text);
  if (found) {
    return found;
  }

  // 5. Return as-is if nothing found (caller will handle)
  return text;
}

/**
 * Check if a string contains balanced JSON brackets.
 * Handles strings and escape sequences correctly.
 */
function isBalancedJson(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (const char of text) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth < 0) return false;
      }
    }
  }

  return depth === 0 && !inString;
}

/**
 * Find balanced JSON object or array in text.
 * Scans for { or [ and extracts until balanced closing bracket.
 */
function findBalancedJson(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{' || char === '[') {
      const closeChar = char === '{' ? '}' : ']';
      let depth = 1;
      let inString = false;
      let escapeNext = false;
      let j = i + 1;

      while (j < text.length && depth > 0) {
        const c = text[j];

        if (escapeNext) {
          escapeNext = false;
          j++;
          continue;
        }

        if (c === '\\' && inString) {
          escapeNext = true;
          j++;
          continue;
        }

        if (c === '"') {
          inString = !inString;
        } else if (!inString) {
          if (c === char) {
            depth++;
          } else if (c === closeChar) {
            depth--;
          }
        }
        j++;
      }

      if (depth === 0) {
        const extracted = text.substring(i, j);
        // Verify it's valid by trying to parse
        try {
          JSON.parse(extracted);
          return extracted;
        } catch {
          // Continue looking
        }
      }
    }
  }

  return null;
}

/** Options for callClaudeWithRetry */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 2000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 15000) */
  maxDelayMs?: number;
  /** Called before each retry attempt */
  onRetry?: (attempt: number, maxRetries: number, error: Error, delayMs: number) => void;
}

/**
 * Check if an error is retryable (transient API/server issue).
 *
 * Retryable: overwhelmed, overloaded, rate limit, 429, 503, timed out
 * Non-retryable: ENOENT (CLI not found), Prompt too large
 */
export function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();

  // Non-retryable errors - fail immediately
  if (msg.includes('enoent') || msg.includes('prompt too large')) {
    return false;
  }

  // Retryable errors
  const retryablePatterns = ['overwhelmed', 'overloaded', 'rate limit', '429', '503', 'timed out'];
  return retryablePatterns.some(pattern => msg.includes(pattern));
}

/**
 * Call the claude CLI with retry and exponential backoff.
 *
 * Wraps callClaude with automatic retries for transient errors.
 * Non-retryable errors (ENOENT, Prompt too large) fail immediately.
 *
 * @param prompt - The prompt to send to Claude
 * @param workingDir - Optional working directory for the subprocess
 * @param options - Retry configuration
 * @returns The response text from Claude
 */
export async function callClaudeWithRetry(
  prompt: string,
  workingDir?: string,
  options?: RetryOptions
): Promise<string> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  const maxDelayMs = options?.maxDelayMs ?? 15000;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callClaude(prompt, workingDir);
    } catch (error: any) {
      lastError = error;

      // Don't retry non-retryable errors
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't retry after last attempt
      if (attempt >= maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff: baseDelay * 2^attempt
      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      log(`[Claude CLI] Retryable error on attempt ${attempt + 1}/${maxRetries + 1}: ${error.message}`);
      log(`[Claude CLI] Retrying in ${delayMs}ms...`);

      if (options?.onRetry) {
        options.onRetry(attempt + 1, maxRetries, error, delayMs);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError!;
}

/**
 * Check if claude CLI is available on the system.
 * @returns true if claude CLI is installed and accessible
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('error', () => {
      resolve(false);
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}
