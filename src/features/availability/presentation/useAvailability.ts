import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { getCurrentCoords } from '@core/location/location';
import { analytics } from '@core/observability/analytics';
import { availabilityRepository } from '@features/availability/data/availabilityRepository';
import { endOfTodayISO, todayDate } from '@features/availability/domain/availabilitySchema';
import type { Coords } from '@core/location/location';
import type { Sport } from '@shared/types/database.types';

const mineKey = (userId: string | undefined) => ['availability', 'mine', userId ?? 'anon'] as const;

export function useMyAvailability() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: mineKey(userId),
    queryFn: () => availabilityRepository.listMine(userId as string, todayDate()),
    enabled: Boolean(userId),
  });
}

export function useNearbyAvailable(coords: Coords | null, sport: Sport | null) {
  return useQuery({
    queryKey: ['availability', 'nearby', coords?.lat ?? 0, coords?.lng ?? 0, sport ?? 'all'] as const,
    queryFn: () =>
      availabilityRepository.nearby({
        lat: (coords as Coords).lat,
        lng: (coords as Coords).lng,
        radiusM: 5000,
        sport,
      }),
    enabled: coords != null,
  });
}

export function useSetAvailable() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  const profile = useAuthStore((s) => s.profile);

  return useMutation({
    mutationFn: async (input: { sport: Sport; note?: string | null }) => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');

      const deviceCoords = await getCurrentCoords();
      const coords =
        deviceCoords ??
        (profile?.home_lat != null && profile?.home_lng != null
          ? { lat: profile.home_lat, lng: profile.home_lng }
          : null);
      if (!coords) {
        throw new AppError(
          'validation',
          'Enable location, or set your home area in your profile, to mark availability.',
        );
      }

      return availabilityRepository.setAvailable({
        userId,
        sport: input.sport,
        date: todayDate(),
        expiresAt: endOfTodayISO(),
        lat: coords.lat,
        lng: coords.lng,
        note: input.note ?? null,
      });
    },
    onSuccess: () => {
      analytics.capture('available_toggled');
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useRemoveAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => availabilityRepository.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['availability'] }),
  });
}
