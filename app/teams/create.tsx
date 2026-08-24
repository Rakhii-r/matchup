import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { CreateTeamSchema } from '@features/teams/domain/teamSchema';
import { useCreateTeam } from '@features/teams/presentation/useTeams';
import { teamRepository } from '@features/teams/data/teamRepository';
import type { Sport } from '@shared/types/database.types';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

const SPORTS: Sport[] = ['box_cricket', 'badminton'];

export default function CreateTeamScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Photo permission is needed to choose a team logo.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.base64) { setLogoUri(asset.uri); setLogoBase64(asset.base64); }
    else if (asset) setError('That image could not be processed. Please choose another image.');
  };

  /**
   * Creating a team is three sequential writes, not one. `createTeam.isPending`
   * only covers the first: it flips back to false the moment the team row
   * exists, while this function is still writing the description and uploading
   * the logo. Binding the button to it left the button live for the whole
   * upload — several seconds on mobile data, with nothing on screen changing —
   * and a second tap created a second team. That is exactly how two identical
   * "Daksha titans" rows appeared 4.4 seconds apart.
   *
   * `submitting` spans the entire sequence instead, and is deliberately NOT
   * cleared on success: the screen navigates away, and clearing it first would
   * re-enable the button for the frame before the transition.
   */
  const onSubmit = async (): Promise<void> => {
    if (submitting) return;
    setError(null);
    const parsed = CreateTeamSchema.safeParse({ name, sport });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    setSubmitting(true);
    try {
      const team = await createTeam.mutateAsync(parsed.data);
      if (description.trim()) await teamRepository.update(team.id, { name: team.name, description: description.trim(), homeGround: '' });
      if (logoBase64) await teamRepository.uploadLogo(team.id, logoBase64);
      router.replace({ pathname: '/teams/[id]', params: { id: team.id } });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not create the team.');
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Create team' }} />

      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <AppText variant="heading">Create a team</AppText>
        <AppText muted>
          A saved squad you play with regularly. Share the invite code and they join once.
        </AppText>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Upload team logo" onPress={() => void pickLogo()} style={styles.logoPicker}>
        {logoUri ? <Image source={{ uri: logoUri }} style={styles.logoImage} /> : <AppText variant="heading" color={colors.primary}>+</AppText>}
      </Pressable>
      <AppText center muted style={{ marginBottom: spacing.lg }}>{logoUri ? 'Tap to replace team image' : 'Upload team image (optional)'}</AppText>

      <TextField
        label="Team name"
        value={name}
        onChangeText={setName}
        placeholder="Sunday Warriors"
        maxLength={50}
        autoFocus
      />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} maxLength={500} />

      <AppText variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
        Sport
      </AppText>
      <View style={styles.sportRow}>
        {SPORTS.map((value) => {
          const on = sport === value;
          return (
            <Pressable
              key={value}
              onPress={() => setSport(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.sportChip, on ? styles.sportChipOn : null]}
            >
              <AppText variant="label" color={on ? colors.textInverse : colors.text}>
                {sportLabel(value)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.md }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label="Create team"
          loading={submitting}
          onPress={() => void onSubmit()}
        />
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    logoPicker: { width: 96, height: 96, borderRadius: 48, alignSelf: 'center', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.surface },
    logoImage: { width: '100%', height: '100%' },
    sportRow: { flexDirection: 'row', gap: spacing.sm },
    sportChip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sportChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  });
