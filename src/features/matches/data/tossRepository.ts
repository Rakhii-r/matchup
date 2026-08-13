import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type { Toss, TossDecision } from '@features/matches/domain/tossSchema';

/** Stable tokens raised by the toss RPCs, mapped to copy the user can act on. */
const TOSS_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['MATCH_NOT_FOUND', 'not_found', 'That match no longer exists.'],
  ['NOT_A_FIXTURE', 'validation', 'A toss needs two teams. This is a casual match.'],
  ['MATCH_NOT_PLAYABLE', 'conflict', 'This match is finished or cancelled.'],
  ['NOT_A_CAPTAIN', 'forbidden', 'Only the two captains can do the toss.'],
  ['TOSS_NOT_DONE', 'not_found', 'The coin has not been flipped yet.'],
  ['DECISION_ALREADY_MADE', 'conflict', 'The choice has already been made.'],
  ['NOT_TOSS_WINNER', 'forbidden', 'Only the captain who won the toss can choose.'],
  ['INVALID_DECISION', 'validation', 'Pick bat or bowl.'],
];

function tossError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of TOSS_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export const tossRepository = {
  /** Null until a captain flips. Not an error — it is the normal first state. */
  async get(matchId: string): Promise<Toss | null> {
    const { data, error } = await supabase.rpc('get_toss', { in_match_id: matchId });
    if (error) throw tossError(error);
    return data?.[0] ?? null;
  },

  /**
   * Flip the coin. The result is generated server-side; nothing the client
   * sends influences who wins. Idempotent — a second call returns the same
   * toss rather than re-rolling, so a double tap cannot change the outcome.
   */
  async perform(matchId: string, overs: number | null): Promise<void> {
    const { error } = await supabase.rpc('perform_toss', {
      in_match_id: matchId,
      in_overs: overs,
    });
    if (error) throw tossError(error);
  },

  /** Winning captain only, once. */
  async decide(matchId: string, decision: TossDecision): Promise<void> {
    const { error } = await supabase.rpc('set_toss_decision', {
      in_match_id: matchId,
      in_decision: decision,
    });
    if (error) throw tossError(error);
  },
};
