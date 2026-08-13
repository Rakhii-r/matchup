import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { SPORT_LABEL } from '@features/matches/domain/matchSchema';
import { CreateTeamSchema } from '@features/teams/domain/teamSchema';
import { useCreateTeam } from '@features/teams/presentation/useTeams';
import type { Sport } from '@shared/types/database.types';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

const SPORTS: Sport[] = ['box_cricket', 'badminton'];

export default function CreateTeamScreen(): React.ReactNode {
  const router = useRouter();
  const createTeam = useCreateTeam();
  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>('box_cricket');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    setError(null);
    const parsed = CreateTeamSchema.safeParse({ name, sport });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    try {
      const team = await createTeam.mutateAsync(parsed.data);
      router.replace({ pathname: '/teams/[id]', params: { id: team.id } });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not create the team.');
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

      <TextField
        label="Team name"
        value={name}
        onChangeText={setName}
        placeholder="Sunday Warriors"
        maxLength={50}
        autoFocus
      />

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
                {SPORT_LABEL[value]}
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
          loading={createTeam.isPending}
          onPress={() => void onSubmit()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
