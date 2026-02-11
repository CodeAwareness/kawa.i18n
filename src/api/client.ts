/**
 * API Client for Kawa API Dictionary Endpoints
 *
 * NOTE: Translation has been moved to local Claude CLI for zero-knowledge privacy.
 * This module now only handles dictionary sync (no code content sent to API).
 *
 * Functions removed (now in src/claude/):
 * - translateText() -> translateText in claude/translator.ts
 * - translateTerms() -> translateIdentifiers in claude/translator.ts
 * - translateProject() -> translateProject in claude/translator.ts
 * - uploadTerms() -> translateComments in claude/translator.ts
 */

import fetch, { RequestInit as NodeRequestInit } from 'node-fetch';
import crypto from 'crypto';
import { Dictionary, LanguageCode } from '../core/types';
import { getAccessToken } from '../auth/store';

const API_BASE_URL = process.env.KAWA_API_URL || 'https://api.codeawareness.com';

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DictionaryData {
  origin: string;
  language: string;
  terms: Record<string, string>;
  comments?: Record<string, any>;
}

export interface TranslateProjectResponse extends DictionaryData {
  totalTerms: number;
  totalComments: number;
  batchCount: number;
}

/**
 * Get authentication token from auth store or environment
 *
 * Auth tokens are received from Muninn via brdc:auth:info broadcasts
 * and stored in memory. This is more secure than reading from encrypted
 * storage because:
 * 1. Only Muninn handles encryption/decryption
 * 2. Tokens only exist in memory (not persisted by extensions)
 * 3. Single point of credential management
 */
function getAuthToken(): string | null {
  // Try environment variable first (for testing/debugging)
  if (process.env.KAWA_AUTH_TOKEN) {
    return process.env.KAWA_AUTH_TOKEN;
  }

  // Get token from in-memory auth store (received from Muninn)
  return getAccessToken();
}

/**
 * Make authenticated API request
 * Automatically prepends /v1/i18n to all endpoints
 */
async function apiRequest<T>(
  endpoint: string,
  options: NodeRequestInit = {}
): Promise<APIResponse<T>> {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Automatically prepend /v1/i18n to all endpoints
  const fullEndpoint = `/v1/i18n${endpoint}`;

  try {
    const response = await fetch(`${API_BASE_URL}${fullEndpoint}`, {
      ...options,
      headers,
    } as NodeRequestInit);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API error ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      data: data as T,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Network error: ${error.message}`,
    };
  }
}

/**
 * Download dictionary from API
 *
 * This is the only API call that remains - it syncs team dictionaries
 * which contain only translated terms, NOT source code.
 *
 * @param origin - Repository origin URL
 * @param language - Target language code
 * @param since - Optional date for incremental sync (YYYY-MM-DD)
 * @returns Dictionary data or error
 */
export async function downloadDictionary(
  origin: string,
  language: LanguageCode,
  since?: string
): Promise<APIResponse<DictionaryData>> {
  // Build query parameters
  const params = new URLSearchParams({
    origin,
    language,
  });

  if (since) {
    params.append('since', since);
  }

  return apiRequest<DictionaryData>(
    `/dictionary?${params.toString()}`,
    {
      method: 'GET',
    }
  );
}

/**
 * Convert API dictionary data to local Dictionary format
 *
 * Handles two comment formats:
 * - Flat: { originalComment: translatedComment } (from translateProject)
 * - Hash-keyed: { md5Hash: { en: "...", ja: "..." } } (from API download)
 *
 * Always normalizes to hash-keyed multi-lang format for MultiLangDictionary.
 */
export function apiToLocalDictionary(apiData: DictionaryData | TranslateProjectResponse): Dictionary {
  const now = new Date().toISOString();

  // Normalize comments to hash-keyed multi-lang format
  let comments = apiData.comments;
  if (comments && Object.keys(comments).length > 0) {
    const firstValue = Object.values(comments)[0];
    if (typeof firstValue === 'string') {
      // Flat format from translateProject: { originalComment: translatedComment }
      // Convert to: { md5Hash: { en: originalComment, [lang]: translatedComment } }
      const normalized: Record<string, { en: string; [lang: string]: string }> = {};
      for (const [original, translated] of Object.entries(comments)) {
        const hash = crypto.createHash('md5').update(original.trim()).digest('hex');
        normalized[hash] = {
          en: original,
          [apiData.language]: translated as string,
        };
      }
      comments = normalized;
    }
  }

  return {
    origin: apiData.origin,
    language: apiData.language as LanguageCode,
    terms: apiData.terms,
    comments,
    metadata: {
      createdAt: now,
      updatedAt: now,
      lastSyncDate: now,
      version: '1.0.0',
    },
  };
}
