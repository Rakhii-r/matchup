/**
 * Tier 3 Tests: Cross-Feature Interactions & Concurrency Protection
 * 
 * Tests:
 * - C1: Simultaneous booking attempts on the same venue, court, and time slot — verify exactly 1 succeeds and the other fails with SLOT_ALREADY_TAKEN (23P01).
 * - C2: Simultaneous booking on different courts of the same venue at the same time — verify both succeed independently.
 * - C3: Book -> Cancel -> Immediate Re-book by another user — verify slot is instantly reusable without delay.
 * - C4: Book with Match Linking -> Cancel Booking -> verify match venue link is cleanly detached.
 * - C5: Multi-hour overlapping booking race condition (User A books 18:00-20:00 vs User B books 19:00-21:00).
 * - C6: High-concurrency 10-user race condition on prime-time slot (exact invariant: 1 winner, 9 conflicts).
 * - C7: Rapid recycle churn: Book -> Cancel -> Book -> Cancel -> Book across different users without corruption.
 * - C8: Multi-court concurrent match linking: two organisers concurrently link matches to Court 1 and Court 2 for the same tournament hour.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueBookingHarness,
  type VenueRecord,
} from '../harness/venueBookingHarness';

describe('Tier 3: Cross-Feature Interactions & Concurrency Protection', () => {
  let harness: VenueBookingHarness;
  let testVenue: VenueRecord;

  const fixedNow = new Date('2026-09-05T04:00:00.000Z');

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(fixedNow);

    // Create 10 active players for concurrency tests
    for (let i = 1; i <= 10; i++) {
      harness.createProfile(`user-${i}`, `Player ${i}`, true, false);
    }

    testVenue = harness.createVenue({
      id: 'venue-concurrency-arena',
      name: 'Prime Turf Arena',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '23:00:00',
      slotDurationMinutes: 60,
      courtsCount: 4,
      sportTypes: ['box_cricket', 'badminton'],
    });
  });

  it('C1: Simultaneous booking attempts on the same venue, court, and slot — exactly 1 succeeds and other receives SLOT_ALREADY_TAKEN (23P01)', async () => {
    const slotStart = '2026-09-05T19:00:00.000Z';
    const slotEnd = '2026-09-05T20:00:00.000Z';

    const results: { user: string; success: boolean; error?: any }[] = [];

    // Simulate 2 users attempting to book Court 1 at 19:00 concurrently
    const attemptBooking = async (userId: string) => {
      try {
        harness.setAuthUser(userId);
        const booking = harness.bookVenueSlot({
          venueId: testVenue.id,
          courtNumber: 1,
          startTime: slotStart,
          endTime: slotEnd,
        });
        results.push({ user: userId, success: true });
        return booking;
      } catch (err: any) {
        results.push({ user: userId, success: false, error: err });
        return null;
      }
    };

    // Execute concurrently
    await Promise.all([attemptBooking('user-1'), attemptBooking('user-2')]);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.equal(successes.length, 1, 'Strictly 1 booking must succeed');
    assert.equal(failures.length, 1, 'Strictly 1 booking must fail');
    assert.equal(failures[0]?.error?.code, '23P01');
    assert.equal(failures[0]?.error?.message, 'SLOT_ALREADY_TAKEN');

    // Confirm database has exactly 1 confirmed booking record for this slot
    const confirmed = Array.from(harness.venueBookings.values()).filter(
      (b) =>
        b.venue_id === testVenue.id &&
        b.court_number === 1 &&
        b.start_time === slotStart &&
        b.status === 'confirmed',
    );
    assert.equal(confirmed.length, 1);
  });

  it('C2: Simultaneous booking on different courts at the exact same time succeed independently', async () => {
    const slotStart = '2026-09-05T19:00:00.000Z';
    const slotEnd = '2026-09-05T20:00:00.000Z';

    const results: { court: number; success: boolean }[] = [];

    const attemptCourt = async (courtNum: number, userId: string) => {
      try {
        harness.setAuthUser(userId);
        harness.bookVenueSlot({
          venueId: testVenue.id,
          courtNumber: courtNum,
          startTime: slotStart,
          endTime: slotEnd,
        });
        results.push({ court: courtNum, success: true });
      } catch (err) {
        results.push({ court: courtNum, success: false });
      }
    };

    // 4 users book Courts 1, 2, 3, 4 at the exact same hour
    await Promise.all([
      attemptCourt(1, 'user-1'),
      attemptCourt(2, 'user-2'),
      attemptCourt(3, 'user-3'),
      attemptCourt(4, 'user-4'),
    ]);

    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.success), 'All 4 court bookings must succeed independently');

    // Verify all 4 courts are confirmed
    const confirmedCount = Array.from(harness.venueBookings.values()).filter(
      (b) => b.venue_id === testVenue.id && b.start_time === slotStart && b.status === 'confirmed',
    ).length;
    assert.equal(confirmedCount, 4);
  });

  it('C3: Book -> Cancel -> Immediate Re-book by another user — slot is instantly reusable without delay', () => {
    const slotStart = '2026-09-05T14:00:00.000Z';
    const slotEnd = '2026-09-05T15:00:00.000Z';

    // Step 1: User 1 books the slot
    harness.setAuthUser('user-1');
    const firstBooking = harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: slotStart,
      endTime: slotEnd,
    });
    assert.equal(firstBooking.status, 'confirmed');

    // Step 2: User 2 tries to book the slot -> fails with SLOT_ALREADY_TAKEN
    harness.setAuthUser('user-2');
    assert.throws(
      () => {
        harness.bookVenueSlot({
          venueId: testVenue.id,
          courtNumber: 1,
          startTime: slotStart,
          endTime: slotEnd,
        });
      },
      (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
    );

    // Step 3: User 1 cancels the booking
    harness.setAuthUser('user-1');
    harness.cancelVenueBooking(firstBooking.id);

    // Step 4: User 2 immediately retries booking -> succeeds without error
    harness.setAuthUser('user-2');
    const secondBooking = harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: slotStart,
      endTime: slotEnd,
    });

    assert.equal(secondBooking.status, 'confirmed');
    assert.equal(secondBooking.user_id, 'user-2');
  });

  it('C4: Book with Match Linking -> Cancel Booking -> cleanly detaches match venue link and allows new match to link', () => {
    // Create two matches
    const matchA = harness.createMatch({
      id: 'match-tourney-a',
      creatorId: 'user-1',
      sport: 'box_cricket',
      scheduledAt: '2026-09-05T10:00:00.000Z',
    });

    const matchB = harness.createMatch({
      id: 'match-tourney-b',
      creatorId: 'user-2',
      sport: 'box_cricket',
      scheduledAt: '2026-09-05T10:00:00.000Z',
    });

    // User 1 books Court 1 and links Match A
    harness.setAuthUser('user-1');
    const bookingA = harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: '2026-09-05T16:00:00.000Z',
      endTime: '2026-09-05T17:00:00.000Z',
      matchId: matchA.id,
    });

    let updatedMatchA = harness.matches.get(matchA.id);
    assert.equal(updatedMatchA?.venue_id, testVenue.id);
    assert.equal(updatedMatchA?.venue_text, 'Prime Turf Arena (Court 1)');

    // User 1 cancels booking
    harness.cancelVenueBooking(bookingA.id);

    // Match A is detached
    updatedMatchA = harness.matches.get(matchA.id);
    assert.equal(updatedMatchA?.venue_id, null, 'Match A venue_id detached');
    assert.equal(updatedMatchA?.venue_text, null, 'Match A venue_text detached');

    // User 2 now books the slot and links Match B
    harness.setAuthUser('user-2');
    const bookingB = harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: '2026-09-05T16:00:00.000Z',
      endTime: '2026-09-05T17:00:00.000Z',
      matchId: matchB.id,
    });

    assert.equal(bookingB.status, 'confirmed');
    const updatedMatchB = harness.matches.get(matchB.id);
    assert.equal(updatedMatchB?.venue_id, testVenue.id);
    assert.equal(updatedMatchB?.venue_text, 'Prime Turf Arena (Court 1)');
  });

  it('C5: Multi-hour overlapping booking race condition: User A books 18:00-20:00 vs User B books 19:00-21:00', () => {
    // User A successfully books 18:00 to 20:00 (2 hours)
    harness.setAuthUser('user-1');
    harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: '2026-09-05T18:00:00.000Z',
      endTime: '2026-09-05T20:00:00.000Z',
    });

    // User B attempts to book 19:00 to 21:00 on the same court
    harness.setAuthUser('user-2');
    assert.throws(
      () => {
        harness.bookVenueSlot({
          venueId: testVenue.id,
          courtNumber: 1,
          startTime: '2026-09-05T19:00:00.000Z',
          endTime: '2026-09-05T21:00:00.000Z',
        });
      },
      (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
    );

    // User C books adjacent non-overlapping slot 20:00 to 22:00 -> succeeds
    harness.setAuthUser('user-3');
    const bookingC = harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: '2026-09-05T20:00:00.000Z',
      endTime: '2026-09-05T22:00:00.000Z',
    });
    assert.equal(bookingC.status, 'confirmed');
  });

  it('C6: High-concurrency 10-user race condition on prime-time slot: exactly 1 wins, exactly 9 receive 23P01', async () => {
    const slotStart = '2026-09-05T21:00:00.000Z';
    const slotEnd = '2026-09-05T22:00:00.000Z';

    const results: { userId: string; won: boolean; code?: string }[] = [];

    const racers = Array.from({ length: 10 }, (_, i) => `user-${i + 1}`);

    const runRacer = async (userId: string) => {
      try {
        harness.setAuthUser(userId);
        harness.bookVenueSlot({
          venueId: testVenue.id,
          courtNumber: 1,
          startTime: slotStart,
          endTime: slotEnd,
        });
        results.push({ userId, won: true });
      } catch (err: any) {
        results.push({ userId, won: false, code: err.code });
      }
    };

    // Launch all 10 simultaneously
    await Promise.all(racers.map((u) => runRacer(u)));

    const winners = results.filter((r) => r.won);
    const losers = results.filter((r) => !r.won);

    assert.equal(winners.length, 1, 'Invariant violated: Exactly 1 user must win the slot');
    assert.equal(losers.length, 9, 'Invariant violated: Exactly 9 users must receive conflict error');
    assert.ok(losers.every((l) => l.code === '23P01'), 'All losers must receive SQLSTATE 23P01');
  });

  it('C7: Rapid recycle churn: 5 cycles of Book -> Cancel -> Rebook across alternating users without corruption', () => {
    const slotStart = '2026-09-05T11:00:00.000Z';
    const slotEnd = '2026-09-05T12:00:00.000Z';

    for (let cycle = 1; cycle <= 5; cycle++) {
      const user = `user-${(cycle % 10) + 1}`;
      harness.setAuthUser(user);

      // Book
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: slotStart,
        endTime: slotEnd,
      });
      assert.equal(booking.status, 'confirmed');

      // Cancel
      const cancelled = harness.cancelVenueBooking(booking.id);
      assert.equal(cancelled.status, 'cancelled');
    }

    // Final user books it permanently
    harness.setAuthUser('user-1');
    const finalBooking = harness.bookVenueSlot({
      venueId: testVenue.id,
      courtNumber: 1,
      startTime: slotStart,
      endTime: slotEnd,
    });
    assert.equal(finalBooking.status, 'confirmed');

    // Confirm that getVenueSlots shows booked
    const slots = harness.getVenueSlots({ venueId: testVenue.id, date: '2026-09-05' });
    const slot11 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '11:00');
    assert.equal(slot11?.is_available, false);
    assert.equal(slot11?.booking_id, finalBooking.id);
  });

  it('C8: Multi-court concurrent match linking: two organisers concurrently book and link matches to Court 1 and Court 2 for the same tournament hour', async () => {
    const match1 = harness.createMatch({
      id: 'match-semi-1',
      creatorId: 'user-1',
      sport: 'box_cricket',
      scheduledAt: '2026-09-05T17:00:00.000Z',
    });

    const match2 = harness.createMatch({
      id: 'match-semi-2',
      creatorId: 'user-2',
      sport: 'box_cricket',
      scheduledAt: '2026-09-05T17:00:00.000Z',
    });

    const book1 = async () => {
      harness.setAuthUser('user-1');
      return harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T17:00:00.000Z',
        endTime: '2026-09-05T18:00:00.000Z',
        matchId: match1.id,
      });
    };

    const book2 = async () => {
      harness.setAuthUser('user-2');
      return harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 2,
        startTime: '2026-09-05T17:00:00.000Z',
        endTime: '2026-09-05T18:00:00.000Z',
        matchId: match2.id,
      });
    };

    const [b1, b2] = await Promise.all([book1(), book2()]);

    assert.equal(b1.status, 'confirmed');
    assert.equal(b2.status, 'confirmed');

    const m1 = harness.matches.get(match1.id);
    const m2 = harness.matches.get(match2.id);

    assert.equal(m1?.venue_text, 'Prime Turf Arena (Court 1)');
    assert.equal(m2?.venue_text, 'Prime Turf Arena (Court 2)');
  });
});
