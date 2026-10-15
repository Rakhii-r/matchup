/**
 * What is left of the recruiting module: the team's FORMAT, and nothing else.
 *
 * `target_size` used to mean "recruiting to N players", which is what put a
 * team on the solo-player Find Players board. That board is gone (3 Sep 2026)
 * along with `list_teams_needing_players`, `request_to_join_team` and the
 * captain's join-request inbox: a player joins a squad by invite code, and a
 * squad plays another squad. Nothing in the app lets an individual queue for,
 * search for or join a Team vs Team fixture any more.
 *
 * The column survives with a new job. `target_size` is now the team's DEFAULT
 * FORMAT -- a 6 means "we are a 6 v 6 side" -- and it is what strict
 * format-to-format matchmaking filters on: `rank_challenge_candidates` and
 * `list_open_challenges_nearby` compare it to the fixture's `total_slots / 2`
 * and refuse anything else. A captain may still override the format for one
 * fixture in the create wizard; the opponent list re-locks to whatever that
 * fixture asked for.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { recruitRepository } from '@features/teams/data/recruitRepository';

/**
 * Set the team's default format (players per side), or null to clear it.
 *
 * Invalidates every `teams` read: the format is rendered on the team page, is
 * the create wizard's default squad size, and decides which fixtures the team
 * can see at all, so a stale copy is a wrong opponent list rather than a
 * cosmetic lag.
 */
export function useSetTeamFormat(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playersPerSide: number | null) =>
      recruitRepository.setTeamFormat(teamId, playersPerSide),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] });
      // Discovery is keyed on the format, so both lists must be re-fetched or
      // the team keeps seeing the old format's opponents.
      void qc.invalidateQueries({ queryKey: ['challenges', 'nearby'] });
      void qc.invalidateQueries({ queryKey: ['challenge'] });
    },
  });
}
