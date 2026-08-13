import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';
import { generateShareCode } from '@features/matches/domain/matchSchema';
import type { Match, MatchPlayer } from '@features/matches/domain/matchSchema';
import type { JoinedVia, PlayerStatus, Sport } from '@shared/types/database.types';

/**
 * `join_match` signals every refusal with a stable token as the error message
 * (see migration 0012). Map each one to user-facing copy here so the UI can say
 * what actually went wrong instead of a generic "something conflicted".
 * Anything unrecognised falls through to the standard Postgres error mapping.
 */
const JOIN_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['ACCOUNT_INACTIVE', 'forbidden', 'Your account is not active.'],
  ['INVALID_JOIN_SOURCE', 'validation', 'Could not join that match. Please try again.'],
  ['MATCH_NOT_FOUND', 'not_found', 'That match is no longer available.'],
  ['OWN_MATCH', 'conflict', 'This is your own match.'],
  ['MATCH_NOT_OPEN', 'conflict', 'That match is no longer open to join.'],
  ['MATCH_STARTED', 'conflict', 'That match has already started.'],
  ['MATCH_FULL', 'conflict', 'That match is already full.'],
  // respond_to_match_invite
  ['NOT_INVITED', 'not_found', 'You are not on the sheet for this match.'],
  ['INVITE_ALREADY_ANSWERED', 'conflict', 'You have already answered this one.'],
  ['MATCH_ALREADY_STARTED', 'conflict', 'That match has already started.'],
];

// A match can still be in progress after its scheduled start. Keep it in
// discovery for a generous playing window, but never let an old row that was
// accidentally left `open` remain in Nearby forever.
const ONGOING_MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;

function isDiscoverableMatch(match: Match, nowMs: number): boolean {
  const scheduledMs = Date.parse(match.scheduled_at);
  return (
    match.status === 'open' &&
    Number.isFinite(scheduledMs) &&
    scheduledMs > nowMs - ONGOING_MATCH_WINDOW_MS
  );
}

