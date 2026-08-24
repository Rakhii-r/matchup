/**
 * Sports management — superadmin only.
 *
 * The `sports` table is the single source of truth: what is listed here is
 * exactly what normal users can pick on Home, Create Match and profile
 * preferences. Hiding a sport removes it everywhere on the next refetch.
 *
 * There is deliberately no "add sport" control. Every sport column in the
 * database (matches, teams, profiles, availability) carries a CHECK constraint
 * pinning it to the supported keys, so a genuinely new sport is a migration,
 * not a row insert. The previous version of this screen showed an Add field
 * whose only code path was `throw` — a button that could never succeed.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import type { ManagedSport } from '@features/sports/data/sportsRepository';
import {
  useAllSports,
  useRenameSport,
  useSetSportActive,
} from '@features/sports/presentation/useSports';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

export default function SportsManagement(): React.ReactNode {
  const { colors } = useTheme();
  const sports = useAllSports();

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Sports management' }} />
      <AppText variant="heading">Sports management</AppText>
      <AppText muted variant="caption" style={{ marginBottom: spacing.lg }}>
        Hidden sports disappear from Home, Create Match and profile preferences for
        every user. Adding a brand-new sport requires a database migration.
      </AppText>

      {sports.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : sports.isError ? (
        <AppText color={colors.danger}>Could not load sports.</AppText>
      ) : (
        (sports.data ?? []).map((s) => <SportRow key={s.id} sport={s} />)
      )}
    </Screen>
  );
}

function SportRow({ sport }: { sport: ManagedSport }): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const setActive = useSetSportActive();
  const rename = useRenameSport();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sport.name);
  const [error, setError] = useState<string | null>(null);

  const submitRename = async (): Promise<void> => {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 50) {
      setError('Name must be between 2 and 50 characters.');
      return;
    }
    try {
      setError(null);
      await rename.mutateAsync({ id: sport.id, name: clean });
      setEditing(false);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not rename this sport.');
    }
  };

  return (
    <View style={styles.row}>
      {editing ? (
        <View style={{ gap: spacing.sm }}>
          <TextField label="Display name" value={name} onChangeText={setName} maxLength={50} />
          {error ? <AppText color={colors.danger}>{error}</AppText> : null}
          <View style={styles.actions}>
            <Button label="Save" loading={rename.isPending} onPress={() => void submitRename()} />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setName(sport.name);
                setError(null);
                setEditing(false);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <AppText variant="label">{sport.name}</AppText>
            <AppText muted variant="caption">
              {sport.sport} · {sport.is_active ? 'ACTIVE' : 'HIDDEN'}
            </AppText>
          </View>
          <View style={styles.actions}>
            <Button label="Rename" variant="secondary" onPress={() => setEditing(true)} />
            <Button
              label={sport.is_active ? 'Hide' : 'Show'}
              variant="secondary"
              loading={setActive.isPending}
              onPress={() => setActive.mutate({ id: sport.id, isActive: !sport.is_active })}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    row: {
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: spacing.sm,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    actions: { flexDirection: 'row', gap: spacing.sm },
  });
