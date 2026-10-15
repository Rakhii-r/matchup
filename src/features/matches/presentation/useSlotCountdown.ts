/**
 * The booked slot's remaining time, as a live value.
 *
 * One slot is one `end_time`, and every game played inside it copies that same
 * instant (see `create_rematch`). So every screen in a session — the result, the
 * live scoring keypad, the scorecard — asks this hook the same question and
 * gets the same answer without knowing which game of the series it is showing.
 *
 * A null `end_time` is a match with NO booked slot, not an expired one. That
 * distinction is the whole reason `hasSlot` exists separately from `expired`:
 * most rows in this database predate the slot being mandatory, and treating
 * their null as "time is up" is what made Play Again dead for every one of them
 * before 24 Aug. `expired` is false for those, and the UI shows no pill at all.
 */
import { useEffect, useMemo, useState } from 'react';

/**
 * How often the remaining time is recomputed.
 *
 * The visible label only changes once a minute, but `expired` gates a button
 * the server will also refuse — and a full minute of a live "Play Next Round"
 * button after the slot closed is a tap that travels to Postgres just to come
 * back as SLOT_EXPIRED. Three ticks a minute keeps that window under 20s at a
 * cost of one comparison. Timers are throttled while the app is backgrounded;
 * every tick recomputes from `Date.now()` rather than accumulating, so the
 * first tick after a resume is already correct.
 */
const TICK_MS = 20_000;

/**
 * Minutes-remaining marks that raise an in-app warning, TIGHTEST FIRST — the
 * order is load-bearing. `find` below takes the first mark the remaining time
 * is inside, so with 5 minutes left this must yield 10 and not 30.
 */
const WARN_AT_MIN = [10, 30] as const;

export type SlotWarning = (typeof WARN_AT_MIN)[number];

export interface SlotCountdown {
  /** False when this match has no booked slot — nothing to show, nothing to gate. */
  hasSlot: boolean;
  /** The end of the booked slot, or null when there is none. */
  endsAt: Date | null;
  /** Whole minutes left, floored. Null with no slot, 0 once the slot has passed. */
  minutesLeft: number | null;
  /** True only when a slot exists AND it has passed. Never true without a slot. */
  expired: boolean;
  /** "1h 25m left in booked slot" / "8m left in booked slot". Null with no slot or once expired. */
  label: string | null;
  /** The slot's finish as a clock reading, for the expired badge: "8:00 PM". */
  endsAtLabel: string | null;
  /** The warning mark currently standing, or null. Cleared by `dismissWarning`. */
  warning: SlotWarning | null;
  dismissWarning: () => void;
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function remainingLabel(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h left in booked slot` : `${h}h ${m}m left in booked slot`;
  }
  return `${minutes}m left in booked slot`;
}

export function useSlotCountdown(endTime: string | null | undefined): SlotCountdown {
  // Parsed once per value, not once per tick: `endTime` is an ISO string off a
  // query result and re-parsing it three times a minute is pure waste.
  const endsAtMs = useMemo(() => {
    if (!endTime) return null;
    const ms = Date.parse(endTime);
    // A malformed timestamp is treated as "no slot" rather than as an expiry:
    // refusing to let anyone play on because a string could not be parsed is
    // the harsher of the two failures, and the server still enforces the real
    // rule on its own copy of the column.
    return Number.isFinite(ms) ? ms : null;
  }, [endTime]);

  const [nowMs, setNowMs] = useState(() => Date.now());

  /**
   * Dismissed warning marks, tagged with the slot they belong to.
   *
   * The tag is what makes the reset below possible without an effect: a
   * different slot is a different set of warnings, and without clearing them,
   * walking from one match to another inside the same mounted screen would
   * carry the first slot's dismissals onto the second.
   */
  const [dismissed, setDismissed] = useState<{ slot: number | null; marks: SlotWarning[] }>(() => ({
    slot: endsAtMs,
    marks: [],
  }));

  // Adjusting state DURING render, not in an effect. React's own guidance for
  // state derived from a changing input: the effect version rendered once with
  // the previous slot's dismissals still applied, then re-rendered to clear
  // them — a wasted commit, and `react-hooks/set-state-in-effect` rejects it.
  // React re-runs this component immediately and discards the first pass.
  if (dismissed.slot !== endsAtMs) {
    setDismissed({ slot: endsAtMs, marks: [] });
  }

  useEffect(() => {
    if (endsAtMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    // Cleared on unmount and whenever the slot changes, so a screen that is
    // navigated away from stops holding a timer.
    return () => clearInterval(id);
  }, [endsAtMs]);

  return useMemo((): SlotCountdown => {
    if (endsAtMs === null) {
      return {
        hasSlot: false,
        endsAt: null,
        minutesLeft: null,
        expired: false,
        label: null,
        endsAtLabel: null,
        warning: null,
        // No slot, so no warning was ever raised and there is nothing to clear.
        dismissWarning: () => {},
      };
    }

    const endsAt = new Date(endsAtMs);
    const msLeft = endsAtMs - nowMs;
    const expired = msLeft <= 0;
    const minutesLeft = expired ? 0 : Math.floor(msLeft / 60_000);

    // The tightest mark reached — see WARN_AT_MIN. 10 wins over 30 once both
    // are true, so the banner sharpens as the slot runs down rather than
    // staying stuck on the first warning shown.
    const standing: SlotWarning | null = expired
      ? null
      : (WARN_AT_MIN.find((m) => minutesLeft <= m) ?? null);

    return {
      hasSlot: true,
      endsAt,
      minutesLeft,
      expired,
      label: expired ? null : remainingLabel(minutesLeft),
      endsAtLabel: clockLabel(endsAt),
      warning: standing !== null && !dismissed.marks.includes(standing) ? standing : null,
      dismissWarning: () =>
        setDismissed((prev) =>
          standing === null || prev.marks.includes(standing)
            ? prev
            : { slot: prev.slot, marks: [...prev.marks, standing] },
        ),
    };
  }, [dismissed, endsAtMs, nowMs]);
}
