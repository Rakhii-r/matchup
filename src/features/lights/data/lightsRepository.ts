import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import {
  DeviceTokenSchema,
  SetLightsPaidInputSchema,
  type CourtDevice,
  type LightBooking,
  type LightCourt,
  type LightEventStatus,
  type LightVenue,
  type MatchLights,
  type SetLightsPaidInput,
  type VenueStaffMember,
} from '@features/lights/domain/lightsSchema';

/**
 * Court lights (Phase 2). Every rule lives in the database: who may mark a
 * booking paid, whether a ball fires, and when the slot cuts off. This file
 * only calls the RPCs in 20261118090000_court_lights.sql and maps their tokens.
 */
const LIGHTS_ERRORS: [token: string, code: AppErrorCode, message: string][] = [
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in again.'],
  ['NOT_VENUE_STAFF', 'forbidden', 'You are not staff at this ground.'],
  ['NOT_SUPERADMIN', 'forbidden', 'Only an admin can do this.'],
  ['BOOKING_NOT_FOUND', 'not_found', 'That booking no longer exists.'],
  ['BOOKING_CANCELLED', 'conflict', 'That booking was cancelled.'],
  ['BOOKING_FINISHED', 'conflict', 'That slot has already ended.'],
  ['ALREADY_PAID', 'conflict', 'Lights are already paid for this booking.'],
  ['NOT_PAID', 'conflict', 'Lights were not paid for this booking.'],
  ['NOT_YOUR_BOOKING', 'forbidden', 'Only the person who booked the court can switch its lights.'],
  ['INVALID_AMOUNT', 'validation', 'Enter a valid amount.'],
  ['INVALID_METHOD', 'validation', 'Pick how they paid.'],
  ['NO_DEVICE', 'not_found', 'No light device is linked to this court.'],
  ['DEVICE_DISABLED', 'conflict', 'Lights are switched off for this court.'],
  ['INVALID_TOKEN', 'validation', 'That does not look like a ThingsBoard device token.'],
  ['COURT_OUT_OF_RANGE', 'validation', 'This ground has no such court.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That ground no longer exists.'],
  ['INVALID_PHONE', 'validation', 'Enter a 10-digit phone number.'],
  ['PLAYER_NOT_FOUND', 'not_found', 'No player has signed up with that number.'],
];

function lightsError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of LIGHTS_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

export const lightsRepository = {
  /** Grounds the caller runs the counter for. Empty for ordinary players. */
  async listMyVenues(): Promise<LightVenue[]> {
    const { data, error } = await supabase.rpc('list_my_light_venues');
    if (error) throw lightsError(error);
    return data ?? [];
  },

  /** Bookings overlapping [from, to), with their lights status. */
  async listBookings(venueId: string, from: Date, to: Date): Promise<LightBooking[]> {
    const { data, error } = await supabase.rpc('list_venue_light_bookings', {
      in_venue_id: venueId,
      in_from: from.toISOString(),
      in_to: to.toISOString(),
    });
    if (error) throw lightsError(error);
    return data ?? [];
  },

  async setPaid(input: SetLightsPaidInput): Promise<void> {
    const parsed = SetLightsPaidInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('validation', 'Enter a valid amount.', parsed.error);
    const { error } = await supabase.rpc('set_lights_paid', {
      in_booking_id: parsed.data.bookingId,
      in_amount_paise: parsed.data.amountRupees * 100,
      in_method: parsed.data.method,
    });
    if (error) throw lightsError(error);
  },

  async revokePaid(bookingId: string): Promise<void> {
    const { error } = await supabase.rpc('revoke_lights_paid', { in_booking_id: bookingId });
    if (error) throw lightsError(error);
  },

  async listCourts(venueId: string): Promise<CourtDevice[]> {
    const { data, error } = await supabase.rpc('list_court_devices', { in_venue_id: venueId });
    if (error) throw lightsError(error);
    return data ?? [];
  },

  /** Superadmin only. The token goes straight into Vault and is never read back. */
  async setDeviceToken(venueId: string, courtNumber: number, token: string): Promise<void> {
    const parsed = DeviceTokenSchema.safeParse(token);
    if (!parsed.success) {
      throw new AppError('validation', 'Paste the device access token from ThingsBoard.', parsed.error);
    }
    const { error } = await supabase.rpc('set_court_device_token', {
      in_venue_id: venueId,
      in_court_number: courtNumber,
      in_token: parsed.data,
    });
    if (error) throw lightsError(error);
  },

  async setDeviceEnabled(venueId: string, courtNumber: number, enabled: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_court_device_enabled', {
      in_venue_id: venueId,
      in_court_number: courtNumber,
      in_enabled: enabled,
    });
    if (error) throw lightsError(error);
  },

  /** Returns the event id, to follow with getEventStatus. */
  async sendTestBlink(venueId: string, courtNumber: number): Promise<string> {
    const { data, error } = await supabase.rpc('send_test_blink', {
      in_venue_id: venueId,
      in_court_number: courtNumber,
    });
    if (error) throw lightsError(error);
    if (typeof data !== 'string') throw new AppError('unknown', 'Test blink was not queued.');
    return data;
  },

  async getEventStatus(eventId: string): Promise<LightEventStatus | null> {
    const { data, error } = await supabase.rpc('get_light_event_status', { in_event_id: eventId });
    if (error) throw lightsError(error);
    return data?.[0] ?? null;
  },

  /**
   * Lights status of the court this match is on right now, for anyone on the
   * match. Null when that court has no light device or no live booking.
   */
  async getMatchLights(matchId: string): Promise<MatchLights | null> {
    const { data, error } = await supabase.rpc('get_match_lights', { in_match_id: matchId });
    if (error) throw lightsError(error);
    return data?.[0] ?? null;
  },

  /** Every court that has a light device: the "Court lights" badges. */
  async listLightCourts(): Promise<LightCourt[]> {
    const { data, error } = await supabase.rpc('list_light_courts');
    if (error) throw lightsError(error);
    return data ?? [];
  },

  /** The booker's own on/off for their booking (at booking time or from the scoreboard). */
  async setBookingLights(bookingId: string, wanted: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_booking_lights', {
      in_booking_id: bookingId,
      in_wanted: wanted,
    });
    if (error) throw lightsError(error);
  },

  async listStaff(venueId: string): Promise<VenueStaffMember[]> {
    const { data, error } = await supabase.rpc('list_venue_staff', { in_venue_id: venueId });
    if (error) throw lightsError(error);
    return data ?? [];
  },

  async addStaff(venueId: string, phone: string): Promise<void> {
    const { error } = await supabase.rpc('add_venue_staff', {
      in_venue_id: venueId,
      in_phone: phone,
    });
    if (error) throw lightsError(error);
  },

  async removeStaff(venueId: string, userId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_venue_staff', {
      in_venue_id: venueId,
      in_user_id: userId,
    });
    if (error) throw lightsError(error);
  },
};
