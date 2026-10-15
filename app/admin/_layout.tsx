import { Redirect, Stack } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { useTheme } from '@shared/theme/ThemeContext';

/**
 * Admin layout & route guard.
 * Non-superadmins are redirected away immediately. Server RLS provides authoritative protection.
 */
export default function AdminLayout(): React.ReactNode {
  const { colors } = useTheme();
  const status = useAuthStore((s) => s.status);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);

  if (status === 'loading') return null;
  if (!isSuperadmin) return <Redirect href="/(tabs)" />;

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
      <Stack.Screen name="index" options={{ title: 'Admin Portal' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports & Moderation' }} />
      <Stack.Screen name="users" options={{ title: 'User Directory' }} />
      <Stack.Screen name="venues" options={{ title: 'Venue Management' }} />
      <Stack.Screen name="sports" options={{ title: 'Sports Management' }} />
    </Stack>
  );
}
