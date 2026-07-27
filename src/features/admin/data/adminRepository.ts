import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import type { AppRole, Database, ReportStatus } from '@shared/types/database.types';

export type Report = Database['public']['Tables']['reports']['Row'];

/** Subset of a profile shown in the admin users list. */
export type AdminUser = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'area_name' | 'phone' | 'sport_pref' | 'avatar_url' | 'is_active' | 'created_at'
>;

/**
 * Admin/moderation data source. Every method here is also gated server-side by RLS
 * (is_admin / is_superadmin), so a non-admin calling these receives an empty result
 * or a permission error — the client gating is convenience only.
 */
export const adminRepository = {
  async listReports(status: ReportStatus | 'all' = 'open'): Promise<Report[]> {
    let query = supabase.from('reports').select('*').order('created_at', { ascending: false });
    if (status !== 'all') query = query.eq('status', status);
    const { data, error } = await query.limit(100);
    if (error) throw toAppError(error);
    return data ?? [];
  },

  /** All users, newest first. Superadmin-only via the profiles_admin_select RLS policy. */
  async listUsers(): Promise<AdminUser[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, area_name, phone, sport_pref, avatar_url, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async updateReportStatus(reportId: string, status: ReportStatus): Promise<void> {
    const { error } = await supabase.from('reports').update({ status }).eq('id', reportId);
    if (error) throw toAppError(error);
  },

  async setUserActive(userId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', userId);
    if (error) throw toAppError(error);
  },

  async cancelMatch(matchId: string): Promise<void> {
    const { error } = await supabase
      .from('matches')
      .update({ status: 'cancelled' })
      .eq('id', matchId);
    if (error) throw toAppError(error);
  },

  // ----- Role management (superadmin only, enforced by RLS) -----
  /** Resolve a role name to its roles.id. Throws if the role is not in the catalogue. */
  async _roleId(role: AppRole): Promise<string> {
    const { data, error } = await supabase
      .from('roles')
      .select('id')
      .eq('name', role)
      .single();
    if (error) throw toAppError(error);
    return data.id;
  },

  async listRoles(userId: string): Promise<AppRole[]> {
    const { data, error } = await supabase
      .from('user_role_names')
      .select('role')
      .eq('user_id', userId);
    if (error) throw toAppError(error);
    return (data ?? []).map((r) => r.role);
  },

  async grantRole(userId: string, role: AppRole, grantedBy: string): Promise<void> {
    const roleId = await this._roleId(role);
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role_id: roleId, granted_by: grantedBy });
    if (error) throw toAppError(error);
  },

  async revokeRole(userId: string, role: AppRole): Promise<void> {
    const roleId = await this._roleId(role);
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId);
    if (error) throw toAppError(error);
  },
};
