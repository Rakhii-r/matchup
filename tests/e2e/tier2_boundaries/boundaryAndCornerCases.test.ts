/**
 * Tier 2 Tests: Boundary & Corner Cases
 * 
 * Coverage areas (>=5 tests per area):
 * - B1: Earliest slot (06:00) and latest slot (22:00-23:00) boundary limits.
 * - B2: Adjacent back-to-back slots — verify [) half-open interval allows sharing boundaries without false conflicts.
 * - B3: Past time slots (slots earlier than now are marked past/disabled).
 * - B4: Single-court venues (courts_count = 1) vs multi-court venues (courts_count = 4, 20).
 * - B5: Invalid inputs: invalid court number, reversed time window (end_time <= start_time), invalid durations, long notes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueBookingHarness,
  type VenueRecord,
} from '../harness/venueBookingHarness';

describe('Tier 2: Boundary & Corner Cases', () => {
  let harness: VenueBookingHarness;
  let testVenue: VenueRecord;

  // Fixed reference anchor: 2026-09-05 at 05:00:00 UTC
  const fixedNow = new Date('2026-09-05T05:00:00.000Z');
  const targetDate = '2026-09-05';

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(fixedNow);

    harness.createProfile('user-tester', 'Test User', true, false);

    // Standard venue: 06:00 to 23:00, 60-min slots, 2 courts
    testVenue = harness.createVenue({
      id: 'venue-boundary-test',
      name: 'Boundary Arena',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '23:00:00',
      slotDurationMinutes: 60,
      courtsCount: 2,
    });

    harness.setAuthUser('user-tester');
  });

  // =========================================================================
  // Area B1: Earliest Slot and Latest Slot Boundary Limits (>=5 tests)
  // =========================================================================
  describe('B1: Earliest & Latest Slot Boundaries', () => {
    it('B1.1: Exact earliest slot (06:00-07:00) starting at operating_hours_start is bookable', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T06:00:00.000Z',
        endTime: '2026-09-05T07:00:00.000Z',
      });

      assert.equal(booking.status, 'confirmed');
      assert.equal(booking.start_time, '2026-09-05T06:00:00.000Z');
      assert.equal(booking.end_time, '2026-09-05T07:00:00.000Z');
    });

    it('B1.2: Exact latest slot (22:00-23:00) ending at operating_hours_end is bookable', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T22:00:00.000Z',
        endTime: '2026-09-05T23:00:00.000Z',
      });

      assert.equal(booking.status, 'confirmed');
      assert.equal(booking.start_time, '2026-09-05T22:00:00.000Z');
      assert.equal(booking.end_time, '2026-09-05T23:00:00.000Z');
    });

    it('B1.3: Attempting to book past operating_hours_end (e.g. 23:00-00:00) does not exist in dynamic slot grid', () => {
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot23 = slots.find((s) => s.time_hhmm === '23:00');
      assert.equal(slot23, undefined, 'No slot starting at 23:00 when venue closes at 23:00');
    });

    it('B1.4: Earliest slot on Court 1 and Court 2 can be booked simultaneously without mutual interference', () => {
      const b1 = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T06:00:00.000Z',
        endTime: '2026-09-05T07:00:00.000Z',
      });

      const b2 = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 2,
        startTime: '2026-09-05T06:00:00.000Z',
        endTime: '2026-09-05T07:00:00.000Z',
      });

      assert.equal(b1.status, 'confirmed');
      assert.equal(b2.status, 'confirmed');
    });

    it('B1.5: 30-min slot venue spanning 06:00 to 07:00 cleanly bounds 06:00-06:30 and 06:30-07:00', () => {
      const miniVenue = harness.createVenue({
        id: 'venue-dawn-cricket',
        name: 'Dawn Club',
        operatingHoursStart: '06:00:00',
        operatingHoursEnd: '07:00:00',
        slotDurationMinutes: 30,
        courtsCount: 1,
      });

      const slots = harness.getVenueSlots({
        venueId: miniVenue.id,
        date: targetDate,
      });

      assert.equal(slots.length, 2);
      assert.equal(slots[0]?.time_hhmm, '06:00');
      assert.equal(slots[0]?.end_time_hhmm, '06:30');
      assert.equal(slots[1]?.time_hhmm, '06:30');
      assert.equal(slots[1]?.end_time_hhmm, '07:00');
    });
  });

  // =========================================================================
  // Area B2: Adjacent Back-to-Back Slots & [) Half-Open Intervals (>=5 tests)
  // =========================================================================
  describe('B2: Adjacent Back-to-Back Slots & [) Half-Open Interval Semantics', () => {
    it('B2.1: Adjacent slots (10:00-11:00) and (11:00-12:00) on the same court succeed with zero conflict', () => {
      const b1 = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      const b2 = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T11:00:00.000Z',
        endTime: '2026-09-05T12:00:00.000Z',
      });

      assert.equal(b1.status, 'confirmed');
      assert.equal(b2.status, 'confirmed');
    });

    it('B2.2: Booking adjacent slots in reverse order (11:00-12:00 first, then 10:00-11:00 second) succeeds', () => {
      const b2 = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T11:00:00.000Z',
        endTime: '2026-09-05T12:00:00.000Z',
      });

      const b1 = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      assert.equal(b2.status, 'confirmed');
      assert.equal(b1.status, 'confirmed');
    });

    it('B2.3: Overlapping start conflict (10:30-11:30) with existing (10:00-11:00) raises SLOT_ALREADY_TAKEN (23P01)', () => {
      // Existing booking 10:00 to 11:00
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      // Partial overlap: 10:30 to 11:30 (on 30-min divisibility if 30-min venue or 60 min spanning 10:30-11:30)
      // On our 60 min venue, 10:30-11:30 would be 60 min, but overlaps with 10:00-11:00
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:30:00.000Z',
            endTime: '2026-09-05T11:30:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
      );
    });

    it('B2.4: Enclosing interval conflict (09:00-12:00) enclosing existing (10:00-11:00) raises SLOT_ALREADY_TAKEN (23P01)', () => {
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      // Attempt 3-hour booking 09:00 to 12:00
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T09:00:00.000Z',
            endTime: '2026-09-05T12:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
      );
    });

    it('B2.5: Sub-interval conflict (10:15-10:45) inside existing (10:00-11:00) raises exclusion violation', () => {
      // Use 30-min venue to test sub-slot overlap
      const subVenue = harness.createVenue({
        id: 'venue-30-sub',
        name: '30 Min Arena',
        operatingHoursStart: '10:00:00',
        operatingHoursEnd: '12:00:00',
        slotDurationMinutes: 30,
        courtsCount: 1,
      });

      // Book 10:00 to 11:00 (60 mins = 2 x 30 min)
      harness.bookVenueSlot({
        venueId: subVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      // Attempt 10:30 to 11:00 (sub-interval)
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: subVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:30:00.000Z',
            endTime: '2026-09-05T11:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
      );
    });

    it('B2.6: Triple back-to-back sandwich: booking 08:00-09:00 and 10:00-11:00 allows booking middle slot 09:00-10:00', () => {
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T08:00:00.000Z',
        endTime: '2026-09-05T09:00:00.000Z',
      });

      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      // Middle slot 09:00-10:00 shares upper boundary with 08:00-09:00 and lower with 10:00-11:00
      const middleBooking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T09:00:00.000Z',
        endTime: '2026-09-05T10:00:00.000Z',
      });

      assert.equal(middleBooking.status, 'confirmed');
    });
  });

  // =========================================================================
  // Area B3: Past Time Slots & Grace Periods (>=5 tests)
  // =========================================================================
  describe('B3: Past Time Slots & Grace Period Handling', () => {
    it('B3.1: Attempting to book a slot that occurred yesterday throws CANNOT_BOOK_PAST (23514)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-04T10:00:00.000Z',
            endTime: '2026-09-04T11:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'CANNOT_BOOK_PAST',
      );
    });

    it('B3.2: Attempting to book a slot more than 5 minutes in the past today throws CANNOT_BOOK_PAST (23514)', () => {
      // Mock time is 05:00 UTC. Attempting 04:00 to 05:00 is strictly > 5 mins past
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T04:00:00.000Z',
            endTime: '2026-09-05T05:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'CANNOT_BOOK_PAST',
      );
    });

    it('B3.3: Slot starting 3 minutes ago (within 5-minute network grace threshold) is accepted', () => {
      // Mock time: 10:03 UTC. Slot start: 10:00 UTC (3 mins ago)
      harness.setMockTime(new Date('2026-09-05T10:03:00.000Z'));

      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      assert.equal(booking.status, 'confirmed');
    });

    it('B3.4: Slot starting exactly at 6 minutes ago (exceeding 5-minute grace threshold) is rejected', () => {
      // Mock time: 10:06 UTC. Slot start: 10:00 UTC (6 mins ago)
      harness.setMockTime(new Date('2026-09-05T10:06:00.000Z'));

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T11:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'CANNOT_BOOK_PAST',
      );
    });

    it('B3.5: get_venue_slots marks slots older than 5 minutes as is_available = false', () => {
      // Mock time is 12:10 UTC
      harness.setMockTime(new Date('2026-09-05T12:10:00.000Z'));

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot11 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '11:00');
      const slot13 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '13:00');

      assert.equal(slot11?.is_available, false, '11:00 slot is in past -> disabled');
      assert.equal(slot13?.is_available, true, '13:00 slot is in future -> enabled');
    });
  });

  // =========================================================================
  // Area B4: Single-Court vs Multi-Court Venues (>=5 tests)
  // =========================================================================
  describe('B4: Single-Court vs Multi-Court Venues (1 vs 4 vs 20)', () => {
    it('B4.1: Single court venue (courts_count = 1) books Court 1 successfully', () => {
      const singleVenue = harness.createVenue({
        id: 'venue-single-1',
        name: 'Single Squash Box',
        operatingHoursStart: '08:00:00',
        operatingHoursEnd: '12:00:00',
        slotDurationMinutes: 60,
        courtsCount: 1,
      });

      const booking = harness.bookVenueSlot({
        venueId: singleVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T08:00:00.000Z',
        endTime: '2026-09-05T09:00:00.000Z',
      });

      assert.equal(booking.court_number, 1);
    });

    it('B4.2: Single court venue rejects attempt to book Court 2 with INVALID_COURT_NUMBER (23514)', () => {
      const singleVenue = harness.createVenue({
        id: 'venue-single-2',
        name: 'Single Squash Box',
        operatingHoursStart: '08:00:00',
        operatingHoursEnd: '12:00:00',
        slotDurationMinutes: 60,
        courtsCount: 1,
      });

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: singleVenue.id,
            courtNumber: 2,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_COURT_NUMBER',
      );
    });

    it('B4.3: 4-court venue accepts bookings on Courts 1, 2, 3, and 4 simultaneously for the same time slot', () => {
      const quadVenue = harness.createVenue({
        id: 'venue-quad-complex',
        name: 'Quad Complex',
        operatingHoursStart: '08:00:00',
        operatingHoursEnd: '12:00:00',
        slotDurationMinutes: 60,
        courtsCount: 4,
      });

      for (let c = 1; c <= 4; c++) {
        const b = harness.bookVenueSlot({
          venueId: quadVenue.id,
          courtNumber: c,
          startTime: '2026-09-05T08:00:00.000Z',
          endTime: '2026-09-05T09:00:00.000Z',
        });
        assert.equal(b.status, 'confirmed');
        assert.equal(b.court_number, c);
      }
    });

    it('B4.4: 4-court venue rejects booking on Court 5 with INVALID_COURT_NUMBER (23514)', () => {
      const quadVenue = harness.createVenue({
        id: 'venue-quad-bounds',
        name: 'Quad Complex',
        operatingHoursStart: '08:00:00',
        operatingHoursEnd: '12:00:00',
        slotDurationMinutes: 60,
        courtsCount: 4,
      });

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: quadVenue.id,
            courtNumber: 5,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_COURT_NUMBER',
      );
    });

    it('B4.5: Maximum capacity venue (courts_count = 20) supports booking Court 20 and rejects Court 21', () => {
      const megaVenue = harness.createVenue({
        id: 'venue-mega-hub',
        name: 'Mega Sports Hub',
        operatingHoursStart: '06:00:00',
        operatingHoursEnd: '10:00:00',
        slotDurationMinutes: 60,
        courtsCount: 20,
      });

      // Court 20 succeeds
      const b20 = harness.bookVenueSlot({
        venueId: megaVenue.id,
        courtNumber: 20,
        startTime: '2026-09-05T06:00:00.000Z',
        endTime: '2026-09-05T07:00:00.000Z',
      });
      assert.equal(b20.court_number, 20);

      // Court 21 is rejected
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: megaVenue.id,
            courtNumber: 21,
            startTime: '2026-09-05T06:00:00.000Z',
            endTime: '2026-09-05T07:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_COURT_NUMBER',
      );
    });
  });

  // =========================================================================
  // Area B5: Invalid Inputs & Error Validation (>=5 tests)
  // =========================================================================
  describe('B5: Input Validation & Edge Error Codes', () => {
    it('B5.1: Court number 0 is rejected with INVALID_COURT_NUMBER (23514)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 0,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_COURT_NUMBER',
      );
    });

    it('B5.2: Negative court number is rejected with INVALID_COURT_NUMBER (23514)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: -1,
            startTime: '2026-09-05T08:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_COURT_NUMBER',
      );
    });

    it('B5.3: Reversed time window (end_time < start_time) is rejected with INVALID_TIME_RANGE (23514)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T09:00:00.000Z', // Reversed
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_TIME_RANGE',
      );
    });

    it('B5.4: Equal start and end time (end_time == start_time) is rejected with INVALID_TIME_RANGE (23514)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T10:00:00.000Z', // Zero duration
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_TIME_RANGE',
      );
    });

    it('B5.5: Duration not matching a multiple of slot_duration_minutes (e.g. 45 mins on 60 min venue) is rejected with INVALID_SLOT_DURATION (23514)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: '2026-09-05T10:00:00.000Z',
            endTime: '2026-09-05T10:45:00.000Z', // 45 mins
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_SLOT_DURATION',
      );
    });

    it('B5.6: Malformed ISO timestamp strings are rejected with INVALID_TIMESTAMP (22007)', () => {
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: testVenue.id,
            courtNumber: 1,
            startTime: 'invalid-date-string',
            endTime: '2026-09-05T10:00:00.000Z',
          });
        },
        (err: any) => err.code === '22007' && err.message === 'INVALID_TIMESTAMP',
      );
    });

    it('B5.7: Venue check constraints prevent invalid slot durations (e.g. 15 mins) and invalid court count (e.g. 0 courts)', () => {
      // 15 mins not allowed
      assert.throws(
        () => {
          harness.createVenue({
            id: 'bad-duration-venue',
            name: 'Bad Duration',
            slotDurationMinutes: 15,
          });
        },
        (err: any) => err.code === '23514',
      );

      // 0 courts not allowed
      assert.throws(
        () => {
          harness.createVenue({
            id: 'zero-courts-venue',
            name: 'Zero Courts',
            courtsCount: 0,
          });
        },
        (err: any) => err.code === '23514',
      );
    });
  });
});
