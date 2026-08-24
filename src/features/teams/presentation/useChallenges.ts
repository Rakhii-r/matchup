import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { challengeRepository } from '@features/teams/data/challengeRepository';
import { buildEndAt, buildScheduledAt } from '@features/matches/domain/matchSchema';
import type {
  Challenge,
  CreateChallengeForm,
  PostOpenChallengeForm,
} from '@features/teams/domain/challengeSchema';

const challengesKey = (userId: string | undefined) =>
  ['challenges', userId ?? 'anon'] as const;

export function useMyChallenges() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: challengesKey(userId),
    queryFn: () => challengeRepository.listMine(),
    enabled: Boolean(userId),
  });
}

/**
 * Accepting a challenge creates a match and confirms both squads, so the
 * matches lists have to be refetched too, not just the challenge list.
 */
function useInvalidateAfterChallengeChange() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  return () => {
    void qc.invalidateQueries({ queryKey: challengesKey(userId) });
    void qc.invalidateQueries({ queryKey: ['challenges', 'offers', userId ?? 'anon'] });
    // Prefix key: covers ['challenge', id], its candidate lists and the radar's
    // ['challenge', id, 'candidates', 'full'], all of which go stale the moment
    // a challenge is accepted, declined or withdrawn.
    void qc.invalidateQueries({ queryKey: ['challenge'] });
    void qc.invalidateQueries({ queryKey: ['matches', 'mine', userId ?? 'anon'] });
    void qc.invalidateQueries({ queryKey: ['matches', 'joined', userId ?? 'anon'] });
  };
}

export function useCreateChallenge(fromTeamId: string) {
  const invalidate = useInvalidateAfterChallengeChange();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (form: CreateChallengeForm): Promise<Challenge> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const when = buildScheduledAt(form.dayOffset, form.timeHHmm);
      if (when.getTime() <= Date.now()) {
        throw new AppError('validation', 'Pick a date and time in the future.');
      }

      // Everything else (owner check, sport match, capacity, duplicate pending)
      // is enforced inside create_challenge under a row lock.
      return challengeRepository.create({
        fromTeamId,
        opponentCode: form.opponentCode,
        matchName: form.matchName,
        venueId: form.venueId,
        scheduledAt: when.toISOString(),
        totalSlots: form.totalSlots,
        message: form.message ?? null,
      });
    },
    onSuccess: invalidate,
  });
}

/**
 * Post an open challenge. Resolves even when the matcher found nobody — an
 * empty candidate list is a valid answer, and the caller shows the count from
 * `useChallengeCandidates` rather than treating zero as failure.
 */
export function usePostOpenChallenge(fromTeamId: string) {
  const invalidate = useInvalidateAfterChallengeChange();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (form: PostOpenChallengeForm): Promise<Challenge> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const when = buildScheduledAt(form.dayOffset, form.timeHHmm);
      if (when.getTime() <= Date.now()) {
        throw new AppError('validation', 'Pick a date and time in the future.');
      }

      // Owner check, one-live-challenge rule and venue validity are all
      // enforced inside post_open_challenge.
      return challengeRepository.postOpen({
        fromTeamId,
        matchName: form.matchName,
        areaName: form.areaName,
        scheduledAt: when.toISOString(),
        totalSlots: form.totalSlots,
        message: form.message ?? null,
        radiusM: form.radiusM,
        // Undefined for every caller that predates the wizard, which leaves the
        // RPC's 'friendly' default and a null end_time — the old behaviour.
        gameType: form.gameType ?? null,
        endTime:
          buildEndAt(form.dayOffset, form.timeHHmm, form.endTimeHHmm)?.toISOString() ?? null,
        lat: form.lat ?? null,
        lng: form.lng ?? null,
        venueId: form.venueId ?? null,
      });
    },
    onSuccess: invalidate,
  });
}

/**
 * Accept a fixture offered to one of my teams. Losing this race is expected,
 * not exceptional — the caller should surface CHALLENGE_ALREADY_TAKEN as
 * information rather than an error state.
 */
