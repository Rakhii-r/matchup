import { useMutation } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { profileRepository } from '@features/profile/data/profileRepository';

/**
 * Save one or more notification mute switches.
 *
 * Writes straight into the auth store on success rather than invalidating a
 * query: the profile is store state, not a react-query cache entry, and the
 * switches must settle in the same frame as the tap or they visibly bounce
 * back to their old position while the round trip is in flight.
 */
export function useUpdateNotifPrefs() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (prefs: Record<string, boolean>) => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      return profileRepository.updateNotifPrefs(userId, prefs);
    },
    onSuccess: (profile) => useAuthStore.getState().setProfile(profile),
  });
}
