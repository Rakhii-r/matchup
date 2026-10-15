import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { tossRepository } from '@features/matches/data/tossRepository';
import type { TossDecision } from '@features/matches/domain/tossSchema';

const tossKey = (matchId: string) => ['match', matchId, 'toss'] as const;

/**
 * Polls while the toss is unresolved.
 *
 * The losing captain's screen has to change when the winner picks, and there is
 * no realtime subscription on match_toss. A 5s poll is the smallest thing that
 * works; it stops as soon as a decision exists, so a settled match costs
 * nothing. Swap for a realtime channel if the wait ever feels long.
 */
export function useToss(matchId: string) {
  return useQuery({
    queryKey: tossKey(matchId),
    queryFn: () => tossRepository.get(matchId),
    enabled: matchId.length > 0,
    refetchInterval: (query) => (query.state.data?.decision ? false : 5000),
  });
}

export function usePerformToss(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ call, overs }: { call: 'heads' | 'tails'; overs: number | null }) =>
      tossRepository.perform(matchId, call, overs),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tossKey(matchId) });
      // `overs` lives on the match row, so the match card is stale too.
      void qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}

/** Re-roll. Captain-only and refused after bat/bowl is chosen — enforced server-side. */
export function useRedoToss(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (call?: 'heads' | 'tails' | null) => tossRepository.redo(matchId, call),
    onSuccess: () => {
      // The toss key explicitly, not just the `['match', id]` prefix it happens
      // to sit under. `redo_toss` rewrites winner_team_id, outcome AND
      // created_at, and `created_at` is the `flipKey` the coin animation is
      // keyed on — a stale row leaves the other captain looking at the previous
      // winner until the 5s poll catches up.
      void qc.invalidateQueries({ queryKey: tossKey(matchId) });
      void qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}

export function useSetTossDecision(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: TossDecision) => tossRepository.decide(matchId, decision),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tossKey(matchId) });
    },
  });
}
