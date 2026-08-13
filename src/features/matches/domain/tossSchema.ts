import type { Database } from '@shared/types/database.types';

export type TossDecision = 'bat' | 'bowl';
export type TossOutcome = 'heads' | 'tails';

/**
 * The toss as the UI needs it: raw row plus the two things the client should
 * never derive itself — the winning team's name (hidden from the opposing
 * squad by `teams` RLS) and which side actually bats, resolved server-side from
 * winner + decision.
 */
export type Toss = Database['public']['Functions']['get_toss']['Returns'][number];

/**
 * Overs offered when starting a toss. Box cricket is short-format; anything
 * longer than 20 is not what this app is for, but the column allows up to 50
 * so a longer game is not impossible.
 */
export const OVERS_OPTIONS = [5, 8, 10, 12, 15, 20] as const;

export const TOSS_DECISION_LABEL: Record<TossDecision, string> = {
  bat: 'Bat first',
  bowl: 'Bowl first',
};
