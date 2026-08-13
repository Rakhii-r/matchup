import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import type { Coords } from '@core/location/location';
import { analytics } from '@core/observability/analytics';
import { matchRepository } from '@features/matches/data/matchRepository';
import { buildScheduledAt } from '@features/matches/domain/matchSchema';
import type { CreateMatchForm, Match } from '@features/matches/domain/matchSchema';
import type { PlayerStatus, Sport } from '@shared/types/database.types';
import { venueRepository } from '@features/venues/data/venueRepository';

const matchKey = (id: string) => ['match', id] as const;
const playersKey = (id: string) => ['match', id, 'players'] as const;
const membershipKey = (id: string, userId: string | undefined) =>
  ['match', id, 'membership', userId ?? 'anon'] as const;
const attendanceKey = (id: string) => ['match', id, 'attendance'] as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useMatch(matchId: string) {
  return useQuery({
    queryKey: matchKey(matchId),
    queryFn: () => matchRepository.getById(matchId),
    enabled: matchId.length > 0,
  });
}

export function useMatchPlayers(matchId: string) {
  return useQuery({
    queryKey: playersKey(matchId),
    queryFn: () => matchRepository.listPlayers(matchId),
    enabled: matchId.length > 0,
  });
}

/**
 * The two squads in a team fixture. Returns null fields for an ordinary match,
 * which the roster renders as a single ungrouped list.
 */
export function useMatchSides(matchId: string) {
  return useQuery({
    queryKey: ['match', matchId, 'sides'] as const,
    queryFn: () => matchRepository.getSides(matchId),
    enabled: matchId.length > 0,
  });
}

export function useMyMembership(matchId: string) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: membershipKey(matchId, userId),
    queryFn: () => matchRepository.getMyMembership(matchId, userId as string),
    enabled: matchId.length > 0 && Boolean(userId),
  });
}

export function useAttendance(matchId: string) {
  return useQuery({
    queryKey: attendanceKey(matchId),
    queryFn: () => matchRepository.listAttendance(matchId),
    enabled: matchId.length > 0,
  });
}

export function useMyMatches() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['matches', 'mine', userId ?? 'anon'] as const,
    queryFn: () => matchRepository.listMine(userId as string),
    enabled: Boolean(userId),
  });
}

/** Matches the user joined (any queue status), newest request first. */
export function useJoinedMatches() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['matches', 'joined', userId ?? 'anon'] as const,
    queryFn: () => matchRepository.listJoined(userId as string),
    enabled: Boolean(userId),
  });
}

export function useNearbyMatches(coords: Coords | null, sport: Sport | null) {
  return useQuery({
    queryKey: ['matches', 'nearby', coords?.lat ?? 0, coords?.lng ?? 0, sport ?? 'all'] as const,
    queryFn: () =>
      matchRepository.nearby({
        lat: (coords as Coords).lat,
        lng: (coords as Coords).lng,
        radiusM: 5000,
        sport,
      }),
    enabled: coords != null,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateMatch() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (form: CreateMatchForm): Promise<Match> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const when = buildScheduledAt(form.dayOffset, form.timeHHmm);
      if (when.getTime() <= Date.now()) {
        throw new AppError('validation', 'Pick a time in the future.');
      }

      const venue = await venueRepository.getById(form.venueId);
      if (!venue) throw new AppError('validation', 'Select a venue from the list.');
      if (!venue.sport_types.includes(form.sport)) {
        throw new AppError('validation', 'That venue does not support the selected sport.');
      }

      return matchRepository.create({
        creatorId: userId,
        matchName: form.matchName,
        sport: form.sport,
        venueId: venue.id,
        venueText: venue.name,
        scheduledAt: when.toISOString(),
        totalSlots: form.totalSlots,
        missingCount: form.missingCount,
        lat: venue.lat,
        lng: venue.lng,
        notes: form.notes ?? null,
      });
    },
    onSuccess: (match) => {
      analytics.capture('match_created', { sport: match.sport });
      void qc.invalidateQueries({ queryKey: matchKey(match.id) });
    },
  });
}

/**
 * Invalidate everything that changes when the current user joins a match: the
 * match row itself (filled_slots moves), the roster, and my own membership.
 */
function useInvalidateAfterJoin() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  return (matchId: string) => {
    void qc.invalidateQueries({ queryKey: matchKey(matchId) });
    void qc.invalidateQueries({ queryKey: playersKey(matchId) });
    void qc.invalidateQueries({ queryKey: membershipKey(matchId, userId) });
    // The match just entered my joined list — the Matches screen must refetch.
    void qc.invalidateQueries({ queryKey: ['matches', 'joined', userId ?? 'anon'] });
  };
}

