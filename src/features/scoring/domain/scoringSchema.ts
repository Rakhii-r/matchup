import type { Database, ExtraType, WicketType } from '@shared/types/database.types';

export type LiveState = Database['public']['Functions']['get_live_state']['Returns'][number];
export type OverBall = Database['public']['Functions']['get_this_over']['Returns'][number];
export type BattingRow = Database['public']['Functions']['get_batting_card']['Returns'][number];
export type BowlingRow = Database['public']['Functions']['get_bowling_card']['Returns'][number];
/** A whole innings row. The scorecard needs both; the live state has only one. */
export type Innings = Database['public']['Tables']['innings']['Row'];

/**
 * One ball as the scoring keypad assembles it before sending.
 *
 * The three player fields are nullable: the keypad records team scoring only
 * and does not ask who was on strike or who bowled. They stay in the shape
 * because the RPC and the columns still accept a named player.
 */
export interface DeliveryInput {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  runsOffBat: number;
  extraType: ExtraType | null;
  /** TOTAL extras including the penalty run. A plain wide is 1, not 0. */
  extraRuns: number;
  wicketType: WicketType | null;
  outPlayerId: string | null;
}

export const EXTRA_LABEL: Record<ExtraType, string> = {
  wide: 'Wide',
  no_ball: 'No ball',
  bye: 'Bye',
  leg_bye: 'Leg bye',
};

export const WICKET_LABEL: Record<WicketType, string> = {
  bowled: 'Bowled',
  caught: 'Caught',
  lbw: 'LBW',
  run_out: 'Run out',
  stumped: 'Stumped',
  hit_wicket: 'Hit wicket',
};

/** "12.4" from 76 legal balls. Overs are base-6, not base-10. */
export function formatOvers(legalBalls: number): string {
  if (!Number.isFinite(legalBalls) || legalBalls < 0) return '0.0';
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

/** Runs per over so far. Null rather than 0 before a ball is bowled. */
export function runRate(runs: number, legalBalls: number): number | null {
  if (legalBalls <= 0) return null;
  return Number(((runs * 6) / legalBalls).toFixed(2));
}

/**
 * Chase maths for the second innings. Returns null in the first innings, where
 * there is nothing to chase.
 */
export function chase(state: LiveState): { need: number; balls: number; rrr: number | null } | null {
  if (state.target === null || state.overs_limit === null) return null;
  const need = Math.max(state.target - state.runs, 0);
  const balls = Math.max(state.overs_limit * 6 - state.legal_balls, 0);
  return { need, balls, rrr: balls > 0 ? Number(((need * 6) / balls).toFixed(2)) : null };
}
