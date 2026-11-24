import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { VenueFormFields } from '@features/partner/presentation/VenueFormFields';
import { useMyPartnerVenues, usePartnerActions } from '@features/partner/presentation/usePartner';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Screen } from '@shared/ui/Screen';

/** Owner edits venue details, location, hours, courts and cover photo. */
export default function EditVenueScreen(): React.ReactNode {
  const { colors } = useTheme();
  const router = useRouter();
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
  const venues = useMyPartnerVenues();
  const { update } = usePartnerActions();
  const [error, setError] = useState<string | null>(null);

  const venue = venues.data?.find((v) => v.id === venueId);

  if (venues.isLoading) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }
  if (!venue || venue.role !== 'owner') {
    return (
      <Screen>
        <AppText muted>Only the venue owner can edit this venue.</AppText>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <VenueFormFields
        initial={venue}
        allowPhoto
        submitLabel="Save changes"
        loading={update.isPending}
        error={error}
        onSubmit={(form, photoBase64) => {
          setError(null);
          update.mutate(
            { venueId: venue.id, form, photoBase64 },
            {
              onSuccess: () => {
                Alert.alert('Saved', 'Your venue details are updated.');
                router.back();
              },
              onError: (e: unknown) =>
                setError(e instanceof AppError ? e.message : 'Could not save the venue.'),
            },
          );
        }}
      />
    </Screen>
  );
}
