import { useState, useCallback } from 'react';
import { ActivityIndicator, Image, ImageBackground, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';

import { authRepository } from '@features/auth/data/authRepository';
import { getCurrentCoords } from '@core/location/location';
import { useCreateProfile } from '@features/profile/presentation/useCreateProfile';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import { IconBadminton, IconClose, IconCricket, IconPlus, IconUser } from '@shared/ui/icons';
import type { Sport } from '@shared/types/database.types';

type SportKey = 'cricket' | 'badminton';
type Skill = 'Beginner' | 'Intermediate' | 'Advanced';

const SPORTS: {
  key: SportKey;
  label: string;
  Icon: typeof IconCricket;
  colors: [string, string];
  img: number;
}[] = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  { key: 'cricket', label: 'Cricket', Icon: IconCricket, colors: ['rgba(62,107,35,0.45)', 'rgba(11,20,7,0.85)'], img: require('../../assets/images/cricket.jpg') as number },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  { key: 'badminton', label: 'Badminton', Icon: IconBadminton, colors: ['rgba(28,79,115,0.45)', 'rgba(6,17,26,0.85)'], img: require('../../assets/images/badminton.jpg') as number },
];
const SKILLS: Skill[] = ['Beginner', 'Intermediate', 'Advanced'];

/** UI keys don't match the DB enum 1:1 — 'cricket' in the picker maps to 'box_cricket' in Postgres. */
const SPORT_KEY_TO_DB: Record<SportKey, Sport> = {
  cricket: 'box_cricket',
  badminton: 'badminton',
};

export default function CreateProfileScreen(): React.ReactNode {
  const router = useRouter();
  const { loading, error, submit } = useCreateProfile();
  const [name, setName] = useState('');
  const [areaName, setAreaName] = useState('');
  const [sports, setSports] = useState<SportKey[]>(['cricket']);
  const [skill, setSkill] = useState<Skill>('Intermediate');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);

  const toggleSport = (key: SportKey): void =>
    setSports((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const pickAvatar = useCallback(async (): Promise<void> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.base64) {
      setAvatarUri(asset.uri);
      setAvatarBase64(asset.base64);
    }
  }, []);

  const canSubmit = name.trim().length >= 2 && areaName.trim().length >= 2 && sports.length >= 1 && !loading;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    const coords = await getCurrentCoords();
    const ok = await submit({
      fullName: name,
      areaName,
      sportPref: sports.map((k) => SPORT_KEY_TO_DB[k]),
      homeLat: coords?.lat ?? null,
      homeLng: coords?.lng ?? null,
      avatarBase64,
    });
    if (ok) router.replace('/(tabs)');
  }, [canSubmit, name, areaName, sports, avatarBase64, submit, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {/* Signed in but no profile yet — closing must sign out so the route guard
            sends the user back to login (a plain router.back has no screen to pop to). */}
        <Pressable hitSlop={10} onPress={() => void authRepository.signOut()}>
          <IconClose color={M.text} />
        </Pressable>
        <AppLogo width={110} />
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <AppText variant="title" center color={M.text} style={{ fontSize: 30, fontWeight: '800' }}>
          Complete Your Profile
        </AppText>
        <AppText center color={M.muted} style={{ marginTop: S.xs }}>
          Step onto the field with a winning profile.
        </AppText>

        <View style={styles.avatarArea}>
          <Pressable
            onPress={() => void pickAvatar()}
            accessibilityRole="button"
            accessibilityLabel="Add profile photo"
            style={styles.avatarRing}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
            ) : (
              <IconUser color={M.muted} size={44} />
            )}
            <View style={styles.avatarPlus}>
              <IconPlus color={M.ctaText} size={18} />
            </View>
          </Pressable>
          <AppText variant="label" color={M.text} style={{ marginTop: S.sm }}>
            {avatarUri ? 'Change Profile Photo' : 'Add Profile Photo'}
          </AppText>
        </View>

        <AppText variant="label" color={M.text} style={styles.fieldLabel}>
          Full Name
        </AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Enter your name"
          placeholderTextColor={M.faint}
          style={styles.input}
        />

        <AppText variant="label" color={M.text} style={styles.fieldLabel}>
          Area / Locality
        </AppText>
        <TextInput
          value={areaName}
          onChangeText={setAreaName}
          placeholder="e.g. Bandra West"
          placeholderTextColor={M.faint}
          style={styles.input}
        />

        <AppText variant="label" color={M.text} style={styles.fieldLabel}>
          Sport Preference
        </AppText>
        <View style={styles.sportRow}>
          {SPORTS.map(({ key, label, Icon, colors, img }) => {
            const on = sports.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => toggleSport(key)}
                style={[styles.sportCard, on && styles.sportCardOn]}
              >
                <ImageBackground source={img} style={StyleSheet.absoluteFill} resizeMode="cover">
                  <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
                </ImageBackground>
                <View style={styles.sportCardLabel}>
                  <Icon color={M.text} size={22} />
                  <AppText variant="label" color={M.text} style={{ marginLeft: 6, fontSize: 16 }}>
                    {label}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>

        <AppText variant="label" color={M.text} style={styles.fieldLabel}>
          Skill Level
        </AppText>
        <View style={styles.segment}>
          {SKILLS.map((sk) => {
            const on = skill === sk;
            return (
              <Pressable
                key={sk}
                onPress={() => setSkill(sk)}
                style={[styles.segItem, on && styles.segItemOn]}
              >
                <AppText variant="label" color={on ? M.ctaText : M.muted}>
                  {sk}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <AppText color={M.danger} style={{ marginTop: S.md }} center>
            {error}
          </AppText>
        ) : null}

        <Pressable
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.cta,
            (!canSubmit || pressed) && { opacity: !canSubmit ? 0.5 : 0.9 },
          ]}
          onPress={() => void handleSubmit()}
        >
          {loading ? (
            <ActivityIndicator color={M.ctaText} />
          ) : (
            <AppText variant="label" color={M.ctaText} style={{ fontSize: 16 }}>
              Ready to Play
            </AppText>
          )}
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
    paddingVertical: S.sm,
  },
  scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },
  avatarArea: { alignItems: 'center', marginVertical: S.xl },
  avatarRing: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: M.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 75 },
  avatarPlus: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: M.cta,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: M.bg,
  },
  fieldLabel: { marginTop: S.lg, marginBottom: S.sm, fontSize: 16 },
  input: {
    backgroundColor: M.cardHi,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    color: M.text,
    fontSize: 16,
  },
  sportRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sportCard: {
    width: '48%',
    height: 170,
    borderRadius: R.md,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  sportCardOn: { borderColor: M.green },
  sportCardLabel: { flexDirection: 'row', alignItems: 'center', padding: S.md },
  segment: {
    flexDirection: 'row',
    backgroundColor: M.cardHi,
    borderRadius: R.md,
    padding: 4,
  },
  segItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: S.md,
    borderRadius: R.sm,
  },
  segItemOn: { backgroundColor: M.cta },
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: M.cta,
    borderRadius: R.md,
    paddingVertical: S.md + 2,
    marginTop: S.xl,
    shadowColor: '#FF7A00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
});
