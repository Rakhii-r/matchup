/**
 * E2E Test Harness for Venue Time Slot Booking, Manual Court Selection & Concurrency Protection
 * 
 * Replicates exact PostgreSQL engine semantics and PL/pgSQL RPC logic:
 * 1. public.venues table schema and operating settings (operating_hours_start, operating_hours_end, slot_duration_minutes, courts_count).
 * 2. public.venue_bookings table schema with partial GiST exclusion constraint:
 *    EXCLUDE USING gist (venue_id WITH =, court_number WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status = 'confirmed')
 * 3. Exact algorithmic replication of database RPCs:
 *    - public.get_venue_slots(in_venue_id, in_date, in_timezone)
 *    - public.book_venue_slot(in_venue_id, in_court_number, in_start_time, in_end_time, in_match_id, in_notes)
 *    - public.cancel_venue_booking(in_booking_id)
 * 4. Match linking lifecycle, validation, and captain chat announcements.
 * 5. Deterministic error throwing with exact Postgres error codes (23P01, 28000, 42501, P0002, 23514).
 */

export interface VenueRecord {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  sport_types: string[];
  phone: string | null;
  status: 'approved' | 'pending' | 'rejected';
  operating_hours_start: string; // e.g. "06:00:00"
  operating_hours_end: string;   // e.g. "23:00:00"
  slot_duration_minutes: number; // e.g. 60 (30, 45, 60, 90, 120)
  courts_count: number;          // e.g. 2 (1..20)
  price_per_hour: number;
  facilities: string[];
}

export interface VenueBookingRecord {
  id: string;
  venue_id: string;
  court_number: number;
  user_id: string;
  start_time: string; // ISO timestamptz
  end_time: string;   // ISO timestamptz
  status: 'confirmed' | 'cancelled';
  match_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export interface MatchRecord {
  id: string;
  creator_id: string;
  sport: string;
  venue_id: string | null;
  venue_text: string | null;
  scheduled_at: string;
  end_time: string | null;
  status: 'open' | 'locked' | 'completed' | 'cancelled';
}

export interface ProfileRecord {
  id: string;
  full_name: string;
  is_active: boolean;
  is_admin?: boolean;
}

export interface CaptainChatMessageRecord {
  id: string;
  match_id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: string;
}

export interface VenueSlotRecord {
  court_number: number;
  court_label: string;
  start_time: string; // ISO
  end_time: string;   // ISO
  time_hhmm: string;  // "06:00"
  end_time_hhmm: string; // "07:00"
  is_available: boolean;
  booking_id: string | null;
  is_my_booking: boolean;
}

export class PostgresError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PostgresError';
    this.code = code;
  }
}

/**
 * Checks if two intervals [startA, endA) and [startB, endB) overlap.
 * In PostgreSQL tstzrange(s, e, '[)'), intervals overlap if and only if
 * startA < endB AND startB < endA.
 * Boundaries are half-open, so [10:00, 11:00) and [11:00, 12:00) do NOT overlap.
 */
export function intervalsOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

export class VenueBookingHarness {
  venues: Map<string, VenueRecord> = new Map();
  venueBookings: Map<string, VenueBookingRecord> = new Map();
  matches: Map<string, MatchRecord> = new Map();
  profiles: Map<string, ProfileRecord> = new Map();
  captainChatMessages: CaptainChatMessageRecord[] = [];

  // Simulated current execution context
  currentUserId: string | null = null;
  mockCurrentTime: Date | null = null;

  reset(): void {
    this.venues.clear();
    this.venueBookings.clear();
    this.matches.clear();
    this.profiles.clear();
    this.captainChatMessages = [];
    this.currentUserId = null;
    this.mockCurrentTime = null;
  }

  setAuthUser(userId: string | null): void {
    this.currentUserId = userId;
  }

  setMockTime(time: Date | null): void {
    this.mockCurrentTime = time;
  }

  getNow(): Date {
    return this.mockCurrentTime ?? new Date();
  }

  // --- Seeding Helpers ---

  createProfile(id: string, fullName: string, isActive: boolean = true, isAdmin: boolean = false): ProfileRecord {
    const profile: ProfileRecord = {
      id,
      full_name: fullName,
      is_active: isActive,
      is_admin: isAdmin,
    };
    this.profiles.set(id, profile);
    return profile;
  }

