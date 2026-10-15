import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import { teamRepository } from '@features/teams/data/teamRepository';
import type {
  Challenge,
  ChallengeCandidate,
  ChallengeCandidateFull,
  ChallengeCandidateWithTeam,
  ChallengeListItem,
  NearbyOpenChallenge,
  OpenOffer,
} from '@features/teams/domain/challengeSchema';
import {
  formatConflictWindow,
  parseScheduleConflict,
} from '@shared/utils/scheduleConflict';
import type { Sport } from '@shared/types/database.types';

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
  // A player cannot stand on both team sheets, so two squads that share one
  // cannot be paired. The radar already hides them from each other; this is
  // what a captain sees if they reach the pairing another way.
  [
    'SHARED_PLAYER',
    'conflict',
    'You share a player with that team, so the two squads cannot play each other.',
  ],
  // team_challenges_squad_check — the squad rule is enforced in the DB now, not
  // only by the create screen's button.
  //
  // ORDER MATTERS: matching is `raw.includes(token)`, and the string
  // 'OPPONENT_SQUAD_TOO_SMALL' contains 'SQUAD_TOO_SMALL'. Listed the other way
  // round, an undersized OPPONENT would be reported as "Your squad is too
  // small" — blaming the wrong team for the wrong thing.
  [
    'OPPONENT_SQUAD_TOO_SMALL',
    'conflict',
    'That team does not have enough players for this many a side yet.',
  ],
  ['SQUAD_TOO_SMALL', 'conflict', 'Your squad is too small for that many players a side. Add players first.'],
  // Strict format matching (20260903090000). ORDER MATTERS for the same reason
  // the squad tokens above are ordered: 'OPPONENT_FORMAT_MISMATCH' contains
  // 'FORMAT_MISMATCH', so the opponent-specific token has to be tested first or
  // a cross-format OPPONENT is reported as the user's own team being wrong.
  [
    'OPPONENT_FORMAT_MISMATCH',
    'conflict',
    'That team plays a different format. Teams can only play the same number a side.',
  ],
  [
    'FORMAT_MISMATCH',
    'conflict',
    'That fixture is a different format from your team. You can only play teams of the same number a side.',
  ],
  // Raised by accept_open_challenge through set_match_lineup.
  ['LINEUP_SIZE_MISMATCH', 'validation', 'Pick exactly the number of players this format needs.'],
  ['LINEUP_DUPLICATE_PLAYER', 'validation', 'That player is already in the lineup.'],
  ['LINEUP_NOT_A_MEMBER', 'validation', 'Everyone in the lineup has to be on your team.'],
  ['LINEUP_MISSING_CAPTAIN', 'validation', 'You play in your own lineup — keep yourself selected.'],
  ['SPORT_MISMATCH', 'validation', 'That team plays a different sport.'],
  ['SCHEDULE_IN_PAST', 'validation', 'Pick a date and time in the future.'],
  ['TOO_MANY_PLAYERS', 'validation', 'Both squads together do not fit the slots you picked.'],
  ['CHALLENGE_ALREADY_PENDING', 'conflict', 'You already have a pending challenge with that team.'],
  ['CHALLENGE_ALREADY_ANSWERED', 'conflict', 'That challenge has already been answered.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That venue is no longer available.'],
  // Open-challenge tokens.
  ['CHALLENGE_ALREADY_TAKEN', 'conflict', 'Another team took this fixture first.'],
  ['NOT_OFFERED', 'forbidden', 'This fixture was not offered to your team.'],
  ['TEAM_NOT_FOUND', 'not_found', 'That team no longer exists.'],
  ['INVALID_SLOTS', 'validation', 'Pick how many players the game needs.'],
  ['NO_OPPONENT', 'validation', 'That challenge has no opponent yet.'],
];

