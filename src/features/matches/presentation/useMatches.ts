import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { getCurrentCoords } from '@core/location/location';
import type { Coords } from '@core/location/location';
import { analytics } from '@core/observability/analytics';
import { matchRepository } from '@features/matches/data/matchRepository';
import { buildScheduledAt } from '@features/matches/domain/matchSchema';
import type { CreateMatchForm, Match } from '@features/matches/domain/matchSchema';
import type { PlayerStatus, Sport } from '@shared/types/database.types';

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
  const profile = useAuthStore((s) => s.profile);

  return useMutation({
    mutationFn: async (form: CreateMatchForm): Promise<Match> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const when = buildScheduledAt(form.dayOffset, form.timeHHmm);
      if (when.getTime() <= Date.now()) {
        throw new AppError('validation', 'Pick a time in the future.');
      }

      const deviceCoords = await getCurrentCoords();
      const coords =
        deviceCoords ??
        (profile?.home_lat != null && profile?.home_lng != null
          ? { lat: profile.home_lat, lng: profile.home_lng }
          : null);
      if (!coords) {
        throw new AppError(
          'validation',
          'Enable location, or set your home area in your profile, to create a match.',
        );
      }

      return matchRepository.create({
        creatorId: userId,
        sport: form.sport,
        venueText: form.venueText,
        scheduledAt: when.toISOString(),
        totalSlots: form.totalSlots,
        missingCount: form.missingCount,
        lat: coords.lat,
        lng: coords.lng,
        notes: form.notes ?? null,
      });
    },
    onSuccess: (match) => {
      analytics.capture('match_created', { sport: match.sport });
      void qc.invalidateQueries({ queryKey: matchKey(match.id) });
    },
  });
}

export function useJoinByCode() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (code: string): Promise<Match> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const match = await matchRepository.getByShareCode(code);
      if (!match) throw new AppError('not_found', 'No match found for that code.');
      if (match.creator_id === userId) {
        throw new AppError('conflict', 'This is your own match.');
      }
      if (match.status !== 'open') {
        throw new AppError('conflict', 'That match is no longer open to join.');
      }

      const existing = await matchRepository.getMyMembership(match.id, userId);
      if (!existing) {
        await matchRepository.join(match.id, userId);
        analytics.capture('join_requested', { match_id: match.id });
      }
      return match;
    },
    onSuccess: (match) => {
      void qc.invalidateQueries({ queryKey: matchKey(match.id) });
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

/** Lifecycle transitions on the match itself: lock the team, complete the match. */
export function useMatchStatus(matchId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: matchKey(matchId) });

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

  return { lock, complete };
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
