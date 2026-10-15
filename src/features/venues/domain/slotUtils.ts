import type { VenueSlot } from './venueBookingSchema';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format court label depending on sport type.
 * e.g., "Box 1" for box cricket, cricket, turf, box; "Court 1" for badminton/tennis/etc.
 */
export function formatCourtLabel(courtNumber: number, sportTypes?: string[]): string {
  const isBoxOrTurf = sportTypes?.some((s) => {
    const lower = s.toLowerCase();
    return (
      lower === 'box_cricket' ||
      lower.includes('cricket') ||
      lower.includes('turf') ||
      lower.includes('box')
    );
  });
  return `${isBoxOrTurf ? 'Box' : 'Court'} ${courtNumber}`;
}

/**
 * Formats a single date into 12-hour time (e.g. "1:00 PM").
 */
function to12hTime(date: Date, timezone: string = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }).format(date);
  } catch {
    const period = date.getHours() < 12 ? 'AM' : 'PM';
    const h12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    return `${h12}:${String(date.getMinutes()).padStart(2, '0')} ${period}`;
  }
}

/**
 * Formats start and end ISO timestamps into a display window (e.g. "1:00 PM – 2:00 PM").
 */
export function formatSlotWindow(
  startTimeIso: string,
  endTimeIso: string,
  timezone: string = 'Asia/Kolkata',
): string {
  try {
    const start = new Date(startTimeIso);
    const end = new Date(endTimeIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return '';
    }
    return `${to12hTime(start, timezone)} – ${to12hTime(end, timezone)}`;
  } catch {
    return '';
  }
}

/**
 * Formats the duration between start and end timestamps into a human-readable label.
 * e.g. "30 mins", "1 hr", "1.5 hrs", "2 hrs", "2.5 hrs", "3 hrs"
 */
export function formatDurationLabel(
  startTime: string | Date,
  endTime: string | Date,
): string {
  const startMs = typeof startTime === 'string' ? new Date(startTime).getTime() : startTime.getTime();
  const endMs = typeof endTime === 'string' ? new Date(endTime).getTime() : endTime.getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
    return '1 hr';
  }
  const diffMinutes = Math.round((endMs - startMs) / (60 * 1000));
  if (diffMinutes < 60) {
    return `${diffMinutes} mins`;
  }
  const hours = diffMinutes / 60;
  if (hours === 1) {
    return '1 hr';
  }
  const formattedHours = Number.isInteger(hours) ? `${hours}` : `${Number(hours.toFixed(1))}`;
  return `${formattedHours} hrs`;
}

/**
 * Formats start and end ISO timestamps into a window with duration.
 * e.g. "1:00 PM – 3:30 PM (2.5 hrs)"
 */
export function formatSlotWindowWithDuration(
  startTimeIso: string,
  endTimeIso: string,
  timezone: string = 'Asia/Kolkata',
): string {
  const windowStr = formatSlotWindow(startTimeIso, endTimeIso, timezone);
  if (!windowStr) return '';
  const durLabel = formatDurationLabel(startTimeIso, endTimeIso);
  return `${windowStr} (${durLabel})`;
}

/**
 * Formats a timestamp into a clean display date.
 * e.g. "Mon, 7 Sept, 2026"
 */
export function formatBookingDateClean(
  startTime: string | Date,
  timezone: string = 'Asia/Kolkata',
): string {
  try {
    const d = typeof startTime === 'string' ? new Date(startTime) : startTime;
    if (isNaN(d.getTime())) return '';

    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: timezone,
    }).formatToParts(d);

    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    let month = parts.find((p) => p.type === 'month')?.value ?? '';
    if (month.toLowerCase() === 'sep') {
      month = 'Sept';
    }
    const year = parts.find((p) => p.type === 'year')?.value ?? '';

    return `${weekday}, ${day} ${month}, ${year}`;
  } catch {
    return '';
  }
}

/**
 * Formats a Date object into "YYYY-MM-DD".
 */
export function formatDateIso(date: Date, timezone?: string): string {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const year = parts.find((p) => p.type === 'year')?.value;
      const month = parts.find((p) => p.type === 'month')?.value;
      const day = parts.find((p) => p.type === 'day')?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fall through to local date parts
    }
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface UpcomingDateItem {
  dateStr: string;
  dayLabel: string;
  dayNumber: string;
  isToday: boolean;
  monthLabel: string;
}

/**
 * Generates an array of upcoming date items starting from today for date picker components.
 */
