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
import { persist, createJSONStorage } from 'zustand/middleware';

import { secureStorage } from '@core/storage/secureStore';
import type { Sport } from '@shared/types/database.types';

/**
 * Booked slot lengths offered as chips, in minutes.
 *
 * The slot is what the organiser paid the venue for, and it is now the hard
 * boundary of the whole session: every game played inside it inherits its
 * `end_time`, and `create_rematch` refuses once that instant has passed. A
 * match created with no end time is a session that can never be limited, so
 * one of these is always applied.
 */
export const SLOT_DURATIONS_MIN = [60, 90, 120, 180] as const;

/**
 * How long an abandoned draft stays offerable, in ms.
 *
 * A half-filled wizard is only worth resuming while the intent behind it is
 * still live. "Tonight at 8" typed an hour ago is the same plan; the same draft
 * found the next morning is a stale answer to a question that has moved on, and
 * resuming it silently posts yesterday's `dayOffset`. After this window the
 * Home banner stops offering it and the next visit to Step 1 clears it.
 */
export const DRAFT_TTL_MS = 60 * 60 * 1000;

/**
 * When you are free to play, instead of a clock time.
 *
 * Box cricket is arranged as "this evening", not "18:00 to 20:00" -- the exact
 * time is settled between captains once an opponent exists. So the form asks
 * for a WINDOW.
 *
 * Each window still resolves to real `scheduled_at` / `end_time` instants,
 * because those columns are load-bearing: `scheduled_at` drives the nearby
 * filter, ordering, clash detection and expire_stale_matches, and `end_time`
 * drives rounds-in-a-slot (create_rematch), the 30/10-minute slot reminders and
 * expiry. Windows change what we ASK for, not what we store.
 */
export const PLAY_WINDOWS = [
  { key: 'morning', label: 'Morning', hint: '6 – 10 AM', start: '06:00', end: '10:00' },
  { key: 'afternoon', label: 'Afternoon', hint: '12 – 4 PM', start: '12:00', end: '16:00' },
  { key: 'evening', label: 'Evening', hint: '5 – 9 PM', start: '17:00', end: '21:00' },
  { key: 'night', label: 'Night', hint: '9 – 11 PM', start: '21:00', end: '23:00' },
] as const;

export type PlayWindowKey = (typeof PLAY_WINDOWS)[number]['key'];

/** The window a start time falls in, so an existing draft lights the right chip. */
export function windowForTime(timeHHmm: string): PlayWindowKey | null {
  return PLAY_WINDOWS.find((w) => w.start === timeHHmm)?.key ?? null;
}

/** The default slot. Two hours is the common box-cricket booking. */
export const DEFAULT_SLOT_DURATION_MIN = 120;

