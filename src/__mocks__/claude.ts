/**
 * Mock for Claude CLI
 *
 * Provides deterministic responses for testing without making actual API calls.
 * The mock can be configured per-test to return specific translations.
 */

import { spawn, ChildProcess } from 'child_process';

/** Mock response storage */
let mockResponses: Map<string, string> = new Map();

/** Mock error to throw */
let mockError: Error | null = null;

/** Track calls for assertions */
export const mockCalls: Array<{ prompt: string; workingDir?: string }> = [];

/**
 * Reset the mock state between tests
 */
export function resetMock(): void {
  mockResponses.clear();
  mockError = null;
  mockCalls.length = 0;
}

/**
 * Set a mock response for a specific prompt pattern
 * @param pattern - Regex or string to match against the prompt
 * @param response - The response to return
 */
export function setMockResponse(pattern: string | RegExp, response: string): void {
  const key = pattern instanceof RegExp ? pattern.source : pattern;
  mockResponses.set(key, response);
}

/**
 * Set a mock error to be thrown
 * @param error - The error to throw
 */
export function setMockError(error: Error): void {
  mockError = error;
}

/**
 * Generate mock translation responses for identifier batches
 * @param terms - Array of terms to translate
 * @param prefix - Prefix to add to each translation (e.g., "モック_" for Japanese mock)
 */
export function setMockTranslations(terms: string[], prefix: string = 'mock_'): void {
  // Create a numbered list response
  const response = terms.map((term, i) => `${i + 1}. ${prefix}${term}`).join('\n');
  setMockResponse('translate', response);
}

/**
 * Mock implementation of callClaude
 * Matches prompts against registered patterns and returns mock responses
 */
export async function callClaude(prompt: string, workingDir?: string): Promise<string> {
  // Track the call
  mockCalls.push({ prompt, workingDir });

  // Check for mock error
  if (mockError) {
    throw mockError;
  }

  // Check for specific response patterns
  for (const [pattern, response] of mockResponses.entries()) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(prompt)) {
      return response;
    }
  }

  // Default response - extract terms from prompt and return mock translations
  const termsMatch = prompt.match(/translate[^\n]*\n([\s\S]*?)(?:\n\n|$)/i);
  if (termsMatch) {
    const lines = termsMatch[1].split('\n').filter(l => l.trim());
    const terms = lines.map((l, i) => {
      const match = l.match(/^\d+\.\s*(.+)$/);
      return match ? match[1] : l;
    });

    if (terms.length > 0) {
      return terms.map((term, i) => `${i + 1}. mock_${term}`).join('\n');
    }
  }

  // Fallback response
  return 'Mock response from Claude CLI';
}

/**
 * Mock implementation of isClaudeCliAvailable
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  return true;
}

/**
 * Mock extractJsonFromResponse for testing
 */
export function extractJsonFromResponse(text: string): string {
  // Simple implementation for testing
  const trimmed = text.trim();

  // Try JSON block first
  const jsonBlockMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  // Try raw JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  return text;
}

// Export the mock module
export default {
  callClaude,
  isClaudeCliAvailable,
  extractJsonFromResponse,
  resetMock,
  setMockResponse,
  setMockError,
  setMockTranslations,
  mockCalls,
};
