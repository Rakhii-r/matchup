import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import type { Database, PlayingRole } from '@shared/types/database.types';

export type PlayerStats = Database['public']['Functions']['get_player_stats']['Returns'][number];
export type NextMatch = Database['public']['Functions']['get_my_next_match']['Returns'][number];
export type RecentMatch =
  Database['public']['Functions']['get_my_recent_matches']['Returns'][number];
export type AppNotification =
  Database['public']['Functions']['list_my_notifications']['Returns'][number];
export type PendingAction =
  Database['public']['Functions']['get_my_pending_actions']['Returns'][number];
export type BattingHistoryRow =
  Database['public']['Functions']['get_player_batting_history']['Returns'][number];

export const PLAYING_ROLE_LABEL: Record<PlayingRole, string> = {
  batter: 'Batter',
  bowler: 'Bowler',
  all_rounder: 'All Rounder',
  keeper: 'Wicket Keeper',
};

/**
 * Every figure here comes from real rows. Nothing is seeded or estimated, so
 * an account that has never played reads 0 across the board — the UI shows that
 * as an empty state rather than dressing it up.
 */
export const dashboardRepository = {
  async stats(): Promise<PlayerStats | null> {
    const { data, error } = await supabase.rpc('get_player_stats', { in_user_id: null });
    if (error) throw toAppError(error);
    return data?.[0] ?? null;
  },

  /** Null when nothing is scheduled. Not an error. */
  async nextMatch(): Promise<NextMatch | null> {
    const { data, error } = await supabase.rpc('get_my_next_match', {});
    if (error) throw toAppError(error);
    return data?.[0] ?? null;
  },

  async recentMatches(limit = 5): Promise<RecentMatch[]> {
    const { data, error } = await supabase.rpc('get_my_recent_matches', { in_limit: limit });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async notifications(limit = 50): Promise<AppNotification[]> {
    const { data, error } = await supabase.rpc('list_my_notifications', { in_limit: limit });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  /**
   * One row per COMPLETED match the caller was confirmed for, newest first.
   * The Profile screen reverses it for the run trend, which reads oldest→newest.
   *
   * An empty array is the honest answer for an account that has never played a
   * scored match, and a row of zeroes is the honest answer for a match played
   * before in-app scoring existed — neither is an error.
   */
  async battingHistory(limit = 10): Promise<BattingHistoryRow[]> {
    const { data, error } = await supabase.rpc('get_player_batting_history', {
      in_user_id: null,
      in_limit: limit,
    });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async pendingActions(): Promise<PendingAction[]> {
    const { data, error } = await supabase.rpc('get_my_pending_actions', {});
    if (error) throw toAppError(error);
    return data ?? [];
  },
};
