import { useEffect, type ReactNode } from 'react';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';

import { queryClient } from '@core/api/queryClient';
import { supabase } from '@core/api/supabaseClient';
import { useAuthStore } from '@core/auth/authStore';
import { logger } from '@core/logging/logger';
import { analytics } from '@core/observability/analytics';
import { setSentryUser } from '@core/observability/sentry';

const PROFILE_ATTEMPTS = 4;
/** auth-js retries a failed refresh for up to 30s; do not hold the splash that long. */
const BOOTSTRAP_PATIENCE_MS = 8000;

function currentUserId(): string | undefined {
  return useAuthStore.getState().session?.user.id;
}

/**
 * Restores the persisted session on cold start and keeps the auth store in sync with
 * Supabase auth events. Loads the user's profile so the route guard can decide between
 * the profile-creation flow and the main app.
 *
 * Returns false when the fetch FAILED, and leaves the store alone. Only a
 * successful read that found no row may say "this user has no profile" — a
 * failed read used to say it too, which sent existing users on a bad network to
 * the create-profile screen.
 */
async function loadProfile(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.warn('Failed to load profile', { error: error.message });
    return false;
  }
  // The user may have signed out, or switched account, while this was in flight.
  if (currentUserId() === userId) useAuthStore.getState().setProfile(data);
  return true;
}

/** One retry loop per user at a time, however many auth events ask for it. */
const profileLoads = new Map<string, Promise<void>>();

function loadProfileWithRetry(userId: string): Promise<void> {
  const running = profileLoads.get(userId);
  if (running) return running;

  const run = (async () => {
    for (let attempt = 0; attempt < PROFILE_ATTEMPTS; attempt += 1) {
      if (currentUserId() !== userId) return;
      if (await loadProfile(userId)) return;
      const base = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((resolve) => setTimeout(resolve, base / 2 + Math.random() * (base / 2)));
    }
    logger.error('Profile load failed after retries', { attempts: PROFILE_ATTEMPTS });
    // With a profile already in memory the app keeps working on it. Without
    // one there is nothing to show, and "offline" is the honest answer.
    const state = useAuthStore.getState();
    if (state.session?.user.id === userId && !state.profile) state.setOffline();
  })().finally(() => profileLoads.delete(userId));

  profileLoads.set(userId, run);
  return run;
}

/**
 * Loads the user's admin roles. A normal user simply has no rows, so roles is []
 * and isAdmin/isSuperadmin stay false. This is UX gating only; RLS is authoritative.
 */
async function loadRoles(userId: string): Promise<void> {
  // Read role NAMES via the user_role_names view (joins user_roles.role_id -> roles.name).
  const { data, error } = await supabase
    .from('user_role_names')
    .select('role')
    .eq('user_id', userId);

  if (error) {
    logger.warn('Failed to load roles', { error: error.message });
    useAuthStore.getState().setRoles([]);
    return;
  }
  useAuthStore.getState().setRoles((data ?? []).map((r) => r.role));
}

function applySession(session: Session | null): void {
  const store = useAuthStore.getState();
  store.setSession(session);

  if (!session?.user) {
    setSentryUser(null);
    analytics.reset();
    store.setProfile(null);
    store.setRoles([]);
    // Many query keys carry no user id; without this the next person to sign in
    // on this phone is served the previous user's lists from cache.
    queryClient.clear();
    return;
  }

  const userId = session.user.id;
  setSentryUser(userId);
  analytics.identify(userId);
  void loadProfileWithRetry(userId);
  void loadRoles(userId);
}

/**
 * Reads the stored session and resolves the auth status from it. Also the
 * Retry action on the offline screen, so it must be safe to call repeatedly.
 */
export async function bootstrapAuth(): Promise<void> {
  useAuthStore.setState({ status: 'loading' });

  const patience = setTimeout(() => {
    if (useAuthStore.getState().status === 'loading') useAuthStore.getState().setOffline();
  }, BOOTSTRAP_PATIENCE_MS);

  try {
    const { data, error } = await supabase.auth.getSession();
    // A stored session whose refresh could not reach the server is still a
    // session. Reporting it as signed out put offline users on the login screen.
    if (!data.session && error && isAuthRetryableFetchError(error)) {
      useAuthStore.getState().setOffline();
      return;
    }
    applySession(data.session);
  } catch (cause) {
    // Unreadable storage (e.g. an invalidated Android Keystore). There is no
    // session to recover, so signing in again is the only way forward.
    logger.error('Auth bootstrap failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    applySession(null);
  } finally {
    clearTimeout(patience);
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  useEffect(() => {
    void bootstrapAuth();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // bootstrapAuth owns the first read; handling this too loaded everything twice.
      if (event === 'INITIAL_SESSION') return;

      // Same user, new token. Reloading the profile here gave every hourly
      // refresh a chance to fail and eject a signed-in user.
      if (event === 'TOKEN_REFRESHED' && useAuthStore.getState().profile) {
        useAuthStore.getState().setSession(session);
        return;
      }

      // Signing out issues no requests, so it is applied in the same tick: the
      // route guard must never see a signed-in status after signOut() resolves.
      if (!session) {
        applySession(null);
        return;
      }

      // Deferred: auth-js holds its lock while this callback runs, and
      // applySession issues Supabase requests.
      setTimeout(() => applySession(session), 0);
    });

    // Leave the "Can't connect" screen by itself when the network comes back.
    const stopWatchingNetwork = onlineManager.subscribe((online) => {
      if (online && useAuthStore.getState().status === 'offline') void bootstrapAuth();
    });

    return () => {
      sub.subscription.unsubscribe();
      stopWatchingNetwork();
    };
  }, []);

  return children;
}
