import { z } from 'zod';

import type { CandidateStatus, ChallengeStatus, Database } from '@shared/types/database.types';

export type Challenge = Database['public']['Tables']['team_challenges']['Row'];

/** Row shape from `list_my_challenges` — team and venue names already resolved. */
export type ChallengeListItem =
  Database['public']['Functions']['list_my_challenges']['Returns'][number];

export const CreateChallengeSchema = z.object({
  opponentCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Enter the opponent’s 6-character code'),
  matchName: z.string().trim().min(2, 'Name the match').max(80),
  venueId: z.string().uuid('Pick a venue'),
  dayOffset: z.number().int().min(0).max(13),
  timeHHmm: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Pick a time'),
  totalSlots: z.number().int().min(2).max(40),
  message: z.string().trim().max(280).optional(),
});

export type CreateChallengeForm = z.infer<typeof CreateChallengeSchema>;

export const CHALLENGE_STATUS_LABEL: Record<ChallengeStatus, string> = {
  pending: 'Pending',
  open: 'Looking for opponent',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Withdrawn',
  expired: 'Expired',
};

/**
 * An OPEN challenge names no opponent. The server ranks nearby teams that play
 * the same sport and offers it to the closest few; the first to accept gets the
 * fixture. Same fields as a directed challenge minus the opponent code, plus
 * how far to look.
 */
export const PostOpenChallengeSchema = z.object({
  matchName: z.string().trim().min(2, 'Name the match').max(80),
  venueId: z.string().uuid('Pick a venue'),
  dayOffset: z.number().int().min(0).max(13),
  timeHHmm: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Pick a time'),
  totalSlots: z.number().int().min(2).max(40),
  message: z.string().trim().max(280).optional(),
  /** Metres. 25 km default covers a metro; 5 km is one neighbourhood. */
  radiusM: z.number().int().min(1000).max(50000).default(25000),
});

export type PostOpenChallengeForm = z.infer<typeof PostOpenChallengeSchema>;

export type ChallengeCandidate =
  Database['public']['Tables']['challenge_candidates']['Row'];

/** A candidate row with the offered team's name resolved for display. */
export interface ChallengeCandidateWithTeam extends ChallengeCandidate {
  team: { name: string; sport: string } | null;
}

/**
 * An offer sitting in front of one of my teams. Flattened from
 * challenge_candidates with the challenge and my team's name embedded, because
 * accepting needs the candidate's `team_id`, not just the challenge id.
 */
export interface OpenOffer {
  id: string;
  challenge_id: string;
  team_id: string;
  rank: number;
  distance_m: number;
  status: CandidateStatus;
  created_at: string;
  team: { name: string } | null;
  challenge: {
    id: string;
    match_name: string;
    scheduled_at: string;
    total_slots: number;
    message: string | null;
    status: ChallengeStatus;
    from_team_id: string;
  } | null;
}

export const RADIUS_OPTIONS: { label: string; value: number }[] = [
  { label: '5 km', value: 5000 },
  { label: '10 km', value: 10000 },
  { label: '25 km', value: 25000 },
  { label: '50 km', value: 50000 },
];
