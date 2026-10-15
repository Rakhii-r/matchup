import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { CreateTeamSchema } from '@features/teams/domain/teamSchema';
import { useCreateTeam } from '@features/teams/presentation/useTeams';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useBottomInset } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { IconTile, StadiumBackdrop } from '@shared/ui/decor';
import {
  IconArrowRight,
  IconBadminton,
  IconCamera,
  IconCheck,
  IconDoc,
  IconPlus,
  IconTrophy,
  IconUsers,
  IconWicket,
} from '@shared/ui/icons';
import { PressableScale } from '@shared/ui/PressableScale';

const SPORTS: Sport[] = ['box_cricket', 'badminton'];
const NAME_MAX = 50;
// The same ceiling CreateTeamSchema enforces, so the counter never lies.
const DESCRIPTION_MAX = 500;

export default function CreateTeamScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const bottomInset = useBottomInset();
  const router = useRouter();
  const createTeam = useCreateTeam();
  const sportLabel = useSportLabel();
  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>('box_cricket');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);

  const pickLogo = async (): Promise<void> => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo permission is needed to choose a team logo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (asset?.base64) {
        setLogoUri(asset.uri);
        setLogoBase64(asset.base64);
        setError(null);
      } else if (asset) {
        setError('That image could not be processed. Please choose another image.');
      }
    } catch {
      setError('Could not access photo library.');
    }
  };

  const onSubmit = async (): Promise<void> => {
    if (submitting) return;
    setError(null);
    const parsed = CreateTeamSchema.safeParse({
      name,
      sport,
      description: description.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    setSubmitting(true);
    try {
      const team = await createTeam.mutateAsync({
        ...parsed.data,
        logoBase64: logoBase64 ?? undefined,
      });
      router.replace({ pathname: '/teams/[id]', params: { id: team.id } });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not create the team.');
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Stack.Screen options={{ title: 'Create team' }} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------- Hero ---------------- */}
        <View style={styles.hero}>
          <StadiumBackdrop height={150} net={false} />
          <View style={styles.heroText}>
            <AppText variant="title" color={M.text} style={styles.heroTitle}>
              Build your
            </AppText>
            <AppText variant="title" color={M.green} style={styles.heroTitle}>
              squad
            </AppText>
            <AppText variant="body" color={M.muted} style={styles.heroBody}>
              A saved squad you play with regularly. Share the invite code and they join once.
            </AppText>
            <View style={styles.heroDash} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={logoUri ? 'Replace team image' : 'Upload team image, optional'}
            onPress={() => void pickLogo()}
            style={styles.logoCol}
          >
            <View style={styles.logoRing}>
              <View style={styles.logoDashed}>
                {logoUri ? (
                  <Image source={{ uri: logoUri }} style={styles.logoImage} />
                ) : (
                  <IconCamera color={M.green} size={26} />
                )}
              </View>
              <View style={styles.logoPlus}>
                <IconPlus color={M.limeInk} size={16} strokeWidth={3} />
              </View>
            </View>
            <View style={styles.logoCaption}>
              <AppText variant="caption" color={M.green} center style={{ fontWeight: '700' }}>
                {logoUri ? 'Tap to replace' : 'Upload team image'}
              </AppText>
              {logoUri ? null : (
                <AppText variant="caption" color={M.muted} center>
                  (optional)
                </AppText>
              )}
            </View>
          </Pressable>
        </View>

        {/* ---------------- Form ---------------- */}
        <View style={styles.card}>
          <View style={styles.fieldHead}>
            <IconTile size={36}>
              <IconUsers color={M.green} size={18} />
            </IconTile>
            <AppText variant="label" color={M.text} style={styles.fieldLabel}>
              Team name
            </AppText>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Team name"
            placeholderTextColor={M.faint}
            maxLength={NAME_MAX}
            autoCapitalize="words"
            style={styles.input}
            accessibilityLabel="Team name"
          />

          <View style={[styles.fieldHead, { marginTop: S.md }]}>
            <IconTile size={36}>
              <IconDoc color={M.green} size={18} />
            </IconTile>
            <AppText variant="label" color={M.text} style={styles.fieldLabel}>
              Description{' '}
              <AppText variant="label" color={M.muted} style={{ fontWeight: '400' }}>
                (optional)
              </AppText>
            </AppText>
          </View>
          <View style={styles.textAreaWrap}>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Add a short description about your team..."
              placeholderTextColor={M.faint}
              maxLength={DESCRIPTION_MAX}
              multiline
              textAlignVertical="top"
              style={styles.textArea}
              accessibilityLabel="Team description, optional"
            />
            <AppText variant="caption" color={M.faint} style={styles.counter}>
              {description.length}/{DESCRIPTION_MAX}
            </AppText>
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldHead}>
            <IconTile size={36}>
              <IconTrophy color={M.green} size={18} />
            </IconTile>
            <View>
              <AppText variant="label" color={M.text} style={styles.fieldLabel}>
                Sport
              </AppText>
              <AppText variant="caption" color={M.muted}>
                Choose the sport for your team
              </AppText>
            </View>
          </View>
          <View style={styles.sportRow}>
            {SPORTS.map((value) => {
              const on = sport === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setSport(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={sportLabel(value)}
                  style={[styles.sportCard, on ? styles.sportCardOn : null]}
                >
                  <IconTile size={40} color={on ? M.chip : M.cardHi}>
                    {value === 'box_cricket' ? (
                      <IconWicket color={on ? M.green : M.muted} size={20} />
                    ) : (
                      <IconBadminton color={on ? M.green : M.muted} size={20} />
                    )}
                  </IconTile>
                  <AppText
                    variant="label"
                    color={on ? M.green : M.text}
                    numberOfLines={1}
                    style={styles.sportName}
                  >
                    {sportLabel(value)}
                  </AppText>
                  <View style={[styles.radio, on ? styles.radioOn : null]}>
                    {on ? <IconCheck color={M.limeInk} size={13} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? (
          <AppText variant="caption" color={M.danger} style={{ marginTop: S.md }}>
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      {/* ---------------- Pinned action ---------------- */}
      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <PressableScale
          onPress={() => void onSubmit()}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Create team"
          accessibilityState={{ disabled: submitting, busy: submitting }}
          style={styles.cta}
        >
          {submitting ? (
            <ActivityIndicator color={M.limeInk} />
          ) : (
            <IconUsers color={M.limeInk} size={22} />
          )}
          <AppText variant="label" color={M.limeInk} style={styles.ctaLabel}>
            Create team
          </AppText>
          <View style={styles.ctaArrow}>
            <IconArrowRight color={M.limeInk} size={20} />
          </View>
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: M.bg },
    scroll: { paddingHorizontal: S.md, paddingBottom: S.lg },

    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      paddingTop: S.md,
      paddingBottom: S.lg,
      minHeight: 210,
    },
    heroText: { flex: 1, minWidth: 0 },
    heroTitle: { fontSize: 32, lineHeight: 36 },
    heroBody: { fontSize: 14, lineHeight: 20, marginTop: S.sm },
    heroDash: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: M.green,
      marginTop: S.md,
    },
    logoCol: { alignItems: 'center', width: 140 },
    logoRing: {
      width: 124,
      height: 124,
      borderRadius: 62,
      backgroundColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 4,
    },
    logoDashed: {
      width: 104,
      height: 104,
      borderRadius: 52,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    logoImage: { width: '100%', height: '100%' },
    logoPlus: {
      position: 'absolute',
      bottom: -4,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: M.green,
      borderWidth: 2,
      borderColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoCaption: {
      marginTop: S.sm + 2,
      paddingHorizontal: S.sm + 2,
      paddingVertical: 6,
      borderRadius: R.md,
      backgroundColor: M.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
      elevation: 2,
    },

    card: {
      backgroundColor: M.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
    },
    fieldHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, marginBottom: S.sm + 2 },
    fieldLabel: { fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: M.border,
      borderRadius: R.md,
      paddingHorizontal: S.md,
      fontSize: 16,
      color: M.text,
      backgroundColor: M.card,
    },
    textAreaWrap: {
      borderWidth: 1,
      borderColor: M.border,
      borderRadius: R.md,
      backgroundColor: M.card,
      paddingBottom: S.sm,
    },
    textArea: {
      minHeight: 76,
      paddingHorizontal: S.md,
      paddingTop: S.sm + 4,
      fontSize: 16,
      color: M.text,
    },
    counter: { alignSelf: 'flex-end', marginRight: S.sm + 4 },
    divider: { height: 1, backgroundColor: M.border, marginVertical: S.md + 4 },

    sportRow: { flexDirection: 'row', gap: S.sm + 2 },
    sportCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      minHeight: 64,
      paddingHorizontal: S.sm + 2,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    sportCardOn: { borderColor: M.green, backgroundColor: M.chip },
    sportName: { flex: 1, fontSize: 14 },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: M.green, borderColor: M.green },

    footer: {
      paddingHorizontal: S.md,
      paddingTop: S.sm + 4,
      backgroundColor: M.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: 1,
      borderColor: M.border,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm + 2,
      minHeight: 58,
      borderRadius: 18,
      backgroundColor: M.green,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
    ctaLabel: { fontSize: 17, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    ctaArrow: { position: 'absolute', right: S.md + 4 },
  });