  createVenue(input: {
    id: string;
    name: string;
    address?: string;
    lat?: number;
    lng?: number;
    sportTypes?: string[];
    phone?: string;
    status?: 'approved' | 'pending' | 'rejected';
    operatingHoursStart?: string;
    operatingHoursEnd?: string;
    slotDurationMinutes?: number;
    courtsCount?: number;
    pricePerHour?: number;
    facilities?: string[];
  }): VenueRecord {
    const venue: VenueRecord = {
      id: input.id,
      name: input.name,
      address: input.address ?? '123 Turf Road, Pune',
      lat: input.lat ?? 18.5204,
      lng: input.lng ?? 73.8567,
      sport_types: input.sportTypes ?? ['box_cricket', 'badminton'],
      phone: input.phone ?? '+919876543210',
      status: input.status ?? 'approved',
      operating_hours_start: input.operatingHoursStart ?? '06:00:00',
      operating_hours_end: input.operatingHoursEnd ?? '23:00:00',
      slot_duration_minutes: input.slotDurationMinutes ?? 60,
      courts_count: input.courtsCount ?? 2,
      price_per_hour: input.pricePerHour ?? 1200,
      facilities: input.facilities ?? ['Floodlights', 'Parking', 'Changing Room'],
    };

    // Validate check constraints matching database migration
    if (![30, 45, 60, 90, 120].includes(venue.slot_duration_minutes)) {
      throw new PostgresError('new row for relation "venues" violates check constraint "venues_slot_duration_check"', '23514');
    }
    if (venue.courts_count < 1 || venue.courts_count > 20) {
      throw new PostgresError('new row for relation "venues" violates check constraint "venues_courts_count_check"', '23514');
    }
    if (venue.operating_hours_end <= venue.operating_hours_start) {
      throw new PostgresError('new row for relation "venues" violates check constraint "venues_valid_operating_hours"', '23514');
    }

    this.venues.set(venue.id, venue);
    return venue;
  }

  createMatch(input: {
    id: string;
    creatorId: string;
    sport: string;
    scheduledAt: string;
    status?: 'open' | 'locked' | 'completed' | 'cancelled';
    venueId?: string | null;
    venueText?: string | null;
    endTime?: string | null;
  }): MatchRecord {
    const match: MatchRecord = {
      id: input.id,
      creator_id: input.creatorId,
      sport: input.sport,
      venue_id: input.venueId ?? null,
      venue_text: input.venueText ?? null,
      scheduled_at: input.scheduledAt,
      end_time: input.endTime ?? null,
      status: input.status ?? 'open',
    };
    this.matches.set(match.id, match);
    return match;
  }

  // --- Database Stored Procedure Replications ---

