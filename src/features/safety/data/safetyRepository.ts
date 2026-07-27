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
};
