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
  homeLat?: number | null;
  homeLng?: number | null;
  /** Base64 JPEG from the image picker, if the user chose a profile photo. */
  avatarBase64?: string | null;
}

interface UseCreateProfile {
  loading: boolean;
  error: string | null;
  submit: (input: SubmitInput) => Promise<boolean>;
}

export function useCreateProfile(): UseCreateProfile {
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
        // Upload the photo first (if any) so the profile row is created with its URL.
        // A failed upload shouldn't block sign-up, so fall back to no avatar.
        let avatarUrl: string | null = null;
        if (input.avatarBase64) {
          try {
            avatarUrl = await profileRepository.uploadAvatar(userId, input.avatarBase64);
          } catch {
            avatarUrl = null;
          }
        }

        const profile = await profileRepository.create({
          userId,
          fullName: parsed.data.fullName,
          areaName: parsed.data.areaName,
          sportPref: parsed.data.sportPref,
          homeLat: input.homeLat,
          homeLng: input.homeLng,
          avatarUrl,
        });
        setProfile(profile);
        analytics.capture('profile_created');
        return true;
      } catch (e) {
        // A duplicate key means the profile already exists — this screen was
        // reached by mistake, or a first attempt landed but its response was
        // lost. Adopt the stored row instead of reporting a conflict.
        if (e instanceof AppError && e.code === 'conflict') {
          const existing = await profileRepository.getMine(userId).catch(() => null);
          if (existing) {
            setProfile(existing);
            return true;
          }
        }
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
