import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type {
  BattingRow,
  BowlingRow,
  DeliveryInput,
  LiveState,
  OverBall,
} from '@features/scoring/domain/scoringSchema';

const SCORING_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['MATCH_NOT_FOUND', 'not_found', 'That match no longer exists.'],
  ['MATCH_CANCELLED', 'conflict', 'This match was cancelled.'],
  ['TOSS_NOT_DECIDED', 'validation', 'Do the toss before starting the innings.'],
  ['NOT_ALLOWED_TO_SCORE', 'forbidden', 'Only a captain or the organiser can start scoring.'],
  ['NOT_THE_SCORER', 'forbidden', 'Someone else is scoring this match.'],
  ['INNINGS_NOT_FOUND', 'not_found', 'That innings no longer exists.'],
  ['INNINGS_ENDED', 'conflict', 'This innings is already finished.'],
  ['FIRST_INNINGS_NOT_ENDED', 'conflict', 'End the first innings first.'],
  ['MATCH_ALREADY_HAS_TWO_INNINGS', 'conflict', 'Both innings are already played.'],
  ['SAME_BATTER_BOTH_ENDS', 'validation', 'Striker and non-striker must be different players.'],
  ['WICKET_NEEDS_PLAYER', 'validation', 'Pick which batter is out.'],
  ['OVERS_EXHAUSTED', 'conflict', 'All overs have been bowled.'],
  ['NOTHING_TO_UNDO', 'not_found', 'There is no ball to undo.'],
  ['SECOND_INNINGS_MISSING', 'validation', 'The second innings has not been played.'],
];

function scoringError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of SCORING_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export const scoringRepository = {
  /** Null before the first innings is started. Not an error. */
  async getLive(matchId: string): Promise<LiveState | null> {
    const { data, error } = await supabase.rpc('get_live_state', { in_match_id: matchId });
    if (error) throw scoringError(error);
    return data?.[0] ?? null;
  },

  async getThisOver(inningsId: string): Promise<OverBall[]> {
    const { data, error } = await supabase.rpc('get_this_over', { in_innings_id: inningsId });
    if (error) throw scoringError(error);
    return data ?? [];
  },

  async getBattingCard(inningsId: string): Promise<BattingRow[]> {
    const { data, error } = await supabase.rpc('get_batting_card', { in_innings_id: inningsId });
    if (error) throw scoringError(error);
    return data ?? [];
  },

  async getBowlingCard(inningsId: string): Promise<BowlingRow[]> {
    const { data, error } = await supabase.rpc('get_bowling_card', { in_innings_id: inningsId });
    if (error) throw scoringError(error);
    return data ?? [];
  },

  /** Whoever calls this first becomes the match scorer, for both innings. */
  async startInnings(matchId: string): Promise<void> {
    const { error } = await supabase.rpc('start_innings', { in_match_id: matchId });
    if (error) throw scoringError(error);
  },

  /**
   * Record one ball. Over and ball numbers are NOT sent — the server derives
   * them from how many legal balls have been bowled, so two devices can never
   * disagree about which over it is.
   */
  async recordDelivery(inningsId: string, input: DeliveryInput): Promise<void> {
    const { error } = await supabase.rpc('record_delivery', {
      in_innings_id: inningsId,
      in_striker_id: input.strikerId,
      in_non_striker_id: input.nonStrikerId,
      in_bowler_id: input.bowlerId,
      in_runs_off_bat: input.runsOffBat,
      in_extra_type: input.extraType,
      in_extra_runs: input.extraRuns,
      in_wicket_type: input.wicketType,
      in_out_player_id: input.outPlayerId,
    });
    if (error) throw scoringError(error);
  },

  async undoLast(inningsId: string): Promise<void> {
    const { error } = await supabase.rpc('undo_last_delivery', { in_innings_id: inningsId });
    if (error) throw scoringError(error);
  },

  async endInnings(inningsId: string): Promise<void> {
    const { error } = await supabase.rpc('end_innings', { in_innings_id: inningsId });
    if (error) throw scoringError(error);
  },

  async finishMatch(matchId: string, motmUserId: string | null): Promise<void> {
    const { error } = await supabase.rpc('finish_match', {
      in_match_id: matchId,
      in_motm_user_id: motmUserId,
    });
    if (error) throw scoringError(error);
  },
};