export function getUpcomingDates(daysCount = 14): UpcomingDateItem[] {
  const dates: UpcomingDateItem[] = [];
  const now = new Date();

  for (let i = 0; i < daysCount; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const isToday = i === 0;
    const dayOfWeek = WEEKDAYS[d.getDay()] ?? '';
    const dayLabel = isToday ? 'Today' : dayOfWeek;
    const dayNumber = String(d.getDate()).padStart(2, '0');
    const monthLabel = MONTHS[d.getMonth()] ?? '';
    const dateStr = formatDateIso(d);

    dates.push({
      dateStr,
      dayLabel,
      dayNumber,
      isToday,
      monthLabel,
    });
  }

  return dates;
}

/**
 * Group flat list of slots by their court number.
 */
export function groupSlotsByCourt(slots: VenueSlot[]): Record<number, VenueSlot[]> {
  const grouped: Record<number, VenueSlot[]> = {};
  for (const slot of slots) {
    const list = grouped[slot.courtNumber] ?? [];
    list.push(slot);
    grouped[slot.courtNumber] = list;
  }
  return grouped;
}

export type SlotState = 'available' | 'booked' | 'past' | 'my_booking';

/**
 * Derives visual and behavioral status for a slot.
 * A slot is ONLY marked 'booked' (Occupied) if there is an actual booking_id in the database.
 */
export function getSlotStatus(slot: VenueSlot): SlotState {
  if (slot.isMyBooking) {
    return 'my_booking';
  }
  if (slot.bookingId !== null) {
    return 'booked';
  }
  const now = new Date();
  const end = new Date(slot.endTime);
  if (!isNaN(end.getTime()) && end.getTime() <= now.getTime()) {
    return 'past';
  }
  return 'available';
}

export interface SlotRangeCalculation {
  slots: VenueSlot[];
  endTime: string;
  endTimeHhmm: string;
  isValid: boolean;
  conflictSlot: VenueSlot | null;
}

/**
 * Calculates continuous slot window for multi-hour booking.
 */
export function computeSlotRange(
  startSlot: VenueSlot,
  durationMinutes: number,
  allCourtSlots: VenueSlot[],
  timezone: string = 'Asia/Kolkata',
): SlotRangeCalculation {
  const startMs = new Date(startSlot.startTime).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;
  const targetEndDate = new Date(endMs);
  const targetEndTimeIso = targetEndDate.toISOString();

  // Sort court slots by start time
  const sorted = [...allCourtSlots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  // Find all slots intersecting [startMs, endMs)
  const coveredSlots = sorted.filter((s) => {
    const sStart = new Date(s.startTime).getTime();
    const sEnd = new Date(s.endTime).getTime();
    return sStart < endMs && sEnd > startMs;
  });

  // Format end time hh:mm in timezone
  let targetEndHhmm = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).formatToParts(targetEndDate);
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    targetEndHhmm = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    targetEndHhmm = `${pad(targetEndDate.getHours())}:${pad(targetEndDate.getMinutes())}`;
  }

  // Check if any covered slot is booked
  let conflictSlot: VenueSlot | null = null;
  for (const s of coveredSlots) {
    const status = getSlotStatus(s);
    if (status === 'booked' || status === 'my_booking') {
      conflictSlot = s;
      break;
    }
  }

  // Verify that covered slots fully span from startMs to endMs without gaps
  let isFullSpanCovered = false;
  if (coveredSlots.length > 0) {
    const firstStart = new Date(coveredSlots[0]!.startTime).getTime();
    const lastEnd = new Date(coveredSlots[coveredSlots.length - 1]!.endTime).getTime();
    isFullSpanCovered = firstStart <= startMs && lastEnd >= endMs;
  }

  const isValid = conflictSlot === null && isFullSpanCovered;

  return {
    slots: coveredSlots,
    endTime: targetEndTimeIso,
    endTimeHhmm: targetEndHhmm,
    isValid,
    conflictSlot,
  };
}

/**
 * Check if a given slot falls within the currently selected duration starting from startSlot.
 */
export function isSlotInSelectedRange(
  slot: VenueSlot,
  startSlot: VenueSlot | null,
  durationMinutes: number,
): boolean {
  if (!startSlot || slot.courtNumber !== startSlot.courtNumber) return false;
  const startMs = new Date(startSlot.startTime).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;
  const slotStartMs = new Date(slot.startTime).getTime();
  const slotEndMs = new Date(slot.endTime).getTime();
  return slotStartMs < endMs && slotEndMs > startMs;
}


