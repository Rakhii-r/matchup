import { z } from 'zod';

import { GameTypeEnum } from '@features/matches/domain/matchSchema';
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
  areaName: z.string().trim().min(2, 'Enter an area name').max(100),
  dayOffset: z.number().int().min(0).max(13),
  timeHHmm: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Pick a time'),
  totalSlots: z.number().int().min(2).max(40),
  message: z.string().trim().max(280).optional(),
  /** Metres. 25 km default covers a metro; 5 km is one neighbourhood. */
  radiusM: z.number().int().min(1000).max(50000).default(25000),
  /**
   * Added with the create-match wizard. Both optional so the older post-open
   * screen keeps compiling and keeps its behaviour — the RPC defaults
   * in_game_type to 'friendly' and in_end_time to null.
   */
  gameType: GameTypeEnum.optional(),
  endTimeHHmm: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Pick an end time')
    .optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  venueId: z.string().uuid().optional(),
});

export type PostOpenChallengeForm = z.infer<typeof PostOpenChallengeSchema>;

export type ChallengeCandidate =
  Database['public']['Tables']['challenge_candidates']['Row'];

/** A candidate row with the offered team's name resolved for display. */
export interface ChallengeCandidateWithTeam extends ChallengeCandidate {
  team: { name: string; sport: string } | null;
}

/**
 * A candidate row from `get_challenge_candidates` — the same offer ledger, but
 * with the team's name, badge and record resolved server-side. Poster-only.
 *
 * This is what the radar and the poster's Match Offers list render.
 * `ChallengeCandidateWithTeam` above cannot carry a name at all: the embedded
 * `teams` row is invisible to a non-member, so it always reads back NULL.
 */
export type ChallengeCandidateFull =
  Database['public']['Functions']['get_challenge_candidates']['Returns'][number];

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

export interface NearbyOpenChallenge {
  challenge_id: string;
  match_name: string;
  from_team_id: string;
  from_team_name: string;
  from_team_logo: string | null;
  sport: string;
  venue_id: string | null;
  venue_name: string;
  area_name: string;
  scheduled_at: string;
  total_slots: number;
  message: string | null;
  distance_m: number;
  created_at: string;
  applied_status: string | null;
}

export const RADIUS_OPTIONS: { label: string; value: number }[] = [
  { label: '5 km', value: 5000 },
  { label: '10 km', value: 10000 },
  { label: '25 km', value: 25000 },
  { label: '50 km', value: 50000 },
];

