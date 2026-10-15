/**
 * Tier 1 Tests: Feature Coverage - Booking RPCs, Cancellation & Match Linking
 * 
 * Features tested:
 * - F4: Atomic booking creation via book_venue_slot.
 * - F5: Cancellation via cancel_venue_booking immediately releasing slot.
 * - F6: Match linking (booking tagged with match_id and updating match details).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueBookingHarness,
  type VenueRecord,
} from '../harness/venueBookingHarness';

describe('Tier 1: Atomic Booking RPC, Cancellation & Match Linking Lifecycle', () => {
  let harness: VenueBookingHarness;
  let testVenue: VenueRecord;

  const fixedNow = new Date('2026-09-05T04:00:00.000Z');

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(fixedNow);

    // Create user profiles
    harness.createProfile('user-organizer', 'Alice Organiser', true, false);
    harness.createProfile('user-opponent', 'Bob Challenger', true, false);
    harness.createProfile('user-inactive', 'Inactive Charlie', false, false);
    harness.createProfile('user-admin', 'Admin Super', true, true);

    // Create standard venue
    testVenue = harness.createVenue({
      id: 'venue-city-arena',
      name: 'City Sports Arena',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '23:00:00',
      slotDurationMinutes: 60,
      courtsCount: 2,
      sportTypes: ['box_cricket', 'badminton'],
    });

    harness.setAuthUser('user-organizer');
  });

  // =========================================================================
  // Feature 4: Atomic Booking Creation via book_venue_slot (>=5 tests)
  // =========================================================================
  describe('F4: Atomic Booking Creation via book_venue_slot', () => {
    it('F4.1: Successfully creates a confirmed booking and persists all record fields', () => {
      const startTime = '2026-09-05T08:00:00.000Z';
      const endTime = '2026-09-05T09:00:00.000Z';

      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime,
        endTime,
        notes: 'Semi-final match prep',
      });

      assert.ok(booking.id.startsWith('bkg-'));
      assert.equal(booking.venue_id, testVenue.id);
      assert.equal(booking.court_number, 1);
      assert.equal(booking.user_id, 'user-organizer');
      assert.equal(booking.start_time, startTime);
      assert.equal(booking.end_time, endTime);
      assert.equal(booking.status, 'confirmed');
      assert.equal(booking.notes, 'Semi-final match prep');
      assert.equal(booking.cancelled_at, null);

      // Verify persisted in harness
      const stored = harness.venueBookings.get(booking.id);
      assert.deepEqual(stored, booking);
    });

    it('F4.2: Booking with null notes creates clean record with null notes field', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 2,
        startTime: '2026-09-05T09:00:00.000Z',
        endTime: '2026-09-05T10:00:00.000Z',
      });

      assert.equal(booking.notes, null);
    });

    it('F4.3: Multi-slot duration booking (e.g. 120 mins = 2 x 60 min slots) succeeds if multiple of slot_duration_minutes', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T12:00:00.000Z', // 2 hours = 120 mins
      });

      assert.equal(booking.status, 'confirmed');

      // Verify that both the 10:00 and 11:00 slots are now occupied
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: '2026-09-05',
      });

      const slot10 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '10:00');
      const slot11 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '11:00');
      const slot12 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '12:00');

      assert.equal(slot10?.is_available, false, '10:00 slot must be occupied');
      assert.equal(slot11?.is_available, false, '11:00 slot must be occupied');
      assert.equal(slot12?.is_available, true, '12:00 slot must remain free');
    });

    it('F4.4: Unauthenticated caller is rejected with NOT_AUTHENTICATED (28000)', () => {
      harness.setAuthUser(null);

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === '28000' && err.message === 'NOT_AUTHENTICATED',
      );
    });

    it('F4.5: Inactive user account is rejected with ACCOUNT_INACTIVE (42501)', () => {
      harness.setAuthUser('user-inactive');

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === '42501' && err.message === 'ACCOUNT_INACTIVE',
      );
    });

    it('F4.6: Booking notes exceeding 280 characters are rejected with NOTES_TOO_LONG (23514)', () => {
      const longNote = 'A'.repeat(281);

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
            notes: longNote,
          });
        },
        (err: any) => err.code === '23514' && err.message === 'NOTES_TOO_LONG',
      );
    });

    it('F4.7: Booking on non-existent venue is rejected with VENUE_NOT_FOUND (P0002)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: 'non-existent-uuid',
            courtNumber: 1,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === 'P0002' && err.message === 'VENUE_NOT_FOUND',
      );
    });
  });

  // =========================================================================
  // Feature 5: Cancellation via cancel_venue_booking (>=5 tests)
  // =========================================================================
  describe('F5: Booking Cancellation via cancel_venue_booking', () => {
    it('F5.1: Booker can successfully cancel booking, updating status to cancelled and timestamping cancelled_at', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T12:00:00.000Z',
        endTime: '2026-09-05T13:00:00.000Z',
      });

      const cancelled = harness.cancelVenueBooking(booking.id);

      assert.equal(cancelled.id, booking.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.ok(cancelled.cancelled_at);
      assert.ok(cancelled.updated_at);
    });

    it('F5.2: Cancelled booking immediately releases slot from GiST exclusion index, permitting immediate re-booking', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T13:00:00.000Z',
        endTime: '2026-09-05T14:00:00.000Z',
      });

      harness.cancelVenueBooking(booking.id);

      // Other user books the exact same slot immediately
      harness.setAuthUser('user-opponent');
      const newBooking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T13:00:00.000Z',
        endTime: '2026-09-05T14:00:00.000Z',
      });

      assert.equal(newBooking.status, 'confirmed');
      assert.equal(newBooking.user_id, 'user-opponent');
    });

    it('F5.3: Non-booker attempting to cancel someone elses booking is rejected with NOT_THE_BOOKER (42501)', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T14:00:00.000Z',
        endTime: '2026-09-05T15:00:00.000Z',
      });

      // Switch to Bob
      harness.setAuthUser('user-opponent');

      assert.throws(
        () => {
          harness.cancelVenueBooking(booking.id);
        },
        (err: any) => err.code === '42501' && err.message === 'NOT_THE_BOOKER',
      );
    });

    it('F5.4: Admin user is permitted to cancel any booking regardless of owner', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T15:00:00.000Z',
        endTime: '2026-09-05T16:00:00.000Z',
      });

      // Switch to Admin
      harness.setAuthUser('user-admin');

      const cancelled = harness.cancelVenueBooking(booking.id);
      assert.equal(cancelled.status, 'cancelled');
    });

    it('F5.5: Cancelling an already cancelled booking is idempotent and returns the record safely', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T16:00:00.000Z',
        endTime: '2026-09-05T17:00:00.000Z',
      });

      const firstCancel = harness.cancelVenueBooking(booking.id);
      const secondCancel = harness.cancelVenueBooking(booking.id);

      assert.equal(firstCancel.status, 'cancelled');
      assert.equal(secondCancel.status, 'cancelled');
      assert.equal(firstCancel.cancelled_at, secondCancel.cancelled_at);
    });

    it('F5.6: Cancelling a non-existent booking throws BOOKING_NOT_FOUND (P0002)', () => {
      assert.throws(
        () => {
          harness.cancelVenueBooking('non-existent-booking-uuid');
        },
        (err: any) => err.code === 'P0002' && err.message === 'BOOKING_NOT_FOUND',
      );
    });

    it('F5.7: Unauthenticated caller attempting cancellation throws NOT_AUTHENTICATED (28000)', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T17:00:00.000Z',
        endTime: '2026-09-05T18:00:00.000Z',
      });

      harness.setAuthUser(null);
      assert.throws(
        () => {
          harness.cancelVenueBooking(booking.id);
        },
        (err: any) => err.code === '28000' && err.message === 'NOT_AUTHENTICATED',
      );
    });
  });

  // =========================================================================
  // Feature 6: Match Linking (>=5 tests)
  // =========================================================================
  describe('F6: Match Linking and Atomicity', () => {
    it('F6.1: Booking linked to match atomically updates match venue_id, venue_text, scheduled_at, and end_time', () => {
      const match = harness.createMatch({
        id: 'match-101',
        creatorId: 'user-organizer',
        sport: 'box_cricket',
        scheduledAt: '2026-09-05T10:00:00.000Z',
      });

      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 2,
        startTime: '2026-09-05T18:00:00.000Z',
        endTime: '2026-09-05T19:00:00.000Z',
        matchId: match.id,
      });

      assert.equal(booking.match_id, match.id);

      // Verify match is atomically updated
      const updatedMatch = harness.matches.get(match.id);
      assert.equal(updatedMatch?.venue_id, testVenue.id);
      assert.equal(updatedMatch?.venue_text, 'City Sports Arena (Court 2)');
      assert.equal(updatedMatch?.scheduled_at, '2026-09-05T18:00:00.000Z');
      assert.equal(updatedMatch?.end_time, '2026-09-05T19:00:00.000Z');
    });

    it('F6.2: Match linking automatically creates a captain chat announcement', () => {
      const match = harness.createMatch({
        id: 'match-chat-test',
        creatorId: 'user-organizer',
        sport: 'box_cricket',
        scheduledAt: '2026-09-05T12:00:00.000Z',
      });

      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T20:00:00.000Z',
        endTime: '2026-09-05T21:00:00.000Z',
        matchId: match.id,
      });

      const chatMsg = harness.captainChatMessages.find((m) => m.match_id === match.id);
      assert.ok(chatMsg, 'Captain chat message should be enqueued');
      assert.ok(chatMsg.content.includes('Court booked: City Sports Arena Court 1'));
    });

    it('F6.3: Non-organiser attempting to link a match is rejected with NOT_THE_ORGANISER (42501)', () => {
      const match = harness.createMatch({
        id: 'match-bob-created',
        creatorId: 'user-opponent', // Bob created this match
        sport: 'box_cricket',
        scheduledAt: '2026-09-05T10:00:00.000Z',
      });

      // Alice tries to book slot for Bob's match
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T09:00:00.000Z',
            endTime: '2026-09-05T10:00:00.000Z',
            matchId: match.id,
          });
        },
        (err: any) => err.code === '42501' && err.message === 'NOT_THE_ORGANISER',
      );
    });

    it('F6.4: Sport mismatch between match and venue is rejected with VENUE_SPORT_MISMATCH (23514)', () => {
      const footballMatch = harness.createMatch({
        id: 'match-football-7v7',
        creatorId: 'user-organizer',
        sport: 'football', // Venue only supports box_cricket and badminton
        scheduledAt: '2026-09-05T10:00:00.000Z',
      });

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T11:00:00.000Z',
            matchId: footballMatch.id,
          });
        },
        (err: any) => err.code === '23514' && err.message === 'VENUE_SPORT_MISMATCH',
      );
    });

    it('F6.5: Linking non-existent match throws MATCH_NOT_FOUND (P0002)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T11:00:00.000Z',
            matchId: 'non-existent-match-id',
          });
        },
        (err: any) => err.code === 'P0002' && err.message === 'MATCH_NOT_FOUND',
      );
    });

    it('F6.6: Linking to an already completed match is rejected with MATCH_ALREADY_STARTED (23514)', () => {
      const completedMatch = harness.createMatch({
        id: 'match-completed',
        creatorId: 'user-organizer',
        sport: 'box_cricket',
        scheduledAt: '2026-09-04T10:00:00.000Z',
        status: 'completed',
      });

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T11:00:00.000Z',
            matchId: completedMatch.id,
          });
        },
        (err: any) => err.code === '23514' && err.message === 'MATCH_ALREADY_STARTED',
      );
    });

    it('F6.7: Cancelling a linked booking cleanly detaches venue from match, clearing venue_id and venue_text', () => {
      const match = harness.createMatch({
        id: 'match-detach-test',
        creatorId: 'user-organizer',
        sport: 'box_cricket',
        scheduledAt: '2026-09-05T10:00:00.000Z',
      });

      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T21:00:00.000Z',
        endTime: '2026-09-05T22:00:00.000Z',
        matchId: match.id,
      });

      // Verify linked
      let matchRow = harness.matches.get(match.id);
      assert.equal(matchRow?.venue_id, testVenue.id);
      assert.ok(matchRow?.venue_text);

      // Cancel the booking
      harness.cancelVenueBooking(booking.id);

      // Verify detached
      matchRow = harness.matches.get(match.id);
      assert.equal(matchRow?.venue_id, null, 'Match venue_id must be cleared to null');
      assert.equal(matchRow?.venue_text, null, 'Match venue_text must be cleared to null');
    });
  });
});
