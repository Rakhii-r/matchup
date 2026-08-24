import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import type { Database, Sport } from '@shared/types/database.types';

export type ManagedSport = Database['public']['Tables']['sports']['Row'];

/**
 * The `sports` table is the single source of truth for which sports exist and
 * what they are called. Nothing in the app should carry its own sport list or
 * its own display names — a sport hidden here disappears from every user
 * surface on the next refetch.
 *
 * RLS does the filtering that matters: `sports_read_active_or_superadmin` means
 * a normal user cannot read a hidden sport even by calling listAll().
 */
export const sportsRepository = {
  /** Sports offered to normal users. */
  async listActive(): Promise<ManagedSport[]> {
    const { data, error } = await supabase
      .from('sports')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (error) throw toAppError(error);
    return data ?? [];
  },

  /** Every sport including hidden ones. Superadmin surfaces only. */
  async listAll(): Promise<ManagedSport[]> {
    const { data, error } = await supabase.from('sports').select('*').order('name');
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('sports')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toAppError(error);
  },

  async rename(id: string, name: string): Promise<void> {
    const { error } = await supabase
      .from('sports')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toAppError(error);
  },
};

/**
 * Display name for a sport key.
 *
 * The fallback title-cases the key itself ('box_cricket' -> 'Box Cricket'),
 * which is exactly what the seeded rows say. That matters: it means a screen
 * rendering before the query resolves shows the right words rather than
 * flashing a placeholder, and a sport hidden from a normal user still reads
 * correctly instead of leaking a raw database key.
 */
export function sportLabel(sports: ManagedSport[] | undefined, sport: Sport): string {
  const known = sports?.find((s) => s.sport === sport)?.name;
  if (known) return known;
  return sport
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
