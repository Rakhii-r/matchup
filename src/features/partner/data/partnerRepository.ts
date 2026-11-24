import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type {
  PartnerRole,
  PartnerVenue,
  PartnerVenueStatus,
  VenueForm,
} from '@features/partner/domain/partnerSchema';

/**
 * Venue Partner (owners). Every rule lives in the RPCs of
 * 20261123110000_venue_partner_owners.sql; this file maps their tokens.
 */
const PARTNER_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['ACCOUNT_INACTIVE', 'forbidden', 'Your account is not active.'],
  ['NOT_VENUE_OWNER', 'forbidden', 'Only the venue owner can change this.'],
  ['NOT_SUPERADMIN', 'forbidden', 'Only an admin can do this.'],
  ['NOT_AN_ADMIN', 'forbidden', 'Only an admin can do this.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That venue no longer exists.'],
  ['VENUE_EXISTS', 'conflict', 'A venue with this name is already listed nearby.'],
  ['TOO_MANY_PENDING', 'rate_limited', 'You already have 3 venues waiting for approval.'],
  ['NAME_TOO_SHORT', 'validation', 'Enter the venue name.'],
  ['NAME_TOO_LONG', 'validation', 'Name is too long.'],
  ['ADDRESS_TOO_LONG', 'validation', 'Address is too long.'],
  ['BAD_COORDS', 'validation', 'Set the venue location.'],
  ['INVALID_PHONE', 'validation', 'Enter a 10-digit phone number.'],
  ['UNKNOWN_SPORT', 'validation', 'Pick at least one sport.'],
  ['BAD_COURTS', 'validation', 'Courts must be between 1 and 20.'],
  ['BAD_HOURS', 'validation', 'Opening and closing must be on the hour, closing after opening.'],
  ['BAD_SLOT', 'validation', 'Slots are 1 hour.'],
  ['TOO_MANY_FACILITIES', 'validation', 'Up to 20 facilities.'],
  ['BAD_IMAGE', 'validation', 'That photo could not be used. Upload it again.'],
  ['PLAYER_NOT_FOUND', 'not_found', 'No player has signed up with that number.'],
];

function partnerError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of PARTNER_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

const hhmm = (t: string): string => t.slice(0, 5);

function formArgs(form: VenueForm) {
  return {
    in_name: form.name,
    in_address: form.address ? form.address : null,
    in_lat: form.lat,
    in_lng: form.lng,
    in_phone: form.phone ? form.phone : null,
    in_sports: form.sportTypes,
    in_courts: form.courtsCount,
    in_open: form.openTime,
    in_close: form.closeTime,
    in_slot: form.slotMinutes,
  };
}

export const partnerRepository = {
  /** Venues the caller owns or staffs. Empty for ordinary players. */
  async listMyVenues(): Promise<PartnerVenue[]> {
    const { data, error } = await supabase.rpc('list_my_partner_venues');
    if (error) throw partnerError(error);
    return (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      phone: r.phone,
      sportTypes: r.sport_types,
      courtsCount: r.courts_count,
      openTime: hhmm(r.operating_hours_start),
      closeTime: hhmm(r.operating_hours_end),
      slotMinutes: r.slot_duration_minutes,
      facilities: r.facilities ?? [],
      imageUrl: r.image_url,
      status: r.status as PartnerVenueStatus,
      role: r.role as PartnerRole,
    }));
  },

  /** Creates the venue as pending and makes the caller its owner. */
  async registerVenue(form: VenueForm): Promise<string> {
    const { data, error } = await supabase.rpc('register_venue', formArgs(form));
    if (error) throw partnerError(error);
    return data;
  },

  async updateVenue(venueId: string, form: VenueForm, imageUrl: string | null): Promise<void> {
    const { error } = await supabase.rpc('update_venue_details', {
      in_venue_id: venueId,
      ...formArgs(form),
      in_facilities: form.facilities,
      in_image_url: imageUrl,
    });
    if (error) throw partnerError(error);
  },

  /**
   * Uploads a JPEG cover photo (base64 from the image picker) to
   * venue-images/partner/<venueId>/. Storage RLS lets only the owner write
   * there. Returns the public URL to pass to updateVenue.
   */
  async uploadCoverPhoto(venueId: string, base64: string): Promise<string> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const path = `partner/${venueId}/cover.jpg`;
    const { error } = await supabase.storage
      .from('venue-images')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw partnerError(error);
    const { data } = supabase.storage.from('venue-images').getPublicUrl(path);
    // Bust the CDN cache so a replaced photo shows immediately.
    return `${data.publicUrl}?v=${Date.now()}`;
  },

  async assignOwner(venueId: string, phone: string): Promise<void> {
    const { error } = await supabase.rpc('admin_assign_venue_owner', {
      in_venue_id: venueId,
      in_phone: phone,
    });
    if (error) throw partnerError(error);
  },

  /** venue id → owner names, for the admin venue list. */
  async listOwners(): Promise<Map<string, string[]>> {
    const { data, error } = await supabase.rpc('admin_list_venue_owners');
    if (error) throw partnerError(error);
    const map = new Map<string, string[]>();
    for (const r of data ?? []) {
      map.set(r.venue_id, [...(map.get(r.venue_id) ?? []), r.owner_name]);
    }
    return map;
  },
};