/**
 * Answer an invite raised when your squad was booked into a team fixture.
 * Accepting moves you to 'confirmed', which is the only status that counts
 * toward filled_slots — so the sheet updates and every join-related query has
 * to be invalidated, same as a normal join.
 */
export function useRespondToMatchInvite(matchId: string) {
  const invalidate = useInvalidateAfterJoin();

  return useMutation({
    mutationFn: (accept: boolean) => matchRepository.respondToInvite(matchId, accept),
    onSuccess: () => invalidate(matchId),
  });
}

export function useJoinByCode() {
  const invalidate = useInvalidateAfterJoin();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (code: string): Promise<Match> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const match = await matchRepository.getByShareCode(code);
      if (!match) throw new AppError('not_found', 'No match found for that code.');

      // Every eligibility rule (own match, not open, already started, full,
      // blocked) is enforced inside join_match under a row lock. Re-checking
      // here would only duplicate it, and the client's copy of the match can
      // already be stale by the time the user taps.
      await matchRepository.join(match.id, 'code');
      analytics.capture('join_requested', { match_id: match.id, via: 'code' });
      return match;
    },
    onSuccess: (match) => invalidate(match.id),
  });
}

/**
 * Request to join a match the user found by browsing (nearby list or a direct
 * link), rather than by entering a share code. Lands in the organiser's queue
 * as 'interested' — same approve/confirm flow as a code join.
 */
export function useRequestToJoin(matchId: string) {
  const invalidate = useInvalidateAfterJoin();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (): Promise<void> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      await matchRepository.join(matchId, 'browse');
    },
    onSuccess: () => {
      analytics.capture('join_requested', { match_id: matchId, via: 'browse' });
      invalidate(matchId);
    },
  });
}

/**
 * Same as {@link useRequestToJoin}, but the match is a mutation variable rather
 * than bound at hook time — for lists, where one hook has to serve every row.
 */
export function useRequestToJoinAny() {
  const invalidate = useInvalidateAfterJoin();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (matchId: string): Promise<string> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      await matchRepository.join(matchId, 'browse');
      return matchId;
    },
    onSuccess: (matchId) => {
      analytics.capture('join_requested', { match_id: matchId, via: 'browse' });
      invalidate(matchId);
    },
  });
}

/** Creator actions on the player queue: approve / reject / confirm / remove. */
export function usePlayerActions(matchId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: matchKey(matchId) });

  const setStatus = useMutation({
    mutationFn: ({ playerId, status }: { playerId: string; status: PlayerStatus }) =>
      matchRepository.setPlayerStatus(playerId, status),
    onSuccess: (_data, vars) => {
      if (vars.status === 'approved') analytics.capture('interest_approved');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (playerId: string) => matchRepository.removePlayer(playerId),
    onSuccess: invalidate,
  });

  return { setStatus, remove };
}

/** Lifecycle transitions on the match itself: lock, complete, cancel. */
export function useMatchStatus(matchId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: matchKey(matchId) });
    // "My matches" filters out cancelled rows, so it has to be refetched too.
    void qc.invalidateQueries({ queryKey: ['matches', 'mine', userId ?? 'anon'] });
  };

  const lock = useMutation({
    mutationFn: () => matchRepository.setStatus(matchId, 'locked'),
    onSuccess: () => {
      analytics.capture('team_locked');
      invalidate();
    },
  });

  const complete = useMutation({
    mutationFn: () => matchRepository.setStatus(matchId, 'completed'),
    onSuccess: invalidate,
  });

  /**
   * Call the match off. Terminal and irreversible — there is no un-cancel, so
   * the UI must confirm before calling this. Cancelled matches drop out of both
   * the nearby feed (the RPC only returns 'open') and "My matches".
   */
  const cancel = useMutation({
    mutationFn: () => matchRepository.setStatus(matchId, 'cancelled'),
    onSuccess: () => {
      analytics.capture('match_cancelled', { match_id: matchId });
      invalidate();
    },
  });

  return { lock, complete, cancel };
}

export function useAttendanceActions(matchId: string) {
  const qc = useQueryClient();
  const markedBy = useAuthStore((s) => s.session?.user.id);

  const mark = useMutation({
    mutationFn: ({ userId, attended }: { userId: string; attended: boolean }) => {
      if (!markedBy) throw new AppError('unauthorized', 'Please sign in again.');
      return matchRepository.markAttendance({ matchId, userId, attended, markedBy });
    },
    onSuccess: () => {
      analytics.capture('attendance_marked');
      void qc.invalidateQueries({ queryKey: matchKey(matchId) });
    },
  });

  return { mark };
}
