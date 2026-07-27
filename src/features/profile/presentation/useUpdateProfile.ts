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
        const profile = await profileRepository.update({
          userId,
          fullName: parsed.data.fullName,
          areaName: parsed.data.areaName,
          sportPref: parsed.data.sportPref,
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
