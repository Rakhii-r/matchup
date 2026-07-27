import { useEffect, type ReactNode } from 'react';

import { supabase } from '@core/api/supabaseClient';
import { useAuthStore } from '@core/auth/authStore';
import { logger } from '@core/logging/logger';
import { analytics } from '@core/observability/analytics';
import { setSentryUser } from '@core/observability/sentry';

/**
 * Restores the persisted session on cold start and keeps the auth store in sync with
 * Supabase auth events. Loads the user's profile so the route guard can decide between
 * the profile-creation flow and the main app.
 */
async function loadProfile(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Failed to load profile', { error: error.message });
    useAuthStore.getState().setProfile(null);
    return;
  }
  useAuthStore.getState().setProfile(data);
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

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        const userId = data.session.user.id;
        setSentryUser(userId);
        analytics.identify(userId);
        await Promise.all([loadProfile(userId), loadRoles(userId)]);
      } else {
        useAuthStore.getState().setProfile(null);
        useAuthStore.getState().setRoles([]);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        const userId = session.user.id;
        setSentryUser(userId);
        analytics.identify(userId);
        void loadProfile(userId);
        void loadRoles(userId);
      } else {
        setSentryUser(null);
        analytics.reset();
        useAuthStore.getState().setProfile(null);
        useAuthStore.getState().setRoles([]);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [setSession]);

  return children;
}