function joinErrorToAppError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of JOIN_ERRORS) {
    // Some transports wrap the raise message in extra text, so match on contains
    // rather than equality. Tokens are distinct and none is a prefix of another.
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export interface CreateMatchInput {
  creatorId: string;
  matchName: string;
  sport: Sport;
  venueId: string;
  venueText: string;
  scheduledAt: string;
  totalSlots: number;
  missingCount: number;
  lat: number;
  lng: number;
  notes?: string | null;
}

/**
 * A match_players row with the player's public profile, plus which side they
 * are on in a team fixture. `side` is 'a' | 'b' for a challenge-created match
 * and null for an ordinary match, which has no sides.
 */
export interface PlayerWithProfile extends MatchPlayer {
  profile: { full_name: string; area_name: string | null } | null;
  team_name: string | null;
  side: 'a' | 'b' | null;
}

/** The two squads in a team fixture, for the match header. */
export interface MatchSides {
  team_a_id: string | null;
  team_a_name: string | null;
  team_b_id: string | null;
  team_b_name: string | null;
}

export interface AttendanceRow {
  user_id: string;
  attended: boolean;
}

/** A match the current user joined, paired with their own queue status on it. */
export interface JoinedMatch {
  match: Match;
  myStatus: PlayerStatus;
}

/**
 * All match reads/writes. Every call is additionally gated by RLS: creators manage
 * their own matches and the player queue, players write only their own rows. The
 * client is untrusted — these methods never assume an action will be permitted.
 */
export const matchRepository = {
  async create(input: CreateMatchInput): Promise<Match> {
    // share_code is UNIQUE; on the rare collision (23505) regenerate and retry.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const shareCode = generateShareCode();
      const { data, error } = await supabase
        .from('matches')
        .insert({
          creator_id: input.creatorId,
          match_name: input.matchName,
          sport: input.sport,
          venue_id: input.venueId,
          venue_text: input.venueText,
          scheduled_at: input.scheduledAt,
          total_slots: input.totalSlots,
          missing_count: input.missingCount,
          lat: input.lat,
          lng: input.lng,
          share_code: shareCode,
          notes: input.notes ?? null,
        })
        .select('*')
        .single();
      if (!error) return data;
      if (error.code === '23505') {
        logger.warn('share_code collision, retrying', { attempt });
        continue;
      }
      throw toAppError(error);
    }
    throw new AppError('conflict', 'Could not generate a unique share code. Please try again.');
  },

  async getById(matchId: string): Promise<Match | null> {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw toAppError(error);
    return data;
  },

  async getByShareCode(code: string): Promise<Match | null> {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('share_code', code)
      .maybeSingle();
    if (error) throw toAppError(error);
    return data;
  },

  /** Matches created by the given user (newest scheduled first), excluding cancelled. */
  async listMine(userId: string): Promise<Match[]> {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('creator_id', userId)
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  /**
   * Matches the user has joined, with their own queue status on each.
   *
   * Distinct from listMine(), which returns matches they CREATED. Without this
   * a joiner has no surface for their own commitments: nearby_matches only
   * returns open matches within the radius, so a locked or distant match they
   * are confirmed for disappears entirely.
   *
   * RLS makes this safe without extra filtering — match_players_select limits
   * rows to user_id = auth.uid(), and matches_select permits reading a match
   * you are a player on regardless of its status.
   */
  async listJoined(userId: string): Promise<JoinedMatch[]> {
    const { data, error } = await supabase
      .from('match_players')
      .select('status, match:matches(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw toAppError(error);

    // The embed is typed loosely by the hand-written database types; the runtime
    // shape is guaranteed by the match_players.match_id -> matches.id FK.
    const rows = (data ?? []) as unknown as { status: PlayerStatus; match: Match | null }[];
    return rows
      .filter((row): row is { status: PlayerStatus; match: Match } => row.match !== null)
      .filter((row) => row.match.status !== 'cancelled')
      .map((row) => ({ match: row.match, myStatus: row.status }));
  },

  async nearby(input: {
    lat: number;
    lng: number;
    radiusM: number;
    sport: Sport | null;
  }): Promise<Match[]> {
    const { data, error } = await supabase.rpc('nearby_matches', {
      in_lat: input.lat,
      in_lng: input.lng,
      in_radius_m: input.radiusM,
      in_sport: input.sport,
    });
    if (error) throw toAppError(error);
    // Keep this defensive filter even after the database migration is applied:
    // it protects users from stale cached data and partially deployed backends.
    const nowMs = Date.now();
    return (data ?? []).filter((match) => isDiscoverableMatch(match, nowMs));
  },

  /**
   * Roster for a match, with profile, side and team name resolved.
   *
   * Served by an RPC rather than a direct select. Two things make that
   * necessary: `teams` is members-only, so the opposing captain can never read
   * your team's NAME through the client; and match_players_select previously
   * showed a non-organiser only their own row, so the opposing squad saw an
   * empty roster (fixed in match_roster_visibility, but the name problem
   * remains). The RPC applies the same visibility rule rather than bypassing
   * it: the organiser sees the request queue, a seated player sees the seated
   * squads, everyone else sees themselves.
   */
  async listPlayers(matchId: string): Promise<PlayerWithProfile[]> {
    const { data, error } = await supabase.rpc('list_match_players', {
      in_match_id: matchId,
    });
    if (error) throw toAppError(error);

    return (data ?? []).map((row) => ({
      id: row.id,
      match_id: matchId,
      user_id: row.user_id,
      status: row.status,
      joined_via: row.joined_via,
      team_id: row.team_id,
      created_at: row.created_at,
      team_name: row.team_name,
      side: row.side,
      // A deactivated or missing profile yields null, as before; callers
      // already render a placeholder for that.
      profile: row.full_name ? { full_name: row.full_name, area_name: row.area_name } : null,
    }));
  },

  /** The two squads in a team fixture. Null fields for an ordinary match. */
  async getSides(matchId: string): Promise<MatchSides | null> {
    const { data, error } = await supabase.rpc('get_match_sides', {
      in_match_id: matchId,
    });
    if (error) throw toAppError(error);
    return data?.[0] ?? null;
  },

  async getMyMembership(matchId: string, userId: string): Promise<MatchPlayer | null> {
    const { data, error } = await supabase
      .from('match_players')
      .select('*')
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw toAppError(error);
    return data;
  },

  /**
   * Join a match through the `join_match` RPC.
   *
   * Direct inserts into `match_players` are denied by RLS (migration 0012): the
   * RPC is the only way in. It takes a row lock on the match, so it is the only
   * place capacity can be checked without a race. Calling it twice is safe — the
   * existing queue row comes back unchanged.
   */
  async join(matchId: string, joinedVia: JoinedVia): Promise<MatchPlayer> {
    const { data, error } = await supabase.rpc('join_match', {
      in_match_id: matchId,
      in_joined_via: joinedVia,
    });
    if (error) throw joinErrorToAppError(error);
    if (!data) throw new AppError('unknown', 'Could not join that match. Please try again.');
    return data;
  },

  /**
   * Answer an invite the app created for you when your squad was booked into a
   * fixture. Distinct from `setPlayerStatus`, which is the organiser acting on
   * someone else's row — this is the player answering for themselves, and the
   * RPC enforces that you can only touch your own 'invited' row.
   */
  async respondToInvite(matchId: string, accept: boolean): Promise<MatchPlayer> {
    const { data, error } = await supabase.rpc('respond_to_match_invite', {
      in_match_id: matchId,
      in_accept: accept,
    });
    if (error) throw joinErrorToAppError(error);
    if (!data) throw new AppError('unknown', 'Could not save your reply.');
    return data;
  },

  async setPlayerStatus(playerId: string, status: PlayerStatus): Promise<void> {
    const { error } = await supabase.from('match_players').update({ status }).eq('id', playerId);
    if (error) throw toAppError(error);
  },

  async removePlayer(playerId: string): Promise<void> {
    const { error } = await supabase.from('match_players').delete().eq('id', playerId);
    if (error) throw toAppError(error);
  },

  async setStatus(matchId: string, status: Match['status']): Promise<void> {
    const { error } = await supabase.from('matches').update({ status }).eq('id', matchId);
    if (error) throw toAppError(error);
  },

  async markAttendance(input: {
    matchId: string;
    userId: string;
    attended: boolean;
    markedBy: string;
  }): Promise<void> {
    const { error } = await supabase.from('attendance').upsert(
      {
        match_id: input.matchId,
        user_id: input.userId,
        attended: input.attended,
        marked_by: input.markedBy,
      },
      { onConflict: 'match_id,user_id' },
    );
    if (error) throw toAppError(error);
  },

  async listAttendance(matchId: string): Promise<AttendanceRow[]> {
    const { data, error } = await supabase
      .from('attendance')
      .select('user_id, attended')
      .eq('match_id', matchId);
    if (error) throw toAppError(error);
    return data ?? [];
  },
};
