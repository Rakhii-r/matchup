/**
 * Tier 1 Tests: Feature Coverage - Venue Slot Calculation & Court Segmentation
 * 
 * Features tested:
 * - F1: Dynamic slot calculation for venue operating hours (06:00 to 23:00, various slot durations).
 * - F2: Court / box slot segmentation (Court 1 vs Court 2 vs Court N).
 * - F3: Status differentiation (Available vs Booked vs Past).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueBookingHarness,
  type VenueRecord,
} from '../harness/venueBookingHarness';

describe('Tier 1: Dynamic Slot Calculation, Court Segmentation & Status Differentiation', () => {
  let harness: VenueBookingHarness;
  let testVenue: VenueRecord;

  // Standard test anchor: tomorrow at 00:00 UTC
  const fixedNow = new Date('2026-09-05T04:00:00.000Z');
  const targetDate = '2026-09-05';

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(fixedNow);

    // Create active profiles
    harness.createProfile('user-alice', 'Alice Organiser');
    harness.createProfile('user-bob', 'Bob Player');

    // Create 2-court standard venue operating 06:00 to 23:00 (60-min slots)
    testVenue = harness.createVenue({
      id: 'venue-pune-turf',
      name: 'Pune Box Arena',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '23:00:00',
      slotDurationMinutes: 60,
      courtsCount: 2,
      sportTypes: ['box_cricket', 'badminton'],
    });

    harness.setAuthUser('user-alice');
  });

  // =========================================================================
  // Feature 1: Dynamic Slot Calculation for Venue Operating Hours (>=5 tests)
  // =========================================================================
  describe('F1: Dynamic Slot Calculation for Venue Operating Hours', () => {
    it('F1.1: 06:00 to 23:00 with 60-min slots generates exactly 17 slots per court (34 total for 2 courts)', () => {
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      // 23 - 6 = 17 hours, 60 min each = 17 slots per court * 2 courts = 34 slots
      assert.equal(slots.length, 34, 'Expected 34 slots for 2 courts across 17 operating hours');

      const court1Slots = slots.filter((s) => s.court_number === 1);
      const court2Slots = slots.filter((s) => s.court_number === 2);
      assert.equal(court1Slots.length, 17);
      assert.equal(court2Slots.length, 17);

      assert.equal(court1Slots[0]?.time_hhmm, '06:00');
      assert.equal(court1Slots[0]?.end_time_hhmm, '07:00');
      assert.equal(court1Slots[16]?.time_hhmm, '22:00');
      assert.equal(court1Slots[16]?.end_time_hhmm, '23:00');
    });

    it('F1.2: 07:00 to 11:00 with 30-min slots generates exactly 8 slots per court', () => {
      const miniVenue = harness.createVenue({
        id: 'venue-morning-badminton',
        name: 'Morning Shuttle Club',
        operatingHoursStart: '07:00:00',
        operatingHoursEnd: '11:00:00',
        slotDurationMinutes: 30,
        courtsCount: 1,
      });

      const slots = harness.getVenueSlots({
        venueId: miniVenue.id,
        date: targetDate,
      });

      // 4 hours * 2 slots/hour = 8 slots
      assert.equal(slots.length, 8);
      assert.equal(slots[0]?.time_hhmm, '07:00');
      assert.equal(slots[0]?.end_time_hhmm, '07:30');
      assert.equal(slots[7]?.time_hhmm, '10:30');
      assert.equal(slots[7]?.end_time_hhmm, '11:00');
    });

    it('F1.3: 08:00 to 14:00 with 90-min slots generates exactly 4 slots (08:00, 09:30, 11:00, 12:30)', () => {
      const turf90 = harness.createVenue({
        id: 'venue-90min-turf',
        name: 'Full Pitch 90',
        operatingHoursStart: '08:00:00',
        operatingHoursEnd: '14:00:00',
        slotDurationMinutes: 90,
        courtsCount: 1,
      });

      const slots = harness.getVenueSlots({
        venueId: turf90.id,
        date: targetDate,
      });

      assert.equal(slots.length, 4);
      assert.equal(slots[0]?.time_hhmm, '08:00');
      assert.equal(slots[0]?.end_time_hhmm, '09:30');
      assert.equal(slots[1]?.time_hhmm, '09:30');
      assert.equal(slots[1]?.end_time_hhmm, '11:00');
      assert.equal(slots[2]?.time_hhmm, '11:00');
      assert.equal(slots[2]?.end_time_hhmm, '12:30');
      assert.equal(slots[3]?.time_hhmm, '12:30');
      assert.equal(slots[3]?.end_time_hhmm, '14:00');
    });

    it('F1.4: 45-min slots step without exceeding the venue closing boundary', () => {
      // 09:00 to 12:00 (180 mins) / 45 mins = 4 slots: 09:00-09:45, 09:45-10:30, 10:30-11:15, 11:15-12:00
      const venue45 = harness.createVenue({
        id: 'venue-squash-45',
        name: 'Squash Courts',
        operatingHoursStart: '09:00:00',
        operatingHoursEnd: '12:00:00',
        slotDurationMinutes: 45,
        courtsCount: 1,
      });

      const slots = harness.getVenueSlots({
        venueId: venue45.id,
        date: targetDate,
      });

      assert.equal(slots.length, 4);
      assert.equal(slots[0]?.time_hhmm, '09:00');
      assert.equal(slots[0]?.end_time_hhmm, '09:45');
      assert.equal(slots[3]?.time_hhmm, '11:15');
      assert.equal(slots[3]?.end_time_hhmm, '12:00');
    });

    it('F1.5: Slot intervals are strictly contiguous and non-overlapping', () => {
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const court1 = slots.filter((s) => s.court_number === 1);
      for (let i = 0; i < court1.length - 1; i++) {
        const current = court1[i]!;
        const next = court1[i + 1]!;
        // End of slot i must equal start of slot i + 1
        assert.equal(current.end_time, next.start_time, `Discontinuity between slot ${i} and ${i + 1}`);
      }
    });

    it('F1.6: Querying an invalid or non-existent venue throws VENUE_NOT_FOUND', () => {
      assert.throws(
        () => {
          harness.getVenueSlots({
            venueId: 'non-existent-venue-uuid',
            date: targetDate,
          });
        },
        (err: any) => err.code === 'P0002' && err.message === 'VENUE_NOT_FOUND',
      );
    });
  });

  // =========================================================================
  // Feature 2: Court / Box Slot Segmentation (>=5 tests)
  // =========================================================================
  describe('F2: Court / Box Slot Segmentation', () => {
    it('F2.1: Multi-court venue generates independent slot tracks per court with distinct court numbers and labels', () => {
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const court1 = slots.filter((s) => s.court_number === 1);
      const court2 = slots.filter((s) => s.court_number === 2);

      assert.ok(court1.every((s) => s.court_label === 'Court 1'));
      assert.ok(court2.every((s) => s.court_label === 'Court 2'));
      assert.equal(court1.length, court2.length);
    });

    it('F2.2: Booking Court 1 leaves the identical time slot on Court 2 as available', () => {
      // Book Court 1 for 10:00 to 11:00
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
      });

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const c1Slot = slots.find((s) => s.court_number === 1 && s.time_hhmm === '10:00');
      const c2Slot = slots.find((s) => s.court_number === 2 && s.time_hhmm === '10:00');

      assert.ok(c1Slot);
      assert.ok(c2Slot);
      assert.equal(c1Slot.is_available, false, 'Court 1 at 10:00 should be marked booked');
      assert.equal(c2Slot.is_available, true, 'Court 2 at 10:00 must remain available');
    });

    it('F2.3: Booking Court 2 does not mutate or lock Court 1 availability', () => {
      // Book Court 2 for 18:00 to 19:00
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 2,
        startTime: '2026-09-05T18:00:00.000Z',
        endTime: '2026-09-05T19:00:00.000Z',
      });

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const c1Slot = slots.find((s) => s.court_number === 1 && s.time_hhmm === '18:00');
      const c2Slot = slots.find((s) => s.court_number === 2 && s.time_hhmm === '18:00');

      assert.equal(c1Slot?.is_available, true, 'Court 1 at 18:00 must remain free');
      assert.equal(c2Slot?.is_available, false, 'Court 2 at 18:00 should be booked');
    });

    it('F2.4: 4-court venue generates independent slot tracks for all 4 courts (Court 1, 2, 3, 4)', () => {
      const quadVenue = harness.createVenue({
        id: 'venue-quad-turf',
        name: 'Quad Padel Center',
        operatingHoursStart: '08:00:00',
        operatingHoursEnd: '12:00:00', // 4 hours = 4 slots per court
        slotDurationMinutes: 60,
        courtsCount: 4,
      });

      const slots = harness.getVenueSlots({
        venueId: quadVenue.id,
        date: targetDate,
      });

      assert.equal(slots.length, 16, '4 courts * 4 slots = 16 total slots');
      const distinctCourts = Array.from(new Set(slots.map((s) => s.court_number))).sort((a, b) => a - b);
      assert.deepEqual(distinctCourts, [1, 2, 3, 4]);
    });

    it('F2.5: Slots are strictly ordered by court_number asc, then start_time asc', () => {
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      for (let i = 0; i < slots.length - 1; i++) {
        const a = slots[i]!;
        const b = slots[i + 1]!;
        if (a.court_number === b.court_number) {
          assert.ok(
            new Date(a.start_time).getTime() <= new Date(b.start_time).getTime(),
            'Same court must be ordered by start_time asc',
          );
        } else {
          assert.ok(a.court_number < b.court_number, 'Must be ordered by court_number asc');
        }
      }
    });

    it('F2.6: Venue with 1 court (courts_count = 1) generates Court 1 only without extraneous courts', () => {
      const singleVenue = harness.createVenue({
        id: 'venue-single-court',
        name: 'Private Studio Court',
        operatingHoursStart: '10:00:00',
        operatingHoursEnd: '13:00:00',
        slotDurationMinutes: 60,
        courtsCount: 1,
      });

      const slots = harness.getVenueSlots({
        venueId: singleVenue.id,
        date: targetDate,
      });

      assert.equal(slots.length, 3);
      assert.ok(slots.every((s) => s.court_number === 1 && s.court_label === 'Court 1'));
    });
  });

  // =========================================================================
  // Feature 3: Status Differentiation (Available vs Booked vs Past) (>=5 tests)
  // =========================================================================
  describe('F3: Status Differentiation (Available vs Booked vs Past)', () => {
    it('F3.1: Unbooked future slot returns is_available = true and booking_id = null', () => {
      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot14 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '14:00');
      assert.ok(slot14);
      assert.equal(slot14.is_available, true);
      assert.equal(slot14.booking_id, null);
      assert.equal(slot14.is_my_booking, false);
    });

    it('F3.2: Confirmed booked future slot returns is_available = false and assigns booking_id', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T14:00:00.000Z',
        endTime: '2026-09-05T15:00:00.000Z',
      });

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot14 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '14:00');
      assert.ok(slot14);
      assert.equal(slot14.is_available, false);
      assert.equal(slot14.booking_id, booking.id);
    });

    it('F3.3: Current user booking sets is_my_booking = true, whereas other user booking sets is_my_booking = false', () => {
      // Alice books 15:00-16:00
      harness.setAuthUser('user-alice');
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T15:00:00.000Z',
        endTime: '2026-09-05T16:00:00.000Z',
      });

      // Bob books 16:00-17:00
      harness.setAuthUser('user-bob');
      harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T16:00:00.000Z',
        endTime: '2026-09-05T17:00:00.000Z',
      });

      // Inspect from Alice perspective
      harness.setAuthUser('user-alice');
      const slotsAlice = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot15Alice = slotsAlice.find((s) => s.court_number === 1 && s.time_hhmm === '15:00');
      const slot16Alice = slotsAlice.find((s) => s.court_number === 1 && s.time_hhmm === '16:00');

      assert.equal(slot15Alice?.is_my_booking, true, 'Alice booked 15:00 -> is_my_booking must be true');
      assert.equal(slot16Alice?.is_my_booking, false, 'Bob booked 16:00 -> is_my_booking must be false for Alice');

      // Inspect from Bob perspective
      harness.setAuthUser('user-bob');
      const slotsBob = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot15Bob = slotsBob.find((s) => s.court_number === 1 && s.time_hhmm === '15:00');
      const slot16Bob = slotsBob.find((s) => s.court_number === 1 && s.time_hhmm === '16:00');

      assert.equal(slot15Bob?.is_my_booking, false, 'Alice booked 15:00 -> is_my_booking must be false for Bob');
      assert.equal(slot16Bob?.is_my_booking, true, 'Bob booked 16:00 -> is_my_booking must be true for Bob');
    });

    it('F3.4: Past time slots on current date are marked is_available = false (disabled)', () => {
      // Set current mock time to 2026-09-05T10:00:00.000Z (10:00 UTC)
      harness.setMockTime(new Date('2026-09-05T10:00:00.000Z'));

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      // Slots at 06:00, 07:00, 08:00 are in the past
      const slot06 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '06:00');
      const slot08 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '08:00');
      // Slot at 11:00 is in the future
      const slot11 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '11:00');

      assert.equal(slot06?.is_available, false, '06:00 slot is in past -> unavailable');
      assert.equal(slot08?.is_available, false, '08:00 slot is in past -> unavailable');
      assert.equal(slot11?.is_available, true, '11:00 slot is in future -> available');
    });

    it('F3.5: Entire past date returns all slots with is_available = false', () => {
      // Mock time is September 5, querying September 4
      harness.setMockTime(new Date('2026-09-05T12:00:00.000Z'));

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: '2026-09-04',
      });

      assert.equal(slots.length, 34);
      assert.ok(slots.every((s) => s.is_available === false), 'All past date slots must be disabled');
    });

    it('F3.6: Cancelled booking slot immediately reverts to is_available = true', () => {
      const booking = harness.bookVenueSlot({
        venueId: testVenue.id,
        courtNumber: 1,
        startTime: '2026-09-05T19:00:00.000Z',
        endTime: '2026-09-05T20:00:00.000Z',
      });

      // Verify booked
      let slots = harness.getVenueSlots({ venueId: testVenue.id, date: targetDate });
      let slot19 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '19:00');
      assert.equal(slot19?.is_available, false);
      assert.equal(slot19?.booking_id, booking.id);

      // Cancel booking
      harness.cancelVenueBooking(booking.id);

      // Verify instantly available
      slots = harness.getVenueSlots({ venueId: testVenue.id, date: targetDate });
      slot19 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '19:00');
      assert.equal(slot19?.is_available, true, 'Slot must become available immediately after cancellation');
      assert.equal(slot19?.booking_id, null, 'Cancelled booking ID must not bind the slot');
    });

    it('F3.7: Grace period window: slot starting within last 5 minutes remains available for completion', () => {
      // Mock time: 10:03 UTC. Slot 10:00 starts 3 minutes ago (within 5-min grace period)
      harness.setMockTime(new Date('2026-09-05T10:03:00.000Z'));

      const slots = harness.getVenueSlots({
        venueId: testVenue.id,
        date: targetDate,
      });

      const slot10 = slots.find((s) => s.court_number === 1 && s.time_hhmm === '10:00');
      assert.equal(slot10?.is_available, true, 'Slot starting 3 mins ago is within 5-min grace window');
    });
  });
});