export function slotDurationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hr${minutes === 60 ? '' : 's'}`;
  return `${Math.floor(minutes / 60)}.${((minutes % 60) * 10) / 60} hrs`;
}

/**
 * Clock arithmetic on an HH:mm string, wrapping at midnight.
 *
 * Wrapping is correct rather than an edge case: a 23:00 start on a two-hour
 * slot legitimately ends at 01:00, and `buildEndAt` already rolls an end time
 * at or before the start onto the next day when it builds the instant.
 */
export function addMinutesHHmm(hhmm: string, minutes: number): string {
  const [h = 0, m = 0] = hhmm.split(':').map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Minutes from `start` to `end`, wrapping past midnight.
 *
 * A 23:00 start with a 01:00 end is a two-hour slot, not a negative one — the
 * same wrap `addMinutesHHmm` already applies in the other direction.
 */
export function minutesBetweenHHmm(start: string, end: string): number | null {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return null;
  const diff = ((eh as number) * 60 + (em as number)) - ((sh as number) * 60 + (sm as number));
  const wrapped = ((diff % 1440) + 1440) % 1440;
  return wrapped === 0 ? 1440 : wrapped;
}

export type MatchType = 'team_vs_team' | 'post_match';

/** The wizard routes, in order. Three steps, no branching. */
export type WizardStep = 'sport' | 'area' | 'details';

const STEP_ORDER: WizardStep[] = ['sport', 'area', 'details'];

/** Where a step sits in the flow, for the "Step N of 3" indicator. */
export function stepPosition(step: WizardStep): { index: number; total: number } {
  const at = STEP_ORDER.indexOf(step);
  return { index: at === -1 ? STEP_ORDER.length : at + 1, total: STEP_ORDER.length };
}

export interface CreateMatchWizardState {
  // Step 1 — sport and match type share one screen.
  sport: Sport | null;
  matchType: MatchType | null;
  // Step 2 — area locality and search radius
  areaName: string;
  areaCoords: { lat: number; lng: number } | null;
  /** Metres, to match the RPC. The chips are in km and multiply by 1000. */
  searchRadiusM: number;
  // Step 3
  teamId: string | null;
  /** Players per side. The sheet total is twice this. */
  playersPerSide: number | null;
  dayOffset: number | null;
  timeHHmm: string;
  endTimeHHmm: string;
  slotDurationMin: number | null;
  lastActiveStep: WizardStep;
  /** Wall clock of the last edit. Null on a cleared draft. See DRAFT_TTL_MS. */
  updatedAt: number | null;

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
  setPlayWindow: (key: PlayWindowKey) => void;
  setSlotDurationMin: (slotDurationMin: number) => void;
  setLastActiveStep: (step: WizardStep) => void;
  reset: () => void;
}

/** Defaults chosen to match the form: 25 km of search. */
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
  slotDurationMin: DEFAULT_SLOT_DURATION_MIN,
  lastActiveStep: 'sport',
  updatedAt: null,
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
  | 'setSlotDurationMin'
  | 'setPlayWindow'
  | 'setLastActiveStep'
  | 'reset'
>;

export function hasMatchDraft(state: {
  sport: Sport | null;
  matchType: MatchType | null;
  areaName: string;
  updatedAt: number | null;
}): boolean {
  const started =
    state.sport !== null ||
    Boolean(state.areaName && state.areaName.trim().length > 0) ||
    state.matchType !== null;
  if (!started) return false;

  // A draft written before updatedAt existed has no timestamp. Treat it as
  // expired rather than immortal -- that is the bug this field exists to fix.
  if (state.updatedAt === null) return false;

  return Date.now() - state.updatedAt < DRAFT_TTL_MS;
}

export const useCreateMatchWizard = create<CreateMatchWizardState>()(
  persist(
    (rawSet) => {
      /*
        Every write stamps the clock, so no setter has to remember to. A caller
        that sets `updatedAt` itself wins -- that is how reset() clears it
        instead of being re-stamped by its own write.
      */
      // zustand's `set` is overloaded (partial vs. replace), and TS resolves the
      // replace overload here -- which demands a callback returning void. One
      // narrow cast at the boundary pins the partial form; every use below is
      // type-checked against CreateMatchWizardState as normal.
      const setState = rawSet as unknown as (
        updater: (state: CreateMatchWizardState) => Partial<CreateMatchWizardState>,
      ) => void;

      const set = (
        updater: (state: CreateMatchWizardState) => Partial<CreateMatchWizardState>,
      ): void =>
        setState((state) => {
          const next = updater(state);
          return 'updatedAt' in next ? next : { ...next, updatedAt: Date.now() };
        });

      return {
      ...INITIAL,

      setSport: (sport) =>
        set((state) =>
          state.sport === sport
            ? { lastActiveStep: 'sport' }
            : {
                sport,
                areaName: '',
                areaCoords: null,
                teamId: null,
                playersPerSide: null,
                lastActiveStep: 'sport',
              },
        ),
      setMatchType: (matchType) =>
        set((state) =>
          state.matchType === matchType
            ? { lastActiveStep: 'sport' }
            : { matchType, teamId: matchType === 'post_match' ? null : state.teamId, lastActiveStep: 'sport' },
        ),
      setAreaName: (areaName) => set(() => ({ areaName, lastActiveStep: 'area' })),
      setAreaCoords: (areaCoords) => set(() => ({ areaCoords, lastActiveStep: 'area' })),
      setSearchRadiusM: (searchRadiusM) => set(() => ({ searchRadiusM })),
      setTeamId: (teamId) => set(() => ({ teamId, lastActiveStep: 'details' })),
      setPlayersPerSide: (playersPerSide) => set(() => ({ playersPerSide, lastActiveStep: 'details' })),
      setDayOffset: (dayOffset) => set(() => ({ dayOffset, lastActiveStep: 'details' })),
      setTimeHHmm: (timeHHmm) =>
        set((state) => ({
          timeHHmm,
          endTimeHHmm:
            state.slotDurationMin !== null && timeHHmm
              ? addMinutesHHmm(timeHHmm, state.slotDurationMin)
              : state.endTimeHHmm,
          lastActiveStep: 'details',
        })),
      /*
        Setting an end time DERIVES the duration; it never clears it.

        This used to write `slotDurationMin: null`, which was correct only for
        the old manual end-time picker ("an explicit end means no preset").
        Step 3 now sets a duration and a start time and then wrote the end time
        too — so every duration tap, and every slot tap, immediately nulled the
        duration it had just set. The screen reads `slotDurationMin ?? 60`, so
        the user picked "2 hrs" and watched it snap back to "1 hr".

        Deriving instead of nulling keeps the three fields consistent no matter
        which one is written last, and there is no longer any path that leaves
        the duration null while a start and end exist.
      */
      setEndTimeHHmm: (endTimeHHmm) =>
        set((state) => ({
          endTimeHHmm,
          slotDurationMin:
            state.timeHHmm && endTimeHHmm
              ? minutesBetweenHHmm(state.timeHHmm, endTimeHHmm) ?? state.slotDurationMin
              : state.slotDurationMin,
          lastActiveStep: 'details',
        })),
      setPlayWindow: (key) =>
        set(() => {
          const w = PLAY_WINDOWS.find((x) => x.key === key);
          if (!w) return {};
          return {
            timeHHmm: w.start,
            endTimeHHmm: w.end,
            // Derived, not nulled — same reason as setEndTimeHHmm above.
            slotDurationMin: minutesBetweenHHmm(w.start, w.end),
            lastActiveStep: 'details',
          };
        }),
      setSlotDurationMin: (slotDurationMin) =>
        set((state) => ({
          slotDurationMin,
          endTimeHHmm: state.timeHHmm
            ? addMinutesHHmm(state.timeHHmm, slotDurationMin)
            : state.endTimeHHmm,
          lastActiveStep: 'details',
        })),
      setLastActiveStep: (lastActiveStep) => set(() => ({ lastActiveStep })),
      reset: () => set(() => ({ ...INITIAL, updatedAt: null })),
      };
    },
    {
      name: 'matchup_create_wizard_draft',
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
