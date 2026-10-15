import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { env } from '@core/config/env';
import { secureStorage } from '@core/storage/secureStore';
import type { Database } from '@shared/types/database.types';

const REQUEST_TIMEOUT_MS = 15_000;
/** Uploads carry a body over what may be a slow uplink. */
const STORAGE_TIMEOUT_MS = 30_000;

/**
 * React Native's fetch has no timeout: on a connection that stalls rather than
 * fails, a request never settles and its spinner never stops. Every Supabase
 * request (auth, REST, storage, functions) goes through this, so each one ends
 * in a response or an abort. An abort surfaces as a `network` AppError.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    url.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
  );

  // Keep honouring a caller's own signal (TanStack Query cancels through one).
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

/**
 * Single Supabase client for the app. The auth session is persisted in the
 * Keychain/Keystore via secureStorage — never AsyncStorage in plaintext.
 *
 * Every request carries the user's JWT, so Row-Level Security applies automatically.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});

/**
 * Drive token auto-refresh from app foreground/background state. Supabase only
 * refreshes while the app is active; pausing in the background avoids wasted work.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
