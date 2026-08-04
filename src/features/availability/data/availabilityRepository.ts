import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import type { Availability } from '@features/availability/domain/availabilitySchema';
import type { Sport } from '@shared/types/database.types';

export interface SetAvailableInput {
  userId: string;
  sport: Sport;
  date: string;
  expiresAt: string;
  lat: number;
  lng: number;
  note?: string | null;
}

export interface AvailabilityWithProfile extends Availability {
  profile: { full_name: string; area_name: string | null } | null;
}

export const availabilityRepository = {
  async setAvailable(input: SetAvailableInput): Promise<Availability> {
    const { data, error } = await supabase
      .from('availability')
      .upsert(
        {
          user_id: input.userId,
          sport: input.sport,
          available_date: input.date,
          expires_at: input.expiresAt,
          lat: input.lat,
          lng: input.lng,
          note: input.note ?? null,
        },
        { onConflict: 'user_id,sport,available_date' },
      )
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },

  async listMine(userId: string, date: string): Promise<Availability[]> {
    const { data, error } = await supabase
      .from('availability')
      .select('*')
      .eq('user_id', userId)
      .eq('available_date', date);
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('availability').delete().eq('id', id);
    if (error) throw toAppError(error);
  },

  async nearby(input: {
    lat: number;
    lng: number;
    radiusM: number;
    sport: Sport | null;
  }): Promise<AvailabilityWithProfile[]> {
    const { data, error } = await supabase.rpc('nearby_available', {
      in_lat: input.lat,
      in_lng: input.lng,
      in_radius_m: input.radiusM,
      in_sport: input.sport,
    });
    if (error) throw toAppError(error);

    const rows = data ?? [];
    if (rows.length === 0) return [];

    const ids = [...new Set(rows.map((r) => r.user_id))];
    // public_profiles, not profiles: the base table is self-read only after the
    // security_hardening migration, and these are other people's rows.
    const { data: profiles, error: profileError } = await supabase
      .from('public_profiles')
      .select('id, full_name, area_name')
      .in('id', ids);
    if (profileError) throw toAppError(profileError);

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return rows.map((r) => {
      const p = byId.get(r.user_id);
      return { ...r, profile: p ? { full_name: p.full_name, area_name: p.area_name } : null };
    });
  },
};
