import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import type { AppRole, Database } from '@shared/types/database.types';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export type AuthStatus = 'loading' | 'signed_out' | 'needs_profile' | 'signed_in';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  /** Derived: moderator or superadmin. UX gating only — RLS is the real boundary. */
  isAdmin: boolean;
  isSuperadmin: boolean;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setRoles: (roles: AppRole[]) => void;
  reset: () => void;
}

/**
 * Client-side auth state. The source of truth for the session is Supabase (persisted
 * in secure storage); this store mirrors it for synchronous access in the UI and
 * derives a single `status` used by the route guard.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  profile: null,
  roles: [],
  isAdmin: false,
  isSuperadmin: false,
  setSession: (session) =>
    set(() => ({
      session,
      status: session ? (get().profile ? 'signed_in' : 'needs_profile') : 'signed_out',
    })),
  setProfile: (profile) =>
    set((state) => ({
      profile,
      status: !state.session ? 'signed_out' : profile ? 'signed_in' : 'needs_profile',
    })),
  setRoles: (roles) =>
    set(() => ({
      roles,
      isAdmin: roles.includes('moderator') || roles.includes('superadmin'),
      isSuperadmin: roles.includes('superadmin'),
    })),
  reset: () =>
    set(() => ({
      status: 'signed_out',
      session: null,
      profile: null,
      roles: [],
      isAdmin: false,
      isSuperadmin: false,
    })),
}));
