import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type { Toss, TossDecision } from '@features/matches/domain/tossSchema';

/** Stable tokens raised by the toss RPCs, mapped to copy the user can act on. */
const TOSS_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['MATCH_NOT_FOUND', 'not_found', 'That game no longer exists.'],
  ['NOT_A_FIXTURE', 'validation', 'A toss needs two teams. This is a casual game.'],
  ['MATCH_NOT_PLAYABLE', 'conflict', 'This game is finished or cancelled.'],
  // Every toss write is now organiser-only. NOT_A_CAPTAIN is kept because
  // installed builds may still be talking to an older function.
  [
    'NOT_THE_ORGANISER',
    'forbidden',
    'Only the game organiser runs the toss. You can follow it here.',
  ],
  ['NOT_A_CAPTAIN', 'forbidden', 'Only the game organiser can do the toss.'],
  ['TOSS_NOT_DONE', 'not_found', 'The coin has not been flipped yet.'],
  ['DECISION_ALREADY_MADE', 'conflict', 'The choice has already been made.'],
  ['NOT_TOSS_WINNER', 'forbidden', 'Only the game organiser can make the toss call.'],
  ['INVALID_DECISION', 'validation', 'Pick bat or bowl.'],
  ['TOSS_NOT_FOUND', 'not_found', 'The coin has not been flipped yet.'],
  [
    'TOSS_ALREADY_DECIDED',
    'conflict',
    'Bat or bowl has already been chosen, so the toss cannot be re-flipped.',
  ],
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
  async perform(matchId: string, call: 'heads' | 'tails' = 'heads', overs: number | null = null): Promise<void> {
    const { error } = await supabase.rpc('perform_toss', {
      in_match_id: matchId,
      in_call: call,
      in_overs: overs,
    } as any);
    if (error) throw tossError(error);
  },

  /**
   * Re-roll the toss. Separate from `perform`, which is deliberately idempotent
   * and therefore physically cannot re-roll — wiring a "flip again" button to it
   * would land on the same face every time.
   *
   * Server-side this is captain-only and refuses once bat or bowl has been
   * chosen, and it notifies BOTH captains: the other side was told who won by
   * the original toss and must not be left holding a stale result.
   */
  async redo(matchId: string, call?: 'heads' | 'tails' | null): Promise<void> {
    const { error } = await supabase.rpc('redo_toss', {
      in_match_id: matchId,
      in_call: call ?? null,
    } as any);
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
