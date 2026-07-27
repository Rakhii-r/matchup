import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { authRepository } from '@features/auth/data/authRepository';
import { useAuthStore } from '@core/auth/authStore';
import type { Sport } from '@shared/types/database.types';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import {
  IconBell,
  IconBolt,
  IconChevron,
  IconEdit,
  IconGear,
  IconLogout,
  IconMenu,
  IconPin,
  IconShieldCheck,
  IconUser,
} from '@shared/ui/icons';

const SPORT_LABEL: Record<Sport, string> = { box_cricket: 'Cricket', badminton: 'Badminton' };

const SETTINGS: { key: string; label: string; Icon: typeof IconEdit; tint: string; route?: string }[] = [
  { key: 'edit', label: 'Edit Profile', Icon: IconEdit, tint: '#2A2B2F', route: '/profile/edit' },
  { key: 'sports', label: 'Sport Preferences', Icon: IconBolt, tint: '#2A2B2F', route: '/profile/edit' },
  { key: 'notif', label: 'Notification Settings', Icon: IconBell, tint: '#173A22' },
];

export default function ProfileScreen(): React.ReactNode {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);
  const sports = profile?.sport_pref ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconMenu color={M.text} />
        <AppLogo width={84} />
        <IconGear color={M.text} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Identity — real logged-in profile */}
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
            ) : (
              <IconUser color={M.faint} size={54} />
            )}
          </View>
          <AppText variant="title" color={M.text} style={{ fontSize: 28, fontWeight: '800', marginTop: S.md }}>
            {profile?.full_name || 'Your profile'}
          </AppText>
          {profile?.area_name ? (
            <View style={styles.areaRow}>
              <IconPin color={M.muted} size={14} />
              <AppText variant="caption" color={M.muted} style={{ marginLeft: 4 }}>
                {profile.area_name}
              </AppText>
            </View>
          ) : null}
          {sports.length > 0 ? (
            <View style={styles.badgeRow}>
              {sports.map((s) => (
                <View key={s} style={[styles.badge, { backgroundColor: M.chip }]}>
                  <IconBolt color={M.muted} size={14} />
                  <AppText variant="caption" color={M.muted} style={styles.badgeText}>
                    {SPORT_LABEL[s]}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Settings */}
        <AppText variant="caption" color={M.faint} style={styles.settingsLabel}>
          ACCOUNT SETTINGS
        </AppText>
        {SETTINGS.map(({ key, label, Icon, tint, route }) => (
          <Pressable
            key={key}
            style={styles.settingRow}
            onPress={() => (route ? router.push(route as never) : undefined)}
          >
            <View style={[styles.settingIcon, { backgroundColor: tint }]}>
              <Icon color={key === 'notif' ? M.green : M.text} size={20} />
            </View>
            <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
              {label}
            </AppText>
            <IconChevron color={M.faint} size={20} />
          </Pressable>
        ))}

        {/* Admin — superadmin only. RLS enforces access server-side regardless. */}
        {isSuperadmin ? (
          <>
            <AppText variant="caption" color={M.faint} style={styles.settingsLabel}>
              ADMIN
            </AppText>
            <Pressable
              style={styles.settingRow}
              onPress={() => router.push('/(admin)/venues' as never)}
            >
              <View style={[styles.settingIcon, { backgroundColor: '#173A22' }]}>
                <IconShieldCheck color={M.green} size={20} />
              </View>
              <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
                Manage venues
              </AppText>
              <IconChevron color={M.faint} size={20} />
            </Pressable>
            <Pressable
              style={styles.settingRow}
              onPress={() => router.push('/(admin)/users' as never)}
            >
              <View style={[styles.settingIcon, { backgroundColor: '#2A2B2F' }]}>
                <IconUser color={M.text} size={20} />
              </View>
              <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
                All users
              </AppText>
              <IconChevron color={M.faint} size={20} />
            </Pressable>
          </>
        ) : null}

        <Pressable style={styles.logout} onPress={() => void authRepository.signOut()}>
          <IconLogout color={M.danger} size={20} />
          <AppText variant="label" color={M.danger} style={{ marginLeft: S.sm, fontSize: 16 }}>
            Logout
          </AppText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },
  identity: { alignItems: 'center', marginTop: S.sm },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: M.cardHi,
    borderWidth: 3,
    borderColor: M.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  areaRow: { flexDirection: 'row', alignItems: 'center', marginTop: S.sm },
  badgeRow: { flexDirection: 'row', gap: S.sm, marginTop: S.md, flexWrap: 'wrap', justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: 6,
  },
  badgeText: { marginLeft: 5, fontWeight: '600' },
  reliability: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: M.cta,
    borderRadius: R.md,
    padding: S.lg,
    marginTop: S.lg,
  },
  statRow: { flexDirection: 'row', gap: S.md, marginTop: S.md },
  statCard: {
    flex: 1,
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    padding: S.md,
  },
  settingsLabel: { letterSpacing: 1, fontWeight: '700', marginTop: S.xl, marginBottom: S.sm },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    padding: S.md,
    marginBottom: S.md,
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
  },
});
