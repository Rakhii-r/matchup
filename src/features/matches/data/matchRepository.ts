import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';
import { generateShareCode } from '@features/matches/domain/matchSchema';
import type { Match, MatchPlayer } from '@features/matches/domain/matchSchema';
import type { PlayerStatus, Sport } from '@shared/types/database.types';

export interface CreateMatchInput {
  creatorId: string;
  sport: Sport;
  venueText: string;
  scheduledAt: string;
  totalSlots: number;
  missingCount: number;
  lat: number;
  lng: number;
  notes?: string | null;
}

/** A match_players row with the joined player's public profile fields. */
export interface PlayerWithProfile extends MatchPlayer {
  profile: { full_name: string; area_name: string | null } | null;
}

export interface AttendanceRow {
  user_id: string;
  attended: boolean;
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
          sport: input.sport,
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
    return data ?? [];
  },

  async listPlayers(matchId: string): Promise<PlayerWithProfile[]> {
    const { data, error } = await supabase
      .from('match_players')
      .select('*, profile:profiles(full_name, area_name)')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true });
    if (error) throw toAppError(error);
    // The embedded profile is typed loosely by the generated types; the runtime shape
    // is guaranteed by the FK match_players.user_id -> profiles.id.
    return (data ?? []) as unknown as PlayerWithProfile[];
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

  async join(matchId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('match_players')
      .insert({ match_id: matchId, user_id: userId, joined_via: 'code' });
    if (error) throw toAppError(error);
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
