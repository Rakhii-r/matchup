import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type {
  Challenge,
  ChallengeCandidateWithTeam,
  ChallengeListItem,
  OpenOffer,
} from '@features/teams/domain/challengeSchema';

/**
 * The challenge RPCs signal every refusal with a stable token as the message,
 * same pattern as join_match and join_team. Map each to copy that tells the user
 * what to do about it.
 */
const CHALLENGE_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['ACCOUNT_INACTIVE', 'forbidden', 'Your account is not active.'],
  ['NOT_TEAM_OWNER', 'forbidden', 'Only the team owner can do that.'],
  ['NOT_OPPONENT_OWNER', 'forbidden', 'Only their team owner can answer this.'],
  ['OPPONENT_NOT_FOUND', 'not_found', 'No team found for that code.'],
  ['CHALLENGE_NOT_FOUND', 'not_found', 'That challenge no longer exists.'],
  ['SELF_CHALLENGE', 'validation', 'You cannot challenge your own team.'],
  ['SPORT_MISMATCH', 'validation', 'That team plays a different sport.'],
  ['SCHEDULE_IN_PAST', 'validation', 'Pick a date and time in the future.'],
  ['TOO_MANY_PLAYERS', 'validation', 'Both squads together do not fit the slots you picked.'],
  ['CHALLENGE_ALREADY_PENDING', 'conflict', 'You already have a pending challenge with that team.'],
  ['CHALLENGE_ALREADY_ANSWERED', 'conflict', 'That challenge has already been answered.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That venue is no longer available.'],
  // Open-challenge tokens.
  ['CHALLENGE_ALREADY_TAKEN', 'conflict', 'Another team took this fixture first.'],
  ['OPEN_CHALLENGE_ALREADY_LIVE', 'conflict', 'This team already has an open challenge. Withdraw it first.'],
  ['NOT_OFFERED', 'forbidden', 'This fixture was not offered to your team.'],
  ['TEAM_NOT_FOUND', 'not_found', 'That team no longer exists.'],
  ['INVALID_SLOTS', 'validation', 'Pick how many players the match needs.'],
  ['NO_OPPONENT', 'validation', 'That challenge has no opponent yet.'],
];

function challengeError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of CHALLENGE_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export const challengeRepository = {
  /**
   * Read through `list_my_challenges` rather than the table directly: the
   * opponent's `teams` row is unreadable under members-only RLS, so a plain
   * select would only ever yield raw uuids for the other side.
   */
  async listMine(): Promise<ChallengeListItem[]> {
    const { data, error } = await supabase.rpc('list_my_challenges');
    if (error) throw challengeError(error);
    return data ?? [];
  },

  async create(input: {
    fromTeamId: string;
    opponentCode: string;
    matchName: string;
    venueId: string;
    scheduledAt: string;
    totalSlots: number;
    message?: string | null;
  }): Promise<Challenge> {
    const { data, error } = await supabase.rpc('create_challenge', {
      in_from_team_id: input.fromTeamId,
      in_opponent_code: input.opponentCode,
      in_match_name: input.matchName,
      in_venue_id: input.venueId,
      in_scheduled_at: input.scheduledAt,
      in_total_slots: input.totalSlots,
      in_message: input.message ?? null,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not send the challenge.');
    return data;
  },

  /** Accepting creates the match and confirms both squads onto it, server-side. */
  async respond(challengeId: string, accept: boolean): Promise<Challenge> {
    const { data, error } = await supabase.rpc('respond_to_challenge', {
      in_challenge_id: challengeId,
      in_accept: accept,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not answer the challenge.');
    return data;
  },

  /**
   * Post a challenge with no named opponent. The server ranks nearby teams and
   * pushes an offer to the closest few; zero candidates is a normal outcome,
   * not an error, so this resolves either way. Read `listCandidates` to show
   * the poster how many were reached.
   */
  async postOpen(input: {
    fromTeamId: string;
    matchName: string;
    venueId: string;
    scheduledAt: string;
    totalSlots: number;
    message?: string | null;
    radiusM: number;
  }): Promise<Challenge> {
    const { data, error } = await supabase.rpc('post_open_challenge', {
      in_from_team_id: input.fromTeamId,
      in_match_name: input.matchName,
      in_venue_id: input.venueId,
      in_scheduled_at: input.scheduledAt,
      in_total_slots: input.totalSlots,
      in_message: input.message ?? null,
      in_radius_m: input.radiusM,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not post the challenge.');
    return data;
  },

  /**
   * First accept wins. The RPC row-locks the challenge, so a loser gets
   * CHALLENGE_ALREADY_TAKEN rather than a duplicate match.
   */
  async acceptOpen(challengeId: string, teamId: string): Promise<Challenge> {
    const { data, error } = await supabase.rpc('accept_open_challenge', {
      in_challenge_id: challengeId,
      in_team_id: teamId,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not accept the fixture.');
    return data;
  },

  /**
   * Fixtures offered to a team I belong to and still awaiting an answer.
   *
   * Read from challenge_candidates rather than list_my_challenges because the
   * accept RPC needs the specific team_id that was offered, and the challenge
   * list does not carry it. RLS already limits rows to my teams (plus my own
   * posted challenges, which the status filter on the embedded challenge and
   * the caller's own-team check exclude).
   */
  async listMyOffers(): Promise<OpenOffer[]> {
    const { data, error } = await supabase
      .from('challenge_candidates')
      .select(
        'id, challenge_id, team_id, rank, distance_m, status, created_at, ' +
          'team:teams!challenge_candidates_team_id_fkey(name), ' +
          'challenge:team_challenges(id, match_name, scheduled_at, total_slots, message, status, from_team_id)',
      )
      .eq('status', 'offered')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw challengeError(error);
    return (data ?? []) as unknown as OpenOffer[];
  },

  /** Who the matcher offered a challenge to. Visible to the poster's squad. */
  async listCandidates(challengeId: string): Promise<ChallengeCandidateWithTeam[]> {
    const { data, error } = await supabase
      .from('challenge_candidates')
      .select('*, team:teams(name, sport)')
      .eq('challenge_id', challengeId)
      .order('rank', { ascending: true });
    if (error) throw challengeError(error);
    return (data ?? []) as unknown as ChallengeCandidateWithTeam[];
  },

  async cancel(challengeId: string): Promise<Challenge> {
    const { data, error } = await supabase.rpc('cancel_challenge', {
      in_challenge_id: challengeId,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not withdraw the challenge.');
    return data;
  },
};
