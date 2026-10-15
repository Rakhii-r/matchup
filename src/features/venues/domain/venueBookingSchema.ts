import { z } from 'zod';

export interface VenueSlot {
  courtNumber: number;
  courtLabel: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  timeHhmm: string;  // e.g. "06:00"
  endTimeHhmm: string; // e.g. "07:00"
  isAvailable: boolean;
  bookingId: string | null;
  isMyBooking: boolean;
}

export type BookingStatus = 'confirmed' | 'cancelled';

export interface VenueBooking {
  id: string;
  venueId: string;
  courtNumber: number;
  userId: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  matchId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  venueName?: string;
  venueAddress?: string | null;
  sportTypes?: string[];
  venueLat?: number | null;
  venueLng?: number | null;
}

export const BookSlotInputSchema = z.object({
  venueId: z.string().uuid('Invalid venue ID'),
  courtNumber: z.number().int().min(1, 'Court number must be at least 1'),
  startTime: z.string().datetime({ offset: true, message: 'Invalid start time' }),
  endTime: z.string().datetime({ offset: true, message: 'Invalid end time' }),
  matchId: z.string().uuid('Invalid match ID').nullable().optional(),
  notes: z.string().max(280, 'Notes cannot exceed 280 characters').nullable().optional(),
});

export type BookSlotInput = z.infer<typeof BookSlotInputSchema>;
export type BookSlotParams = BookSlotInput;

export const CancelBookingInputSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
});

export type CancelBookingInput = z.infer<typeof CancelBookingInputSchema>;
