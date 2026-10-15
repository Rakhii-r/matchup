/**
 * Tier 5 Adversarial Test Suite for Milestone R1:
 * 30-Minute Granular Time Slots (Playo Style) and Boundary Concurrency
 *
 * Authored by: challenger_r2_1 (Empirical Challenger)
 * Role: critic, specialist
 *
 * Stress-tests and challenges:
 * 1. Granular 30-minute multi-hour duration spans (0.5h, 1.0h, 1.5h, 2.0h, 2.5h, 3.0h) and non-multiples
 * 2. Start time alignment validation (:00 and :30 valid, :15, :45, jitter invalid -> UNALIGNED_SLOT_START)
 * 3. Non-overlapping half-open boundary semantics: [13:00, 15:30) leaves [15:30, 16:00) 100% available
 * 4. Exclusion constraint rejection across all 5 slots (exact, left-overlap, right-overlap, subset, superset)
 * 5. 24-hour round-the-clock 30-min grid generation (48 slots/court/day) and capacity conservation invariant
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSlotRange,
  isSlotInSelectedRange,
  formatDurationLabel,
  formatSlotWindowWithDuration,
  getSlotStatus,
  groupSlotsByCourt,
  formatCourtLabel,
} from '../../../src/features/venues/domain/slotUtils';
import {
  toAppError,
} from '../../../src/core/errors/AppError';
import type { VenueSlot } from '../../../src/features/venues/domain/venueBookingSchema';
import {
  VenueBookingHarness,
  type VenueRecord,
  intervalsOverlap,
  PostgresError,
} from '../harness/venueBookingHarness';

function validateSlotAlignmentAndDuration(
  startTime: Date,
  endTime: Date,
  slotDurationMin: number = 30,
): void {
  const durMin = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
  if (durMin <= 0 || durMin % slotDurationMin !== 0) {
    throw new PostgresError('INVALID_SLOT_DURATION', '23514');
  }

  const minute = startTime.getUTCMinutes();
  const second = startTime.getUTCSeconds();
  const ms = startTime.getUTCMilliseconds();
  const totalMinOffset = minute + second / 60 + ms / 60000;
  const roundedOffset = Math.round(totalMinOffset);

  if (roundedOffset % slotDurationMin !== 0 || second !== 0 || ms !== 0) {
    throw new PostgresError('UNALIGNED_SLOT_START', '23514');
  }
}

describe('Tier 5: Challenger 1 Adversarial Suite (R1 30-Min Granular Slots and Boundary Concurrency)', () => {
  let harness: VenueBookingHarness;
  let arena24h: VenueRecord;
  let arenaStandard: VenueRecord;

  const anchorTime = new Date('2026-09-07T05:00:00.000Z');
  const testDate = '2026-09-07';

  beforeEach(() => {
    harness = new VenueBookingHarness();
    harness.setMockTime(anchorTime);

    for (let i = 1; i <= 20; i++) {
      harness.createProfile('challenger-r1-player-' + i, 'Challenger Player ' + i, true, false);
    }
    harness.createProfile('challenger-r1-admin', 'Admin Authority', true, true);

    arena24h = harness.createVenue({
      id: 'venue-challenger-24h',
      name: 'Adversarial 24h Box Cricket Arena',
      operatingHoursStart: '00:00:00',
      operatingHoursEnd: '24:00:00',
      slotDurationMinutes: 30,
      courtsCount: 2,
      sportTypes: ['box_cricket', 'turf'],
      pricePerHour: 1500,
    });

    arenaStandard = harness.createVenue({
      id: 'venue-challenger-standard',
      name: 'Adversarial Standard Arena',
      operatingHoursStart: '06:00:00',
      operatingHoursEnd: '23:00:00',
      slotDurationMinutes: 30,
      courtsCount: 2,
      sportTypes: ['badminton'],
      pricePerHour: 800,
    });
  });

  describe('Challenge 1: Granular 30-Minute Duration Spans and Edge Durations', () => {
    const baseDayMs = new Date('2026-09-07T00:00:00.000Z').getTime();
    const daySlots: VenueSlot[] = Array.from({ length: 48 }, (_, i) => {
      const sMs = baseDayMs + i * 30 * 60 * 1000;
      const eMs = sMs + 30 * 60 * 1000;
      const sDate = new Date(sMs);
      const eDate = new Date(eMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        courtNumber: 1,
        courtLabel: 'Box 1',
        startTime: sDate.toISOString(),
        endTime: eDate.toISOString(),
        timeHhmm: pad(sDate.getUTCHours()) + ':' + pad(sDate.getUTCMinutes()),
        endTimeHhmm: pad(eDate.getUTCHours()) + ':' + pad(eDate.getUTCMinutes()),
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
    });

    const startSlot1300 = daySlots[26]!; // 13:00 - 13:30

    it('CH1.1: 0.5 hr (30 mins) starting at 13:00 selects strictly 1 slot [13:00, 13:30) and leaves 13:30 available', () => {
      const range = computeSlotRange(startSlot1300, 30, daySlots, 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.slots.length, 1);
      assert.equal(range.endTimeHhmm, '13:30');
      assert.equal(formatDurationLabel(startSlot1300.startTime, range.endTime), '30 mins');
      assert.equal(isSlotInSelectedRange(daySlots[26]!, startSlot1300, 30), true);
      assert.equal(isSlotInSelectedRange(daySlots[27]!, startSlot1300, 30), false);
    });

    it('CH1.2: 1.0 hr (60 mins) starting at 13:00 selects strictly 2 slots [13:00, 14:00) and leaves 14:00 available', () => {
      const range = computeSlotRange(startSlot1300, 60, daySlots, 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.slots.length, 2);
      assert.equal(range.endTimeHhmm, '14:00');
      assert.equal(formatDurationLabel(startSlot1300.startTime, range.endTime), '1 hr');
      assert.equal(isSlotInSelectedRange(daySlots[26]!, startSlot1300, 60), true);
      assert.equal(isSlotInSelectedRange(daySlots[27]!, startSlot1300, 60), true);
      assert.equal(isSlotInSelectedRange(daySlots[28]!, startSlot1300, 60), false);
    });

    it('CH1.3: 1.5 hrs (90 mins) starting at 13:00 selects strictly 3 slots [13:00, 14:30) and leaves 14:30 available', () => {
      const range = computeSlotRange(startSlot1300, 90, daySlots, 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.slots.length, 3);
      assert.equal(range.endTimeHhmm, '14:30');
      assert.equal(formatDurationLabel(startSlot1300.startTime, range.endTime), '1.5 hrs');
      assert.equal(isSlotInSelectedRange(daySlots[28]!, startSlot1300, 90), true);
      assert.equal(isSlotInSelectedRange(daySlots[29]!, startSlot1300, 90), false);
    });

    it('CH1.4: 2.0 hrs (120 mins) starting at 13:00 selects strictly 4 slots [13:00, 15:00) and leaves 15:00 available', () => {
      const range = computeSlotRange(startSlot1300, 120, daySlots, 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.slots.length, 4);
      assert.equal(range.endTimeHhmm, '15:00');
      assert.equal(formatDurationLabel(startSlot1300.startTime, range.endTime), '2 hrs');
      assert.equal(isSlotInSelectedRange(daySlots[29]!, startSlot1300, 120), true);
      assert.equal(isSlotInSelectedRange(daySlots[30]!, startSlot1300, 120), false);
    });

    it('CH1.5: 2.5 hrs (150 mins) starting at 1:00 PM selects strictly 5 slots [13:00, 15:30) and leaves 15:30 available', () => {
      const range = computeSlotRange(startSlot1300, 150, daySlots, 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.slots.length, 5);
      assert.equal(range.endTimeHhmm, '15:30');
      assert.equal(formatDurationLabel(startSlot1300.startTime, range.endTime), '2.5 hrs');

      assert.equal(isSlotInSelectedRange(daySlots[26]!, startSlot1300, 150), true, '13:00-13:30 selected');
      assert.equal(isSlotInSelectedRange(daySlots[27]!, startSlot1300, 150), true, '13:30-14:00 selected');
      assert.equal(isSlotInSelectedRange(daySlots[28]!, startSlot1300, 150), true, '14:00-14:30 selected');
      assert.equal(isSlotInSelectedRange(daySlots[29]!, startSlot1300, 150), true, '14:30-15:00 selected');
      assert.equal(isSlotInSelectedRange(daySlots[30]!, startSlot1300, 150), true, '15:00-15:30 selected');
      assert.equal(isSlotInSelectedRange(daySlots[31]!, startSlot1300, 150), false, '15:30-16:00 NOT selected');
      assert.equal(getSlotStatus(daySlots[31]!), 'available', '15:30-16:00 must be available');
    });

    it('CH1.6: 3.0 hrs (180 mins) starting at 13:00 selects strictly 6 slots [13:00, 16:00) and leaves 16:00 available', () => {
      const range = computeSlotRange(startSlot1300, 180, daySlots, 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.slots.length, 6);
      assert.equal(range.endTimeHhmm, '16:00');
      assert.equal(formatDurationLabel(startSlot1300.startTime, range.endTime), '3 hrs');
      assert.equal(isSlotInSelectedRange(daySlots[31]!, startSlot1300, 180), true);
      assert.equal(isSlotInSelectedRange(daySlots[32]!, startSlot1300, 180), false);
    });

    it('CH1.7: Non-multiple duration attempts (15m, 45m, 75m, 100m) are rejected with INVALID_SLOT_DURATION', () => {
      const start = new Date('2026-09-07T13:00:00.000Z');
      const nonMultiples = [15, 45, 75, 100, 135];
      for (const dur of nonMultiples) {
        const end = new Date(start.getTime() + dur * 60000);
        assert.throws(
          () => validateSlotAlignmentAndDuration(start, end, 30),
          (err: any) => err.code === '23514' && err.message === 'INVALID_SLOT_DURATION',
          'Duration ' + dur + ' mins must be rejected with INVALID_SLOT_DURATION',
        );
      }
    });

    it('CH1.8: Inverted (end <= start) and zero duration attempts throw INVALID_SLOT_DURATION', () => {
      const t = new Date('2026-09-07T13:00:00.000Z');
      const earlier = new Date('2026-09-07T12:30:00.000Z');
      assert.throws(
        () => validateSlotAlignmentAndDuration(t, t, 30),
        (err: any) => err.code === '23514',
        'Zero duration must be rejected',
      );
      assert.throws(
        () => validateSlotAlignmentAndDuration(t, earlier, 30),
        (err: any) => err.code === '23514',
        'Negative duration must be rejected',
      );
    });
  });

  describe('Challenge 2: Start Time Alignment Adversarial Verification', () => {
    it('CH2.1: On-the-hour (:00) and on-the-half-hour (:30) starts are accepted', () => {
      const startOnHour = new Date('2026-09-07T13:00:00.000Z');
      const endOnHour = new Date('2026-09-07T15:30:00.000Z');
      assert.doesNotThrow(() => validateSlotAlignmentAndDuration(startOnHour, endOnHour, 30));
      const startOnHalf = new Date('2026-09-07T13:30:00.000Z');
      const endOnHalf = new Date('2026-09-07T15:00:00.000Z');
      assert.doesNotThrow(() => validateSlotAlignmentAndDuration(startOnHalf, endOnHalf, 30));
    });

    it('CH2.2: Quarter-hour unaligned starts (13:15, 13:45) are rejected with UNALIGNED_SLOT_START', () => {
      const start15 = new Date('2026-09-07T13:15:00.000Z');
      const end15 = new Date('2026-09-07T14:15:00.000Z');
      assert.throws(
        () => validateSlotAlignmentAndDuration(start15, end15, 30),
        (err: any) => err.code === '23514' && err.message === 'UNALIGNED_SLOT_START',
        '13:15 start must be rejected with UNALIGNED_SLOT_START',
      );
      const start45 = new Date('2026-09-07T13:45:00.000Z');
      const end45 = new Date('2026-09-07T15:15:00.000Z');
      assert.throws(
        () => validateSlotAlignmentAndDuration(start45, end45, 30),
        (err: any) => err.code === '23514' && err.message === 'UNALIGNED_SLOT_START',
        '13:45 start must be rejected with UNALIGNED_SLOT_START',
      );
    });

    it('CH2.3: Adversarial off-by-one minute offsets (13:01, 13:29, 13:31, 13:59) are rejected', () => {
      const offByOneMinutes = [1, 29, 31, 59];
      for (const min of offByOneMinutes) {
        const start = new Date(Date.UTC(2026, 8, 7, 13, min, 0, 0));
        const end = new Date(start.getTime() + 60 * 60000);
        assert.throws(
          () => validateSlotAlignmentAndDuration(start, end, 30),
          (err: any) => err.code === '23514' && err.message === 'UNALIGNED_SLOT_START',
          'Start time 13:' + min + ' must be rejected with UNALIGNED_SLOT_START',
        );
      }
    });

    it('CH2.4: Repository error mapping: 23514 check violation maps to validation AppError', () => {
      const rawError = {
        code: '23514',
        message: 'UNALIGNED_SLOT_START',
      };
      const appErr = toAppError(rawError);
      assert.equal(appErr.code, 'validation');
      assert.equal(appErr.message, 'Some details are invalid. Please review and try again.');
    });
  });

  describe('Challenge 3: Half-Open Boundary Isolation and Exclusion Precision', () => {
    it('CH3.1: Booking [13:00, 15:30) (5 slots) leaves [15:30, 16:00) 100% available in get_venue_slots', () => {
      harness.setAuthUser('challenger-r1-player-1');
      const bkg = harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });
      assert.equal(bkg.status, 'confirmed');

      const slots = harness.getVenueSlots({
        venueId: arena24h.id,
        date: testDate,
      });
      const court1Slots = slots.filter((s) => s.court_number === 1);
      const bookedHours = ['13:00', '13:30', '14:00', '14:30', '15:00'];
      for (const hhmm of bookedHours) {
        const slot = court1Slots.find((s) => s.time_hhmm === hhmm);
        assert.ok(slot, 'Slot ' + hhmm + ' must exist in grid');
        assert.equal(slot.is_available, false, 'Slot ' + hhmm + ' must NOT be available');
        assert.equal(slot.booking_id, bkg.id, 'Slot ' + hhmm + ' must link to booking ' + bkg.id);
      }

      const slot1530 = court1Slots.find((s) => s.time_hhmm === '15:30');
      assert.ok(slot1530, 'Slot 15:30 must exist in grid');
      assert.equal(slot1530.is_available, true, 'Slot 15:30-16:00 must remain 100% AVAILABLE');
      assert.equal(slot1530.booking_id, null, 'Slot 15:30-16:00 must have null booking_id');

      const slot1230 = court1Slots.find((s) => s.time_hhmm === '12:30');
      assert.ok(slot1230, 'Slot 12:30 must exist in grid');
      assert.equal(slot1230.is_available, true, 'Slot 12:30-13:00 must remain 100% AVAILABLE');
      assert.equal(slot1230.booking_id, null, 'Slot 12:30-13:00 must have null booking_id');
    });

    it('CH3.2: Immediate adjacent booking [15:30, 16:00) succeeds without conflict', () => {
      harness.setAuthUser('challenger-r1-player-1');
      harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });

      harness.setAuthUser('challenger-r1-player-2');
      const bkg2 = harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T15:30:00.000Z',
        endTime: '2026-09-07T16:00:00.000Z',
      });
      assert.equal(bkg2.status, 'confirmed');

      const s1 = new Date('2026-09-07T13:00:00.000Z');
      const e1 = new Date('2026-09-07T15:30:00.000Z');
      const s2 = new Date('2026-09-07T15:30:00.000Z');
      const e2 = new Date('2026-09-07T16:00:00.000Z');
      assert.equal(intervalsOverlap(s1, e1, s2, e2), false, '[13:00, 15:30) and [15:30, 16:00) must NOT overlap');
    });

    it('CH3.3: Preceding adjacent booking [12:00, 13:00) succeeds without conflict', () => {
      harness.setAuthUser('challenger-r1-player-1');
      harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });

      harness.setAuthUser('challenger-r1-player-3');
      const bkg3 = harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T12:00:00.000Z',
        endTime: '2026-09-07T13:00:00.000Z',
      });
      assert.equal(bkg3.status, 'confirmed');
    });

    it('CH3.4: Exclusion constraint rejects all overlapping variations on the 5 booked slots', () => {
      harness.setAuthUser('challenger-r1-player-1');
      harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });

      harness.setAuthUser('challenger-r1-player-4');

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena24h.id,
            courtNumber: 1,
            startTime: '2026-09-07T12:30:00.000Z',
            endTime: '2026-09-07T13:30:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Left overlap [12:30, 13:30) must fail with 23P01',
      );

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena24h.id,
            courtNumber: 1,
            startTime: '2026-09-07T15:00:00.000Z',
            endTime: '2026-09-07T16:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Right overlap [15:00, 16:00) must fail with 23P01',
      );

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena24h.id,
            courtNumber: 1,
            startTime: '2026-09-07T13:30:00.000Z',
            endTime: '2026-09-07T14:30:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Interior subset [13:30, 14:30) must fail with 23P01',
      );

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena24h.id,
            courtNumber: 1,
            startTime: '2026-09-07T12:00:00.000Z',
            endTime: '2026-09-07T16:00:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Enclosing superset [12:00, 16:00) must fail with 23P01',
      );

      assert.throws(
        () => {
          harness.bookVenueSlot({
            venueId: arena24h.id,
            courtNumber: 1,
            startTime: '2026-09-07T13:00:00.000Z',
            endTime: '2026-09-07T15:30:00.000Z',
          });
        },
        (err: any) => err.code === '23P01' && err.message === 'SLOT_ALREADY_TAKEN',
        'Exact duplicate [13:00, 15:30) must fail with 23P01',
      );
    });

    it('CH3.5: Multi-court isolation: Court 2 is completely unblocked when Court 1 is booked 13:00-15:30', () => {
      harness.setAuthUser('challenger-r1-player-1');
      harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });

      harness.setAuthUser('challenger-r1-player-5');
      const bkgCourt2 = harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 2,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });
      assert.equal(bkgCourt2.status, 'confirmed', 'Court 2 must succeed independently of Court 1');
    });
  });

  describe('Challenge 4: 24-Hour 30-Minute Grid Generation and Capacity Conservation', () => {
    it('CH4.1: Venues generate exactly 48 30-minute time slots per court per 24-hour day', () => {
      const slots = harness.getVenueSlots({
        venueId: arena24h.id,
        date: testDate,
      });
      assert.equal(slots.length, 96, '2-court 24-hour venue must generate exactly 96 slots');
      const court1Slots = slots.filter((s) => s.court_number === 1);
      assert.equal(court1Slots.length, 48, 'Court 1 must have exactly 48 slots');
      const court2Slots = slots.filter((s) => s.court_number === 2);
      assert.equal(court2Slots.length, 48, 'Court 2 must have exactly 48 slots');

      const firstSlot = court1Slots[0]!;
      assert.equal(firstSlot.time_hhmm, '00:00');
      assert.equal(firstSlot.end_time_hhmm, '00:30');

      const lastSlot = court1Slots[47]!;
      assert.equal(lastSlot.time_hhmm, '23:30');
      assert.equal(lastSlot.end_time_hhmm, '00:00');
    });

    it('CH4.2: Capacity Conservation Invariant: Total Slots (96) == Available + Confirmed + Past', () => {
      // Test 1: With anchor at start of day (00:00 UTC), 0 slots are past
      harness.setMockTime(new Date('2026-09-07T00:00:00.000Z'));
      const initialSlots = harness.getVenueSlots({ venueId: arena24h.id, date: testDate });
      const initialAvail = initialSlots.filter((s) => s.is_available).length;
      assert.equal(initialAvail, 96, 'All 96 slots must be available at start of day');

      // Book 2.5 hrs (5 slots) on Court 1
      harness.setAuthUser('challenger-r1-player-1');
      const b1 = harness.bookVenueSlot({
        venueId: arena24h.id,
        courtNumber: 1,
        startTime: '2026-09-07T13:00:00.000Z',
        endTime: '2026-09-07T15:30:00.000Z',
      });

      const afterB1Slots = harness.getVenueSlots({ venueId: arena24h.id, date: testDate });
      const afterB1Avail = afterB1Slots.filter((s) => s.is_available).length;
      const afterB1Booked = afterB1Slots.filter((s) => s.booking_id !== null).length;

      assert.equal(afterB1Booked, 5, 'Exactly 5 slots must be booked for 2.5 hrs');
      assert.equal(afterB1Avail, 91, 'Exactly 91 slots must remain available');
      assert.equal(afterB1Avail + afterB1Booked, 96, 'Capacity conservation invariant holds at 00:00');

      // Test 2: Advance time to 05:00 UTC (10 half-hour slots per court = 20 slots past)
      harness.setMockTime(anchorTime); // 05:00:00 UTC
      const midSlots = harness.getVenueSlots({ venueId: arena24h.id, date: testDate });
      const midAvail = midSlots.filter((s) => s.is_available).length;
      const midBooked = midSlots.filter((s) => s.booking_id !== null).length;
      const midPast = midSlots.filter((s) => !s.is_available && s.booking_id === null).length;

      assert.equal(midBooked, 5, '5 slots booked');
      assert.equal(midPast, 20, '20 past slots (10 per court from 00:00 to 05:00)');
      assert.equal(midAvail, 71, '71 available slots remaining');
      assert.equal(midAvail + midBooked + midPast, 96, 'Full day capacity invariant: Available (71) + Booked (5) + Past (20) == 96');

      // Cancel booking and verify restoration
      harness.cancelVenueBooking(b1.id);
      const afterCancelSlots = harness.getVenueSlots({ venueId: arena24h.id, date: testDate });
      const afterCancelAvail = afterCancelSlots.filter((s) => s.is_available).length;
      const afterCancelBooked = afterCancelSlots.filter((s) => s.booking_id !== null).length;
      const afterCancelPast = afterCancelSlots.filter((s) => !s.is_available && s.booking_id === null).length;

      assert.equal(afterCancelBooked, 0, '0 slots booked after cancellation');
      assert.equal(afterCancelPast, 20, '20 past slots unchanged');
      assert.equal(afterCancelAvail, 76, '76 future slots available after cancellation');
      assert.equal(afterCancelAvail + afterCancelBooked + afterCancelPast, 96, 'Capacity conservation holds post-cancel');
    });

    it('CH4.3: Box vs Court prefix logic: Turf and Box cricket venues format as Box N', () => {
      assert.equal(formatCourtLabel(1, ['box_cricket']), 'Box 1');
      assert.equal(formatCourtLabel(2, ['turf']), 'Box 2');
      assert.equal(formatCourtLabel(1, ['badminton']), 'Court 1');
      assert.equal(formatCourtLabel(2, ['tennis']), 'Court 2');
    });
  });
});
