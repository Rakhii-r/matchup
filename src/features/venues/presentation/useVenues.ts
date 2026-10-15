import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { venueRepository } from '@features/venues/data/venueRepository';
import type {
  NearbyVenuesInput,
  SuggestVenueInput,
  VenueStatus,
} from '@features/venues/data/venueRepository';
import type { VenueForm } from '@features/venues/domain/venueSchema';

export function useVenues() {
  return useQuery({ queryKey: ['venues'], queryFn: () => venueRepository.list() });
}

/**
 * Venues near a point, for the picker on a match. Disabled until coordinates
 * are known, so the screen never fires a query for lat/lng 0,0.
 */
export function useNearbyVenues(input: NearbyVenuesInput | null) {
  return useQuery({
    queryKey: [
      'venues',
      'nearby',
      input?.lat ?? null,
      input?.lng ?? null,
      input?.radiusM ?? null,
      input?.sport ?? null,
    ],
    queryFn: () => venueRepository.nearby(input as NearbyVenuesInput),
    enabled: input !== null,
  });
}

export function useCreateVenue() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (form: VenueForm) => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      return venueRepository.create({
        createdBy: userId,
        name: form.name,
        address: form.address ?? null,
        lat: form.lat,
        lng: form.lng,
        sportTypes: form.sportTypes,
        phone: form.phone ?? null,
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

export function useUpdateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, form }: { id: string; form: VenueForm }) =>
      venueRepository.update(id, {
        name: form.name,
        address: form.address ?? null,
        lat: form.lat,
        lng: form.lng,
        sportTypes: form.sportTypes,
        phone: form.phone ?? null,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

export function useDeleteVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => venueRepository.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

/**
 * Suggest a ground. Invalidates the nearby picker as well as the directory: an
 * admin approving from another device is the only way the new row becomes
 * visible, but refetching costs nothing and keeps the two in step.
 */
export function useSuggestVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SuggestVenueInput) => venueRepository.suggest(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

export function useMyVenueRating(venueId: string | null) {
  return useQuery({
    queryKey: ['venues', 'my-rating', venueId],
    queryFn: () => venueRepository.myRating(venueId as string),
    enabled: Boolean(venueId),
  });
}

export function useRateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ venueId, rating }: { venueId: string; rating: number }) =>
      venueRepository.rate(venueId, rating),
    // The aggregate on every venue row moves, so the pickers refetch too.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}

export function useSetVenueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: VenueStatus }) =>
      venueRepository.setStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues'] }),
  });
}
