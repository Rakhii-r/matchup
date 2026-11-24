import { z } from 'zod';

/**
 * Venue Partner (owner) forms. The database re-checks every rule in
 * validate_venue_input (20261123110000); this schema only gives the owner a
 * readable message before the round trip.
 */
export type PartnerVenueStatus = 'approved' | 'pending' | 'hidden';
export type PartnerRole = 'owner' | 'staff';

export interface PartnerVenue {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  sportTypes: string[];
  courtsCount: number;
  openTime: string; // HH:MM
  closeTime: string; // HH:MM
  slotMinutes: number;
  facilities: string[];
  imageUrl: string | null;
  status: PartnerVenueStatus;
  role: PartnerRole;
}

/** Every venue books in whole hours (20261123120000_hourly_bookings_only.sql). */
export const SLOT_MINUTES = 60;

// On the hour only, so the hourly booking grid lines up. 24:00 is a real
// closing time (Akhil box runs 00:00–24:00) and Postgres accepts it.
const HHMM = /^(([01]\d|2[0-3]):00|24:00)$/;

export const VenueFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the venue name.').max(80, 'Name is too long.'),
    address: z.string().trim().max(160, 'Address is too long.').optional(),
    lat: z.number({ message: 'Set the venue location.' }).min(-90).max(90),
    lng: z.number({ message: 'Set the venue location.' }).min(-180).max(180),
    phone: z
      .string()
      .trim()
      .optional()
      .refine(
        (p) => !p || (p.replace(/\D/g, '').length >= 10 && p.replace(/\D/g, '').length <= 13),
        'Enter a 10-digit phone number.',
      ),
    sportTypes: z.array(z.string()).min(1, 'Pick at least one sport.'),
    courtsCount: z.number().int().min(1, 'At least 1 court.').max(20, 'At most 20 courts.'),
    openTime: z.string().regex(HHMM, 'Opening time must be on the hour, e.g. 06:00.'),
    closeTime: z.string().regex(HHMM, 'Closing time must be on the hour, e.g. 23:00.'),
    slotMinutes: z.literal(SLOT_MINUTES),
    facilities: z.array(z.string().trim().min(1).max(40)).max(20),
  })
  .refine((v) => !(v.lat === 0 && v.lng === 0), {
    message: 'Set the venue location.',
    path: ['lat'],
  })
  .refine((v) => v.closeTime > v.openTime, {
    message: 'Closing time must be after opening time.',
    path: ['closeTime'],
  });

export type VenueForm = z.infer<typeof VenueFormSchema>;

/**
 * Reads coordinates out of a full Google Maps link. Short links
 * (maps.app.goo.gl) carry no coordinates, so they return null and the owner is
 * told to use the current location or open the link and copy the full one.
 */
export function parseMapsLink(link: string): { lat: number; lng: number } | null {
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // place pin
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, // map centre
    /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/, // plain "17.49, 78.40"
  ];
  for (const re of patterns) {
    const m = link.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
        return { lat, lng };
      }
    }
  }
  return null;
}
