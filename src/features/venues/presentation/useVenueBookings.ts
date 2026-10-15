import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { venueBookingRepository } from '@features/venues/data/venueBookingRepository';
import type {
  BookSlotInput,
  VenueBooking,
  VenueSlot,
} from '@features/venues/domain/venueBookingSchema';

/**
 * Hook to dynamically fetch time slot availability for a venue on a specific date.
 */
export function useVenueSlots(
  venueId: string | null | undefined,
  date: string | null | undefined,
  timezone: string = 'Asia/Kolkata',
) {
  return useQuery<VenueSlot[]>({
    queryKey: ['venue-slots', venueId ?? '', date ?? ''] as const,
    queryFn: () => {
      if (!venueId || !date) return [];
      return venueBookingRepository.getSlots(venueId, date, timezone);
    },
    enabled: Boolean(venueId && date),
  });
}

/**
 * Hook to book a court slot with atomic concurrency protection and automatic cache invalidation.
 */
export function useBookSlot() {
  const qc = useQueryClient();

  return useMutation<VenueBooking, Error, BookSlotInput>({
    mutationFn: (input: BookSlotInput) => venueBookingRepository.bookSlot(input),
    onSuccess: (_data, variables) => {
      // Invalidate slots for this venue
      void qc.invalidateQueries({ queryKey: ['venue-slots', variables.venueId] });
      // Invalidate user's bookings list
      void qc.invalidateQueries({ queryKey: ['my-bookings'] });
      // If linked to a match, invalidate match details and matches list
      if (variables.matchId) {
        void qc.invalidateQueries({ queryKey: ['matches', variables.matchId] });
        void qc.invalidateQueries({ queryKey: ['matches'] });
      }
    },
  });
}

/**
 * Hook to cancel a booking and immediately release the court slot for others.
 */
export function useCancelBooking() {
  const qc = useQueryClient();

  return useMutation<VenueBooking, Error, string>({
    mutationFn: (bookingId: string) => venueBookingRepository.cancelBooking(bookingId),
    onSuccess: (data) => {
      // Invalidate venue slots so the released slot shows available immediately
      void qc.invalidateQueries({ queryKey: ['venue-slots'] });
      // Invalidate user's bookings list
      void qc.invalidateQueries({ queryKey: ['my-bookings'] });
      // Invalidate match details if this booking was linked to a match
      if (data.matchId) {
        void qc.invalidateQueries({ queryKey: ['matches', data.matchId] });
      }
      void qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

/**
 * Hook to fetch all bookings for the currently signed-in user.
 */
export function useMyBookings() {
  return useQuery<VenueBooking[]>({
    queryKey: ['my-bookings'] as const,
    queryFn: () => venueBookingRepository.listMyBookings(),
  });
}

/**
 * Hook to fetch the linked booking for a specific match.
 */
export function useMatchBooking(matchId: string | null | undefined) {
  return useQuery<VenueBooking | null>({
    queryKey: ['match-booking', matchId ?? ''] as const,
    queryFn: () => {
      if (!matchId) return null;
      return venueBookingRepository.getBookingForMatch(matchId);
    },
    enabled: Boolean(matchId),
  });
}
