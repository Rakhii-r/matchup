import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';
import { generateShareCode } from '@features/matches/domain/matchSchema';
import type { Team, TeamMemberWithProfile } from '@features/teams/domain/teamSchema';
import type { Database, Sport } from '@shared/types/database.types';

/** One row of the Teams tab list — team identity plus its aggregated record. */
export type TeamOverviewRow =
  Database['public']['Functions']['get_my_teams_overview']['Returns'][number];

/**
 * `join_team` signals refusals with a stable token as the error message (see the
 * teams migration). Same pattern as join_match — map each to user-facing copy so
 * the UI can say what went wrong instead of a generic conflict message.
 */
const JOIN_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['ACCOUNT_INACTIVE', 'forbidden', 'Your account is not active.'],
  ['TEAM_NOT_FOUND', 'not_found', 'No team found for that code.'],
  // team_members_roster_cap. The trigger's DETAIL carries the live count,
  // but the cap is fixed at 20, so a plain sentence is clearer than echoing it.
  ['TEAM_ROSTER_FULL', 'conflict', 'That squad is full — a team can have at most 20 players.'],
];

function joinErrorToAppError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of JOIN_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export const teamRepository = {
  /**
   * Create a team. The owner's membership row is added by a database trigger,
   * not here — that keeps the invariant true no matter who does the insert.
   * invite_code is UNIQUE; on the rare collision (23505) regenerate and retry.
   */
  async create(input: {
    name: string;
    sport: Sport;
    ownerId: string;
    description?: string | null;
    homeGround?: string | null;
    logoUrl?: string | null;
  }): Promise<Team> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = generateShareCode();
      const { data, error } = await supabase
        .from('teams')
        .insert({
          name: input.name,
          sport: input.sport,
          owner_id: input.ownerId,
          invite_code: inviteCode,
          description: input.description?.trim() || null,
          home_ground: input.homeGround?.trim() || null,
          logo_url: input.logoUrl ?? null,
        })
        .select('*')
        .single();
      if (!error) return data;
      if (error.code === '23505') {
        logger.warn('team invite_code collision, retrying', { attempt });
        continue;
      }
      throw toAppError(error);
    }
    throw new AppError('conflict', 'Could not generate a unique invite code. Please try again.');
  },

  async uploadLogo(teamId: string, base64: string): Promise<string> {
    const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '').replace(/[\r\n\s]+/g, '');
    const binary = atob(cleanBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const path = `${teamId}/logo.jpg`;
    const { error } = await supabase.storage
      .from('team-logos')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw toAppError(error);
    const { data } = supabase.storage.from('team-logos').getPublicUrl(path);
    const url = `${data.publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await supabase
      .from('teams')
      .update({ logo_url: url })
      .eq('id', teamId);
    if (updateError) throw toAppError(updateError);
    return url;
  },

  async removeLogo(teamId: string): Promise<void> {
    try {
      await supabase.storage.from('team-logos').remove([`${teamId}/logo.jpg`]);
    } catch {
      // Ignore if not present
    }
    const { error } = await supabase
      .from('teams')
      .update({ logo_url: null })
      .eq('id', teamId);
    if (error) throw toAppError(error);
  },

  /** Teams the user belongs to. RLS already limits rows to their memberships. */
  async listMine(): Promise<Team[]> {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async getById(teamId: string): Promise<Team | null> {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw toAppError(error);
    return data;
  },

  /**
   * Every team the user belongs to, with roster size and results already
   * aggregated server-side — one round trip regardless of team count. The
   * function filters on auth.uid() internally, so there is no team id to pass
   * and nothing for the client to authorise.
   */
  async listMineOverview(): Promise<TeamOverviewRow[]> {
    const { data, error } = await supabase.rpc('get_my_teams_overview', {});
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async getOverview(teamId: string) {
    try {
      const { data, error } = await supabase.rpc('get_team_overview', { in_team_id: teamId });
      if (!error && data && data.length > 0 && data[0]) {
        return data[0];
      }
    } catch {
      // Fallback below
    }

    // Direct fallback from teams and public_profiles tables
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, name, sport, invite_code, created_at, description, logo_url, home_ground, owner_id, target_size')
      .eq('id', teamId)
      .maybeSingle();

    if (teamErr) throw toAppError(teamErr);
    if (!team) return null;

    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData.session?.user?.id ?? null;

    const [ownerRes, memberCountRes, myMemberRes] = await Promise.all([
      supabase.from('public_profiles').select('full_name, avatar_url').eq('id', team.owner_id).maybeSingle(),
      supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', teamId),
      currentUserId
        ? supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', currentUserId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const isOwner = Boolean(currentUserId && team.owner_id === currentUserId);
    const isMember = Boolean(myMemberRes.data);

    return {
      id: team.id,
      name: team.name,
      sport: team.sport,
      invite_code: (isOwner || isMember) ? team.invite_code : null,
      created_at: team.created_at,
      description: team.description,
      logo_url: team.logo_url,
      home_ground: team.home_ground,
      owner_id: team.owner_id,
      captain_name: ownerRes.data?.full_name ?? null,
      captain_avatar: ownerRes.data?.avatar_url ?? null,
      player_count: memberCountRes.count ?? 0,
      my_role: myMemberRes.data?.role ?? null,
      i_am_owner: isOwner,
      target_size: team.target_size,
    };
  },

  async getStats(teamId: string) {
    try {
      const { data, error } = await supabase.rpc('get_team_stats', { in_team_id: teamId });
      if (!error && data && data.length > 0 && data[0]) {
        return data[0];
      }
    } catch {
      // Return default empty stats
    }
    return {
      team_id: teamId,
      matches_played: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      win_rate: 0,
      highest_score: null,
      lowest_score: null,
    };
  },

  async getFixtures(teamId: string) {
    const { data, error } = await supabase.rpc('get_team_fixtures', { in_team_id: teamId });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async update(teamId: string, input: { name: string; description: string; homeGround: string }) {
    const { error } = await supabase.from('teams').update({ name: input.name, description: input.description || null, home_ground: input.homeGround || null }).eq('id', teamId);
    if (error) throw toAppError(error);
  },

  /**
   * Roster with public profiles. Two queries rather than an embedded join: the
   * profiles base table is self-read only, so names must come from the
   * public_profiles view, and embedding through a view relies on PostgREST
   * relationship inference we do not want the roster to depend on.
   */
  async listMembers(teamId: string): Promise<TeamMemberWithProfile[]> {
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true })
      .limit(100);
    if (error) throw toAppError(error);

    const rows = data ?? [];
    if (rows.length === 0) return [];

    const ids = [...new Set(rows.map((row) => row.user_id))];
    const { data: profiles, error: profileError } = await supabase
      .from('public_profiles')
      .select('id, full_name, area_name')
      .in('id', ids);
    if (profileError) throw toAppError(profileError);

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return rows.map((row) => {
      const p = byId.get(row.user_id);
      return { ...row, profile: p ? { full_name: p.full_name, area_name: p.area_name } : null };
    });
  },

  /**
   * Join by invite code. Direct inserts into team_members are denied by RLS —
   * this RPC locks the team row and is the only write path. Idempotent.
   */
  async joinByCode(inviteCode: string): Promise<Team> {
    const { data, error } = await supabase.rpc('join_team', { in_invite_code: inviteCode });
    if (error) throw joinErrorToAppError(error);
    if (!data) throw new AppError('unknown', 'Could not join that team. Please try again.');
    return data;
  },

  /**
   * Remove a membership row. RLS allows this for your own row, or for any
   * non-owner row if you own the team. The owner's row can never be deleted, so
   * a team cannot end up ownerless.
   */
  async removeMember(memberId: string): Promise<void> {
    const { error } = await supabase.from('team_members').delete().eq('id', memberId);
    if (error) throw toAppError(error);
  },

  async remove(teamId: string): Promise<void> {
    const { error } = await supabase.from('teams').delete().eq('id', teamId);
    if (error) throw toAppError(error);
  },
};
