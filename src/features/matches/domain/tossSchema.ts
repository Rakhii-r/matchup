import type { Sport } from '@shared/types/database.types';

export type TossDecision = 'bat' | 'bowl';
export type TossOutcome = 'heads' | 'tails';
export type TossCall = 'heads' | 'tails';

/**
 * The toss as the UI needs it: raw row plus the two things the client should
 * never derive itself — the winning team's name (hidden from the opposing
 * squad by `teams` RLS) and which side actually bats, resolved server-side from
 * winner + decision.
 */
export interface Toss {
  match_id: string;
  winner_team_id: string;
  winner_team_name: string;
  outcome: TossOutcome;
  called_face?: TossCall | null;
  calling_team_id?: string | null;
  calling_team_name?: string | null;
  decision: TossDecision | null;
  overs: number | null;
  batting_team_id: string | null;
  bowling_team_id: string | null;
  i_am_captain: boolean;
  i_am_winner: boolean;
  i_am_caller?: boolean;
  created_at: string;
  decided_at: string | null;
}

/**
 * Overs offered when starting a toss. Box cricket is short-format; anything
 * longer than 20 is not what this app is for, but the column allows up to 50
 * so a longer game is not impossible.
 */
export const OVERS_OPTIONS = [5, 8, 10, 12, 15, 20] as const;

/**
 * Whether this sport is played in overs.
 *
 * Only box cricket is. Badminton has no innings and no over count, so the
 * toss must not ask for one — and `matches.overs` stays null for it, which is
 * what `matches_overs_check` (null, or 1..50) already allows.
 */
export function sportUsesOvers(sport: Sport | null | undefined): boolean {
  return sport === 'box_cricket';
}

/**
 * What the two toss choices are CALLED, per sport.
 *
 * The stored values never change: `match_toss.decision` is CHECK-constrained to
 * 'bat' | 'bowl' and `start_innings` derives the batting side from it, so a
 * badminton toss still writes 'bat'/'bowl' underneath. Only the words move.
 * Serving is the advantage a badminton toss winner elects, so it maps onto the
 * same slot batting does.
 */
const DECISION_LABELS: Record<Sport, Record<TossDecision, string>> = {
  box_cricket: { bat: 'Bat first', bowl: 'Bowl first' },
  badminton: { bat: 'Serve first', bowl: 'Receive first' },
};

export function tossDecisionLabel(sport: Sport | null | undefined, decision: TossDecision): string {
  return (sport ? DECISION_LABELS[sport] : DECISION_LABELS.box_cricket)[decision];
}

/**
 * The past-tense phrase for the settled screen: "and chose to <verb> first".
 * Cricket says "bat"; badminton says "serve".
 */
export function tossDecisionVerb(sport: Sport | null | undefined, decision: TossDecision): string {
  if (sport === 'badminton') return decision === 'bat' ? 'serve' : 'receive';
  return decision;
}

/** What the toss actually decides, for the caption on the match screen. */
export function tossPurposeLabel(sport: Sport | null | undefined): string {
  return sport === 'badminton' ? 'Decides who serves first.' : 'Decides who bats first.';
}
