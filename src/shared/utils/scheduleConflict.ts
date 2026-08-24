/**
 * Shared parsing and phrasing for the schedule-conflict exceptions the database
 * raises.
 *
 * Three team RPCs (post_open_challenge, finalise_challenge, create_challenge)
 * and two open-match RPCs (create_open_match, join_open_match) all refuse an
 * overlapping booking with `<TOKEN>|<startIso>|<endIso>|<name>` rather than a
 * plain token, because the message has to name the window that actually clashes.
 * Both repositories need to read that, so the reader lives here rather than
 * being copied.
 */
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function to12h(d: Date): string {
  const period = d.getHours() < 12 ? 'AM' : 'PM';
  const h12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${period}`;
}

/** "Mon 17 Aug, 7:00 PM – 9:00 PM" — the window of the match already booked. */
export function formatConflictWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${WEEKDAY[start.getDay()]} ${start.getDate()} ${MONTH[start.getMonth()]}, ${to12h(start)} – ${to12h(end)}`;
}

/**
 * `raw` is searched with `indexOf` rather than requiring the token at the
 * start, matching how PostgREST forwards the exception text. Returns null when
 * the error is not a conflict at all, so callers can fall through to their own
 * token table.
 */
export function parseScheduleConflict(
  raw: string,
  token: string,
): { startIso: string; endIso: string } | null {
  const at = raw.toUpperCase().indexOf(token.toUpperCase());
  if (at === -1) return null;
  const parts = raw.slice(at + token.length).split('|');
  if (parts.length < 3) return null;
  const startIso = (parts[1] ?? '').trim();
  const endIso = (parts[2] ?? '').trim();
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}
