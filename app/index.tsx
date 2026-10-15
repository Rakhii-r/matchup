import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';

/**
 * Entry route. Shows a neutral loading state while auth resolves, then redirects.
 * It redirects itself rather than relying only on the route guard in _layout: the
 * guard never moved a signed-in user off `/`, which left them on this spinner forever.
 */
export default function Index(): React.ReactNode {
  const status = useAuthStore((s) => s.status);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (status === 'signed_in') return <Redirect href="/(tabs)" />;
  if (status === 'needs_profile') return <Redirect href="/(auth)/create-profile" />;
  if (status === 'signed_out') return <Redirect href="/(auth)/login" />;

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  });
