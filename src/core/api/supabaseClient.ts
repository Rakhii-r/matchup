import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { env } from '@core/config/env';
import { secureStorage } from '@core/storage/secureStore';
import type { Database } from '@shared/types/database.types';

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
