import { Stack } from 'expo-router';

import { useTheme } from '@shared/theme/ThemeContext';

/**
 * Venue Partner (docs/VENUE_PARTNER_PLAN.md). No client-side role guard: which
 * venues show is decided by list_my_partner_venues, and every write is refused
 * server-side for anyone who is not that venue's owner.
 */
export default function PartnerLayout(): React.ReactNode {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Venue Partner' }} />
      <Stack.Screen name="register" options={{ title: 'List your venue' }} />
      <Stack.Screen name="[venueId]/edit" options={{ title: 'Edit venue' }} />
    </Stack>
  );
}
