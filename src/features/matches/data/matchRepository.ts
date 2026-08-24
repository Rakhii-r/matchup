import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';
import { generateShareCode } from '@features/matches/domain/matchSchema';
import type { Match, MatchPlayer } from '@features/matches/domain/matchSchema';
import type { GameType, JoinedVia, PlayerStatus, Sport } from '@shared/types/database.types';
import {
  formatConflictWindow,
  parseScheduleConflict,
} from '@shared/utils/scheduleConflict';

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
  // create_open_match / join_open_match. PLAYER_SCHEDULE_CONFLICT is handled
  // separately below because it carries the clashing window in the message.
  ['NOT_OPEN_MATCH', 'conflict', 'That match is not open for individual players.'],
  ['INVALID_SPORT', 'validation', 'Pick a sport.'],
  ['INVALID_GAME_TYPE', 'validation', 'Pick a game type.'],
  ['INVALID_SLOTS', 'validation', 'Pick how many players the match needs.'],
  ['INVALID_RADIUS', 'validation', 'Pick a search distance.'],
  ['SCHEDULE_IN_PAST', 'validation', 'Pick a date and time in the future.'],
  ['END_BEFORE_START', 'validation', 'The end time must be after the start time.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That venue is no longer available.'],
  ['VENUE_SPORT_MISMATCH', 'validation', 'That venue does not host the selected sport.'],
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

  // Requirement: a player is blocked only by an OVERLAPPING booking, never by
  // merely having another match on another day — so the message names the one
  // that actually clashes instead of saying "you already have a match".
  const clash = parseScheduleConflict(raw, 'PLAYER_SCHEDULE_CONFLICT');
  if (clash) {
    return new AppError(
      'conflict',
      `You are already playing ${formatConflictWindow(clash.startIso, clash.endIso)}. Pick a time that does not overlap.`,
      error,
    );
  }

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
  /**
   * Both optional and both nullable: every caller that predates the create
   * wizard passes neither, which leaves the `game_type` column default and a
   * null `end_time`. They were being passed by useCreateMatch already and
   * silently dropped here, which is why the column never moved.
   */
  gameType?: GameType | null;
  endTime?: string | null;
}

/** Everything `create_open_match` needs. Deliberately has no team field. */
export interface CreateOpenMatchInput {
  matchName: string;
  sport: Sport;
  areaName: string;
  /** ISO instant. Composed from the day chip and the start-time picker. */
  scheduledAt: string;
  /** ISO instant, or null when the organiser left the finish open. */
  endTime: string | null;
  /** Seats on the sheet — twice the players-per-side chip. */
  totalSlots: number;
  gameType: GameType;
  /** Metres. The chips are kilometres and multiply by 1000. */
  radiusM: number;
  lat?: number | null;
  lng?: number | null;
  venueId?: string | null;
}

/**
 * A match_players row with the player's public profile, plus which side they
 * are on in a team fixture. `side` is 'a' | 'b' for a challenge-created match
 * and null for an ordinary match, which has no sides.
 */
export interface PlayerWithProfile extends MatchPlayer {
  profile: { full_name: string; area_name: string | null; avatar_url: string | null } | null;
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
          ...(input.gameType ? { game_type: input.gameType } : {}),
          end_time: input.endTime ?? null,
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

  /**
   * Post a Match (Open for all).
   *
   * A completely separate write from {@link create} and from
   * `challengeRepository.postOpen`: no team is sent, no `team_challenges` row is
   * made and no opponent is searched for. `create_open_match` also seats the
   * caller as the host in the same transaction, so the match is never visible
   * with an empty roster and `filled_slots` is 1 the instant it exists.
   *
   * Everything that can refuse it — a past time, a venue that does not host the
   * sport, an overlapping booking of the caller's own — is checked inside the
   * RPC under an advisory lock, because a client-side check can always be stale
   * by the time the user taps Post.
   */
  async createOpen(input: CreateOpenMatchInput): Promise<Match> {
    const { data, error } = await supabase.rpc('create_open_match', {
      in_sport: input.sport,
      in_match_name: input.matchName,
      in_area_name: input.areaName,
      in_scheduled_at: input.scheduledAt,
      in_total_slots: input.totalSlots,
      in_end_time: input.endTime ?? null,
      in_game_type: input.gameType,
      in_radius_m: input.radiusM,
      in_lat: input.lat ?? null,
      in_lng: input.lng ?? null,
      in_venue_id: input.venueId ?? null,
    });
    if (error) throw joinErrorToAppError(error);
    if (!data) throw new AppError('unknown', 'Could not post the match. Please try again.');
    return data;
  },

  /**
   * Take a seat in an open match as an individual.
   *
   * Distinct from {@link join}, which queues you as 'interested' and waits for
   * the organiser. Here the seat is yours immediately ('confirmed'), which is
   * what the "Open for all players to join" promise means. Idempotent: a second
   * call returns the row you already have rather than failing.
   */
  async joinOpen(matchId: string, joinedVia: JoinedVia): Promise<MatchPlayer> {
    const { data, error } = await supabase.rpc('join_open_match', {
      in_match_id: matchId,
      in_joined_via: joinedVia,
    });
    if (error) throw joinErrorToAppError(error);
    if (!data) throw new AppError('unknown', 'Could not join that match. Please try again.');
    return data;
  },

  /**
   * Start a Rematch / Play Again within the same booked time slot.
   * Copies confirmed players, sets status = 'locked' and scheduled_at = now().
   */
  async createRematch(matchId: string): Promise<Match> {
    const { data, error } = await supabase.rpc('create_rematch', {
      in_match_id: matchId,
    });
    if (error) throw toAppError(error);
    if (!data) throw new AppError('unknown', 'Could not create rematch. Please try again.');
    return data;
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

  /**
   * Complete list of matches the user is associated with (created or joined),
   * across all statuses (open, locked, completed, cancelled).
   */
  async listAllBookedMatches(userId: string): Promise<{
    match: Match;
    myRole: 'creator' | 'player';
    myStatus: PlayerStatus | 'confirmed';
  }[]> {
    const { data: created, error: createdErr } = await supabase
      .from('matches')
      .select('*')
      .eq('creator_id', userId)
      .order('scheduled_at', { ascending: false });
    if (createdErr) throw toAppError(createdErr);

    const { data: joined, error: joinedErr } = await supabase
      .from('match_players')
      .select('status, match:matches(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (joinedErr) throw toAppError(joinedErr);

    const matchMap = new Map<string, {
      match: Match;
      myRole: 'creator' | 'player';
      myStatus: PlayerStatus | 'confirmed';
    }>();

    for (const m of created ?? []) {
      matchMap.set(m.id, { match: m, myRole: 'creator', myStatus: 'confirmed' });
    }

    const joinedRows = (joined ?? []) as unknown as { status: PlayerStatus; match: Match | null }[];
    for (const row of joinedRows) {
      if (!row.match) continue;
      if (!matchMap.has(row.match.id)) {
        matchMap.set(row.match.id, {
          match: row.match,
          myRole: 'player',
          myStatus: row.status,
        });
      }
    }

    return Array.from(matchMap.values()).sort(
      (a, b) => new Date(b.match.scheduled_at).getTime() - new Date(a.match.scheduled_at).getTime(),
    );
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
      role: row.role,
      team_id: row.team_id,
      created_at: row.created_at,
      team_name: row.team_name,
      side: row.side,
      // A deactivated or missing profile yields null, as before; callers
      // already render a placeholder for that.
      profile: row.full_name
        ? { full_name: row.full_name, area_name: row.area_name, avatar_url: row.avatar_url }
        : null,
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
