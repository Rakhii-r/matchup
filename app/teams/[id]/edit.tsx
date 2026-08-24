import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { AppError } from '@core/errors/AppError';
import { teamRepository } from '@features/teams/data/teamRepository';
import { useTeamOverview, useUpdateTeam } from '@features/teams/presentation/useTeams';
import { S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { IconCamera, IconUsers } from '@shared/ui/icons';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

export default function EditTeam(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = id ?? '';
  const q = useTeamOverview(teamId);

  if (q.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Edit team' }} />
        <View style={styles.center}>
          <ActivityIndicator color={M.green} />
        </View>
      </Screen>
    );
  }

  if (!q.data?.i_am_owner) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Edit team' }} />
        <View style={styles.center}>
          <AppText color={M.muted}>Only the team owner can edit team details.</AppText>
        </View>
      </Screen>
    );
  }

  return <EditForm key={q.data.id} teamId={teamId} initial={q.data} />;
}

function EditForm({
  teamId,
  initial,
}: {
  teamId: string;
  initial: {
    name: string;
    description: string | null;
    home_ground: string | null;
    logo_url?: string | null;
  };
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const save = useUpdateTeam(teamId);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [homeGround, setHomeGround] = useState(initial.home_ground ?? '');
  const [logoUri, setLogoUri] = useState<string | null>(initial.logo_url ?? null);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickLogo = async (): Promise<void> => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!res.canceled && res.assets[0]) {
        setLogoUri(res.assets[0].uri);
        if (res.assets[0].base64) {
          setLogoBase64(res.assets[0].base64);
        }
      }
    } catch {
      setError('Could not access photo library.');
    }
  };

  const submit = async () => {
    try {
      setError(null);
      if (logoBase64) {
        setUploadingLogo(true);
        await teamRepository.uploadLogo(teamId, logoBase64);
      }
      await save.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        homeGround: homeGround.trim(),
      });
      router.back();
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Unable to save changes.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const isSaving = save.isPending || uploadingLogo;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Edit team' }} />
      <View style={styles.logoWrap}>
        <Pressable
          onPress={() => void pickLogo()}
          style={styles.logoButton}
          accessibilityRole="button"
          accessibilityLabel="Change team photo"
        >
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoFallback]}>
              <IconUsers color={M.green} size={36} />
            </View>
          )}
          <View style={styles.cameraBadge}>
            <IconCamera color={M.limeInk} size={16} />
          </View>
        </Pressable>
        <AppText variant="caption" color={M.muted}>
          Tap to change team photo
        </AppText>
      </View>

      <TextField label="Team name" value={name} onChangeText={setName} maxLength={50} />
      <TextField label="Description" value={description} onChangeText={setDescription} maxLength={500} />
      <TextField label="Home ground" value={homeGround} onChangeText={setHomeGround} maxLength={100} />

      {error ? <AppText color={M.danger}>{error}</AppText> : null}
      <Button label={isSaving ? 'Saving…' : 'Save changes'} disabled={isSaving} onPress={() => void submit()} />
    </Screen>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.lg },
    logoWrap: { alignItems: 'center', gap: S.sm, marginBottom: S.lg },
    logoButton: { position: 'relative' },
    logo: { width: 96, height: 96, borderRadius: 48, backgroundColor: M.card },
    logoFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: M.border },
    cameraBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: M.bg,
    },
  });
