import { useState, useCallback } from 'react';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { analytics } from '@core/observability/analytics';
import { profileRepository } from '@features/profile/data/profileRepository';
import { CreateProfileSchema } from '@features/profile/domain/profileSchema';
import type { Sport } from '@shared/types/database.types';

interface SubmitInput {
  fullName: string;
  areaName: string;
  sportPref: Sport[];
  avatarBase64?: string | null;
  removeAvatar?: boolean;
  homeLat?: number | null;
  homeLng?: number | null;
}

interface UseUpdateProfile {
  loading: boolean;
  error: string | null;
  submit: (input: SubmitInput) => Promise<boolean>;
}

/** Edit the signed-in user's profile. Validation reuses the create-profile schema. */
export function useUpdateProfile(): UseUpdateProfile {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useAuthStore((s) => s.session);
  const setProfile = useAuthStore((s) => s.setProfile);

  const submit = useCallback(
    async (input: SubmitInput): Promise<boolean> => {
      setError(null);
      const userId = session?.user.id;
      if (!userId) {
        setError('Your session has expired. Please sign in again.');
        return false;
      }

      const parsed = CreateProfileSchema.safeParse(input);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Please check your details.');
        return false;
      }

      setLoading(true);
      try {
        let avatarUrl = undefined as string | null | undefined;
        if (input.removeAvatar) { await profileRepository.removeAvatar(userId); avatarUrl = null; }
        else if (input.avatarBase64) avatarUrl = await profileRepository.uploadAvatar(userId, input.avatarBase64);
        const profile = await profileRepository.update({
          userId,
          fullName: parsed.data.fullName,
          areaName: parsed.data.areaName,
          sportPref: parsed.data.sportPref,
          avatarUrl,
          homeLat: input.homeLat,
          homeLng: input.homeLng,
        });
        setProfile(profile);
        analytics.capture('profile_created');
        return true;
      } catch (e) {
        setError(e instanceof AppError ? e.message : 'Could not save your profile.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [session, setProfile],
  );

  return { loading, error, submit };
}

/**
 * Saves or removes the profile photo on its own, immediately.
 *
 * The photo used to ride along with the edit form: picking one only changed a
 * local preview, and nothing was uploaded until "Save changes" at the very
 * bottom of the screen. Leaving with the back arrow threw the photo away with
 * no message, which is exactly what "it adds but does not show" was.
 *
 * Pass base64 to set a photo, or `null` to remove the current one. Resolves
 * `true` when the server has it; on failure `error` says why and the stored
 * photo is unchanged.
 */
export function useUpdateAvatar(): {
  busy: boolean;
  error: string | null;
  save: (base64: string | null) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useAuthStore((s) => s.session);
  const setProfile = useAuthStore((s) => s.setProfile);

  const save = useCallback(
    async (base64: string | null): Promise<boolean> => {
      setError(null);
      const userId = session?.user.id;
      if (!userId) {
        setError('Your session has expired. Please sign in again.');
        return false;
      }
      setBusy(true);
      try {
        let url: string | null = null;
        if (base64) url = await profileRepository.uploadAvatar(userId, base64);
        else await profileRepository.removeAvatar(userId);
        setProfile(await profileRepository.setAvatarUrl(userId, url));
        return true;
      } catch (e) {
        setError(
          e instanceof AppError
            ? `Photo not saved. ${e.message}`
            : 'Photo not saved. Check your connection and try again.',
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [session, setProfile],
  );

  return { busy, error, save };
}