  /**
   * Replicates public.get_venue_slots:
   * Dynamically computes candidate slot grid across all courts for in_date,
   * left-joining active confirmed bookings using [) half-open intervals.
   */
  getVenueSlots(input: {
    venueId: string;
    date: string; // "YYYY-MM-DD"
    timezone?: string;
  }): VenueSlotRecord[] {
    const venue = this.venues.get(input.venueId);
    if (!venue) {
      throw new PostgresError('VENUE_NOT_FOUND', 'P0002');
    }

    const courtsCount = venue.courts_count;
    const slotDurationMs = venue.slot_duration_minutes * 60 * 1000;
    const now = this.getNow();
    const graceWindowMs = 5 * 60 * 1000; // now() - interval '5 minutes'

    // Parse start and end hours
    const [startH, startM] = venue.operating_hours_start.split(':').map(Number) as [number, number];
    const [endH, endM] = venue.operating_hours_end.split(':').map(Number) as [number, number];

    const [year, month, day] = input.date.split('-').map(Number) as [number, number, number];

    const dayStart = new Date(Date.UTC(year, month - 1, day, startH, startM, 0, 0));
    const dayEnd = new Date(Date.UTC(year, month - 1, day, endH, endM, 0, 0));

    if (dayStart.getTime() >= dayEnd.getTime() || slotDurationMs <= 0) {
      return [];
    }

    // Active confirmed bookings for this venue
    const confirmedBookings = Array.from(this.venueBookings.values()).filter(
      (b) => b.venue_id === input.venueId && b.status === 'confirmed',
    );

    const slots: VenueSlotRecord[] = [];

    // Loop over each court
    for (let cNum = 1; cNum <= courtsCount; cNum++) {
      let currentSlotStart = new Date(dayStart.getTime());

      while (currentSlotStart.getTime() + slotDurationMs <= dayEnd.getTime()) {
        const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDurationMs);

        // Find any overlapping confirmed booking on this court
        const matchingBooking = confirmedBookings.find(
          (b) =>
            b.court_number === cNum &&
            intervalsOverlap(
              new Date(b.start_time),
              new Date(b.end_time),
              currentSlotStart,
              currentSlotEnd,
            ),
        );

        // Availability rule matching SQL:
        // b.id is null and g.start_time >= (now() - interval '5 minutes')
        const isNotPast = currentSlotStart.getTime() >= (now.getTime() - graceWindowMs);
        const isAvailable = matchingBooking === undefined && isNotPast;

        const pad = (n: number) => String(n).padStart(2, '0');
        const timeHhmm = `${pad(currentSlotStart.getUTCHours())}:${pad(currentSlotStart.getUTCMinutes())}`;
        const endTimeHhmm = `${pad(currentSlotEnd.getUTCHours())}:${pad(currentSlotEnd.getUTCMinutes())}`;

        const isMyBooking =
          matchingBooking !== undefined &&
          this.currentUserId !== null &&
          matchingBooking.user_id === this.currentUserId;

        slots.push({
          court_number: cNum,
          court_label: `Court ${cNum}`,
          start_time: currentSlotStart.toISOString(),
          end_time: currentSlotEnd.toISOString(),
          time_hhmm: timeHhmm,
          end_time_hhmm: endTimeHhmm,
          is_available: isAvailable,
          booking_id: matchingBooking ? matchingBooking.id : null,
          is_my_booking: isMyBooking,
        });

        currentSlotStart = currentSlotEnd;
      }
    }

