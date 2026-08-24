/**
 * State for the three-step Create Match wizard (`app/match/create/`).
 *
 * The wizard is a stack of real routes so hardware back works and each step is
 * deep-linkable, which rules out threading the answers through route params:
 * params are trivially lost on back-navigation and would have to be re-encoded
 * at every push. A tiny client store instead — same house pattern as
 * `src/core/auth/authStore.ts` — keeps every answer alive for as long as the
 * stack is mounted, so re-entering a step shows what was chosen before.
 *
 * `reset()` is called when Step 1 mounts. Going *back* to Step 1 does not
 * remount it (it is the root of the stack and was never unmounted), so a back
 * navigation preserves the answers; only a fresh entry into the wizard clears
 * them.
 */
import { create } from 'zustand';

import type { GameType, Sport } from '@shared/types/database.types';

/**
 * Which of the two flows the user picked on Step 1. This DOES decide which RPC
 * runs — that is the entire point of the choice.
 *
 * 'team_vs_team' → `usePostOpenChallenge` → `post_open_challenge` → radar →
 *   offers. Needs a team you own (Team A); the opponent is found by the search
 *   and is never picked by hand, which is why there is no `opponentTeamId`.
 *
 * 'post_match'  → `useCreateOpenMatch` → `create_open_match` → the match
 *   detail screen. Needs no team of any kind: the fixture is advertised and
 *   individual players take seats one at a time. There is no Team A, no Team B
 *   and no opponent to find, so Step 3 shows no team UI at all.
 *
 * An earlier version funnelled both through `post_open_challenge` and treated
 * `matchType` as a label. That is what made "Post a Match" demand a team and
 * behave like a challenge, and it is the bug this branch exists to fix.
 *
 * The old `solo` branch is gone: the wizard offers only these two.
 * `useCreateMatch` deliberately stays in the codebase — it is the direct
 * match-creation path and other surfaces may use it again — it simply has no
 * entry point from this wizard.
 */
export type MatchType = 'team_vs_team' | 'post_match';

/** The wizard routes, in order. Three steps, no branching. */
export type WizardStep = 'sport' | 'area' | 'details';

const STEP_ORDER: WizardStep[] = ['sport', 'area', 'details'];

/** Where a step sits in the flow, for the "Step N of 3" indicator. */
export function stepPosition(step: WizardStep): { index: number; total: number } {
  const at = STEP_ORDER.indexOf(step);
  return { index: at === -1 ? STEP_ORDER.length : at + 1, total: STEP_ORDER.length };
}

interface CreateMatchWizardState {
  // Step 1 — sport and match type share one screen.
  sport: Sport | null;
  matchType: MatchType | null;
  // Step 2 — area locality and search radius
  areaName: string;
  areaCoords: { lat: number; lng: number } | null;
  /** Metres, to match the RPC. The chips are in km and multiply by 1000. */
  searchRadiusM: number;
  // Step 3
  /**
   * Team A. Only ever set on the 'team_vs_team' branch — an open match has no
   * team, and switching to it clears this so a half-finished challenge cannot
   * leak a team id into the open-match submit. Team B is found by the radar
   * search and is never set here.
   */
  teamId: string | null;
  /** Players per side. The sheet total is twice this. */
  playersPerSide: number | null;
  dayOffset: number | null;
  timeHHmm: string;
  /** Optional finish time. Empty string means "left open". */
  endTimeHHmm: string;
  gameType: GameType;

  setSport: (sport: Sport) => void;
  setMatchType: (matchType: MatchType) => void;
  setAreaName: (areaName: string) => void;
  setAreaCoords: (areaCoords: { lat: number; lng: number } | null) => void;
  setSearchRadiusM: (searchRadiusM: number) => void;
  setTeamId: (teamId: string) => void;
  setPlayersPerSide: (playersPerSide: number) => void;
  setDayOffset: (dayOffset: number) => void;
  setTimeHHmm: (timeHHmm: string) => void;
  setEndTimeHHmm: (endTimeHHmm: string) => void;
  setGameType: (gameType: GameType) => void;
  reset: () => void;
}

/** Defaults chosen to match the form: a friendly game, 25 km of search. */
const INITIAL = {
  sport: null,
  matchType: null,
  areaName: '',
  areaCoords: null,
  searchRadiusM: 25000,
  teamId: null,
  playersPerSide: null,
  dayOffset: null,
  timeHHmm: '',
  endTimeHHmm: '',
  gameType: 'friendly',
} satisfies Omit<
  CreateMatchWizardState,
  | 'setSport'
  | 'setMatchType'
  | 'setAreaName'
  | 'setAreaCoords'
  | 'setSearchRadiusM'
  | 'setTeamId'
  | 'setPlayersPerSide'
  | 'setDayOffset'
  | 'setTimeHHmm'
  | 'setEndTimeHHmm'
  | 'setGameType'
  | 'reset'
>;

export const useCreateMatchWizard = create<CreateMatchWizardState>((set) => ({
  ...INITIAL,

  /**
   * Changing the sport invalidates downstream answers filtered by it —
   * the team list and players-per-side list. It also resets the locality
   * so a clean slate is presented.
   */
  setSport: (sport) =>
    set((state) =>
      state.sport === sport
        ? {}
        : {
            sport,
            areaName: '',
            areaCoords: null,
            teamId: null,
            playersPerSide: null,
          },
    ),
  /**
   * Area, radius, date, times, squad size and game type mean the same thing
   * on both branches, so switching type keeps them. Team A does not: it
   * has no meaning on an open match, and leaving it set would let a stale id
   * survive a switch. Re-picking the same type is a no-op.
   */
  setMatchType: (matchType) =>
    set((state) =>
      state.matchType === matchType
        ? {}
        : { matchType, teamId: matchType === 'post_match' ? null : state.teamId },
    ),
  setAreaName: (areaName) => set(() => ({ areaName })),
  setAreaCoords: (areaCoords) => set(() => ({ areaCoords })),
  setSearchRadiusM: (searchRadiusM) => set(() => ({ searchRadiusM })),
  setTeamId: (teamId) => set(() => ({ teamId })),
  setPlayersPerSide: (playersPerSide) => set(() => ({ playersPerSide })),
  setDayOffset: (dayOffset) => set(() => ({ dayOffset })),
  setTimeHHmm: (timeHHmm) => set(() => ({ timeHHmm })),
  setEndTimeHHmm: (endTimeHHmm) => set(() => ({ endTimeHHmm })),
  setGameType: (gameType) => set(() => ({ gameType })),
  reset: () => set(() => ({ ...INITIAL })),
}));
