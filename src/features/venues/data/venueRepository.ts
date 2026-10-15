import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import { DEFAULT_CONFIRM_NOTE } from '@features/venues/domain/venueSchema';
import type { Venue } from '@features/venues/domain/venueSchema';
import type { Database, Sport } from '@shared/types/database.types';

export interface CreateVenueInput {
  createdBy: string;
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  sportTypes: Sport[];
  phone?: string | null;
}

/** A venue row as returned by the `nearby_venues` RPC, with its distance. */
export type NearbyVenue = Database['public']['Functions']['nearby_venues']['Returns'][number];

export interface NearbyVenuesInput {
  lat: number;
  lng: number;
  /** Defaults to 25 km server-side, matching the match search radius cap. */
  radiusM?: number;
  /** Null lists every sport at the venue. */
  sport?: Sport | null;
}

/**
 * Venue directory. Reads are open to any signed-in user; writes are gated by RLS to
 * the venue creator or an admin. In Phase 1 venues are admin-managed.
 */
export interface SuggestVenueInput {
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  sport: Sport;
}

export type VenueStatus = 'approved' | 'pending' | 'hidden';

const SUGGEST_ERRORS: [string, AppErrorCode, string][] = [
  ['VENUE_EXISTS', 'conflict', 'That ground is already listed.'],
  ['BAD_COORDS', 'validation', 'Could not read your location. Try again at the ground.'],
  ['LOCATION_REQUIRED', 'validation', 'Turn on location so we can pin the ground.'],
  ['NAME_TOO_SHORT', 'validation', 'Enter the ground name.'],
  ['NAME_TOO_LONG', 'validation', 'That name is too long (max 80 characters).'],
  ['ADDRESS_TOO_LONG', 'validation', 'That address is too long (max 160 characters).'],
  ['UNKNOWN_SPORT', 'validation', 'That sport is not supported.'],
  ['TOO_MANY_PENDING', 'conflict', 'You have 5 grounds waiting for review already.'],
  ['NOT_AN_ADMIN', 'unauthorized', 'Only an admin can change a ground\'s status.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That ground no longer exists.'],
  ['ACCOUNT_INACTIVE', 'unauthorized', 'Your account is not active.'],
];

function venueError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of SUGGEST_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export const venueRepository = {
  async list(): Promise<Venue[]> {
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .order('name', { ascending: true })
      .limit(100);
    if (error) throw toAppError(error);
    return data ?? [];
  },

  /**
   * Venues near a point, nearest first, for the area-scoped picker on a match.
   *
   * `list()` returns the whole directory ordered by name — right for the admin
   * table, wrong for a picker, which must show grounds near the area the
   * organiser chose at wizard step 2. Ranking is distance, then rating, then
   * name; there is no featured/bookable tier because no column backs one.
   *
   * Every enrichment field (`image_url`, `rating`, `price_per_hour`,
   * `facilities`) can be null or empty. Render an empty state, never a
   * fabricated value.
   */
  async nearby(input: NearbyVenuesInput): Promise<NearbyVenue[]> {
    const { data, error } = await supabase.rpc('nearby_venues', {
      in_lat: input.lat,
      in_lng: input.lng,
      in_radius_m: input.radiusM ?? 25000,
      in_sport: input.sport ?? null,
    });
    if (error) throw toAppError(error);
    return data ?? [];
  },

  async getById(id: string): Promise<Venue | null> {
    const { data, error } = await supabase.from('venues').select('*').eq('id', id).maybeSingle();
    if (error) throw toAppError(error);
    return data;
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

  /**
   * A captain adds the ground they play at. Coordinates come from the DEVICE —
   * they submit while standing at the turf — so the app needs no geocoder, no
   * API key and no third-party terms. The row lands `pending` and is invisible
   * to every picker until an admin approves it.
   */
  async suggest(input: SuggestVenueInput): Promise<Venue> {
    const { data, error } = await supabase.rpc('suggest_venue', {
      in_name: input.name,
      in_address: input.address ?? null,
      in_lat: input.lat,
      in_lng: input.lng,
      in_sport: input.sport,
    });
    if (error) throw venueError(error);
    return data as unknown as Venue;
  },

  /** Approve or hide a ground. Admin-only, enforced server-side. */
  async setStatus(id: string, status: VenueStatus): Promise<Venue> {
    const { data, error } = await supabase.rpc('set_venue_status', {
      in_venue_id: id,
      in_status: status,
    });
    if (error) throw venueError(error);
    return data as unknown as Venue;
  },

  /**
   * Rate a ground 1-5. `rate_venue` refuses anyone who was not on the sheet for
   * a completed game there (NOT_PLAYED_HERE), so the aggregate cannot be farmed
   * by a rival ground or someone who never turned up. Upserts: rating again
   * replaces your previous score rather than adding a second one.
   */
  async rate(venueId: string, rating: number): Promise<Venue> {
    const { data, error } = await supabase.rpc('rate_venue', {
      in_venue_id: venueId,
      in_rating: rating,
    });
    if (error) throw venueError(error);
    return data as unknown as Venue;
  },

  /** Whether the caller has earned the right to rate, and what they gave. */
  async myRating(venueId: string): Promise<{ canRate: boolean; myRating: number | null }> {
    const { data, error } = await supabase.rpc('my_venue_rating', { in_venue_id: venueId });
    if (error) throw venueError(error);
    const row = (data as unknown as { can_rate: boolean; my_rating: number | null }[])?.[0];
    return { canRate: row?.can_rate ?? false, myRating: row?.my_rating ?? null };
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('venues').delete().eq('id', id);
    if (error) throw toAppError(error);
  },
};
