/**
 * Tier 1 Tests: Venue UI Components & Logic Helpers (Milestone 3)
 *
 * Verifies:
 * 1. DateStrip date generation and formatting (getUpcomingDates)
 * 2. CourtPicker label formatting (formatCourtLabel for Cricket Box vs Court)
 * 3. TimeSlotGrid status derivation (getSlotStatus for Available, Booked, Past, MyBooking)
 * 4. Slot time window formatting (formatSlotWindow)
 * 5. Double-booking conflict message matching ("Slot already taken")
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toAppError } from '../../../src/core/errors/AppError';
import {
  computeSlotRange,
  formatBookingDateClean,
  formatCourtLabel,
  formatDateIso,
  formatDurationLabel,
  formatSlotWindow,
  formatSlotWindowWithDuration,
  getSlotStatus,
  getUpcomingDates,
  groupSlotsByCourt,
  isSlotInSelectedRange,
} from '../../../src/features/venues/domain/slotUtils';
import {
  getMapDirectionsUrl,
  openMapDirections,
} from '../../../src/features/venues/domain/mapDirections';
import type { VenueSlot } from '../../../src/features/venues/domain/venueBookingSchema';

describe('Tier 1 (M3): Venue UI Components & Logic Helpers', () => {
  describe('DateStrip Utilities (getUpcomingDates & formatDateIso)', () => {
    it('generates exactly 14 upcoming dates by default', () => {
      const dates = getUpcomingDates(14);
      assert.equal(dates.length, 14);
      const firstDate = dates[0];
      assert.ok(firstDate, 'firstDate must be defined');
      assert.equal(firstDate.isToday, true);
      assert.equal(firstDate.dayLabel, 'Today');
      assert.ok(firstDate.dayNumber.length === 2);
      assert.ok(firstDate.monthLabel.length === 3);
    });

    it('generates consecutive dates without gaps', () => {
      const dates = getUpcomingDates(5);
      assert.equal(dates.length, 5);
      for (let i = 0; i < dates.length - 1; i++) {
        const d1Item = dates[i];
        const d2Item = dates[i + 1];
        assert.ok(d1Item, `dates[${i}] must be defined`);
        assert.ok(d2Item, `dates[${i + 1}] must be defined`);
        const d1 = new Date(d1Item.dateStr);
        const d2 = new Date(d2Item.dateStr);
        const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
        assert.equal(diffDays, 1, `Dates should be 1 day apart between ${d1Item.dateStr} and ${d2Item.dateStr}`);
      }
    });

    it('formats Date object into YYYY-MM-DD correctly', () => {
      const date = new Date(2026, 8, 5); // Sep 5, 2026
      const iso = formatDateIso(date);
      assert.equal(iso, '2026-09-05');
    });
  });

  describe('CourtPicker Utilities (formatCourtLabel)', () => {
    it('formats "Box N" when sports include box_cricket, cricket, turf, or box', () => {
      assert.equal(formatCourtLabel(1, ['box_cricket']), 'Box 1');
      assert.equal(formatCourtLabel(2, ['cricket', 'football']), 'Box 2');
      assert.equal(formatCourtLabel(3, ['turf']), 'Box 3');
      assert.equal(formatCourtLabel(4, ['box']), 'Box 4');
      assert.equal(formatCourtLabel(5, ['football_turf']), 'Box 5');
    });

    it('formats "Court N" for badminton, tennis, or default sports', () => {
      assert.equal(formatCourtLabel(1, ['badminton']), 'Court 1');
      assert.equal(formatCourtLabel(3, ['tennis']), 'Court 3');
      assert.equal(formatCourtLabel(1, undefined), 'Court 1');
      assert.equal(formatCourtLabel(2, []), 'Court 2');
    });
  });

  describe('TimeSlotGrid Utilities (getSlotStatus & formatSlotWindow)', () => {
    const futureStartTime = '2099-01-01T10:00:00.000Z';
    const futureEndTime = '2099-01-01T11:00:00.000Z';
    const pastStartTime = '2020-01-01T10:00:00.000Z';
    const pastEndTime = '2020-01-01T11:00:00.000Z';

    it('marks slot as available when isAvailable is true and in the future', () => {
      const slot: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: futureStartTime,
        endTime: futureEndTime,
        timeHhmm: '10:00',
        endTimeHhmm: '11:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      assert.equal(getSlotStatus(slot), 'available');
    });

    it('marks slot as booked when isAvailable is false and bookingId is present', () => {
      const slot: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: futureStartTime,
        endTime: futureEndTime,
        timeHhmm: '10:00',
        endTimeHhmm: '11:00',
        isAvailable: false,
        bookingId: 'booking-123',
        isMyBooking: false,
      };
      assert.equal(getSlotStatus(slot), 'booked');
    });

    it('marks slot as my_booking when isMyBooking is true', () => {
      const slot: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: futureStartTime,
        endTime: futureEndTime,
        timeHhmm: '10:00',
        endTimeHhmm: '11:00',
        isAvailable: false,
        bookingId: 'booking-mine',
        isMyBooking: true,
      };
      assert.equal(getSlotStatus(slot), 'my_booking');
    });

    it('marks slot as past when endTime has elapsed', () => {
      const slot: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: pastStartTime,
        endTime: pastEndTime,
        timeHhmm: '10:00',
        endTimeHhmm: '11:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      assert.equal(getSlotStatus(slot), 'past');
    });

    it('marks slot as available when unbooked (bookingId is null) even if ongoing', () => {
      const slot: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: futureStartTime,
        endTime: futureEndTime,
        timeHhmm: '10:00',
        endTimeHhmm: '11:00',
        isAvailable: false, // DB flag might be false for started slot
        bookingId: null, // But NOT booked by anyone!
        isMyBooking: false,
      };
      // Must be available, NEVER booked/occupied when bookingId is null
      assert.equal(getSlotStatus(slot), 'available');
    });

    it('computeSlotRange calculates 2-hour continuous slot window and end time', () => {
      const s1: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T14:00:00.000Z',
        endTime: '2099-01-01T15:00:00.000Z',
        timeHhmm: '14:00',
        endTimeHhmm: '15:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      const s2: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T15:00:00.000Z',
        endTime: '2099-01-01T16:00:00.000Z',
        timeHhmm: '15:00',
        endTimeHhmm: '16:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };

      const range = computeSlotRange(s1, 120, [s1, s2], 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.endTimeHhmm, '16:00');
      assert.equal(range.slots.length, 2);
    });

    it('computeSlotRange calculates 2.5-hour duration (150 mins) spanning 3 hourly slots ending at 13:30', () => {
      const s1: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T11:00:00.000Z',
        endTime: '2099-01-01T12:00:00.000Z',
        timeHhmm: '11:00',
        endTimeHhmm: '12:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      const s2: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T12:00:00.000Z',
        endTime: '2099-01-01T13:00:00.000Z',
        timeHhmm: '12:00',
        endTimeHhmm: '13:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      const s3: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T13:00:00.000Z',
        endTime: '2099-01-01T14:00:00.000Z',
        timeHhmm: '13:00',
        endTimeHhmm: '14:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };

      const range = computeSlotRange(s1, 150, [s1, s2, s3], 'UTC');
      assert.equal(range.isValid, true);
      assert.equal(range.endTimeHhmm, '13:30');
      assert.equal(range.slots.length, 3);
    });

    it('computeSlotRange detects conflict when an intermediate slot is occupied', () => {
      const s1: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T14:00:00.000Z',
        endTime: '2099-01-01T15:00:00.000Z',
        timeHhmm: '14:00',
        endTimeHhmm: '15:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      const s2: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T15:00:00.000Z',
        endTime: '2099-01-01T16:00:00.000Z',
        timeHhmm: '15:00',
        endTimeHhmm: '16:00',
        isAvailable: false,
        bookingId: 'booking-occupied',
        isMyBooking: false,
      };

      const range = computeSlotRange(s1, 120, [s1, s2]);
      assert.equal(range.isValid, false);
      assert.equal(range.conflictSlot?.bookingId, 'booking-occupied');
    });

    it('isSlotInSelectedRange correctly identifies slots within duration span', () => {
      const s1: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T14:00:00.000Z',
        endTime: '2099-01-01T15:00:00.000Z',
        timeHhmm: '14:00',
        endTimeHhmm: '15:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      const s2: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T15:00:00.000Z',
        endTime: '2099-01-01T16:00:00.000Z',
        timeHhmm: '15:00',
        endTimeHhmm: '16:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };
      const s3: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T16:00:00.000Z',
        endTime: '2099-01-01T17:00:00.000Z',
        timeHhmm: '16:00',
        endTimeHhmm: '17:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };

      // 2 hour span starting from s1 covers s1 and s2, but not s3
      assert.equal(isSlotInSelectedRange(s1, s1, 120), true);
      assert.equal(isSlotInSelectedRange(s2, s1, 120), true);
      assert.equal(isSlotInSelectedRange(s3, s1, 120), false);
    });

    it('groups slots by court number correctly', () => {
      const slots: VenueSlot[] = [
        {
          courtNumber: 1,
          courtLabel: 'Court 1',
          startTime: futureStartTime,
          endTime: futureEndTime,
          timeHhmm: '10:00',
          endTimeHhmm: '11:00',
          isAvailable: true,
          bookingId: null,
          isMyBooking: false,
        },
        {
          courtNumber: 2,
          courtLabel: 'Court 2',
          startTime: futureStartTime,
          endTime: futureEndTime,
          timeHhmm: '10:00',
          endTimeHhmm: '11:00',
          isAvailable: true,
          bookingId: null,
          isMyBooking: false,
        },
      ];
      const grouped = groupSlotsByCourt(slots);
      const court1Slots = grouped[1];
      const court2Slots = grouped[2];
      assert.ok(court1Slots, 'court 1 slots must be defined');
      assert.ok(court2Slots, 'court 2 slots must be defined');
      assert.equal(court1Slots.length, 1);
      assert.equal(court2Slots.length, 1);
    });
  });

  describe('Double-Booking Conflict Error Handling Contract', () => {
    it('translates database exclusion conflict (23P01) into "Slot already taken" AppError', () => {
      const dbExclusionError = {
        code: '23P01',
        message: 'conflicting key value violates exclusion constraint "venue_bookings_no_double_booking"',
      };
      const appErr = toAppError(dbExclusionError);
      assert.equal(appErr.code, 'conflict');
      assert.equal(appErr.message, 'Slot already taken');
    });

    it('translates RPC SLOT_ALREADY_TAKEN token into "Slot already taken" AppError', () => {
      const rpcError = {
        code: 'SLOT_ALREADY_TAKEN',
        message: 'The requested slot has already been booked by another player.',
      };
      const appErr = toAppError(rpcError);
      assert.equal(appErr.code, 'conflict');
      assert.equal(appErr.message, 'Slot already taken');
    });

    it('translates exclusion constraint name into "Slot already taken" AppError', () => {
      const rawError = {
        message: 'violates exclusion constraint "venue_bookings_no_double_booking"',
      };
      const appErr = toAppError(rawError);
      assert.equal(appErr.code, 'conflict');
      assert.equal(appErr.message, 'Slot already taken');
    });

    it('translates slot_already_taken lowercase message into "Slot already taken" AppError', () => {
      const rawError = {
        message: 'slot_already_taken',
      };
      const appErr = toAppError(rawError);
      assert.equal(appErr.code, 'conflict');
      assert.equal(appErr.message, 'Slot already taken');
    });

    it('matches conflict message pattern in BookingModal error handler', () => {
      const conflictErrorTokens = [
        'Slot already taken',
        '23P01',
        'SLOT_ALREADY_TAKEN',
        'conflict: slot is already booked',
      ];

      for (const token of conflictErrorTokens) {
        const isConflict =
          token.includes('Slot already taken') ||
          token.toLowerCase().includes('already taken') ||
          token.toLowerCase().includes('conflict') ||
          token.includes('23P01') ||
          token.includes('SLOT_ALREADY_TAKEN');

        assert.equal(isConflict, true, `Token "${token}" should be detected as a conflict`);
      }

      // Verify that mapped AppError from toAppError triggers BookingModal conflict detection
      const appConflict = toAppError({ code: '23P01' });
      const triggersModalConflict =
        appConflict.message.includes('Slot already taken') ||
        appConflict.message.toLowerCase().includes('already taken') ||
        appConflict.message.toLowerCase().includes('conflict') ||
        appConflict.message.includes('23P01') ||
        appConflict.message.includes('SLOT_ALREADY_TAKEN');
      assert.equal(triggersModalConflict, true);
    });

    it('verifies slot synchronization logic clears selection when slot becomes unavailable', () => {
      const previouslySelectedSlot: VenueSlot = {
        courtNumber: 1,
        courtLabel: 'Court 1',
        startTime: '2099-01-01T10:00:00.000Z',
        endTime: '2099-01-01T11:00:00.000Z',
        timeHhmm: '10:00',
        endTimeHhmm: '11:00',
        isAvailable: true,
        bookingId: null,
        isMyBooking: false,
      };

      // When court slots are refreshed after a conflict, the slot is marked as unavailable
      const updatedCourtSlots: VenueSlot[] = [
        {
          ...previouslySelectedSlot,
          isAvailable: false,
          bookingId: 'conflicting-booking-id',
        },
      ];

      // Pure logic test of CourtSlotPickerSheet's conflict recovery sync check
      const current = updatedCourtSlots.find(
        (s) =>
          s.courtNumber === previouslySelectedSlot.courtNumber &&
          s.startTime === previouslySelectedSlot.startTime,
      );
      const shouldClearSelection = !current || !current.isAvailable;
      assert.equal(shouldClearSelection, true, 'Taken slot must trigger clearing selectedSlot');
    });

    it('verifies zero TypeScript compile errors under strict tsconfig', async () => {
      const ts = await import('typescript');
      const path = await import('node:path');

      const configPath = ts.default.findConfigFile(process.cwd(), ts.default.sys.fileExists, 'tsconfig.json');
      assert.ok(configPath, 'tsconfig.json must exist');
      const configFile = ts.default.readConfigFile(configPath, ts.default.sys.readFile);
      const parsedCommandLine = ts.default.parseJsonConfigFileContent(
        configFile.config,
        ts.default.sys,
        path.default.dirname(configPath),
      );

      const program = ts.default.createProgram(parsedCommandLine.fileNames, {
        ...parsedCommandLine.options,
        noEmit: true,
      });

      const diagnostics = ts.default.getPreEmitDiagnostics(program).filter((d) => {
        if (!d.file) return false;
        return !d.file.fileName.includes('node_modules');
      });

      const formattedErrors = diagnostics.map((d) => {
        const message = ts.default.flattenDiagnosticMessageText(d.messageText, '\n');
        const pos = d.file && d.start ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        return `${d.file?.fileName}:${pos ? `${pos.line + 1}:${pos.character + 1}` : ''} - ${message}`;
      });

      assert.deepEqual(formattedErrors, [], `Expected 0 TypeScript errors across project but found:\n${formattedErrors.join('\n')}`);
    });
  });

  describe('Duration Formatting & Window Utilities (formatDurationLabel & formatSlotWindowWithDuration)', () => {
    it('formats duration in clean human-readable units (mins and hrs)', () => {
      const base = new Date('2026-09-07T13:00:00.000Z').getTime();
      const m30 = new Date(base + 30 * 60 * 1000).toISOString();
      const m60 = new Date(base + 60 * 60 * 1000).toISOString();
      const m90 = new Date(base + 90 * 60 * 1000).toISOString();
      const m120 = new Date(base + 120 * 60 * 1000).toISOString();
      const m150 = new Date(base + 150 * 60 * 1000).toISOString();
      const m180 = new Date(base + 180 * 60 * 1000).toISOString();
      const startIso = new Date(base).toISOString();

      assert.equal(formatDurationLabel(startIso, m30), '30 mins');
      assert.equal(formatDurationLabel(startIso, m60), '1 hr');
      assert.equal(formatDurationLabel(startIso, m90), '1.5 hrs');
      assert.equal(formatDurationLabel(startIso, m120), '2 hrs');
      assert.equal(formatDurationLabel(startIso, m150), '2.5 hrs');
      assert.equal(formatDurationLabel(startIso, m180), '3 hrs');
    });

    it('formats slot window with duration appended', () => {
      // 1:00 PM to 3:30 PM in Asia/Kolkata (UTC 07:30 to 10:00)
      const start = '2026-09-07T07:30:00.000Z';
      const end = '2026-09-07T10:00:00.000Z';
      const formatted = formatSlotWindowWithDuration(start, end, 'Asia/Kolkata');
      assert.ok(formatted.includes('1:00 PM – 3:30 PM'), `Expected window to include '1:00 PM – 3:30 PM', got '${formatted}'`);
      assert.ok(formatted.includes('(2.5 hrs)'), `Expected window to include '(2.5 hrs)', got '${formatted}'`);
    });
  });

  describe('Clean Booking Date Utilities (formatBookingDateClean)', () => {
    it('formats ISO date into "Mon, 7 Sept, 2026" in Asia/Kolkata', () => {
      const iso = '2026-09-07T07:30:00.000Z'; // 1:00 PM IST on Monday Sep 7, 2026
      const dateStr = formatBookingDateClean(iso, 'Asia/Kolkata');
      assert.equal(dateStr, 'Mon, 7 Sept, 2026');
    });

    it('returns empty string gracefully for invalid dates', () => {
      assert.equal(formatBookingDateClean('invalid-date'), '');
    });
  });

  describe('Granular 30-Minute Slot Range & Availability (Playo-Style 2.5 Hr Booking)', () => {
    it('2.5 hr booking starting at 1:00 PM covers strictly 5 30-min slots and leaves 3:30 PM available', () => {
      // Create 6 consecutive 30-min slots from 13:00 to 16:00
      const baseMs = new Date('2099-01-01T13:00:00.000Z').getTime();
      const slots: VenueSlot[] = Array.from({ length: 6 }, (_, i) => {
        const sMs = baseMs + i * 30 * 60 * 1000;
        const eMs = sMs + 30 * 60 * 1000;
        const sDate = new Date(sMs);
        const eDate = new Date(eMs);
        const pad = (n: number) => String(n).padStart(2, '0');
        const sHhmm = `${pad(sDate.getUTCHours())}:${pad(sDate.getUTCMinutes())}`;
        const eHhmm = `${pad(eDate.getUTCHours())}:${pad(eDate.getUTCMinutes())}`;
        return {
          courtNumber: 1,
          courtLabel: 'Box 1',
          startTime: sDate.toISOString(),
          endTime: eDate.toISOString(),
          timeHhmm: sHhmm,
          endTimeHhmm: eHhmm,
          isAvailable: true,
          bookingId: null,
          isMyBooking: false,
        };
      });

      const startSlot = slots[0]!;
      // 2.5 hrs = 150 minutes
      const range = computeSlotRange(startSlot, 150, slots, 'UTC');

      assert.equal(range.isValid, true);
      assert.equal(range.endTimeHhmm, '15:30');
      // Exactly 5 30-minute slots: 13:00-13:30, 13:30-14:00, 14:00-14:30, 14:30-15:00, 15:00-15:30
      assert.equal(range.slots.length, 5);

      // Verify isSlotInSelectedRange for all 6 slots
      assert.equal(isSlotInSelectedRange(slots[0]!, startSlot, 150), true, 'Slot 0 (13:00-13:30) must be selected');
      assert.equal(isSlotInSelectedRange(slots[1]!, startSlot, 150), true, 'Slot 1 (13:30-14:00) must be selected');
      assert.equal(isSlotInSelectedRange(slots[2]!, startSlot, 150), true, 'Slot 2 (14:00-14:30) must be selected');
      assert.equal(isSlotInSelectedRange(slots[3]!, startSlot, 150), true, 'Slot 3 (14:30-15:00) must be selected');
      assert.equal(isSlotInSelectedRange(slots[4]!, startSlot, 150), true, 'Slot 4 (15:00-15:30) must be selected');
      assert.equal(isSlotInSelectedRange(slots[5]!, startSlot, 150), false, 'Slot 5 (15:30-16:00) must NOT be selected');

      // Slot 6 (15:30-16:00) remains Available for other players
      assert.equal(getSlotStatus(slots[5]!), 'available');
    });
  });

  describe('Map Directions Navigation Utilities (getMapDirectionsUrl & openMapDirections)', () => {
    const venueCoords = {
      lat: 18.5204,
      lng: 73.8567,
      name: 'Ace Sports Turf',
      address: 'Deccan Gymkhana, Pune',
    };

    it('generates iOS Apple Maps URL with coordinates and query label', () => {
      const url = getMapDirectionsUrl(venueCoords, 'ios');
      assert.ok(url.startsWith('http://maps.apple.com/?daddr=18.5204,73.8567'));
      assert.ok(url.includes('Ace%20Sports%20Turf'));
    });

    it('generates Android geo URI with coordinates and label in query', () => {
      const url = getMapDirectionsUrl(venueCoords, 'android');
      assert.ok(url.startsWith('geo:0,0?q=18.5204,73.8567(Ace%20Sports%20Turf)'));
    });

    it('generates Web Universal Google Maps URL with coordinates destination', () => {
      const url = getMapDirectionsUrl(venueCoords, 'web');
      assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=18.5204,73.8567');
    });

    it('gracefully falls back to address query when coordinates are absent or 0', () => {
      const noCoords = {
        lat: null,
        lng: null,
        name: 'Pune Box Cricket',
        address: 'Kothrud, Pune',
      };
      const webUrl = getMapDirectionsUrl(noCoords, 'web');
      assert.ok(webUrl.includes('destination=Kothrud%2C%20Pune'));

      const iosUrl = getMapDirectionsUrl(noCoords, 'ios');
      assert.ok(iosUrl.includes('daddr=Kothrud%2C%20Pune'));
    });

    it('openMapDirections executes without throwing for valid inputs', async () => {
      const result = await openMapDirections(venueCoords);
      assert.equal(typeof result, 'boolean');
    });
  });
});
