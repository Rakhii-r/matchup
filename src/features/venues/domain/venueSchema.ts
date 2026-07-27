import { z } from 'zod';

import type { Database, Sport } from '@shared/types/database.types';

export type Venue = Database['public']['Tables']['venues']['Row'];

export const DEFAULT_CONFIRM_NOTE = 'Call to confirm availability';

export const SportEnum = z.enum(['box_cricket', 'badminton']);

export const VenueSchema = z.object({
  name: z.string().trim().min(2, 'Enter a venue name').max(80),
  address: z.string().trim().max(160).optional(),
  lat: z
    .number({ invalid_type_error: 'Latitude must be a number' })
    .refine((n) => Math.abs(n) <= 90, 'Latitude must be between -90 and 90'),
  lng: z
    .number({ invalid_type_error: 'Longitude must be a number' })
    .refine((n) => Math.abs(n) <= 180, 'Longitude must be between -180 and 180'),
  sportTypes: z.array(SportEnum).min(1, 'Pick at least one sport'),
  phone: z.string().trim().max(20).optional(),
});

export type VenueForm = z.infer<typeof VenueSchema>;

export const SPORT_LABEL: Record<Sport, string> = {
  box_cricket: 'Box Cricket',
  badminton: 'Badminton',
};
