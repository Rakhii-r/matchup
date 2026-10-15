import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';

/**
 * Team FORMAT, and nothing else.
 *
 * This file used to be the solo-player recruiting surface: `openings()` listed
 * teams to strangers, `requestToJoin()` queued a stranger against a squad and
 * `listRequests()` / `respond()` were the captain's inbox for those requests.
 * All four are gone with the Find Players board (3 Sep 2026), and so are the
 * RPCs behind them -- `list_teams_needing_players`, `request_to_join_team`,
 * `list_team_join_requests` and `respond_to_join_request` are dropped in
 * `20260904092956_squad_only_matchmaking.sql`.
 *
 * `set_team_target_size` survives because the column it writes has a second,
 * load-bearing job: it is the team's declared format, and strict
 * format-to-format matchmaking reads it on both sides of every fixture.
 */
const FORMAT_ERRORS: [string, AppErrorCode, string][] = [
  ['NOT_THE_CAPTAIN', 'unauthorized', 'Only the team captain can set the format.'],
  ['TEAM_NOT_FOUND', 'not_found', 'That team no longer exists.'],
  ['INVALID_SQUAD_SIZE', 'validation', 'Pick a format between 2 and 20 players a side.'],
  // set_team_target_size raises SQUAD_TOO_SMALL_FOR_FORMAT. The old token here
  // was FORMAT_BELOW_SQUAD, which the RPC has never raised -- so a refused
  // format fell through to the raw Postgres message.
  [
    'SQUAD_TOO_SMALL_FOR_FORMAT',
    'validation',
    'Your squad is smaller than that format. Add players first.',
  ],
  ['ACCOUNT_INACTIVE', 'unauthorized', 'Your account is not active.'],
];

function formatError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);
  for (const [token, code, friendly] of FORMAT_ERRORS) {
    if (message.includes(token)) return new AppError(code, friendly);
  }
  return toAppError(error);
}

export const recruitRepository = {
  /**
   * Declare the team's format in players PER SIDE, or null to clear it.
   *
   * A team with no format is invisible to matchmaking in both directions: the
   * radar cannot rank it as a candidate and it cannot see anybody's fixtures,
   * because "any format" is exactly what strict matching refuses to allow.
   */
  async setTeamFormat(teamId: string, playersPerSide: number | null): Promise<void> {
    const { error } = await supabase.rpc('set_team_target_size', {
      in_team_id: teamId,
      in_size: playersPerSide,
    });
    if (error) throw formatError(error);
  },
};
