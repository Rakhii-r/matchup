import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import {
  BookSlotInputSchema,
  CancelBookingInputSchema,
} from '@features/venues/domain/venueBookingSchema';
import type {
  BookSlotInput,
  VenueBooking,
  VenueSlot,
} from '@features/venues/domain/venueBookingSchema';

const BOOKING_ERRORS: [string, AppErrorCode, string][] = [
  ['SLOT_ALREADY_TAKEN', 'conflict', 'Slot already taken'],
  ['23P01', 'conflict', 'Slot already taken'],
  ['venue_bookings_no_double_booking', 'conflict', 'Slot already taken'],
  ['NOT_AUTHENTICATED', 'unauthorized', 'Please sign in to continue.'],
  ['ACCOUNT_INACTIVE', 'forbidden', 'Your account is inactive.'],
  ['VENUE_NOT_FOUND', 'not_found', 'That ground no longer exists.'],
  ['INVALID_COURT_NUMBER', 'validation', 'Invalid court number.'],
  ['INVALID_TIME_RANGE', 'validation', 'Invalid time range.'],
  ['CANNOT_BOOK_PAST', 'validation', 'Cannot book a slot in the past.'],
  ['INVALID_SLOT_DURATION', 'validation', 'Invalid slot duration.'],
  ['OUTSIDE_OPERATING_HOURS', 'validation', 'Selected time is outside venue operating hours.'],
  ['UNALIGNED_SLOT_START', 'validation', 'Slot time does not align with venue schedule.'],
  ['NOTES_TOO_LONG', 'validation', 'Notes cannot exceed 280 characters.'],
  ['MATCH_NOT_FOUND', 'not_found', 'Linked match was not found.'],
  ['NOT_THE_ORGANISER', 'forbidden', 'Only the match organiser can link this court booking.'],
  ['MATCH_ALREADY_STARTED', 'conflict', 'This match is already in progress or completed.'],
  ['VENUE_SPORT_MISMATCH', 'validation', 'This ground does not support the match sport.'],
  ['BOOKING_NOT_FOUND', 'not_found', 'Booking not found.'],
  ['NOT_THE_BOOKER', 'forbidden', 'Only the person who booked this slot can cancel it.'],
];

export function bookingErrorToAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const e = (error ?? {}) as { message?: string; code?: string };
  const raw = (e.message ?? '').toLowerCase();
  const code = (e.code ?? '').toUpperCase();

  if (
    code === '23P01' ||
    code === 'SLOT_ALREADY_TAKEN' ||
    raw.includes('slot_already_taken') ||
    raw.includes('venue_bookings_no_double_booking')
  ) {
    return new AppError('conflict', 'Slot already taken', error);
  }

  for (const [token, errCode, message] of BOOKING_ERRORS) {
    if (code === token || raw.includes(token.toLowerCase())) {
      return new AppError(errCode, message, error);
    }
  }

  return toAppError(error);
}

