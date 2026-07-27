import { Redirect, Stack } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';

/**
 * Admin route guard. Non-admins are redirected away — but this is only UX: every
 * admin write is independently authorised by RLS on the server.
 */
export default function AdminLayout(): React.ReactNode {
  const status = useAuthStore((s) => s.status);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);

  if (status === 'loading') return null;
  if (!isSuperadmin) return <Redirect href="/(tabs)" />;

  return <Stack screenOptions={{ headerShown: true }} />;
}
