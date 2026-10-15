/**
 * The format the caller is currently matchmaking in.
 *
 * Strict format-to-format matching needs one number before it can show a single
 * opponent -- how many a side is this user playing -- and every discovery screen
 * needs the same answer, from the same place, or two screens disagree about who
 * is a valid opponent. That answer is the declared format (`target_size`) of the
 * team the user OWNS for the sport in view.
 *
 * Owned, not merely joined: `apply_to_open_challenge` and
 * `accept_open_challenge` both refuse anyone who is not the team owner, so a
 * squad the user only plays for could never act on anything the list showed.
 *
 * `format` is null when there is no owned team for the sport, or its captain has
 * not declared one. Null is not "show everything" -- it means the user is not in
 * matchmaking, and the screens say which of the two it is (`reason`) rather than
 * rendering an empty list with no explanation.
 */
import { useMemo } from 'react';

import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import type { Sport } from '@shared/types/database.types';

export type ActiveFormatReason = 'ok' | 'loading' | 'no_team' | 'no_format';

export interface ActiveTeamFormat {
  /** Players per side, or null when the user is not in matchmaking. */
  format: number | null;
  /** The team that format came from, for challenge and apply calls. */
  teamId: string | null;
  teamName: string | null;
  /** Every team the user owns for this sport, format declared or not. */
  ownedTeams: { id: string; name: string; sport: Sport; target_size: number | null }[];
  reason: ActiveFormatReason;
  isLoading: boolean;
}

export function useActiveTeamFormat(sport?: Sport | null): ActiveTeamFormat {
  const teams = useMyTeamsOverview();

  return useMemo(() => {
    const owned = (teams.data ?? [])
      .filter((t) => t.i_am_owner && (sport == null || t.sport === sport))
      .map((t) => ({ id: t.id, name: t.name, sport: t.sport, target_size: t.target_size }));

    // A team with a declared format wins over one without, then name order (the
    // RPC already sorts by name) so the choice is stable across renders.
    const withFormat = owned.find((t) => t.target_size != null) ?? null;

    if (teams.isLoading) {
      return { format: null, teamId: null, teamName: null, ownedTeams: owned, reason: 'loading', isLoading: true };
    }
    if (owned.length === 0) {
      return { format: null, teamId: null, teamName: null, ownedTeams: owned, reason: 'no_team', isLoading: false };
    }
    if (!withFormat) {
      const first = owned[0] ?? null;
      return {
        format: null,
        teamId: first?.id ?? null,
        teamName: first?.name ?? null,
        ownedTeams: owned,
        reason: 'no_format',
        isLoading: false,
      };
    }
    return {
      format: withFormat.target_size,
      teamId: withFormat.id,
      teamName: withFormat.name,
      ownedTeams: owned,
      reason: 'ok',
      isLoading: false,
    };
  }, [teams.data, teams.isLoading, sport]);
}

/** "4 v 4". One spelling of the format, so no screen invents its own. */
export function formatLabel(playersPerSide: number): string {
  return `${playersPerSide} v ${playersPerSide}`;
}
