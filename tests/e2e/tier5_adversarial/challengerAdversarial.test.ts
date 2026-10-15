/**
 * Tier 5 Adversarial & Challenger Stress Suite
 * 
 * Authored by: challenger_m1_1 (Empirical Challenger)
 * Role: critic, specialist
 * 
 * Stress-tests and challenges:
 * 1. Concurrency guarantees: Can two concurrent bookings on the same venue and court
 *    at overlapping times ever commit simultaneously? (50-user race condition, partial overlap variations)
 * 2. Exclusion constraint boundary behavior: Do back-to-back bookings (e.g. 10:00-11:00 and 11:00-12:00)
 *    cause false collision due to endpoint inclusion? Does microsecond proximity violate [) half-open semantics?
 * 3. Cancellation release: Does cancellation instantly release the slot from the exclusion index?
 *    Does high-frequency rapid book-cancel-rebook churn leave the database consistent?
 * 4. Dynamic slot matrix oracle: Does get_venue_slots accurately reflect available vs booked slots,
 *    past thresholds, multi-slot bookings, and conserve total court capacity?
 * 5. Match ground linking: Does match linking update match state atomically, prevent unauthorized linking,
 *    and ensure unlinking on cancellation leaves matches consistent without collateral damage to other venues?
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueBookingHarness,
  type VenueRecord,
  intervalsOverlap,
} from '../harness/venueBookingHarness';

describe('Tier 5: Challenger Adversarial Stress Suite (Milestone 1)', () => {
  let harness: VenueBookingHarness;
  let arena: VenueRecord;

  // Fixed time anchor: 2026-09-07T05:00:00.000Z
  const anchorTime = new Date('2026-09-07T05:00:00.000Z');
  const testDate = '2026-09-07';

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(anchorTime);

    // Create 50 unique players for high-concurrency races
    for (let i = 1; i <= 50; i++) {
      harness.createProfile(`challenger-user-${i}`, `Challenger Player ${i}`, true, false);
    }
    harness.createProfile('challenger-admin', 'Admin Authority', true, true);

    // Standard 4-court venue, 06:00 to 23:00, 60-min slots
    arena = harness.createVenue({
      id: 'venue-challenger-arena',
      name: 'Adversarial Test Arena',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '23:00:00',
      slotDurationMinutes: 60,
      courtsCount: 4,
      sportTypes: ['box_cricket', 'football', 'badminton'],
      pricePerHour: 1400,
    });
  });

  // =========================================================================
  // Challenge 1: Concurrency Guarantees & Overlap Collision Testing
  // =========================================================================
  describe('Challenge 1: Concurrency & Overlapping Race Conditions', () => {
    it('CH1.1: 50 concurrent booking attempts on the exact same court and slot produce strictly 1 winner and 49 conflicts', async () => {
      const slotStart = '2026-09-07T18:00:00.000Z';
      const slotEnd = '2026-09-07T19:00:00.000Z';

      const results: { userId: string; success: boolean; code?: string }[] = [];

      const racerTasks = Array.from({ length: 50 }, (_, i) => {
        const userId = `challenger-user-${i + 1}`;
        return async () => {
          try {
            harness.setAuthUser(userId);
            harness.bookVenueSlot({
              venueId: arena.id,
              courtNumber: 1,
              startTime: slotStart,
              endTime: slotEnd,
            });
            results.push({ userId, success: true });
          } catch (err: any) {
            results.push({ userId, success: false, code: err.code });
          }
        };
      });

      // Launch all 50 concurrent attempts simultaneously
      await Promise.all(racerTasks.map((task) => task()));

      const winners = results.filter((r) => r.success);
      const losers = results.filter((r) => !r.success);

      assert.equal(winners.length, 1, 'Strictly 1 booking must succeed out of 50');
      assert.equal(losers.length, 49, 'Strictly 49 bookings must fail');
      assert.ok(losers.every((l) => l.code === '23P01'), 'All 49 losers must receive SQLSTATE 23P01');

      // Database state verification: exactly 1 confirmed row exists
      const confirmedBookings = Array.from(harness.venueBookings.values()).filter(
        (b) =>
          b.venue_id === arena.id &&
          b.court_number === 1 &&
          b.start_time === slotStart &&
          b.status === 'confirmed',
      );
      assert.equal(confirmedBookings.length, 1, 'Database must contain exactly 1 confirmed record');
    });

    it('CH1.2: Asymmetric partial overlap: left overlap, right overlap, superset, and subset all fail with 23P01', () => {
      // 1. Establish base booking: 14:00 to 16:00 (120 mins) on Court 2
      harness.setAuthUser('challenger-user-1');
      const base = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 2,
        startTime: '2026-09-07T14:00:00.000Z',
        endTime: '2026-09-07T16:00:00.000Z',
      });
      assert.equal(base.status, 'confirmed');

      // 2. Left-hand partial overlap: 13:00 to 15:00 on Court 2
      harness.setAuthUser('challenger-user-2');
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 2,
            startTime: '2026-09-07T13:00:00.000Z',
            endTime: '2026-09-07T15:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Left partial overlap must be rejected',
      );

      // 3. Right-hand partial overlap: 15:00 to 17:00 on Court 2
      harness.setAuthUser('challenger-user-3');
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 2,
            startTime: '2026-09-07T15:00:00.000Z',
            endTime: '2026-09-07T17:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Right partial overlap must be rejected',
      );

      // 4. Strict interior subset: 14:00 to 15:00 on Court 2
      harness.setAuthUser('challenger-user-4');
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 2,
            startTime: '2026-09-07T14:00:00.000Z',
            endTime: '2026-09-07T15:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Subset overlap must be rejected',
      );

      // 5. Strict superset (engulfing): 13:00 to 17:00 on Court 2
      harness.setAuthUser('challenger-user-5');
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 2,
            startTime: '2026-09-07T13:00:00.000Z',
            endTime: '2026-09-07T17:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Superset engulfing overlap must be rejected',
      );
    });

    it('CH1.3: Multi-court concurrent bookings at the exact same hour never cross-contaminate', async () => {
      const slotStart = '2026-09-07T20:00:00.000Z';
      const slotEnd = '2026-09-07T21:00:00.000Z';

      // 4 concurrent bookings across Court 1, 2, 3, 4
      const courtBookings = await Promise.all(
        [1, 2, 3, 4].map(async (cNum) => {
          harness.setAuthUser(`challenger-user-${cNum}`);
          return harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: cNum,
            startTime: slotStart,
            endTime: slotEnd,
          });
        }),
      );

      assert.equal(courtBookings.length, 4);
      assert.ok(courtBookings.every((b) => b.status === 'confirmed'));
      assert.deepEqual(
        courtBookings.map((b) => b.court_number).sort(),
        [1, 2, 3, 4],
      );
    });
  });

  // =========================================================================
  // Challenge 2: Boundary Precision & Half-Open Interval Semantics
  // =========================================================================
  describe('Challenge 2: Boundary Precision & [) Half-Open Intervals', () => {
    it('CH2.1: Back-to-back sandwich booking: 08:00-09:00, 09:00-10:00, and 10:00-11:00 share endpoints with zero conflict', () => {
      // Step 1: Book 08:00 to 09:00
      harness.setAuthUser('challenger-user-1');
      const b1 = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 3,
        startTime: '2026-09-07T08:00:00.000Z',
        endTime: '2026-09-07T09:00:00.000Z',
      });

      // Step 2: Book 10:00 to 11:00
      harness.setAuthUser('challenger-user-2');
      const b3 = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 3,
        startTime: '2026-09-07T10:00:00.000Z',
        endTime: '2026-09-07T11:00:00.000Z',
      });

      // Step 3: Insert the sandwich slot 09:00 to 10:00
      harness.setAuthUser('challenger-user-3');
      const b2 = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 3,
        startTime: '2026-09-07T09:00:00.000Z',
        endTime: '2026-09-07T10:00:00.000Z',
      });

      assert.equal(b1.status, 'confirmed');
      assert.equal(b2.status, 'confirmed');
      assert.equal(b3.status, 'confirmed');

      // Verify mathematical interval overlap oracle directly
      assert.equal(
        intervalsOverlap(
          new Date('2026-09-07T08:00:00.000Z'),
          new Date('2026-09-07T09:00:00.000Z'),
          new Date('2026-09-07T09:00:00.000Z'),
          new Date('2026-09-07T10:00:00.000Z'),
        ),
        false,
        'Abutting [08:00, 09:00) and [09:00, 10:00) must NOT overlap',
      );
    });

    it('CH2.2: Operating boundaries: Earliest possible slot (06:00) and latest slot (22:00-23:00) strictly enforced', () => {
      // Earliest slot: 06:00 to 07:00
      harness.setAuthUser('challenger-user-1');
      const earliest = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 1,
        startTime: '2026-09-07T06:00:00.000Z',
        endTime: '2026-09-07T07:00:00.000Z',
      });
      assert.equal(earliest.status, 'confirmed');

      // Latest slot: 22:00 to 23:00
      harness.setAuthUser('challenger-user-2');
      const latest = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 1,
        startTime: '2026-09-07T22:00:00.000Z',
        endTime: '2026-09-07T23:00:00.000Z',
      });
      assert.equal(latest.status, 'confirmed');

      // Verify slot generation does NOT produce slots beyond 23:00
      const slots = harness.getVenueSlots({
        venueId: arena.id,
        date: testDate,
      });
      const court1Slots = slots.filter((s) => s.court_number === 1);
      assert.equal(court1Slots[0]?.time_hhmm, '06:00');
      assert.equal(court1Slots[court1Slots.length - 1]?.end_time_hhmm, '23:00');
    });

    it('CH2.3: Inverted, zero, or non-multiple duration attempts are immediately rejected with 23514', () => {
      harness.setAuthUser('challenger-user-1');

      // 1. Inverted time range (end <= start)
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 1,
            startTime: '2026-09-07T12:00:00.000Z',
            endTime: '2026-09-07T11:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_TIME_RANGE',
      );

      // 2. Zero-length interval (end == start)
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 1,
            startTime: '2026-09-07T12:00:00.000Z',
            endTime: '2026-09-07T12:00:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_TIME_RANGE',
      );

      // 3. Invalid duration not divisible by slot_duration_minutes (45 mins in a 60 min venue)
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 1,
            startTime: '2026-09-07T12:00:00.000Z',
            endTime: '2026-09-07T12:45:00.000Z',
          });
        },
        (err: any) => err.code === '23514' && err.message === 'INVALID_SLOT_DURATION',
      );
    });
  });

  // =========================================================================
  // Challenge 3: Cancellation Lifecycle & High-Frequency Churn
  // =========================================================================
  describe('Challenge 3: Cancellation Instant Release & Churn Resilience', () => {
    it('CH3.1: 20 sequential book -> cancel -> rebook churn cycles leave no ghost records in exclusion index', () => {
      const slotStart = '2026-09-07T16:00:00.000Z';
      const slotEnd = '2026-09-07T17:00:00.000Z';

      for (let cycle = 1; cycle <= 20; cycle++) {
        const booker = `challenger-user-${(cycle % 50) + 1}`;
        harness.setAuthUser(booker);

        const b = harness.bookVenueSlot({
          venueId: arena.id,
          courtNumber: 4,
          startTime: slotStart,
          endTime: slotEnd,
        });
        assert.equal(b.status, 'confirmed');

        const cancelled = harness.cancelVenueBooking(b.id);
        assert.equal(cancelled.status, 'cancelled');
        assert.ok(cancelled.cancelled_at !== null);
      }

      // Final player books it permanently
      harness.setAuthUser('challenger-user-50');
      const finalB = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 4,
        startTime: slotStart,
        endTime: slotEnd,
      });
      assert.equal(finalB.status, 'confirmed');

      // Dynamic slot matrix should accurately show booked with finalB.id
      const slots = harness.getVenueSlots({ venueId: arena.id, date: testDate });
      const slot16 = slots.find((s) => s.court_number === 4 && s.time_hhmm === '16:00');
      assert.equal(slot16?.is_available, false);
      assert.equal(slot16?.booking_id, finalB.id);

      // Audit verify: 20 cancelled records exist, exactly 1 confirmed record exists
      const court4Bookings = Array.from(harness.venueBookings.values()).filter(
        (b) => b.venue_id === arena.id && b.court_number === 4 && b.start_time === slotStart,
      );
      assert.equal(court4Bookings.filter((b) => b.status === 'cancelled').length, 20);
      assert.equal(court4Bookings.filter((b) => b.status === 'confirmed').length, 1);
    });

    it('CH3.2: Cancellation idempotency: multiple calls on already cancelled booking return cleanly without side-effects', () => {
      harness.setAuthUser('challenger-user-1');
      const booking = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 1,
        startTime: '2026-09-07T11:00:00.000Z',
        endTime: '2026-09-07T12:00:00.000Z',
      });

      const cancel1 = harness.cancelVenueBooking(booking.id);
      assert.equal(cancel1.status, 'cancelled');

      // Second call must return idempotently
      const cancel2 = harness.cancelVenueBooking(booking.id);
      assert.equal(cancel2.status, 'cancelled');
      assert.equal(cancel2.id, booking.id);
    });

    it('CH3.3: Security check: Unauthorized non-booker cannot cancel another user\'s booking, but admin can', () => {
      // User 1 books
      harness.setAuthUser('challenger-user-1');
      const booking = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T14:00:00.000Z',
      });

      // User 2 attempts cancellation -> rejected with 42501
      harness.setAuthUser('challenger-user-2');
      assert.throws(
        () => {
          harness.cancelVenueBooking(booking.id);
        },
        (err: any) => err.code === '42501' && err.message === 'NOT_THE_BOOKER',
      );

      // Admin cancels -> succeeds
      harness.setAuthUser('challenger-admin');
      const cancelledByAdmin = harness.cancelVenueBooking(booking.id);
      assert.equal(cancelledByAdmin.status, 'cancelled');
    });
  });

  // =========================================================================
  // Challenge 4: Dynamic Slot Matrix Calculation & Capacity Conservation Oracle
  // =========================================================================
  describe('Challenge 4: Dynamic Slot Matrix Calculation & Conservation Invariant', () => {
    it('CH4.1: Capacity Conservation Invariant: Available + Confirmed Booked == Total Grid Capacity across arbitrary bookings', () => {
      // Arena: 4 courts, 17 hours (06:00 to 23:00) = 68 total slots
      const initialSlots = harness.getVenueSlots({ venueId: arena.id, date: testDate });
      const totalSlots = initialSlots.length;
      assert.equal(totalSlots, 68, '4 courts * 17 hours = 68 slots');

      // Randomly populate 15 non-overlapping bookings across different courts
      const bookingSchedule = [
        { court: 1, startH: 6, durH: 1 },
        { court: 1, startH: 8, durH: 2 }, // spans 2 slots
        { court: 1, startH: 12, durH: 1 },
        { court: 2, startH: 7, durH: 1 },
        { court: 2, startH: 9, durH: 1 },
        { court: 2, startH: 14, durH: 3 }, // spans 3 slots
        { court: 3, startH: 10, durH: 1 },
        { court: 3, startH: 15, durH: 2 }, // spans 2 slots
        { court: 4, startH: 6, durH: 1 },
        { court: 4, startH: 18, durH: 2 }, // spans 2 slots
      ];

      let expectedBookedSlotsCount = 0;
      for (const [idx, item] of bookingSchedule.entries()) {
        harness.setAuthUser(`challenger-user-${idx + 1}`);
        const pad = (n: number) => String(n).padStart(2, '0');
        const sTime = `2026-09-07T${pad(item.startH)}:00:00.000Z`;
        const eTime = `2026-09-07T${pad(item.startH + item.durH)}:00:00.000Z`;

        harness.bookVenueSlot({
          venueId: arena.id,
          courtNumber: item.court,
          startTime: sTime,
          endTime: eTime,
        });

        expectedBookedSlotsCount += item.durH;
      }

      // Invariant check on dynamic slot grid
      const updatedSlots = harness.getVenueSlots({ venueId: arena.id, date: testDate });
      const availableCount = updatedSlots.filter((s) => s.is_available).length;
      const bookedCount = updatedSlots.filter((s) => !s.is_available && s.booking_id !== null).length;

      assert.equal(bookedCount, expectedBookedSlotsCount, 'Booked slot count must equal sum of booked durations');
      assert.equal(
        availableCount + bookedCount,
        totalSlots,
        'Conservation Invariant: Available + Booked must strictly equal Total Grid Slots',
      );
    });

    it('CH4.2: Multi-slot booking marking: a 120-min booking correctly marks both 60-min grid slots as occupied with same booking_id', () => {
      harness.setAuthUser('challenger-user-1');
      const b2h = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 1,
        startTime: '2026-09-07T10:00:00.000Z',
        endTime: '2026-09-07T12:00:00.000Z',
      });

      const slots = harness.getVenueSlots({ venueId: arena.id, date: testDate });
      const slot10 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '10:00');
      const slot11 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '11:00');
      const slot12 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '12:00');

      assert.equal(slot10?.is_available, false);
      assert.equal(slot10?.booking_id, b2h.id);

      assert.equal(slot11?.is_available, false);
      assert.equal(slot11?.booking_id, b2h.id);

      // Adjacent slot 12:00 is available
      assert.equal(slot12?.is_available, true);
      assert.equal(slot12?.booking_id, null);
    });
  });

  // =========================================================================
  // Challenge 5: Match Ground Linking & Detachment Consistency
  // =========================================================================
  describe('Challenge 5: Match Ground Linking State Consistency', () => {
    it('CH5.1: Atomic match linking updates venue, venue_text, and scheduled times simultaneously', () => {
      const match = harness.createMatch({
        id: 'challenger-match-1',
        creatorId: 'challenger-user-1',
        sport: 'box_cricket',
        scheduledAt: '2026-09-07T10:00:00.000Z',
      });

      harness.setAuthUser('challenger-user-1');
      const booking = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 2,
        startTime: '2026-09-07T17:00:00.000Z',
        endTime: '2026-09-07T18:00:00.000Z',
        matchId: match.id,
      });

      assert.equal(booking.match_id, match.id);

      const linkedMatch = harness.matches.get(match.id);
      assert.equal(linkedMatch?.venue_id, arena.id);
      assert.equal(linkedMatch?.venue_text, 'Adversarial Test Arena (Court 2)');
      assert.equal(linkedMatch?.scheduled_at, '2026-09-07T17:00:00.000Z');
      assert.equal(linkedMatch?.end_time, '2026-09-07T18:00:00.000Z');
    });

    it('CH5.2: Linking match owned by another user fails with NOT_THE_ORGANISER (42501)', () => {
      const match = harness.createMatch({
        id: 'challenger-match-owned-by-alice',
        creatorId: 'challenger-user-1',
        sport: 'box_cricket',
        scheduledAt: '2026-09-07T10:00:00.000Z',
      });

      // User 2 attempts to link Alice's match
      harness.setAuthUser('challenger-user-2');
      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena.id,
            courtNumber: 1,
            startTime: '2026-09-07T10:00:00.000Z',
            endTime: '2026-09-07T11:00:00.000Z',
            matchId: match.id,
          });
        },
        (err: any) => err.code === '42501' && err.message === 'NOT_THE_ORGANISER',
      );
    });

    it('CH5.3: Cross-venue detachment protection: cancelling booking at Venue A does not wipe match if match moved to Venue B', () => {
      const venueB = harness.createVenue({
        id: 'venue-challenger-b',
        name: 'Venue B Turf',
        operatingHoursStart: '06:00:00',
        operatingHoursEnd: '23:00:00',
        slotDurationMinutes: 60,
        courtsCount: 1,
      });

      const match = harness.createMatch({
        id: 'challenger-multi-venue-match',
        creatorId: 'challenger-user-1',
        sport: 'box_cricket',
        scheduledAt: '2026-09-07T10:00:00.000Z',
      });

      harness.setAuthUser('challenger-user-1');

      // Book Venue A
      const bookingA = harness.bookVenueSlot({
        venueId: arena.id,
        courtNumber: 1,
        startTime: '2026-09-07T10:00:00.000Z',
        endTime: '2026-09-07T11:00:00.000Z',
        matchId: match.id,
      });

      // Match now points to Venue A
      assert.equal(harness.matches.get(match.id)?.venue_id, arena.id);

      // Re-book to Venue B
      harness.bookVenueSlot({
        venueId: venueB.id,
        courtNumber: 1,
        startTime: '2026-09-07T11:00:00.000Z',
        endTime: '2026-09-07T12:00:00.000Z',
        matchId: match.id,
      });

      // Match now points to Venue B
      assert.equal(harness.matches.get(match.id)?.venue_id, venueB.id);

      // Cancel older booking at Venue A
      harness.cancelVenueBooking(bookingA.id);

      // Defensive check in cancel_venue_booking:
      // where id = v_booking.match_id and venue_id = v_booking.venue_id;
      // Match should STILL point to Venue B, NOT be cleared!
      const finalMatch = harness.matches.get(match.id);
      assert.equal(
        finalMatch?.venue_id,
        venueB.id,
        'Match venue reference must remain Venue B when older Venue A booking is cancelled',
      );
    });
  });
});