function challengeError(error: unknown): AppError {
  const e = (error ?? {}) as { message?: string; details?: string; hint?: string; code?: string };
  const raw = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.toUpperCase();

  const own = parseScheduleConflict(raw, 'TEAM_SCHEDULE_CONFLICT');
  if (own) {
    return new AppError(
      'conflict',
      `Team unavailable — this team already has a match scheduled ${formatConflictWindow(own.startIso, own.endIso)}. Choose a different time or date.`,
      error,
    );
  }
  const opponent = parseScheduleConflict(raw, 'OPPONENT_SCHEDULE_CONFLICT');
  if (opponent) {
    return new AppError(
      'conflict',
      `Opponent team is unavailable at this time — they already have a match scheduled ${formatConflictWindow(opponent.startIso, opponent.endIso)}. Choose a different time or date.`,
      error,
    );
  }

  for (const [token, code, message] of CHALLENGE_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }

  if (raw.includes('CHALLENGE_CANDIDATES_STATUS_CHECK') || raw.includes('STATUS_CHECK')) {
    return new AppError(
      'validation',
      'Please apply the latest database migration for interactive game requests.',
      error,
    );
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
    areaName: string;
    scheduledAt: string;
    totalSlots: number;
    message?: string | null;
    radiusM: number;
    /** ISO instant, or null to leave the finish time open. */
    endTime?: string | null;
    lat?: number | null;
    lng?: number | null;
    venueId?: string | null;
  }): Promise<Challenge> {
    const { data, error } = await supabase.rpc('post_open_challenge', {
      in_from_team_id: input.fromTeamId,
      in_match_name: input.matchName,
      in_area_name: input.areaName,
      in_scheduled_at: input.scheduledAt,
      in_total_slots: input.totalSlots,
      in_message: input.message ?? null,
      in_radius_m: input.radiusM,
      in_end_time: input.endTime ?? null,
      in_lat: input.lat ?? null,
      in_lng: input.lng ?? null,
      in_venue_id: input.venueId ?? null,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not post the challenge.');
    return data;
  },

  /**
   * Opponent team captain sends an interested/challenge request to an open fixture.
   */
  async applyToChallenge(challengeId: string, teamId: string): Promise<ChallengeCandidate> {
    const { data, error } = await supabase.rpc('apply_to_open_challenge', {
      in_challenge_id: challengeId,
      in_team_id: teamId,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not apply to the challenge.');
    return data;
  },

  /**
   * Opponent teams browse open fixtures looking for opponents nearby.
   */
  /**
   * Open fixtures near me, LOCKED to one format.
   *
   * `teamSize` is players per side and is not optional in spirit even though
   * the type allows null: `list_open_challenges_nearby` returns nothing at all
   * for a null, because "I have not told you my format" is not a wildcard. The
   * caller passes the active team's declared format and renders a
   * format-specific empty state when there is nothing at that size.
   */
  async listNearbyOpenChallenges(input?: {
    lat?: number | null;
    lng?: number | null;
    radiusM?: number | null;
    sport?: Sport | string | null;
    teamSize?: number | null;
  }): Promise<NearbyOpenChallenge[]> {
    const { data, error } = await supabase.rpc('list_open_challenges_nearby', {
      in_lat: input?.lat ?? null,
      in_lng: input?.lng ?? null,
      in_radius_m: (input?.radiusM ?? null) as unknown as number,
      in_sport: input?.sport ?? null,
      in_team_size: input?.teamSize ?? null,
    });
    if (error) throw challengeError(error);
    return (data ?? []) as NearbyOpenChallenge[];
  },

  /**
   * Accept an open fixture (called either by the Host accepting an applicant team,
   * or by an offered team accepting an offer).
   */
  /**
   * Accept a fixture AND name the squad, in one transaction.
   *
   * `lineup` is the accepting captain's own team, exactly the format size and
   * including themselves. It is not optional: the server refuses a fixture with
   * no named squad, and it validates the lineup before building the match, so a
   * bad selection rolls the acceptance back with it rather than leaving a
   * confirmed fixture nobody is playing in.
   */
  async acceptOpen(challengeId: string, teamId: string, lineup: string[]): Promise<Challenge> {
    const { data, error } = await supabase.rpc('accept_open_challenge', {
      in_challenge_id: challengeId,
      in_team_id: teamId,
      in_lineup: lineup,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not accept the fixture.');
    return data;
  },
  async declineOpen(challengeId: string, teamId: string): Promise<void> {
    const { error } = await supabase.rpc('decline_open_challenge', { in_challenge_id: challengeId, in_team_id: teamId });
    if (error) throw challengeError(error);
  },

  /**
   * Fixtures offered to a team I belong to and still awaiting an answer.
   *
   * Read from challenge_candidates rather than list_my_challenges because the
   * accept RPC needs the specific team_id that was offered, and the challenge
   * list does not carry it.
   *
   * RLS IS NOT ENOUGH HERE, and filtering on status alone was a real bug.
   * `challenge_candidates_select` deliberately matches two kinds of row: rows
   * for a team I am in (a genuine incoming offer) AND every row of a challenge
   * MY OWN team posted (so the poster can see who was reached). Both are
   * correct for the policy and only the first is an incoming offer, so a
   * poster's outgoing candidates were listed to them as if other teams had
   * offered them a fixture — with a null team name, because `teams` is
   * members-only and the poster is not in the team the row points at.
   *
   * Narrowing to the teams I am actually a member of is the whole fix: a
   * candidate row is an offer TO ME only when its team_id is one of mine.
   */
  async listMyOffers(): Promise<OpenOffer[]> {
    const myTeamIds = (await teamRepository.listMine()).map((team) => team.id);
    // No teams, no incoming offers. Skipping the query is not just an
    // optimisation: `.in('team_id', [])` is a query PostgREST does not need to
    // be asked, and an unfiltered fallback would reintroduce the bug above.
    if (myTeamIds.length === 0) return [];

    const { data, error } = await supabase
      .from('challenge_candidates')
      .select(
        'id, challenge_id, team_id, rank, distance_m, status, created_at, ' +
          'team:teams!challenge_candidates_team_id_fkey(name), ' +
          'challenge:team_challenges(id, match_name, scheduled_at, total_slots, message, status, from_team_id)',
      )
      .in('status', ['offered', 'interested'])
      .in('team_id', myTeamIds)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw challengeError(error);

    // Deduplicate by challenge_id so a user receives exactly ONE offer card per fixture
    const rawOffers = (data ?? []) as unknown as OpenOffer[];
    const dedupedMap = new Map<string, OpenOffer>();
    for (const offer of rawOffers) {
      if (!offer.challenge_id || !offer.challenge || offer.challenge.status !== 'open') continue;
      const existing = dedupedMap.get(offer.challenge_id);
      if (!existing) {
        dedupedMap.set(offer.challenge_id, offer);
      } else if (existing.status !== 'interested' && offer.status === 'interested') {
        dedupedMap.set(offer.challenge_id, offer);
      }
    }
    return Array.from(dedupedMap.values());
  },

  /** Who the matcher offered a challenge to. Visible to the poster's squad. */
  async listCandidates(challengeId: string): Promise<ChallengeCandidateWithTeam[]> {
    const { data, error } = await supabase
      .from('challenge_candidates')
      .select('*, team:teams(name, sport)')
      .eq('challenge_id', challengeId)
      .order('rank', { ascending: true })
      .limit(50);
    if (error) throw challengeError(error);
    return (data ?? []) as unknown as ChallengeCandidateWithTeam[];
  },

  /**
   * The offer ledger for one challenge, with each team's name and record.
   * Poster-only: the RPC is SECURITY DEFINER and gated on
   * `is_challenge_poster(in_challenge_id)`, so anyone else simply gets no rows
   * rather than an error.
   *
   * Prefer this over `listCandidates` for anything that shows a team to a
   * human. `teams` is members-only, so the embedded name there is always null
   * for a candidate — that is exactly why the offer cards had no team names.
   */
  async candidatesForChallenge(challengeId: string): Promise<ChallengeCandidateFull[]> {
    const { data, error } = await supabase.rpc('get_challenge_candidates', {
      in_challenge_id: challengeId,
    });
    if (error) throw challengeError(error);
    return data ?? [];
  },

  /**
   * One challenge row. The radar needs `search_radius_m` to say how far it is
   * looking and `status` to know when to stop polling; both live here and
   * nowhere else. Readable by either squad under team_challenges_select, so a
   * missing row means gone or not mine — hence null rather than a throw.
   */
  async getById(challengeId: string): Promise<Challenge | null> {
    const { data, error } = await supabase
      .from('team_challenges')
      .select('*')
      .eq('id', challengeId)
      .maybeSingle();

    if (!error && data) return data;

    // Fallback: If direct table select failed due to RLS or schema cache,
    // resolve via list_my_challenges SECURITY DEFINER RPC.
    try {
      const mine = await challengeRepository.listMine();
      const item = mine.find((c) => c.id === challengeId);
      if (item) {
        return {
          id: item.id,
          from_team_id: item.from_team_id,
          to_team_id: item.to_team_id,
          created_by: '',
          match_name: item.match_name,
          venue_id: '',
          scheduled_at: item.scheduled_at,
          total_slots: item.total_slots,
          message: item.message,
          status: item.status,
          match_id: item.match_id,
          created_at: item.created_at,
          responded_at: null,
          search_radius_m: 5000,
          game_type: 'friendly',
          end_time: null,
        } as Challenge;
      }
    } catch {
      // Fall through to error handler
    }

    if (error) throw challengeError(error);
    return null;
  },

  async cancel(challengeId: string): Promise<Challenge> {
    const { data, error } = await supabase.rpc('cancel_challenge', {
      in_challenge_id: challengeId,
    });
    if (error) throw challengeError(error);
    if (!data) throw new AppError('unknown', 'Could not withdraw the challenge.');
    return data;
  },

  /** Cancels all open challenges & unplayed matches for the user's teams */
  async cleanupMyOpenFixtures(): Promise<number> {
    const { data, error } = await supabase.rpc('cleanup_my_open_fixtures');
    if (error) throw challengeError(error);
    return data ?? 0;
  },
};
