/**
 * Auth Store - In-memory storage for auth tokens received from Kawa Code
 *
 * Tokens are received via brdc:auth:info broadcasts from Kawa Code.
 * This module stores them in memory and provides access to the API client.
 */

import { log } from '../ipc/protocol';

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface TokenInfo {
  token: string;
  expires: string;
}

export interface Tokens {
  access: TokenInfo;
  refresh: TokenInfo;
}

export interface AuthState {
  authenticated: boolean;
  user: User | null;
  tokens: Tokens | null;
}

// In-memory auth state
let authState: AuthState = {
  authenticated: false,
  user: null,
  tokens: null,
};

/**
 * Update auth state from Kawa Code broadcast
 */
export function setAuthState(data: any): void {
  authState = {
    authenticated: data?.authenticated ?? false,
    user: data?.user ?? null,
    tokens: data?.tokens ?? null,
  };

  if (authState.authenticated && authState.user) {
    log(`Auth state updated: authenticated as ${authState.user.email}`);
  } else {
    log('Auth state updated: not authenticated');
  }
}

/**
 * Get current auth state
 */
export function getAuthState(): AuthState {
  return authState;
}

/**
 * Get access token for API calls
 */
export function getAccessToken(): string | null {
  return authState.tokens?.access?.token ?? null;
}

/**
 * Check if authenticated
 */
export function isAuthenticated(): boolean {
  return authState.authenticated && authState.tokens?.access?.token != null;
}

/**
 * Token refresh callback — set by index.ts to request fresh tokens from Kawa Code.
 * Used by apiRequest to automatically retry on 401 without circular dependencies.
 */
let refreshTokenCallback: (() => Promise<void>) | null = null;

export function setRefreshTokenCallback(cb: () => Promise<void>): void {
  refreshTokenCallback = cb;
}

export async function refreshToken(): Promise<boolean> {
  if (!refreshTokenCallback) return false;
  try {
    await refreshTokenCallback();
    return isAuthenticated();
  } catch {
    return false;
  }
}

/**
 * Clear auth state (on logout)
 */
export function clearAuthState(): void {
  authState = {
    authenticated: false,
    user: null,
    tokens: null,
  };
  log('Auth state cleared');
}
