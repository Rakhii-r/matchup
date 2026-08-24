import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useJoinByCode } from '@features/matches/presentation/useMatches';
import { JoinCodeSchema } from '@features/matches/domain/matchSchema';
import { spacing } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

export default function JoinMatchScreen(): React.ReactNode {
  const router = useRouter();
  const { colors } = useTheme();
  const joinByCode = useJoinByCode();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    setError(null);
    const parsed = JoinCodeSchema.safeParse({ code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the 6-character code.');
      return;
    }
    try {
      const match = await joinByCode.mutateAsync(parsed.data.code);
      router.replace({ pathname: '/match/[id]', params: { id: match.id } });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not join the match.');
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Join match' }} />
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <AppText variant="heading">Join a match</AppText>
        <AppText muted>Enter the 6-character code the organiser shared with you.</AppText>
      </View>

      <TextField
        label="Share code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoFocus
      />

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginBottom: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      <Button label="Join match" onPress={onSubmit} loading={joinByCode.isPending} />
    </Screen>
  );
}