export function useAcceptOpenChallenge() {
  const invalidate = useInvalidateAfterChallengeChange();

  return useMutation({
    mutationFn: ({ challengeId, teamId }: { challengeId: string; teamId: string }) =>
      challengeRepository.acceptOpen(challengeId, teamId),
    onSuccess: invalidate,
  });
}
export function useDeclineOpenChallenge() {
  const invalidate = useInvalidateAfterChallengeChange();
  return useMutation({ mutationFn: ({ challengeId, teamId }: { challengeId: string; teamId: string }) => challengeRepository.declineOpen(challengeId, teamId), onSuccess: invalidate });
}

/** Fixtures offered to my teams, still unanswered. Drives the Offers screen. */
export function useMyOffers() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['challenges', 'offers', userId ?? 'anon'] as const,
    queryFn: () => challengeRepository.listMyOffers(),
    enabled: Boolean(userId),
  });
}

/** Who the matcher reached. Poster-side only; empty until a challenge is open. */
export function useChallengeCandidates(challengeId: string | null) {
  return useQuery({
    queryKey: ['challenge', challengeId ?? 'none', 'candidates'] as const,
    queryFn: () => challengeRepository.listCandidates(challengeId as string),
    enabled: Boolean(challengeId),
  });
}

/** One challenge row. Drives the radar's radius copy and its stop condition. */
export function useChallenge(challengeId: string | null) {
  return useQuery({
    queryKey: ['challenge', challengeId ?? 'none'] as const,
    queryFn: () => challengeRepository.getById(challengeId as string),
    enabled: Boolean(challengeId),
  });
}

/**
 * The same candidates as `useChallengeCandidates`, but through the RPC that
 * resolves each team's name and record — the only version fit to render.
 *
 * Polls every 5s so a candidate that answers (or that a later ranking pass
 * adds) shows up on the radar without a manual refresh. The poll stops as soon
 * as the challenge is no longer open, which the caller knows and this hook does
 * not: pass `isOpen` from `useChallenge`. It also stops on its own once a row
 * reads 'accepted', so a stale `isOpen` cannot leave an interval running
 * against a fixture that is already settled.
 */
export function useChallengeCandidatesFull(challengeId: string | null, isOpen = true) {
  return useQuery({
    queryKey: ['challenge', challengeId ?? 'none', 'candidates', 'full'] as const,
    queryFn: () => challengeRepository.candidatesForChallenge(challengeId as string),
    enabled: Boolean(challengeId),
    refetchInterval: (query) => {
      if (!isOpen) return false;
      const rows = query.state.data;
      if (rows?.some((row) => row.status === 'accepted')) return false;
      return 5000;
    },
  });
}

export function useRespondToChallenge() {
  const invalidate = useInvalidateAfterChallengeChange();

  return useMutation({
    mutationFn: ({ challengeId, accept }: { challengeId: string; accept: boolean }) =>
      challengeRepository.respond(challengeId, accept),
    onSuccess: invalidate,
  });
}

export function useCancelChallenge() {
  const invalidate = useInvalidateAfterChallengeChange();

  return useMutation({
    mutationFn: (challengeId: string) => challengeRepository.cancel(challengeId),
    onSuccess: invalidate,
  });
}

/**
 * Opponent team expresses interest / sends a challenge request to an open fixture.
 */
export function useApplyToChallenge() {
  const invalidate = useInvalidateAfterChallengeChange();

  return useMutation({
    mutationFn: ({ challengeId, teamId }: { challengeId: string; teamId: string }) =>
      challengeRepository.applyToChallenge(challengeId, teamId),
    onSuccess: invalidate,
  });
}

/**
 * Opponent teams browse open fixtures in their area looking for matches.
 */
export function useCleanupMyOpenFixtures() {
  const invalidate = useInvalidateAfterChallengeChange();

  return useMutation({
    mutationFn: () => challengeRepository.cleanupMyOpenFixtures(),
    onSuccess: invalidate,
  });
}

/**
 * Opponent teams browse open fixtures in their area looking for matches.
 */
export function useNearbyOpenChallenges(coords?: { lat: number; lng: number } | null, sport?: string | null) {
  return useQuery({
    queryKey: ['challenges', 'nearby', coords?.lat ?? 'none', coords?.lng ?? 'none', sport ?? 'all'] as const,
    queryFn: () =>
      challengeRepository.listNearbyOpenChallenges({
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        sport: sport ?? null,
      }),
    refetchInterval: 10000,
  });
}



