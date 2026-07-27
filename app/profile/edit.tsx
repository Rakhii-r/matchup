import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Stack, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { useUpdateProfile } from '@features/profile/presentation/useUpdateProfile';
import type { Sport } from '@shared/types/database.types';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconBack } from '@shared/ui/icons';

const SPORTS: { value: Sport; label: string }[] = [
  { value: 'badminton', label: 'Badminton' },
  { value: 'box_cricket', label: 'Box Cricket' },
];

export default function EditProfileScreen(): React.ReactNode {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const { loading, error, submit } = useUpdateProfile();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [areaName, setAreaName] = useState(profile?.area_name ?? '');
  const [sports, setSports] = useState<Sport[]>(profile?.sport_pref ?? []);

  const toggleSport = (sport: Sport): void => {
    setSports((prev) => (prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport]));
  };

  const onSubmit = async (): Promise<void> => {
    const ok = await submit({ fullName, areaName, sportPref: sports });
    if (ok) router.back();
  };

  // Phone-OTP is the login identity; email belongs to Supabase Auth, so it is
  // shown read-only here.
  const loginContact = session?.user.phone
    ? `+${session.user.phone}`
    : (session?.user.email ?? 'Not set');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
          <IconBack color={M.text} size={22} />
        </Pressable>
        <AppText variant="heading" color={M.text}>
          Edit profile
        </AppText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Name
        </AppText>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          placeholderTextColor={M.faint}
          style={styles.input}
        />

        {/* Area */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Area
        </AppText>
        <TextInput
          value={areaName}
          onChangeText={setAreaName}
          placeholder="e.g. Kukatpally, Hyderabad"
          placeholderTextColor={M.faint}
          style={styles.input}
        />

        {/* Sports */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Sports you play
        </AppText>
        <View style={styles.chips}>
          {SPORTS.map((s) => {
            const selected = sports.includes(s.value);
            return (
              <Pressable
                key={s.value}
                onPress={() => toggleSport(s.value)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={styles.chipWrap}
              >
                <MotiView
                  animate={{
                    backgroundColor: selected ? M.green : M.card,
                    borderColor: selected ? M.green : M.border,
                  }}
                  transition={{ type: 'timing', duration: 160 }}
                  style={styles.chip}
                >
                  <AppText variant="label" color={selected ? '#06230F' : M.text}>
                    {s.label}
                  </AppText>
                </MotiView>
              </Pressable>
            );
          })}
        </View>

        {/* Login (read-only) */}
        <View style={styles.readonly}>
          <AppText variant="label" color={M.muted}>
            Login (phone)
          </AppText>
          <AppText color={M.text} style={{ marginTop: 4 }}>
            {loginContact}
          </AppText>
          <AppText variant="caption" color={M.faint} style={{ marginTop: 4 }}>
            Your login is managed by sign-in and can&apos;t be changed here.
          </AppText>
        </View>

        {error ? (
          <AppText variant="caption" color={M.danger} style={{ marginBottom: S.sm }}>
            {error}
          </AppText>
        ) : null}

        <Pressable
          disabled={loading}
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.cta,
            { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: loading ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
        >
          <AppText variant="label" color="#06230F" style={{ fontSize: 16 }}>
            {loading ? 'Saving…' : 'Save changes'}
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
    paddingTop: S.sm,
    paddingBottom: S.md,
    borderBottomWidth: 1,
    borderBottomColor: M.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: S.lg, paddingTop: S.lg, paddingBottom: S.xl },
  fieldLabel: { marginBottom: S.sm, fontSize: 14 },
  input: {
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    minHeight: 52,
    color: M.text,
    fontSize: 16,
    marginBottom: S.lg,
  },
  chips: { flexDirection: 'row', gap: S.md, marginBottom: S.lg },
  chipWrap: { flex: 1 },
  chip: {
    minHeight: 48,
    borderRadius: R.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readonly: {
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
    marginBottom: S.lg,
  },
  cta: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
});