    // Return ordered by court_number asc, start_time asc
    return slots.sort((a, b) => {
      if (a.court_number !== b.court_number) {
        return a.court_number - b.court_number;
      }
      return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    });
  }

  /**
   * Replicates public.book_venue_slot:
   * 1. Validates auth and active user.
   * 2. Validates venue, court bounds, time window, slot duration divisibility.
   * 3. Validates match ownership and sport compatibility.
   * 4. Enforces GiST exclusion constraint ([) overlap with existing confirmed bookings).
   * 5. Atomically links match and emits captain chat message.
   */
  bookVenueSlot(input: {
    venueId: string;
    courtNumber: number;
    startTime: string;
    endTime: string;
    matchId?: string | null;
    notes?: string | null;
  }): VenueBookingRecord {
    const authUid = this.currentUserId;
    if (!authUid) {
      throw new PostgresError('NOT_AUTHENTICATED', '28000');
    }

    const userProfile = this.profiles.get(authUid);
    if (!userProfile || !userProfile.is_active) {
      throw new PostgresError('ACCOUNT_INACTIVE', '42501');
    }

    // 1. Validate Venue
    const venue = this.venues.get(input.venueId);
    if (!venue || venue.status !== 'approved') {
      throw new PostgresError('VENUE_NOT_FOUND', 'P0002');
    }

    // 2. Validate Court Number
    if (input.courtNumber < 1 || input.courtNumber > venue.courts_count) {
      throw new PostgresError('INVALID_COURT_NUMBER', '23514');
    }

    // 3. Validate Time Window
    const startDate = new Date(input.startTime);
    const endDate = new Date(input.endTime);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new PostgresError('INVALID_TIMESTAMP', '22007');
    }

    if (endDate.getTime() <= startDate.getTime()) {
      throw new PostgresError('INVALID_TIME_RANGE', '23514');
    }

    const now = this.getNow();
    const gracePastThreshold = now.getTime() - 5 * 60 * 1000;
    if (startDate.getTime() < gracePastThreshold) {
      throw new PostgresError('CANNOT_BOOK_PAST', '23514');
    }

    const durMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    if (durMin <= 0 || (durMin % venue.slot_duration_minutes !== 0)) {
      throw new PostgresError('INVALID_SLOT_DURATION', '23514');
    }

    if (input.notes && input.notes.length > 280) {
      throw new PostgresError('NOTES_TOO_LONG', '23514');
    }

    // 4. Validate Match Linkage if provided
    let match: MatchRecord | null = null;
    if (input.matchId) {
      match = this.matches.get(input.matchId) ?? null;
      if (!match) {
        throw new PostgresError('MATCH_NOT_FOUND', 'P0002');
      }
      if (match.creator_id !== authUid) {
        throw new PostgresError('NOT_THE_ORGANISER', '42501');
      }
      if (match.status !== 'open' && match.status !== 'locked') {
        throw new PostgresError('MATCH_ALREADY_STARTED', '23514');
      }
      if (!venue.sport_types.includes(match.sport)) {
        throw new PostgresError('VENUE_SPORT_MISMATCH', '23514');
      }
    }

    // 5. Check GiST Exclusion Constraint (Double-booking prevention)
    // EXCLUDE USING gist (venue_id WITH =, court_number WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status = 'confirmed')
    for (const existing of this.venueBookings.values()) {
      if (
        existing.venue_id === input.venueId &&
        existing.court_number === input.courtNumber &&
        existing.status === 'confirmed'
      ) {
        const existStart = new Date(existing.start_time);
        const existEnd = new Date(existing.end_time);

        if (intervalsOverlap(existStart, existEnd, startDate, endDate)) {
          // Triggers exclusion violation, caught and re-raised as SLOT_ALREADY_TAKEN
          throw new PostgresError('SLOT_ALREADY_TAKEN', '23P01');
        }
      }
    }

    // 6. Insert Booking
    const bookingId = `bkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nowIso = now.toISOString();

    const booking: VenueBookingRecord = {
      id: bookingId,
      venue_id: input.venueId,
      court_number: input.courtNumber,
      user_id: authUid,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      status: 'confirmed',
      match_id: input.matchId ?? null,
      notes: input.notes ?? null,
      created_at: nowIso,
      updated_at: nowIso,
      cancelled_at: null,
    };

    this.venueBookings.set(bookingId, booking);

    // 7. Atomically update match if linked
    if (match) {
      match.venue_id = venue.id;
      match.venue_text = `${venue.name} (Court ${input.courtNumber})`;
      match.scheduled_at = startDate.toISOString();
      match.end_time = endDate.toISOString();

      // Best-effort captain chat announcement
      this.captainChatMessages.push({
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        match_id: match.id,
        sender_id: authUid,
        recipient_id: 'opponent-captain',
        content: `Court booked: ${venue.name} Court ${input.courtNumber} confirmed for ${startDate.toUTCString()}`,
        created_at: nowIso,
      });
    }

    return booking;
  }

  /**
   * Replicates public.cancel_venue_booking:
   * 1. Validates auth and ownership (or admin status).
   * 2. Idempotently sets status = 'cancelled' and cancelled_at = now().
   * 3. Instantly excludes from GiST exclusion constraint (slot immediately bookable).
   * 4. Detaches venue linkage from associated match.
   */
  cancelVenueBooking(bookingId: string): VenueBookingRecord {
    const authUid = this.currentUserId;
    if (!authUid) {
      throw new PostgresError('NOT_AUTHENTICATED', '28000');
    }

    const booking = this.venueBookings.get(bookingId);
    if (!booking) {
      throw new PostgresError('BOOKING_NOT_FOUND', 'P0002');
    }

    const userProfile = this.profiles.get(authUid);
    const isAdmin = userProfile?.is_admin === true;

    if (booking.user_id !== authUid && !isAdmin) {
      throw new PostgresError('NOT_THE_BOOKER', '42501');
    }

    if (booking.status === 'cancelled') {
      return booking;
    }

    const now = this.getNow().toISOString();
    booking.status = 'cancelled';
    booking.cancelled_at = now;
    booking.updated_at = now;

    // If tied to a match, clear match venue reference
    if (booking.match_id) {
      const match = this.matches.get(booking.match_id);
      if (match && match.venue_id === booking.venue_id) {
        match.venue_id = null;
        match.venue_text = null;
      }
    }

    return booking;
  }
}
