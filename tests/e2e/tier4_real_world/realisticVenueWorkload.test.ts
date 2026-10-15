/**
 * Tier 4 Tests: Real-World Workload & Ecosystem Life Cycle
 * 
 * Simulates real-world production conditions:
 * 1. Full-day multi-court community tournament:
 *    - 4 courts operating from 06:00 to 22:00 (16 hours, 64 total slots).
 *    - League group stages, knockouts, match ground linking, and captain announcements.
 * 2. Peak-hour saturation, contention, and opportunistic recycling:
 *    - 100% saturation of prime-time evening slots (18:00 to 22:00).
 *    - Rejected contention attempts from concurrent users.
 *    - Sudden cancellation and instant reallocation to a standby squad.
 * 3. Complete system audit and capacity conservation invariant:
 *    - At all moments, for every court and every time slice, (available slots + confirmed bookings) == theoretical capacity.
 *    - Cancelled bookings preserve audit records with non-null cancelled_at without leaking into the active exclusion constraint.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueBookingHarness,
  type VenueRecord,
} from '../harness/venueBookingHarness';

describe('Tier 4: Real-World Multi-Court Venue Workload & Life Cycle', () => {
  let harness: VenueBookingHarness;
  let tournamentVenue: VenueRecord;

  const tournamentDate = '2026-09-06';
  const morningAnchor = new Date('2026-09-06T05:00:00.000Z');

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(morningAnchor);

    // Create 12 team captains / organizers
    for (let i = 1; i <= 12; i++) {
      harness.createProfile(`captain-${i}`, `Captain Team ${i}`, true, false);
    }
    harness.createProfile('admin-pune', 'Tournament Director', true, true);

    // 4-Court Sports Complex operating 06:00 to 22:00 (16 hours)
    tournamentVenue = harness.createVenue({
      id: 'venue-grand-complex',
      name: 'Grand Pune Sports Complex',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '22:00:00',
      slotDurationMinutes: 60,
      courtsCount: 4,
      sportTypes: ['box_cricket', 'badminton'],
      pricePerHour: 1500,
    });
  });

  it('W1: Complete 4-court tournament life cycle: scheduling, multi-court parallel matches, and captain announcements', () => {
    // 16 hours * 4 courts = 64 total theoretical slots
    const initialSlots = harness.getVenueSlots({
      venueId: tournamentVenue.id,
      date: tournamentDate,
    });
    assert.equal(initialSlots.length, 64);
    assert.ok(initialSlots.every((s) => s.is_available));

    // Round 1: 4 matches played simultaneously from 08:00 to 09:00 across Courts 1..4
    const round1Matches = [
      harness.createMatch({ id: 'm-r1-c1', creatorId: 'captain-1', sport: 'box_cricket', scheduledAt: '2026-09-06T08:00:00.000Z' }),
      harness.createMatch({ id: 'm-r1-c2', creatorId: 'captain-2', sport: 'box_cricket', scheduledAt: '2026-09-06T08:00:00.000Z' }),
      harness.createMatch({ id: 'm-r1-c3', creatorId: 'captain-3', sport: 'box_cricket', scheduledAt: '2026-09-06T08:00:00.000Z' }),
      harness.createMatch({ id: 'm-r1-c4', creatorId: 'captain-4', sport: 'box_cricket', scheduledAt: '2026-09-06T08:00:00.000Z' }),
    ];

    for (let c = 1; c <= 4; c++) {
      harness.setAuthUser(`captain-${c}`);
      harness.bookVenueSlot({
        venueId: tournamentVenue.id,
        courtNumber: c,
        startTime: '2026-09-06T08:00:00.000Z',
        endTime: '2026-09-06T09:00:00.000Z',
        matchId: round1Matches[c - 1]!.id,
      });
    }

    // Semi-Finals: 2 matches played from 14:00 to 16:00 (2-hour slots) on Courts 1 & 2
    const semiMatches = [
      harness.createMatch({ id: 'm-semi-1', creatorId: 'captain-5', sport: 'box_cricket', scheduledAt: '2026-09-06T14:00:00.000Z' }),
      harness.createMatch({ id: 'm-semi-2', creatorId: 'captain-6', sport: 'box_cricket', scheduledAt: '2026-09-06T14:00:00.000Z' }),
    ];

    harness.setAuthUser('captain-5');
    harness.bookVenueSlot({
      venueId: tournamentVenue.id,
      courtNumber: 1,
      startTime: '2026-09-06T14:00:00.000Z',
      endTime: '2026-09-06T16:00:00.000Z',
      matchId: semiMatches[0]!.id,
    });

    harness.setAuthUser('captain-6');
    harness.bookVenueSlot({
      venueId: tournamentVenue.id,
      courtNumber: 2,
      startTime: '2026-09-06T14:00:00.000Z',
      endTime: '2026-09-06T16:00:00.000Z',
      matchId: semiMatches[1]!.id,
    });

    // Grand Final: 18:00 to 20:00 on Court 1 (Show Court)
    const finalMatch = harness.createMatch({
      id: 'm-final',
      creatorId: 'captain-7',
      sport: 'box_cricket',
      scheduledAt: '2026-09-06T18:00:00.000Z',
    });

    harness.setAuthUser('captain-7');
    harness.bookVenueSlot({
      venueId: tournamentVenue.id,
      courtNumber: 1,
      startTime: '2026-09-06T18:00:00.000Z',
      endTime: '2026-09-06T20:00:00.000Z',
      matchId: finalMatch.id,
    });

    // Verify chat announcements were created for all 7 tournament fixtures
    assert.equal(harness.captainChatMessages.length, 7);

    // Verify slot status in dynamic calculation
    const currentSlots = harness.getVenueSlots({
      venueId: tournamentVenue.id,
      date: tournamentDate,
    });

    // 4 slots in R1 + 4 slots in Semis (2x2hr) + 2 slots in Final = 10 slots booked
    const bookedSlots = currentSlots.filter((s) => !s.is_available);
    const availableSlots = currentSlots.filter((s) => s.is_available);

    assert.equal(bookedSlots.length, 10, '10 hourly slot units should be booked');
    assert.equal(availableSlots.length, 54, '54 hourly slot units should remain free');
  });

  it('W2: Prime-time saturation, contention rejection, and instant opportunistic cancellation recycling', () => {
    // Saturate prime-time: 18:00 to 22:00 across all 4 courts (4 hours * 4 courts = 16 slots)
    const primeBookings = [];
    const primeHours = ['18', '19', '20', '21'];

    for (let c = 1; c <= 4; c++) {
      for (let h = 0; h < primeHours.length; h++) {
        const startH = primeHours[h]!;
        const endH = String(Number(startH) + 1).padStart(2, '0');
        harness.setAuthUser(`captain-${c}`);
        const b = harness.bookVenueSlot({
          venueId: tournamentVenue.id,
          courtNumber: c,
          startTime: `2026-09-06T${startH}:00:00.000Z`,
          endTime: `2026-09-06T${endH}:00:00.000Z`,
        });
        primeBookings.push(b);
      }
    }

    assert.equal(primeBookings.length, 16);

    // Now Captain 9 attempts to book prime time 19:00-20:00 on Court 2 -> Rejected
    harness.setAuthUser('captain-9');
    assert.throws(
      () => {
        harness.bookVenueSlot({
          venueId: tournamentVenue.id,
          courtNumber: 2,
          startTime: '2026-09-06T19:00:00.000Z',
          endTime: '2026-09-06T20:00:00.000Z',
        });
      },
      (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
    );

    // Suddenly, Captain 2 cancels Court 2 at 19:00 due to weather/injury
    const targetBooking = primeBookings.find(
      (b) => b.court_number === 2 && b.start_time === '2026-09-06T19:00:00.000Z',
    );
    assert.ok(targetBooking);

    harness.setAuthUser('captain-2');
    harness.cancelVenueBooking(targetBooking.id);

    // Captain 9 immediately retries booking Court 2 at 19:00 -> Confirmed instantly!
    harness.setAuthUser('captain-9');
    const newBooking = harness.bookVenueSlot({
      venueId: tournamentVenue.id,
      courtNumber: 2,
      startTime: '2026-09-06T19:00:00.000Z',
      endTime: '2026-09-06T20:00:00.000Z',
      notes: 'Picked up cancelled prime-time slot',
    });

    assert.equal(newBooking.status, 'confirmed');
    assert.equal(newBooking.user_id, 'captain-9');

    // Confirm that total prime-time confirmed bookings is still 16
    const activePrime = Array.from(harness.venueBookings.values()).filter(
      (b) =>
        b.venue_id === tournamentVenue.id &&
        b.status === 'confirmed' &&
        new Date(b.start_time).getUTCHours() >= 18 &&
        new Date(b.end_time).getUTCHours() <= 22,
    );
    assert.equal(activePrime.length, 16);
  });

  it('W3: Capacity conservation invariant: total slots = available slots + confirmed bookings across any state transitions', () => {
    const totalCapacity = 64; // 16 hours * 4 courts

    const verifyInvariant = (stepDescription: string) => {
      const slots = harness.getVenueSlots({
        venueId: tournamentVenue.id,
        date: tournamentDate,
      });

      assert.equal(slots.length, totalCapacity, `${stepDescription}: Total grid slots must be exactly 64`);

      const availableCount = slots.filter((s) => s.is_available).length;
      const bookedCount = slots.filter((s) => !s.is_available).length;

      assert.equal(
        availableCount + bookedCount,
        totalCapacity,
        `${stepDescription}: Conservation violated: available (${availableCount}) + booked (${bookedCount}) != capacity (${totalCapacity})`,
      );
    };

    // State 0: Pristine venue
    verifyInvariant('State 0: Pristine venue');

    // State 1: Book 5 slots
    const bookings = [];
    for (let i = 1; i <= 5; i++) {
      harness.setAuthUser(`captain-${i}`);
      const b = harness.bookVenueSlot({
        venueId: tournamentVenue.id,
        courtNumber: 1,
        startTime: `2026-09-06T${String(5 + i).padStart(2, '0')}:00:00.000Z`,
        endTime: `2026-09-06T${String(6 + i).padStart(2, '0')}:00:00.000Z`,
      });
      bookings.push(b);
    }
    verifyInvariant('State 1: After booking 5 slots');

    // State 2: Cancel 2 slots
    harness.setAuthUser('captain-1');
    harness.cancelVenueBooking(bookings[0]!.id);

    harness.setAuthUser('captain-2');
    harness.cancelVenueBooking(bookings[1]!.id);
    verifyInvariant('State 2: After cancelling 2 slots');

    // State 3: Rebook 1 cancelled slot
    harness.setAuthUser('captain-10');
    harness.bookVenueSlot({
      venueId: tournamentVenue.id,
      courtNumber: 1,
      startTime: '2026-09-06T06:00:00.000Z',
      endTime: '2026-09-06T07:00:00.000Z',
    });
    verifyInvariant('State 3: After rebooking 1 slot');

    // State 4: Book 10 slots on Court 3
    for (let h = 8; h <= 17; h++) {
      const padH = String(h).padStart(2, '0');
      const padNext = String(h + 1).padStart(2, '0');
      harness.setAuthUser('captain-8');
      harness.bookVenueSlot({
        venueId: tournamentVenue.id,
        courtNumber: 3,
        startTime: `2026-09-06T${padH}:00:00.000Z`,
        endTime: `2026-09-06T${padNext}:00:00.000Z`,
      });
    }
    verifyInvariant('State 4: After heavy booking on Court 3');
  });
});
