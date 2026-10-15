/**
 * Settings — everything about the account that is not a statistic.
 *
 * Moved here from the bottom of the Profile tab (8 Oct 2026), where it sat
 * under two cards of figures and had to be scrolled to. The rows and what they
 * do are unchanged: appearance, the four account screens, the admin portal for
 * a superadmin, and Log Out.
 */
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { authRepository } from '@features/auth/data/authRepository';
import { useTheme } from '@shared/theme/ThemeContext';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useBottomInset } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { PageHeader } from '@shared/ui/decor';
import {
  IconBell,
  IconCalendar,
  IconChevron,
  IconEdit,
  IconLogout,
  IconMoon,
  IconShieldCheck,
  IconShieldStar,
  IconSun,
} from '@shared/ui/icons';

const settingsFor = (
  M: MockPalette,
): { key: string; label: string; Icon: typeof IconEdit; tint: string; route?: string }[] => [
  { key: 'edit', label: 'Edit Profile', Icon: IconEdit, tint: M.border, route: '/profile/edit' },
  {
    key: 'bookings',
    label: 'My Court Bookings',
    Icon: IconCalendar,
    tint: M.border,
    route: '/profile/bookings',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    Icon: IconBell,
    tint: M.border,
    route: '/profile/notifications',
  },
  {
    key: 'blocked',
    label: 'Blocked Players',
    Icon: IconShieldStar,
    tint: M.border,
    route: '/profile/blocked',
  },
];

export default function SettingsScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const bottomInset = useBottomInset();
  const { isDark, setScheme } = useTheme();
  const router = useRouter();
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Settings" fallback="/(tabs)/profile" />

        <AppText variant="caption" color={M.faint} style={styles.settingsLabel}>
          ACCOUNT SETTINGS
        </AppText>
        <Pressable
          style={styles.settingRow}
          onPress={() => setScheme(isDark ? 'light' : 'dark')}
          accessibilityRole="switch"
          accessibilityState={{ checked: isDark }}
          accessibilityLabel={`Appearance, currently ${isDark ? 'dark' : 'light'}. Double tap to switch to ${isDark ? 'light' : 'dark'}.`}
        >
          <View style={[styles.settingIcon, { backgroundColor: M.iconChip }]}>
            {isDark ? <IconMoon color={M.green} size={20} /> : <IconSun color={M.green} size={20} />}
          </View>
          <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
            Appearance
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {isDark ? 'Dark' : 'Light'}
          </AppText>
        </Pressable>

        {settingsFor(M).map(({ key, label, Icon, tint, route }) => (
          <Pressable
            key={key}
            style={styles.settingRow}
            onPress={() => {
              if (route) router.push(route as never);
            }}
            accessibilityRole="button"
          >
            <View style={[styles.settingIcon, { backgroundColor: tint }]}>
              <Icon color={M.green} size={20} />
            </View>
            <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
              {label}
            </AppText>
            <IconChevron color={M.muted} size={18} />
          </Pressable>
        ))}

        {isSuperadmin ? (
          <>
            <AppText variant="caption" color={M.faint} style={styles.settingsLabel}>
              ADMIN
            </AppText>
            <Pressable
              style={styles.settingRow}
              onPress={() => router.push('/admin' as never)}
              accessibilityRole="button"
            >
              <View style={[styles.settingIcon, { backgroundColor: M.border }]}>
                <IconShieldCheck color={M.green} size={20} />
              </View>
              <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
                Admin Portal
              </AppText>
              <IconChevron color={M.muted} size={18} />
            </Pressable>
          </>
        ) : null}

        <Pressable
          style={styles.logout}
          onPress={() => {
            /*
              signOut() awaits unregisterForPushNotifications() before it touches
              supabase.auth, so the store does not flip to signed_out for a network
              round-trip. Navigating synchronously landed the user on a route that
              does not exist ('/(auth)/sign-in'; the screen is login.tsx) and held
              them there until that call returned. Await it, then go to the real
              route -- the _layout guard would also get there, this just avoids the
              gap. A thrown signOut leaves the session intact, so say so instead of
              navigating away from a still-signed-in state.
            */
            void (async () => {
              try {
                await authRepository.signOut();
              } catch {
                Alert.alert('Could not log out', 'Check your connection and try again.');
                return;
              }
              router.replace('/(auth)/login');
            })();
          }}
          accessibilityRole="button"
        >
          <IconLogout color={M.danger} size={18} />
          <AppText variant="label" color={M.danger} style={{ marginLeft: S.sm }}>
            Log Out
          </AppText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    scroll: { paddingHorizontal: S.md },
    settingsLabel: { letterSpacing: 1, fontWeight: '700', marginTop: S.md, marginBottom: S.sm },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.sm + 4,
      marginBottom: S.sm + 2,
      minHeight: 44,
    },
    settingIcon: {
      width: 40,
      height: 40,
      borderRadius: R.sm,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: S.md,
    },
    logout: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: M.border,
      borderRadius: R.md,
      paddingVertical: S.md + 2,
      marginTop: S.lg,
      minHeight: 44,
    },
  });
