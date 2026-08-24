import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { dashboardRepository } from '@features/dashboard/data/dashboardRepository';

const key = (userId: string | undefined, part: string) =>
  ['dashboard', userId ?? 'anon', part] as const;

export function usePlayerStats() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: key(userId, 'stats'),
    queryFn: () => dashboardRepository.stats(),
    enabled: Boolean(userId),
  });
}

export function useNextMatch() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: key(userId, 'next'),
    queryFn: () => dashboardRepository.nextMatch(),
    enabled: Boolean(userId),
  });
}

export function useRecentMatches(limit = 5) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: [...key(userId, 'recent'), limit] as const,
    queryFn: () => dashboardRepository.recentMatches(limit),
    enabled: Boolean(userId),
  });
}

/**
 * Per-match batting cards for the Profile statistics screen. Its own key part,
 * because `useRecentMatches` is a different shape from a different RPC and
 * sharing 'recent' would let one overwrite the other in the cache.
 */
export function usePlayerBattingHistory(limit = 10) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: [...key(userId, 'batting'), limit] as const,
    queryFn: () => dashboardRepository.battingHistory(limit),
    enabled: Boolean(userId),
  });
}

export function useNotifications(limit = 50) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: [...key(userId, 'notifications'), limit] as const,
    queryFn: () => dashboardRepository.notifications(limit),
    enabled: Boolean(userId),
  });
}

/**
 * Drives both the Home "Your actions" list and the Activity tab badge.
 *
 * Polls every 60s: an invite or a challenge can arrive while the app is open,
 * and this is the surface that tells the user. Slow enough to be invisible on
 * battery, fast enough that the badge is not stale by the time they look.
 */
export function usePendingActions() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: key(userId, 'actions'),
    queryFn: () => dashboardRepository.pendingActions(),
    enabled: Boolean(userId),
    refetchInterval: 60000,
  });
}
