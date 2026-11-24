import { Stack } from 'expo-router';

import { useTheme } from '@shared/theme/ThemeContext';

/**
 * Court lights (venue counter). No client-side role guard: who may see a
 * venue here is decided by list_my_light_venues, and every action is refused
 * server-side for anyone who is not that venue's staff or a superadmin.
 */
export default function LightsLayout(): React.ReactNode {
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
      <Stack.Screen name="index" options={{ title: 'Court Lights' }} />
    </Stack>
  );
}
