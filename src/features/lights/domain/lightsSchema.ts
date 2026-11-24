import { z } from 'zod';

import type { Database } from '@shared/types/database.types';

type Fn = Database['public']['Functions'];

export type LightVenue = Fn['list_my_light_venues']['Returns'][number];
export type LightBooking = Fn['list_venue_light_bookings']['Returns'][number];
export type CourtDevice = Fn['list_court_devices']['Returns'][number];
export type VenueStaffMember = Fn['list_venue_staff']['Returns'][number];
export type MatchLights = Fn['get_match_lights']['Returns'][number];
export type LightCourt = Fn['list_light_courts']['Returns'][number];
export type LightEventStatus = Fn['get_light_event_status']['Returns'][number];

export const PAYMENT_METHODS = ['cash', 'upi', 'comp'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What the counter enters when a booker pays for lights. Amount is in rupees. */
export const SetLightsPaidInputSchema = z.object({
  bookingId: z.string().uuid(),
  amountRupees: z.number().int().min(0).max(100000),
  method: z.enum(PAYMENT_METHODS),
});
export type SetLightsPaidInput = z.infer<typeof SetLightsPaidInputSchema>;

/** ThingsBoard device access tokens are short URL-safe strings. Mirrors the SQL check. */
export const DeviceTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Paste the device access token from ThingsBoard.');

/** Shown on the court card so staff can tell why the last event did not blink. */
export const LIGHT_REASON_LABELS: Record<string, string> = {
  scorer_not_booker: 'Scored by someone other than the booker',
  not_paid: 'Lights not paid for this booking',
  booker_turned_off: 'Booker switched lights off',
  ambiguous_court: 'Booker holds two courts; match not linked',
  no_device: 'No device linked to this court',
  device_disabled: 'Court lights switched off',
  rate_limited: 'Too many blinks in a minute',
  slot_over: 'Slot had ended',
  no_device_token: 'Device token missing',
  dispatcher_not_configured: 'Server not configured',
};

export function lightReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (LIGHT_REASON_LABELS[reason]) return LIGHT_REASON_LABELS[reason];
  if (reason.startsWith('thingsboard 401') || reason.startsWith('thingsboard 404')) {
    return 'ThingsBoard rejected the device token';
  }
  if (reason.startsWith('network')) return 'Could not reach ThingsBoard';
  return reason;
}
