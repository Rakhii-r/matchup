import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { analytics } from '@core/observability/analytics';
import { safetyRepository } from '@features/safety/data/safetyRepository';

export function useReportUser() {
  const reporterId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (input: {
      reportedUserId: string;
      matchId?: string | null;
      reason: string;
      details?: string | null;
    }) => {
      if (!reporterId) throw new AppError('unauthorized', 'Please sign in again.');
      if (reporterId === input.reportedUserId) {
        throw new AppError('validation', 'You cannot report yourself.');
      }
      return safetyRepository.createReport({
        reporterId,
        reportedUserId: input.reportedUserId,
        matchId: input.matchId ?? null,
        reason: input.reason,
        details: input.details ?? null,
      });
    },
    onSuccess: () => analytics.capture('user_reported'),
  });
}

export const blockedKey = ['safety', 'blocked'] as const;

export function useBlockedUsers() {
  const blockerId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: blockedKey,
    queryFn: () => safetyRepository.listBlocked(blockerId as string),
    enabled: Boolean(blockerId),
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  const blockerId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (blockedId: string) => {
      if (!blockerId) throw new AppError('unauthorized', 'Please sign in again.');
      return safetyRepository.unblockUser({ blockerId, blockedId });
    },
    onSuccess: () => {
      analytics.capture('user_unblocked');
      // Same reason as blocking: visibility changes across matches, players
      // and availability, so nothing narrower than a full refresh is correct.
      void qc.invalidateQueries();
    },
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  const blockerId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (blockedId: string) => {
      if (!blockerId) throw new AppError('unauthorized', 'Please sign in again.');
      if (blockerId === blockedId) {
        throw new AppError('validation', 'You cannot block yourself.');
      }
      return safetyRepository.blockUser({ blockerId, blockedId });
    },
    onSuccess: () => {
      analytics.capture('user_blocked');
      // Blocking changes visibility (matches, players, availability) — refresh broadly.
      void qc.invalidateQueries();
    },
  });
}
