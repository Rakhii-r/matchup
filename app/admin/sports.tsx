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
      <Stack.Screen options={{ title: 'Sports Management' }} />
      <AppText muted variant="caption" style={{ marginBottom: spacing.lg }}>
        Disabled sports disappear from Home, Create Game, and profile preferences for
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
          <View style={styles.titleRow}>
            <AppText variant="heading" numberOfLines={1} style={styles.name}>
              {sport.name}
            </AppText>
            <View
              style={[
                styles.badge,
                { backgroundColor: sport.is_active ? `${colors.primary}20` : `${colors.textMuted}20` },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color: sport.is_active ? colors.primary : colors.textMuted,
                  fontWeight: '700',
                }}
              >
                {sport.is_active ? 'Active' : 'Disabled'}
              </AppText>
            </View>
          </View>
          <AppText muted variant="caption">
            Sport key: {sport.sport}
          </AppText>
          {/* Under the name, not beside it: two buttons do not fit next to a
              name and a badge on a phone, and overlapped them. */}
          <View style={styles.btnRow}>
            <View style={styles.btnCell}>
              <Button label="Rename" variant="secondary" onPress={() => setEditing(true)} />
            </View>
            <View style={styles.btnCell}>
              <Button
                label={sport.is_active ? 'Disable' : 'Enable'}
                variant={sport.is_active ? 'danger' : 'primary'}
                loading={setActive.isPending}
                onPress={() => setActive.mutate({ id: sport.id, isActive: !sport.is_active })}
              />
            </View>
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
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: spacing.md,
    },
    head: { gap: 4 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    name: { flexShrink: 1, fontSize: 18 },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    btnRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm + 4,
    },
    btnCell: { flex: 1 },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
  });
