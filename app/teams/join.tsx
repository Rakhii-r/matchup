import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { TeamInviteCodeSchema } from '@features/teams/domain/teamSchema';
import { useJoinTeamByCode } from '@features/teams/presentation/useTeams';
import { colors, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

export default function JoinTeamScreen(): React.ReactNode {
  const router = useRouter();
  const joinTeam = useJoinTeamByCode();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    setError(null);
    const parsed = TeamInviteCodeSchema.safeParse({ code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the 6-character code.');
      return;
    }
    try {
      const team = await joinTeam.mutateAsync(parsed.data.code);
      router.replace({ pathname: '/teams/[id]', params: { id: team.id } });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not join the team.');
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Join team' }} />

      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <AppText variant="heading">Join a team</AppText>
        <AppText muted>Enter the 6-character invite code the owner shared with you.</AppText>
      </View>

      <TextField
        label="Invite code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoFocus
      />

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Button label="Join team" loading={joinTeam.isPending} onPress={() => void onSubmit()} />
      </View>
    </Screen>
  );
}
