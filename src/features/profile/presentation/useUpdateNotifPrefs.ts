import { useMutation } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { profileRepository } from '@features/profile/data/profileRepository';

/**
 * Save one or more notification mute switches.
 *
 * The screen owns what the switches show (local state, flipped on tap); this
 * only persists. Writing every tap into the auth store first re-rendered every
 * subscriber of `profile` across the app before the switch could repaint,
 * which is the lag testers saw. The store is updated once, with the saved row.
 *
 * Every call shares one mutation scope, so taps are sent one after another.
 * `updateNotifPrefs` reads the row, merges and writes; two of those in flight
 * at once could each read the old row and the second write would drop the
 * first switch.
 */
export function useUpdateNotifPrefs() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    scope: { id: 'notif-prefs' },
    mutationFn: (prefs: Record<string, boolean>) => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      return profileRepository.updateNotifPrefs(userId, prefs);
    },
    onSuccess: (profile) => useAuthStore.getState().setProfile(profile),
  });
}
