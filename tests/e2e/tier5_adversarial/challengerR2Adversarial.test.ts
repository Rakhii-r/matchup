/**
 * Tier 5 Adversarial Test Suite for Milestone R2
 * 
 * Authored by: challenger_r2_2 (Empirical Challenger)
 * Role: critic, specialist
 * 
 * Adversarial challenges:
 * 1. Coordinates Edge Cases:
 *    - (0, 0) Null Island coordinates treated as invalid/fallback, avoiding misleading ocean pins
 *    - Null/undefined coordinates with address or name fallback
 *    - Coordinates boundary values: +/-90 lat, +/-180 lng, high-precision floats
 *    - Non-finite numbers (NaN, Infinity) handling
 *    - Completely empty inputs (all null/undefined/whitespace)
 * 2. Special Characters, Escaping & Injection in Venue Name & Address:
 *    - Symbols: &, ?, #, /, \, +, =, %, @, quotes, double quotes
 *    - Emojis & Unicode / Indic scripts (Hindi, Marathi)
 *    - Newlines, tabs, and excess whitespace trimming
 * 3. Platform URL Scheme Verification:
 *    - iOS: Universal Apple Maps link (http://maps.apple.com/?daddr=...&q=...)
 *    - Android: Native geo URI (geo:0,0?q=lat,lng(label))
 *    - Web: Google Maps directions (https://www.google.com/maps/dir/?api=1&destination=...)
 * 4. Venue Labeling & Duration Representation:
 *    - Box vs Court dynamic labeling across sports (case variants, substrings)
 *    - Duration formatting across various time deltas (mins, fractions of hrs, exact hrs)
 *    - Clean Date string formatting (Mon, 7 Sept, 2026)
 * 5. Slot Granularity & Concurrency Oracle:
 *    - Multi-hour 2.5 hr booking exact 5-slot span
 *    - Adjacent slot availability conservation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMapDirectionsUrl,
  openMapDirections,
} from '../../../src/features/venues/domain/mapDirections';
import {
  computeSlotRange,
  formatBookingDateClean,
  formatCourtLabel,
  formatDurationLabel,
  formatSlotWindowWithDuration,
  getSlotStatus,
  isSlotInSelectedRange,
} from '../../../src/features/venues/domain/slotUtils';
import type { VenueSlot } from '../../../src/features/venues/domain/venueBookingSchema';

describe('Tier 5 (R2): Adversarial Stress Suite for My Court Bookings & Directions', () => {

  // =========================================================================
  // Challenge 1: Coordinates Edge Cases & Null Island Defense
  // =========================================================================
  describe('Challenge 1: Coordinates Edge Cases & Null Island Handling', () => {
    it('CH1.1: (0, 0) Null Island coordinates are rejected as coordinates and fallback to address query', () => {
      const params = {
        lat: 0,
        lng: 0,
        address: 'FC Road, Shivaji Nagar, Pune',
        name: 'FC Box Cricket Arena',
      };

      const iosUrl = getMapDirectionsUrl(params, 'ios');
      const androidUrl = getMapDirectionsUrl(params, 'android');
      const webUrl = getMapDirectionsUrl(params, 'web');

      // (0,0) must NOT be in coordinates position
      assert.ok(!iosUrl.includes('daddr=0,0'), 'iOS must not route to (0,0) coords');
      assert.ok(!webUrl.includes('destination=0,0'), 'Web must not route to (0,0) coords');

      // Should fallback to address query
      assert.ok(iosUrl.includes('FC%20Road'), 'iOS should query address');
      assert.ok(androidUrl.includes('FC%20Road'), 'Android should query address');
      assert.ok(webUrl.includes('FC%20Road'), 'Web should query address');
    });

    it('CH1.2: (0, 0) with no address falls back to venue name query', () => {
      const params = {
        lat: 0,
        lng: 0,
        address: null,
        name: 'GreenTurf Sports Arena',
      };

      const webUrl = getMapDirectionsUrl(params, 'web');
      assert.equal(
        webUrl,
        'https://www.google.com/maps/dir/?api=1&destination=GreenTurf%20Sports%20Arena',
      );

      const androidUrl = getMapDirectionsUrl(params, 'android');
      assert.equal(androidUrl, 'geo:0,0?q=GreenTurf%20Sports%20Arena');
    });

    it('CH1.3: (0, 0) with all null/empty fields falls back to universal base Google Maps', () => {
      const params = {
        lat: 0,
        lng: 0,
        address: '   ',
        name: '',
      };

      const iosUrl = getMapDirectionsUrl(params, 'ios');
      const androidUrl = getMapDirectionsUrl(params, 'android');
      const webUrl = getMapDirectionsUrl(params, 'web');

      assert.equal(iosUrl, 'https://www.google.com/maps');
      assert.equal(androidUrl, 'https://www.google.com/maps');
      assert.equal(webUrl, 'https://www.google.com/maps');
    });

    it('CH1.4: Null/undefined coordinates with address query encode correctly across all platforms', () => {
      const params = {
        lat: null,
        lng: undefined,
        address: '123 MG Road, Bengaluru, Karnataka 560001',
        name: 'Metro Badminton Court',
      };

      const ios = getMapDirectionsUrl(params, 'ios');
      const android = getMapDirectionsUrl(params, 'android');
      const web = getMapDirectionsUrl(params, 'web');

      assert.ok(ios.startsWith('http://maps.apple.com/?daddr=123%20MG%20Road'));
      assert.ok(android.startsWith('geo:0,0?q=123%20MG%20Road'));
      assert.ok(web.startsWith('https://www.google.com/maps/dir/?api=1&destination=123%20MG%20Road'));
    });

    it('CH1.5: Valid extreme coordinates (+90/-90 lat, +180/-180 lng) are accepted', () => {
      const northPole = { lat: 90, lng: 0, name: 'North Pole Station' };
      const southPole = { lat: -90, lng: 0, name: 'South Pole Station' };
      const antimeridian = { lat: 18.5204, lng: 180, name: 'Antimeridian Arena' };

      const northWeb = getMapDirectionsUrl(northPole, 'web');
      assert.equal(northWeb, 'https://www.google.com/maps/dir/?api=1&destination=90,0');

      const southWeb = getMapDirectionsUrl(southPole, 'web');
      assert.equal(southWeb, 'https://www.google.com/maps/dir/?api=1&destination=-90,0');

      const antiWeb = getMapDirectionsUrl(antimeridian, 'web');
      assert.equal(antiWeb, 'https://www.google.com/maps/dir/?api=1&destination=18.5204,180');
    });

    it('CH1.6: NaN coordinates fall back gracefully without emitting "NaN" in destination', () => {
      const nanParams = {
        lat: NaN,
        lng: NaN,
        name: 'Ace Turf Arena',
        address: 'Kothrud, Pune',
      };

      const webUrl = getMapDirectionsUrl(nanParams, 'web');
      assert.ok(!webUrl.includes('NaN'), 'URL must not contain NaN');
      assert.ok(webUrl.includes('Kothrud%2C%20Pune'), 'URL must fallback to address');
    });
  });

  // =========================================================================
  // Challenge 2: Special Characters, Escaping & Injection Stress
  // =========================================================================
  describe('Challenge 2: Special Characters, URL Escaping & Injection Resistance', () => {
    it('CH2.1: Ampersands, slashes, hash, and query params in venue name are safely percent-encoded', () => {
      const specialVenue = {
        lat: 19.076,
        lng: 72.8777,
        name: 'Strike & Goal / Box Cricket #1 (Turf?id=42&view=3D)',
        address: 'Bandra West, Mumbai #400050',
      };

      const ios = getMapDirectionsUrl(specialVenue, 'ios');
      const android = getMapDirectionsUrl(specialVenue, 'android');
      const web = getMapDirectionsUrl(specialVenue, 'web');

      // Check query parameter preservation without breaking URL parsing
      assert.ok(ios.includes('%26'), 'Ampersand must be encoded in iOS query');
      assert.ok(ios.includes('%23'), 'Hash symbol must be encoded in iOS query to prevent fragment truncation');
      assert.ok(android.includes('%26'), 'Ampersand must be encoded in Android query');
      assert.ok(web.startsWith('https://www.google.com/maps/dir/?api=1&destination=19.076,72.8777'));
    });

    it('CH2.2: Unicode characters (Indic scripts, emojis) are correctly UTF-8 percent-encoded', () => {
      const indicVenue = {
        lat: null,
        lng: null,
        name: '??????? ?????? ?????? ?????? ????? ????',
        address: '????????, ????',
      };

      const web = getMapDirectionsUrl(indicVenue, 'web');
      const ios = getMapDirectionsUrl(indicVenue, 'ios');
      const android = getMapDirectionsUrl(indicVenue, 'android');

      // Valid URL without crashing and properly encoded
      assert.ok(web.startsWith('https://www.google.com/maps/dir/?api=1&destination=%E0%A4%AC%E0%A4%BE%E0%A4%B2%E0%A5%87%E0%A4%B5%E0%A4%BE%E0%A4%A1%E0%A5%80'));
      assert.ok(ios.includes('%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%B0%E0%A4%AA%E0%A4%A4%E0%A5%80'));
      assert.ok(android.includes('%E0%A4%AC%E0%A4%BE%E0%A4%B2%E0%A5%87%E0%A4%B5%E0%A4%BE%E0%A4%A1%E0%A5%80'));
    });

    it('CH2.3: Multiline address with tabs and excess whitespace is cleanly trimmed', () => {
      const messyParams = {
        lat: null,
        lng: null,
        name: '  Trimmed Arena  \n',
        address: '\n\t  Plot 45, Near IT Park, Hinjawadi Phase 1  \t\n',
      };

      const web = getMapDirectionsUrl(messyParams, 'web');
      assert.ok(web.includes('Plot%2045%2C%20Near%20IT%20Park%2C%20Hinjawadi%20Phase%201'));
      assert.ok(!web.includes('%0A'), 'URL should not contain raw unencoded newlines');
    });

    it('CH2.4: XSS injection attempt string in name and address is sanitized and encoded', () => {
      const xssParams = {
        lat: null,
        lng: null,
        name: '<script>alert("xss")</script>',
        address: '"><img src=x onerror=alert(1)>',
      };

      const web = getMapDirectionsUrl(xssParams, 'web');
      assert.ok(!web.includes('<script>'), 'Unencoded script tags forbidden');
      assert.ok(web.includes('%3Cscript%3E'));
    });
  });

  // =========================================================================
  // Challenge 3: Platform URL Scheme Fidelity
  // =========================================================================
  describe('Challenge 3: Platform URL Schemes (iOS, Android, Web)', () => {
    const sampleCoords = {
      lat: 12.9716,
      lng: 77.5946,
      name: 'Bangalore Turf Club',
      address: 'Race Course Rd, Bengaluru',
    };

    it('CH3.1: iOS generates Apple Maps universal URL with daddr and label query', () => {
      const url = getMapDirectionsUrl(sampleCoords, 'ios');
      assert.ok(url.startsWith('http://maps.apple.com/?daddr=12.9716,77.5946&q=Bangalore%20Turf%20Club'));
    });

    it('CH3.2: Android generates geo URI with 0,0 query and coordinates with label in parentheses', () => {
      const url = getMapDirectionsUrl(sampleCoords, 'android');
      assert.equal(url, 'geo:0,0?q=12.9716,77.5946(Bangalore%20Turf%20Club)');
    });

    it('CH3.3: Web generates universal Google Maps navigation URL with destination coordinates', () => {
      const url = getMapDirectionsUrl(sampleCoords, 'web');
      assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946');
    });

    it('CH3.4: openMapDirections returns false when all parameters are null/empty', async () => {
      const res = await openMapDirections({
        lat: null,
        lng: null,
        address: null,
        name: null,
      });
      assert.equal(res, false, 'openMapDirections must safely return false when no destination info exists');
    });

    it('CH3.5: openMapDirections returns a boolean without throwing in Node environment', async () => {
      const res = await openMapDirections(sampleCoords);
      assert.equal(typeof res, 'boolean');
    });
  });

  // =========================================================================
  // Challenge 4: Box vs Court Labeling & Time Formatting Consistency
  // =========================================================================
  describe('Challenge 4: Box vs Court Labeling & Time Duration Formatting', () => {
    it('CH4.1: Box labeling is applied for all variations of cricket, turf, box', () => {
      assert.equal(formatCourtLabel(1, ['BOX_CRICKET']), 'Box 1');
      assert.equal(formatCourtLabel(2, ['CrIcKeT']), 'Box 2');
      assert.equal(formatCourtLabel(3, ['Indoor_Turf_Cricket']), 'Box 3');
      assert.equal(formatCourtLabel(4, ['box_football']), 'Box 4');
      assert.equal(formatCourtLabel(5, ['open_turf']), 'Box 5');
    });

    it('CH4.2: Court labeling is applied for non-box sports', () => {
      assert.equal(formatCourtLabel(1, ['badminton']), 'Court 1');
      assert.equal(formatCourtLabel(2, ['tennis']), 'Court 2');
      assert.equal(formatCourtLabel(3, ['squash']), 'Court 3');
      assert.equal(formatCourtLabel(4, ['pickleball']), 'Court 4');
      assert.equal(formatCourtLabel(5, []), 'Court 5');
      assert.equal(formatCourtLabel(6, undefined), 'Court 6');
    });

    it('CH4.3: Duration label formatting handles 30m, 1h, 1.5h, 2h, 2.5h, 3h and irregular intervals', () => {
      const start = '2026-09-07T10:00:00.000Z';
      const m30 = '2026-09-07T10:30:00.000Z';
      const m60 = '2026-09-07T11:00:00.000Z';
      const m90 = '2026-09-07T11:30:00.000Z';
      const m120 = '2026-09-07T12:00:00.000Z';
      const m150 = '2026-09-07T12:30:00.000Z';
      const m180 = '2026-09-07T13:00:00.000Z';

      assert.equal(formatDurationLabel(start, m30), '30 mins');
      assert.equal(formatDurationLabel(start, m60), '1 hr');
      assert.equal(formatDurationLabel(start, m90), '1.5 hrs');
      assert.equal(formatDurationLabel(start, m120), '2 hrs');
      assert.equal(formatDurationLabel(start, m150), '2.5 hrs');
      assert.equal(formatDurationLabel(start, m180), '3 hrs');

      // Irregular durations
      const m45 = '2026-09-07T10:45:00.000Z';
      assert.equal(formatDurationLabel(start, m45), '45 mins');
    });

    it('CH4.4: formatSlotWindowWithDuration matches exact Playo requirement: "1:00 PM – 3:30 PM (2.5 hrs)"', () => {
      // 07:30 UTC to 10:00 UTC == 13:00 to 15:30 IST
      const start = '2026-09-07T07:30:00.000Z';
      const end = '2026-09-07T10:00:00.000Z';
      const formatted = formatSlotWindowWithDuration(start, end, 'Asia/Kolkata');
      assert.equal(formatted, '1:00 PM – 3:30 PM (2.5 hrs)');
    });

    it('CH4.5: formatBookingDateClean produces "Mon, 7 Sept, 2026" for September date', () => {
      const dateIso = '2026-09-07T07:30:00.000Z';
      const cleanDate = formatBookingDateClean(dateIso, 'Asia/Kolkata');
      assert.equal(cleanDate, 'Mon, 7 Sept, 2026');
    });
  });

  // =========================================================================
  // Challenge 5: Granular 30-Minute Slot Range & Non-Overlocking Guarantee
  // =========================================================================
  describe('Challenge 5: 30-Minute Slot Math & Non-Overlocking Invariant', () => {
    it('CH5.1: 2.5-hour duration covers strictly 5 slots: 1:00 PM to 3:30 PM, leaving 3:30 PM Available', () => {
      // Create 8 continuous 30-minute slots starting at 13:00 UTC
      const startEpoch = new Date('2026-09-07T13:00:00.000Z').getTime();
      const slots: VenueSlot[] = Array.from({ length: 8 }, (_, i) => {
        const sTime = new Date(startEpoch + i * 30 * 60 * 1000).toISOString();
        const eTime = new Date(startEpoch + (i + 1) * 30 * 60 * 1000).toISOString();
        const pad = (n: number) => String(n).padStart(2, '0');
        const sDate = new Date(sTime);
        const eDate = new Date(eTime);
        return {
          courtNumber: 1,
          courtLabel: 'Box 1',
          startTime: sTime,
          endTime: eTime,
          timeHhmm: `${pad(sDate.getUTCHours())}:${pad(sDate.getUTCMinutes())}`,
          endTimeHhmm: `${pad(eDate.getUTCHours())}:${pad(eDate.getUTCMinutes())}`,
          isAvailable: true,
          bookingId: null,
          isMyBooking: false,
        };
      });

      const startSlot = slots[0]!;
      // 2.5 hours = 150 minutes
      const range = computeSlotRange(startSlot, 150, slots, 'UTC');

      assert.equal(range.isValid, true);
      assert.equal(range.endTimeHhmm, '15:30');
      assert.equal(range.slots.length, 5);

      // Check slot indices:
      // slot 0: 13:00 - 13:30 (covered)
      // slot 1: 13:30 - 14:00 (covered)
      // slot 2: 14:00 - 14:30 (covered)
      // slot 3: 14:30 - 15:00 (covered)
      // slot 4: 15:00 - 15:30 (covered)
      // slot 5: 15:30 - 16:00 (UNCOVERED & AVAILABLE)
      for (let i = 0; i < 5; i++) {
        assert.equal(isSlotInSelectedRange(slots[i]!, startSlot, 150), true, `Slot ${i} must be selected`);
      }
      assert.equal(isSlotInSelectedRange(slots[5]!, startSlot, 150), false, 'Slot 5 (15:30-16:00) must NOT be selected');
      assert.equal(isSlotInSelectedRange(slots[6]!, startSlot, 150), false, 'Slot 6 (16:00-16:30) must NOT be selected');
      assert.equal(getSlotStatus(slots[5]!), 'available');
    });

    it('CH5.2: Any booked slot inside the 2.5-hour duration invalidates range with conflictSlot', () => {
      const startEpoch = new Date('2026-09-07T13:00:00.000Z').getTime();
      const slots: VenueSlot[] = Array.from({ length: 6 }, (_, i) => {
        const sTime = new Date(startEpoch + i * 30 * 60 * 1000).toISOString();
        const eTime = new Date(startEpoch + (i + 1) * 30 * 60 * 1000).toISOString();
        const pad = (n: number) => String(n).padStart(2, '0');
        const sDate = new Date(sTime);
        const eDate = new Date(eTime);
        const isConflictSlot = i === 3; // 14:30 - 15:00 is booked
        return {
          courtNumber: 1,
          courtLabel: 'Box 1',
          startTime: sTime,
          endTime: eTime,
          timeHhmm: `${pad(sDate.getUTCHours())}:${pad(sDate.getUTCMinutes())}`,
          endTimeHhmm: `${pad(eDate.getUTCHours())}:${pad(eDate.getUTCMinutes())}`,
          isAvailable: !isConflictSlot,
          bookingId: isConflictSlot ? 'occupied-booking-99' : null,
          isMyBooking: false,
        };
      });

      const startSlot = slots[0]!;
      const range = computeSlotRange(startSlot, 150, slots, 'UTC');

      assert.equal(range.isValid, false);
      assert.equal(range.conflictSlot?.bookingId, 'occupied-booking-99');
      assert.equal(range.conflictSlot?.timeHhmm, '14:30');
    });
  });
});
