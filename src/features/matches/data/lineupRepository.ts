import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type { Database } from '@shared/types/database.types';

export type MatchPlayerRow = Database['public']['Tables']['match_players']['Row'];

/**
 * The captain's squad for one match.
 *
 * There is no `match_lineups` table: a lineup IS the set of `match_players`
 * rows for one team on one match. `set_match_lineup` replaces that set in a
 * single call, so re-picking is the same operation as picking.
 *
 * Every refusal comes back as a stable token, same pattern as the challenge and
 * team RPCs, because each one has a different fix and the captain needs to know
 * which.
 */
const LINEUP_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  [
    'LINEUP_SIZE_MISMATCH',
    'validation',
    'Pick exactly the number of players this format needs.',
  ],
  ['LINEUP_DUPLICATE_PLAYER', 'validation', 'That player is already in the lineup.'],
  [
    'LINEUP_NOT_A_MEMBER',
    'validation',
    'Everyone in the lineup has to be on your team. Someone you picked has left the squad.',
  ],
  ['LINEUP_MISSING_CAPTAIN', 'validation', 'You play in your own lineup — keep yourself selected.'],
  ['NOT_THE_CAPTAIN', 'forbidden', 'Only the team captain can pick the lineup.'],
  ['TEAM_NOT_IN_MATCH', 'validation', 'That team is not playing in this match.'],
  ['MATCH_ALREADY_STARTED', 'conflict', 'This match has already started — the lineup is locked.'],
  ['MATCH_NOT_FOUND', 'not_found', 'That match no longer exists.'],
  ['TEAM_NOT_FOUND', 'not_found', 'That team no longer exists.'],
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
];

function lineupError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);
  for (const [token, code, friendly] of LINEUP_ERRORS) {
    if (message.includes(token)) return new AppError(code, friendly);
  }
  return toAppError(error);
}

export const lineupRepository = {
  /**
   * Name (or re-name) one team's squad. `userIds` must be exactly the format
   * size and must include the captain — both are enforced server-side, so a
   * stale screen cannot post a short lineup.
   */
  async setLineup(matchId: string, teamId: string, userIds: string[]): Promise<MatchPlayerRow[]> {
    const { data, error } = await supabase.rpc('set_match_lineup', {
      in_match_id: matchId,
      in_team_id: teamId,
      in_user_ids: userIds,
    });
    if (error) throw lineupError(error);
    return data ?? [];
  },
};
