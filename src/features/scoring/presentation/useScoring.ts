import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { scoringRepository } from '@features/scoring/data/scoringRepository';
import type { DeliveryInput } from '@features/scoring/domain/scoringSchema';

const liveKey = (matchId: string) => ['match', matchId, 'live'] as const;
const inningsKey = (matchId: string) => ['match', matchId, 'innings'] as const;
const overKey = (inningsId: string) => ['innings', inningsId, 'over'] as const;
const battingKey = (inningsId: string) => ['innings', inningsId, 'batting'] as const;
const bowlingKey = (inningsId: string) => ['innings', inningsId, 'bowling'] as const;

/**
 * 8s, not 4s: a ball is bowled roughly every 30 seconds, and a watcher runs
 * `useLiveState` and `useThisOver` together, so 4s was thirty requests a minute
 * per spectator to learn about two balls. Polling stops while the app is in
 * the background (focusManager in queryClient).
 */
const WATCHER_POLL_MS = 8000;

/**
 * Live score.
 *
 * Polls for WATCHERS only. The scorer's own device already refetches
 * after each ball it records, so polling them would fight their input and waste
 * battery for no benefit — `isScorer` turns it off.
 */
export function useLiveState(matchId: string, isScorer: boolean) {
  return useQuery({
    queryKey: liveKey(matchId),
    queryFn: () => scoringRepository.getLive(matchId),
    enabled: matchId.length > 0,
    refetchInterval: isScorer ? false : WATCHER_POLL_MS,
  });
}

/**
 * Both innings of the match, oldest first. The scorecard needs the first
 * innings as well as the one in play, and `get_live_state` only ever returns
 * the latest, so the full card cannot be built from live state alone.
 */
export function useMatchInnings(matchId: string) {
  return useQuery({
    queryKey: inningsKey(matchId),
    queryFn: () => scoringRepository.listInnings(matchId),
    enabled: matchId.length > 0,
  });
}

export function useThisOver(inningsId: string | null, isScorer: boolean) {
  return useQuery({
    queryKey: overKey(inningsId ?? 'none'),
    queryFn: () => scoringRepository.getThisOver(inningsId as string),
    enabled: Boolean(inningsId),
    refetchInterval: isScorer ? false : WATCHER_POLL_MS,
  });
}

export function useBattingCard(inningsId: string | null) {
  return useQuery({
    queryKey: battingKey(inningsId ?? 'none'),
    queryFn: () => scoringRepository.getBattingCard(inningsId as string),
    enabled: Boolean(inningsId),
  });
}

export function useBowlingCard(inningsId: string | null) {
  return useQuery({
    queryKey: bowlingKey(inningsId ?? 'none'),
    queryFn: () => scoringRepository.getBowlingCard(inningsId as string),
    enabled: Boolean(inningsId),
  });
}

/**
 * Every scoring write invalidates the same four queries, because a single ball
 * can change all of them: the total, the over chips, the batter's figures and
 * the bowler's. Keeping this in one place stops a new action forgetting one.
 */
function useInvalidateScoring(matchId: string, inningsId: string | null) {
  const qc = useQueryClient();
  return () => {
    // Prefix key — covers ['match', id, 'live' | 'innings'] AND the match row
    // itself, which matters now that a ball can complete the match: the score
    // screen watches matches.status to know when to show the result.
    void qc.invalidateQueries({ queryKey: ['match', matchId] });
    if (inningsId) {
      void qc.invalidateQueries({ queryKey: overKey(inningsId) });
      void qc.invalidateQueries({ queryKey: battingKey(inningsId) });
      void qc.invalidateQueries({ queryKey: bowlingKey(inningsId) });
    }
  };
}

export function useStartInnings(matchId: string) {
  const invalidate = useInvalidateScoring(matchId, null);
  return useMutation({
    mutationFn: () => scoringRepository.startInnings(matchId),
    onSuccess: invalidate,
  });
}

export function useRecordDelivery(matchId: string, inningsId: string | null) {
  const invalidate = useInvalidateScoring(matchId, inningsId);
  return useMutation({
    mutationFn: (input: DeliveryInput) =>
      scoringRepository.recordDelivery(inningsId as string, input),
    onSuccess: invalidate,
  });
}

export function useUndoLastDelivery(matchId: string, inningsId: string | null) {
  const invalidate = useInvalidateScoring(matchId, inningsId);
  return useMutation({
    mutationFn: () => scoringRepository.undoLast(inningsId as string),
    onSuccess: invalidate,
  });
}

export function useEndInnings(matchId: string, inningsId: string | null) {
  const invalidate = useInvalidateScoring(matchId, inningsId);
  return useMutation({
    mutationFn: () => scoringRepository.endInnings(inningsId as string),
    onSuccess: invalidate,
  });
}

/**
 * Finish the match. This is the ONLY call that works out the winner and writes
 * `matches.status = 'completed'`, `result_text` and `motm_user_id`.
 *
 * `end_innings` closes an innings row and touches nothing else, so a second
 * innings ended without this call leaves the match still in progress, with no
 * result and every read model that keys off status empty. The two always go
 * together — see the end-of-match sequence in app/match/[id]/score.tsx.
 *
 * The invalidations are RETURNED rather than fired and forgotten: react-query
 * awaits a promise from `onSuccess`, so `mutateAsync` does not resolve until
 * the match row has been re-read. The result screen therefore paints the
 * finished row straight away instead of the stale in-progress one.
 */
/**
 * Award or clear Player of the Game after the game is over.
 *
 * Not folded into useFinishMatch: the second innings auto-completes inside
 * record_delivery, so on a chase there is no "Finish" tap at all and the award
 * has to be makeable afterwards from the result screen.
 */
export function useSetMotm(matchId: string) {
  const invalidate = useInvalidateScoring(matchId, null);
  return useMutation({
    mutationFn: (motmUserId: string | null) => scoringRepository.setMotm(matchId, motmUserId),
    onSuccess: invalidate,
  });
}

export function useFinishMatch(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (motmUserId: string | null) =>
      scoringRepository.finishMatch(matchId, motmUserId),
    onSuccess: () =>
      Promise.all([
        // Prefix key — also covers ['match', id, 'live' | 'players' | 'sides'],
        // so liveKey does not need listing separately.
        qc.invalidateQueries({ queryKey: ['match', matchId] }),
        // The Matches tab and the Home dashboard both render match status.
        qc.invalidateQueries({ queryKey: ['matches'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
  });
}
