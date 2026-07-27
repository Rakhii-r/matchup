import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { venueRepository } from '@features/venues/data/venueRepository';
import type { VenueForm } from '@features/venues/domain/venueSchema';

export function useVenues() {
  return useQuery({ queryKey: ['venues'], queryFn: () => venueRepository.list() });
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
