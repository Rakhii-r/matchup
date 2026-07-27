/**
 * Fallback demo matches for the Nearby screen.
 *
 * These are shown ONLY when the database returns no real nearby matches, so a
 * first-time user (or a demo/client build) never sees an empty wall. Every card
 * is unique — distinct name, venue, time, player count and status — and the ids
 * are namespaced with `demo-` so they can never collide with a real row.
 *
 * They are display-only: they are not written to Supabase and tapping them does
 * not attempt a join (the Nearby screen guards demo ids).
 */
import type { Match } from '@features/matches/domain/matchSchema';

/** True when a match id belongs to the demo set (never a real DB row). */
export function isDemoMatch(id: string): boolean {
  return id.startsWith('demo-');
}

/** Build an ISO timestamp `days` from today at `hh:mm` local time. */
function at(days: number, hh: number, mm: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

type DemoSeed = {
  id: string;
  name: string;
  sport: Match['sport'];
  venue: string;
  when: string;
  total: number;
  filled: number;
  status: Match['status'];
};

const SEEDS: DemoSeed[] = [
  {
    id: 'demo-1',
    name: 'Box Cricket Evening Match',
    sport: 'box_cricket',
    venue: 'BoxOut Cricket Turf, Kukatpally',
    when: at(0, 19, 0),
    total: 12,
    filled: 8,
    status: 'open',
  },
  {
    id: 'demo-2',
    name: 'Morning Badminton Rally',
    sport: 'badminton',
    venue: 'Smash Arena, Madhapur',
    when: at(1, 7, 30),
    total: 4,
    filled: 2,
    status: 'open',
  },
  {
    id: 'demo-3',
    name: 'Weekend Cricket League',
    sport: 'box_cricket',
    venue: 'Game Point Sports Club, Gachibowli',
    when: at(2, 16, 0),
    total: 16,
    filled: 11,
    status: 'open',
  },
  {
    id: 'demo-4',
    name: 'Smash Doubles',
    sport: 'badminton',
    venue: 'Rally Shuttle Court, Kondapur',
    when: at(1, 20, 30),
    total: 4,
    filled: 4,
    status: 'locked',
  },
  {
    id: 'demo-5',
    name: 'Night Cricket League',
    sport: 'box_cricket',
    venue: 'Turf 24 Arena, Miyapur',
    when: at(3, 21, 0),
    total: 12,
    filled: 5,
    status: 'open',
  },
  {
    id: 'demo-6',
    name: 'PowerPlay Challenge',
    sport: 'box_cricket',
    venue: 'Sixer Box Cricket, Kphb',
    when: at(4, 18, 30),
    total: 16,
    filled: 9,
    status: 'open',
  },
];

/** Unique demo matches, shaped as full `Match` rows for the Nearby list. */
export const DEMO_MATCHES: Match[] = SEEDS.map((seed) => ({
  id: seed.id,
  creator_id: `demo-creator-${seed.id}`,
  sport: seed.sport,
  venue_id: null,
  venue_text: seed.venue,
  scheduled_at: seed.when,
  total_slots: seed.total,
  filled_slots: seed.filled,
  missing_count: Math.max(0, seed.total - seed.filled),
  status: seed.status,
  share_code: seed.id.toUpperCase(),
  lat: 17.4849,
  lng: 78.3915,
  notes: seed.name,
  created_at: new Date().toISOString(),
}));
