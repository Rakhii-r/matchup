import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';
import { generateShareCode } from '@features/matches/domain/matchSchema';
import type { Team, TeamMemberWithProfile } from '@features/teams/domain/teamSchema';
import type { Sport } from '@shared/types/database.types';

/**
 * `join_team` signals refusals with a stable token as the error message (see the
 * teams migration). Same pattern as join_match — map each to user-facing copy so
 * the UI can say what went wrong instead of a generic conflict message.
 */
const JOIN_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['ACCOUNT_INACTIVE', 'forbidden', 'Your account is not active.'],
  ['TEAM_NOT_FOUND', 'not_found', 'No team found for that code.'],
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
  async create(input: { name: string; sport: Sport; ownerId: string }): Promise<Team> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = generateShareCode();
      const { data, error } = await supabase
        .from('teams')
        .insert({
          name: input.name,
          sport: input.sport,
          owner_id: input.ownerId,
          invite_code: inviteCode,
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
