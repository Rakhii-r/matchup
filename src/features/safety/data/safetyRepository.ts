import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';

export interface CreateReportInput {
  reporterId: string;
  reportedUserId: string;
  matchId?: string | null;
  reason: string;
  details?: string | null;
}

export interface BlockInput {
  blockerId: string;
  blockedId: string;
}

/** A person you blocked, with enough to recognise them in the list. */
export interface BlockedUser {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

/**
 * Safety actions. RLS forces reporter_id / blocker_id to the caller, and CHECK
 * constraints forbid self-reports and self-blocks; the hooks guard those too so the
 * user gets a clean message instead of a database error.
 */
export const safetyRepository = {
  async createReport(input: CreateReportInput): Promise<void> {
    const { error } = await supabase.from('reports').insert({
      reporter_id: input.reporterId,
      reported_user_id: input.reportedUserId,
      match_id: input.matchId ?? null,
      reason: input.reason,
      details: input.details ?? null,
    });
    if (error) throw toAppError(error);
  },

  async blockUser(input: BlockInput): Promise<void> {
    const { error } = await supabase
      .from('blocks')
      .insert({ blocker_id: input.blockerId, blocked_id: input.blockedId });
    if (error) throw toAppError(error);
  },

  /**
   * Undo a block. `blocks_delete_self` already restricts this to rows the
   * caller owns, so no RPC is needed -- the block was one-directional and
   * removing the row restores visibility both ways.
   */
  async unblockUser(input: BlockInput): Promise<void> {
    const { error } = await supabase
      .from('blocks')
      .delete()
      .eq('blocker_id', input.blockerId)
      .eq('blocked_id', input.blockedId);
    if (error) throw toAppError(error);
  },

  /**
   * Two queries rather than a join: `blocks` has no FK relationship declared to
   * `public_profiles` (it points at profiles), so PostgREST cannot embed it.
   */
  async listBlocked(blockerId: string): Promise<BlockedUser[]> {
    const { data: rows, error } = await supabase
      .from('blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw toAppError(error);
    if (!rows || rows.length === 0) return [];

    const { data: people, error: peopleError } = await supabase
      .from('public_profiles')
      .select('id, full_name, avatar_url')
      .in('id', rows.map((r) => r.blocked_id));
    if (peopleError) throw toAppError(peopleError);

    const byId = new Map((people ?? []).map((p) => [p.id, p]));
    return rows.map((r) => ({
      userId: r.blocked_id,
      fullName: byId.get(r.blocked_id)?.full_name ?? 'Player',
      avatarUrl: byId.get(r.blocked_id)?.avatar_url ?? null,
      blockedAt: r.created_at,
    }));
  },
};
