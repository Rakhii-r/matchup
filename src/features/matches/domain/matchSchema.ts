import { z } from 'zod';

import type { Database, PlayerStatus } from '@shared/types/database.types';

export type Match = Database['public']['Tables']['matches']['Row'];
export type MatchPlayer = Database['public']['Tables']['match_players']['Row'];

export const SportEnum = z.enum(['box_cricket', 'badminton']);

/** Mirrors the `game_type` CHECK on `matches` and `team_challenges`. */
export const GameTypeEnum = z.enum(['friendly', 'competitive']);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Create-match form. Day/time are chip selections that compose into scheduled_at. */
export const CreateMatchSchema = z
  .object({
    matchName: z.string().trim().min(2, 'Enter a match name').max(80),
    sport: SportEnum,
    venueId: z.string().uuid('Select a venue'),
    dayOffset: z.number().int().min(0, 'Pick a day').max(13),
    timeHHmm: z.string().regex(HHMM, 'Pick a time'),
    totalSlots: z.number().int().min(2, 'At least 2 players').max(40),
    missingCount: z.number().int().min(1, 'Need at least 1 player').max(39),
    notes: z.string().trim().max(280).optional(),
    /**
     * Added with the create-match wizard. Both are optional so every existing
     * caller keeps compiling and keeps its old behaviour: `gameType` falls back
     * to the column default and `endTimeHHmm` to null.
     */
    gameType: GameTypeEnum.optional(),
    endTimeHHmm: z.string().regex(HHMM, 'Pick an end time').optional(),
  })
  .refine((v) => v.missingCount < v.totalSlots, {
    message: 'Players needed must be fewer than the total',
    path: ['missingCount'],
  });

export type CreateMatchForm = z.infer<typeof CreateMatchSchema>;

/**
 * Post a Match (Open for all).
 *
 * Mirrors the checks inside `create_open_match` so the user is told what is
 * missing before a round trip. The RPC still re-checks every one of them — the
 * client is untrusted, and a form that passed validation five minutes ago can
 * be submitting a time that is now in the past.
 *
 * There is no team field, and that is deliberate: an open match has no Team A,
 * no Team B and no opponent. `totalSlots` is the whole sheet (players per side
 * × 2), because both halves of it are filled by individuals here rather than by
 * two squads.
 */
export const CreateOpenMatchSchema = z.object({
  matchName: z.string().trim().min(2, 'Enter a match name').max(80),
  sport: SportEnum,
  areaName: z.string().trim().min(2, 'Enter an area name').max(100),
  dayOffset: z.number().int().min(0, 'Pick a day').max(13),
  timeHHmm: z.string().regex(HHMM, 'Pick a start time'),
  /** Absent means the organiser left the finish open. */
  endTimeHHmm: z.string().regex(HHMM, 'Pick an end time').optional(),
  totalSlots: z.number().int().min(2, 'At least 2 players').max(40),
  gameType: GameTypeEnum,
  /** Metres, to match the column and the RPC. The chips are kilometres. */
  radiusM: z.number().int().min(1000, 'Pick a search distance').max(50000),
  lat: z.number().optional(),
  lng: z.number().optional(),
  venueId: z.string().uuid().optional(),
});

export type CreateOpenMatchForm = z.infer<typeof CreateOpenMatchSchema>;

export const JoinCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code'),
});

export const PLAYER_STATUS_LABEL: Record<PlayerStatus, string> = {
  interested: 'Interested',
  invited: 'Awaiting reply',
  approved: 'Approved',
  rejected: 'Rejected',
  confirmed: 'Confirmed',
};

/** Share code uses an unambiguous alphabet (no 0/O/1/I) for easy reading aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateShareCode(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return out;
}

/** Compose an absolute Date from a day offset (0 = today) and an HH:mm time string. */
export function buildScheduledAt(dayOffset: number, timeHHmm: string): Date {
  const [h = 0, m = 0] = timeHHmm.split(':').map((part) => Number(part));
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(h, m, 0, 0);
  return date;
}

/**
 * Absolute end of the booking, or null when the organiser left it open.
 *
 * An end time at or before the start means the game runs past midnight — a
 * 23:00 start finishing at 00:30 — so it rolls onto the next day rather than
 * being rejected. `end_time` is timestamptz on both tables, so this has to be a
 * full instant, not a clock reading.
 */
export function buildEndAt(
  dayOffset: number,
  startHHmm: string,
  endHHmm: string | undefined | null,
): Date | null {
  if (!endHHmm) return null;
  const start = buildScheduledAt(dayOffset, startHHmm);
  const end = buildScheduledAt(dayOffset, endHHmm);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return end;
}