export const venueBookingRepository = {
  /**
   * Dynamically calculate slot availability for a venue on a given date.
   */
  async getSlots(
    venueId: string,
    date: string,
    timezone: string = 'Asia/Kolkata',
  ): Promise<VenueSlot[]> {
    const { data, error } = await supabase.rpc('get_venue_slots', {
      in_venue_id: venueId,
      in_date: date,
      in_timezone: timezone,
    });

    if (error) throw bookingErrorToAppError(error);

    return (data ?? []).map((row) => ({
      courtNumber: row.court_number,
      courtLabel: row.court_label,
      startTime: row.start_time,
      endTime: row.end_time,
      timeHhmm: row.time_hhmm,
      endTimeHhmm: row.end_time_hhmm,
      isAvailable: row.is_available,
      bookingId: row.booking_id,
      isMyBooking: row.is_my_booking,
    }));
  },

  /**
   * Book a specific court slot atomically. Catches exclusion constraint errors and maps to "Slot already taken".
   */
  async bookSlot(input: BookSlotInput): Promise<VenueBooking> {
    const parsed = BookSlotInputSchema.parse(input);
    const { data, error } = await supabase.rpc('book_venue_slot', {
      in_venue_id: parsed.venueId,
      in_court_number: parsed.courtNumber,
      in_start_time: parsed.startTime,
      in_end_time: parsed.endTime,
      in_match_id: parsed.matchId ?? null,
      in_notes: parsed.notes ?? null,
    });

    if (error) throw bookingErrorToAppError(error);
    if (!data) throw new AppError('unknown', 'Failed to book slot');

    return {
      id: data.id,
      venueId: data.venue_id,
      courtNumber: data.court_number,
      userId: data.user_id,
      startTime: data.start_time,
      endTime: data.end_time,
      status: data.status,
      matchId: data.match_id,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      cancelledAt: data.cancelled_at,
    };
  },

  /**
   * Cancel a confirmed booking and immediately release the slot for others.
   */
  async cancelBooking(bookingId: string): Promise<VenueBooking> {
    CancelBookingInputSchema.parse({ bookingId });
    const { data, error } = await supabase.rpc('cancel_venue_booking', {
      in_booking_id: bookingId,
    });

    if (error) throw bookingErrorToAppError(error);
    if (!data) throw new AppError('not_found', 'Booking not found');

    return {
      id: data.id,
      venueId: data.venue_id,
      courtNumber: data.court_number,
      userId: data.user_id,
      startTime: data.start_time,
      endTime: data.end_time,
      status: data.status,
      matchId: data.match_id,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      cancelledAt: data.cancelled_at,
    };
  },

  /**
   * List confirmed and past bookings for the signed-in user, eager-loading venue details.
   */
  async listMyBookings(): Promise<VenueBooking[]> {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData.session?.user?.id;
    if (!currentUserId) return [];

    const { data, error } = await supabase
      .from('venue_bookings')
      .select('*, venues(name, address, sport_types, lat, lng)')
      .eq('user_id', currentUserId)
      .order('start_time', { ascending: false });

    if (error) throw bookingErrorToAppError(error);

    return (data ?? []).map((row) => {
      const venueObj = row.venues as {
        name?: string;
        address?: string | null;
        sport_types?: string[];
        lat?: number | null;
        lng?: number | null;
      } | null;
      return {
        id: row.id,
        venueId: row.venue_id,
        courtNumber: row.court_number,
        userId: row.user_id,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
        matchId: row.match_id,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        cancelledAt: row.cancelled_at,
        venueName: venueObj?.name,
        venueAddress: venueObj?.address,
        sportTypes: venueObj?.sport_types,
        venueLat: venueObj?.lat ?? null,
        venueLng: venueObj?.lng ?? null,
      };
    });
  },

  /**
   * Retrieve active booking for a match if linked.
   */
  async getBookingForMatch(matchId: string): Promise<VenueBooking | null> {
    const { data, error } = await supabase
      .from('venue_bookings')
      .select('*, venues(name, address, sport_types, lat, lng)')
      .eq('match_id', matchId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw bookingErrorToAppError(error);
    if (!data) return null;

    const venueObj = data.venues as {
      name?: string;
      address?: string | null;
      sport_types?: string[];
      lat?: number | null;
      lng?: number | null;
    } | null;
    return {
      id: data.id,
      venueId: data.venue_id,
      courtNumber: data.court_number,
      userId: data.user_id,
      startTime: data.start_time,
      endTime: data.end_time,
      status: data.status,
      matchId: data.match_id,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      cancelledAt: data.cancelled_at,
      venueName: venueObj?.name,
      venueAddress: venueObj?.address,
      sportTypes: venueObj?.sport_types,
      venueLat: venueObj?.lat ?? null,
      venueLng: venueObj?.lng ?? null,
    };
  },
};
