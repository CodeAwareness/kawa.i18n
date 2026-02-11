/**
 * Auth Store - In-memory storage for auth tokens received from Muninn
 *
 * Tokens are received via brdc:auth:info broadcasts from Muninn.
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
 * Update auth state from Muninn broadcast
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
