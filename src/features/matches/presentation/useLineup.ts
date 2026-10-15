import { useMutation, useQueryClient } from '@tanstack/react-query';

import { lineupRepository } from '@features/matches/data/lineupRepository';

/**
 * Set one team's squad for a match.
 *
 * Invalidates the match reads rather than the team reads: naming a lineup does
 * not change the roster, it changes who is on this match's sheet — which is
 * what the players list, the slot counter and the pending-actions badge all
 * read.
 */
export function useSetMatchLineup(matchId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ teamId, userIds }: { teamId: string; userIds: string[] }) =>
      lineupRepository.setLineup(matchId, teamId, userIds),
    onSuccess: () => {
      // Prefix key: ['match', id] covers ['match', id, 'players'] and the
      // sides read, which are the two views a lineup change moves.
      void qc.invalidateQueries({ queryKey: ['match', matchId] });
      void qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}
