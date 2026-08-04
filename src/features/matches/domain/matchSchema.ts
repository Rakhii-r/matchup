import { z } from 'zod';

import type { Database, PlayerStatus, Sport } from '@shared/types/database.types';

export type Match = Database['public']['Tables']['matches']['Row'];
export type MatchPlayer = Database['public']['Tables']['match_players']['Row'];

export const SportEnum = z.enum(['box_cricket', 'badminton']);

/** Create-match form. Day/time are chip selections that compose into scheduled_at. */
export const CreateMatchSchema = z
  .object({
    matchName: z.string().trim().min(2, 'Enter a match name').max(80),
    sport: SportEnum,
    venueId: z.string().uuid('Select a venue'),
    dayOffset: z.number().int().min(0, 'Pick a day').max(13),
    timeHHmm: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Pick a time'),
    totalSlots: z.number().int().min(2, 'At least 2 players').max(40),
    missingCount: z.number().int().min(1, 'Need at least 1 player').max(39),
    notes: z.string().trim().max(280).optional(),
  })
  .refine((v) => v.missingCount < v.totalSlots, {
    message: 'Players needed must be fewer than the total',
    path: ['missingCount'],
  });

export type CreateMatchForm = z.infer<typeof CreateMatchSchema>;

export const JoinCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code'),
});

export const SPORT_LABEL: Record<Sport, string> = {
  box_cricket: 'Box Cricket',
  badminton: 'Badminton',
};

export const PLAYER_STATUS_LABEL: Record<PlayerStatus, string> = {
  interested: 'Interested',
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
