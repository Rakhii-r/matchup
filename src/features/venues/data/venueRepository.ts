import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import { DEFAULT_CONFIRM_NOTE } from '@features/venues/domain/venueSchema';
import type { Venue } from '@features/venues/domain/venueSchema';
import type { Sport } from '@shared/types/database.types';

export interface CreateVenueInput {
  createdBy: string;
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  sportTypes: Sport[];
  phone?: string | null;
}

/**
 * Venue directory. Reads are open to any signed-in user; writes are gated by RLS to
 * the venue creator or an admin. In Phase 1 venues are admin-managed.
 */
export const venueRepository = {
  async list(): Promise<Venue[]> {
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async create(input: CreateVenueInput): Promise<Venue> {
    const { data, error } = await supabase
      .from('venues')
      .insert({
        created_by: input.createdBy,
        name: input.name,
        address: input.address ?? null,
        lat: input.lat,
        lng: input.lng,
        sport_types: input.sportTypes,
        phone: input.phone ?? null,
        confirm_note: DEFAULT_CONFIRM_NOTE,
      })
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },

  async update(id: string, input: Omit<CreateVenueInput, 'createdBy'>): Promise<Venue> {
    const { data, error } = await supabase
      .from('venues')
      .update({
        name: input.name,
        address: input.address ?? null,
        lat: input.lat,
        lng: input.lng,
        sport_types: input.sportTypes,
        phone: input.phone ?? null,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('venues').delete().eq('id', id);
    if (error) throw toAppError(error);
  },
};
