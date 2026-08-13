import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { scoringRepository } from '@features/scoring/data/scoringRepository';
import type { DeliveryInput } from '@features/scoring/domain/scoringSchema';

const liveKey = (matchId: string) => ['match', matchId, 'live'] as const;
const overKey = (inningsId: string) => ['innings', inningsId, 'over'] as const;
const battingKey = (inningsId: string) => ['innings', inningsId, 'batting'] as const;
const bowlingKey = (inningsId: string) => ['innings', inningsId, 'bowling'] as const;

/**
 * Live score.
 *
 * Polls every 4s for WATCHERS only. The scorer's own device already refetches
 * after each ball it records, so polling them would fight their input and waste
 * battery for no benefit — `isScorer` turns it off.
 */
export function useLiveState(matchId: string, isScorer: boolean) {
  return useQuery({
    queryKey: liveKey(matchId),
    queryFn: () => scoringRepository.getLive(matchId),
    enabled: matchId.length > 0,
    refetchInterval: isScorer ? false : 4000,
  });
}

export function useThisOver(inningsId: string | null, isScorer: boolean) {
  return useQuery({
    queryKey: overKey(inningsId ?? 'none'),
    queryFn: () => scoringRepository.getThisOver(inningsId as string),
    enabled: Boolean(inningsId),
    refetchInterval: isScorer ? false : 4000,
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
    void qc.invalidateQueries({ queryKey: liveKey(matchId) });
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

export function useFinishMatch(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (motmUserId: string | null) =>
      scoringRepository.finishMatch(matchId, motmUserId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: liveKey(matchId) });
      void qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}
