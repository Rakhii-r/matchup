import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@core/api/supabaseClient';
import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import type { Coords } from '@core/location/location';
import { analytics } from '@core/observability/analytics';
import { matchRepository } from '@features/matches/data/matchRepository';
import type { CreateOpenMatchInput } from '@features/matches/data/matchRepository';
import { buildEndAt, buildScheduledAt } from '@features/matches/domain/matchSchema';
import type { CreateMatchForm, Match } from '@features/matches/domain/matchSchema';
import type { PlayerStatus, Sport } from '@shared/types/database.types';
import { venueRepository } from '@features/venues/data/venueRepository';

const matchKey = (id: string) => ['match', id] as const;
const playersKey = (id: string) => ['match', id, 'players'] as const;
const membershipKey = (id: string, userId: string | undefined) =>
  ['match', id, 'membership', userId ?? 'anon'] as const;

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
 * Every game played in this match's booked slot, oldest first.
 *
 * Kept off the `['match', id]` prefix on purpose. `useInvalidateScoring`
 * invalidates that whole prefix after every ball so the match row refetches
 * (see the auto_complete_second_innings note in the scoring model), and the
 * series only changes when a game starts or finishes — refetching it per
 * delivery would be a request every few seconds for a list that has not moved.
 */
export function useMatchSeries(matchId: string) {
  return useQuery({
    queryKey: ['match-series', matchId] as const,
    queryFn: () => matchRepository.listSeries(matchId),
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

/**
 * Keep one match's roster and seat count live while its screen is open.
 *
 * `match_players` is the only table in the `supabase_realtime` publication, and
 * it is the one that moves: a join inserts a row there, and the
 * `sync_filled_slots` trigger derives `matches.filled_slots` from it. So a
 * change event on this match is the signal to refetch both. Realtime applies
 * the table's RLS, so a subscriber is only ever told about rows it may read.
 *
 * The channel name is per match, per user AND per mount: two screens in the same
 * app session must not collide on one topic, and the channel has to be torn
 * down on unmount or the subscription leaks for the life of the app.
 */
export function useMatchPlayersRealtime(matchId: string): void {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  /*
    The topic is per HOOK INSTANCE, not per match+user.

    Two copies of the match screen can be mounted at the same time: a native
    stack keeps the screen underneath a pushed route alive, so coming back from
    the toss with `replace` puts a second `/match/[id]` on top of the first.
    supabase-js hands back the SAME channel object for a topic it already holds,
    so the second mount would call `.on()` on a channel that is already
    subscribed — which throws

      cannot add `postgres_changes` callbacks for realtime:match-roster:… after `subscribe()`

    and takes the screen down with a render error. A per-instance suffix keeps
    the two subscriptions apart; it is stored in a ref so a re-run of the effect
    reuses it and teardown always removes its own channel.
  */
  const [instanceId] = useState(() => Math.random().toString(36).slice(2, 10));

  useEffect(() => {
    if (matchId.length === 0 || !userId) return;

    const topic = `match-roster:${matchId}:${userId}:${instanceId}`;

    // `removeChannel` is async, so a channel from a previous run of this effect
    // (matchId changed, or a fast refresh) can still be registered under the
    // same topic. Drop it first rather than inheriting its subscribed state.
    for (const stale of supabase.getChannels()) {
      if (stale.topic === `realtime:${topic}`) void supabase.removeChannel(stale);
    }

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_players',
          filter: `match_id=eq.${matchId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: matchKey(matchId) });
          void qc.invalidateQueries({ queryKey: playersKey(matchId) });
          void qc.invalidateQueries({ queryKey: membershipKey(matchId, userId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [instanceId, matchId, userId, qc]);
}

export function useMyMembership(matchId: string) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: membershipKey(matchId, userId),
    queryFn: () => matchRepository.getMyMembership(matchId, userId as string),
    enabled: matchId.length > 0 && Boolean(userId),
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

/** Started, unfinished matches the user organises or is confirmed in. */
export function useLiveMatches() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['matches', 'live', userId ?? 'anon'] as const,
    queryFn: () => matchRepository.listLive(userId as string),
    enabled: Boolean(userId),
  });
}

/** Complete list of all matches created or joined by the user across all statuses. */
export function useAllMyBookedMatches() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['matches', 'booked_all', userId ?? 'anon'] as const,
    queryFn: () => matchRepository.listAllBookedMatches(userId as string),
    enabled: Boolean(userId),
  });
}

/**
 * How far "near you" reaches. The 5 km used to be written into the query below
 * AND into two empty-state strings, so a change in one never reached the other.
 * One definition, and the screens read the label off it.
 */
export const SEARCH_RADII_M = [2000, 5000, 10000, 25000, 50000, 0] as const;
export const DEFAULT_SEARCH_RADIUS_M = 5000;

export function formatRadius(radiusM: number | null | undefined): string {
  if (radiusM == null || radiusM <= 0) return 'All';
  return `${Math.round(radiusM / 1000)} km`;
}

export function useNearbyMatches(
  coords: Coords | null,
  sport: Sport | null,
  radiusM: number | null = DEFAULT_SEARCH_RADIUS_M,
) {
  return useQuery({
    // radiusM is part of the key: without it, widening the search returned the
    // previous distance's cached rows and the list appeared not to change.
    queryKey: [
      'matches',
      'nearby',
      coords?.lat ?? null,
      coords?.lng ?? null,
      sport ?? 'all',
      radiusM ?? null,
    ] as const,
    queryFn: () =>
      matchRepository.nearby({
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        radiusM: radiusM ?? null,
        sport,
      }),
    enabled: true,
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
        // Undefined for every caller that predates the wizard, which leaves a
        // null end_time — the old behaviour.
        endTime: buildEndAt(form.dayOffset, form.timeHHmm, form.endTimeHHmm)?.toISOString() ?? null,
      });
    },
    onSuccess: (match) => {
      analytics.capture('match_created', { sport: match.sport });
      void qc.invalidateQueries({ queryKey: matchKey(match.id) });
    },
  });
}

/**
 * Post a Match (Open for all) — the second creation engine.
 *
 * Nothing here reads a team. `useCreateMatch` (direct insert) and
 * `usePostOpenChallenge` (team challenge + radar) are both untouched; this is a
 * third, parallel path, which is the whole point of the change: the two match
 * types must not share a submit.
 */
export function useCreateOpenMatch() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (input: CreateOpenMatchInput): Promise<Match> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      return matchRepository.createOpen(input);
    },
    onSuccess: (match) => {
      analytics.capture('match_created', { sport: match.sport, match_type: 'open' });
      void qc.invalidateQueries({ queryKey: matchKey(match.id) });
      void qc.invalidateQueries({ queryKey: ['matches', 'mine', userId ?? 'anon'] });
      void qc.invalidateQueries({ queryKey: ['matches', 'nearby'] });
    },
  });
}

/**
 * Take a seat in an open match, as an individual and with no approval step.
 * The mutation variable is the match id so one hook can serve a list as well as
 * a detail screen.
 */
export function useJoinOpenMatch() {
  const invalidate = useInvalidateAfterJoin();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (matchId: string): Promise<string> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      await matchRepository.joinOpen(matchId, 'browse');
      return matchId;
    },
    onSuccess: (matchId) => {
      analytics.capture('open_match_joined', { match_id: matchId });
      invalidate(matchId);
    },
  });
}

/**
 * Start a rematch / next match within the same slot.
 */
export function useRematch() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (matchId: string): Promise<Match> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      return matchRepository.createRematch(matchId);
    },
    onSuccess: (newMatch) => {
      analytics.capture('match_created', { sport: newMatch.sport, is_rematch: true });
      void qc.invalidateQueries({ queryKey: matchKey(newMatch.id) });
      void qc.invalidateQueries({ queryKey: ['matches', 'mine', userId ?? 'anon'] });
      void qc.invalidateQueries({ queryKey: ['matches', 'joined', userId ?? 'anon'] });
      // The series gained a game. Every game in the slot answers with the same
      // list, and the screen the user just left is still mounted behind the
      // navigation, so the whole prefix is dropped rather than one match's key.
      void qc.invalidateQueries({ queryKey: ['match-series'] });
    },
  });
}

/**
 * Attach a venue to a match after creation, or clear it with `venueId: null`.
 *
 * The wizard captures an area and defers the venue, so this is the write that
 * completes the location. Organiser-only server-side; the UI gates on
 * `match.creator_id === userId` and shows non-organisers a stated line rather
 * than a button that would fail.
 *
 * Invalidates the lists as well as the match: `venue_text` is rendered on the
 * home feed, the matches tab and the team fixtures list, so a tag that only
 * refreshed the detail screen would leave three stale surfaces behind it.
 */
export function useSetMatchVenue(matchId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (venueId: string | null): Promise<Match> =>
      matchRepository.setVenue(matchId, venueId),
    onSuccess: (match) => {
      void qc.invalidateQueries({ queryKey: matchKey(match.id) });
      void qc.invalidateQueries({ queryKey: ['matches', 'mine', userId ?? 'anon'] });
      void qc.invalidateQueries({ queryKey: ['matches', 'joined', userId ?? 'anon'] });
      void qc.invalidateQueries({ queryKey: ['matches', 'nearby'] });
      void qc.invalidateQueries({ queryKey: ['match-series'] });
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
    // …and its nearby card now shows a different filled/total.
    void qc.invalidateQueries({ queryKey: ['matches', 'nearby'] });
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
      if (!match) throw new AppError('not_found', 'No game found for that code.');

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
    // "My games" filters out cancelled rows, so it has to be refetched too.
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
   * the nearby feed (the RPC only returns 'open') and "My games".
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

/**
 * Delete a posted game. Invalidates the lists rather than the single match:
 * the row is gone, so ['match', id] has nothing left to refetch.
 */
export function useDeleteMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => matchRepository.deleteMatch(matchId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['matches'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => matchRepository.setStatus(matchId, 'cancelled'),
    onSuccess: (_data, matchId) => {
      analytics.capture('match_cancelled', { match_id: matchId });
      void qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
