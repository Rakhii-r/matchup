import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { VenueFormFields } from '@features/partner/presentation/VenueFormFields';
import { usePartnerActions } from '@features/partner/presentation/usePartner';
import { AppText } from '@shared/ui/AppText';
import { Screen } from '@shared/ui/Screen';

/**
 * "List your venue": any signed-in user registers a venue and becomes its
 * owner. It stays hidden from players until an admin approves it.
 */
export default function RegisterVenueScreen(): React.ReactNode {
  const router = useRouter();
  const { register } = usePartnerActions();
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen scroll>
      <AppText muted style={{ marginBottom: 12 }}>
        Add your ground to SIXFOUR 24. Our team checks it before players can see and book it.
        You can add a photo and edit everything after it is submitted.
      </AppText>
      <VenueFormFields
        submitLabel="Submit for approval"
        loading={register.isPending}
        error={error}
        onSubmit={(form) => {
          setError(null);
          register.mutate(form, {
            onSuccess: () => {
              Alert.alert(
                'Venue submitted',
                'We will review it soon. You can edit it from Venue Partner meanwhile.',
              );
              router.replace('/partner' as never);
            },
            onError: (e: unknown) =>
              setError(e instanceof AppError ? e.message : 'Could not submit the venue.'),
          });
        }}
      />
    </Screen>
  );
}
