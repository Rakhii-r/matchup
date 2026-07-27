import type { Database } from '@shared/types/database.types';

export type Availability = Database['public']['Tables']['availability']['Row'];

/** Local calendar date as YYYY-MM-DD (matches the date column, not UTC midnight). */
export function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** End of the local day — availability for "today" expires tonight. */
export function endOfTodayISO(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
