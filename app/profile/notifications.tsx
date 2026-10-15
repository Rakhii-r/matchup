/**
 * Notification preferences.
 *
 * Fourteen notification kinds fired with no way to mute any of them. The
 * switches are keyed by GROUP rather than by kind, matching `notif_group` in
 * 20260831174915: a kind added later falls into an existing group server-side
 * and honours a choice already made here, instead of escaping it because
 * nobody remembered to add a row.
 *
 * An absent key means enabled, so a profile that has never opened this screen
 * keeps every notification and needed no backfill.
 */
import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { useUpdateNotifPrefs } from '@features/profile/presentation/useUpdateNotifPrefs';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';

const GROUPS: { key: string; label: string; description: string }[] = [
  {
    key: 'games',
    label: 'Games',
    description: 'Join requests, invites and confirmations for games you organise or play.',
  },
  {
    key: 'challenges',
    label: 'Challenges & offers',
    description: 'Teams offering to play you, and replies to challenges you posted.',
  },
  {
    key: 'toss_scoring',
    label: 'Toss & scoring',
    description: 'The toss is ready, the result is in, or the next round has started.',
  },
  { key: 'chat', label: 'Captain chat', description: 'Messages from the opposing captain.' },
  {
    key: 'slots',
    label: 'Slot reminders',
    description: 'A nudge 30 and 10 minutes before your booked slot ends.',
  },
];

export default function NotificationSettingsScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const profile = useAuthStore((s) => s.profile);
  const update = useUpdateNotifPrefs();

  const prefs = profile?.notif_prefs ?? {};

  const onToggle = (key: string, enabled: boolean): void => {
    update.mutate(
      { [key]: enabled },
      {
        onError: (e: unknown) =>
          Alert.alert(
            'Could not save',
            e instanceof Error ? e.message : 'Please check your connection and try again.',
          ),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <ScrollView contentContainerStyle={styles.list}>
        <AppText variant="caption" color={M.muted} style={styles.intro}>
          Turn off anything you would rather not be buzzed about. Everything is on
          unless you switch it off here.
        </AppText>

        {GROUPS.map((g) => {
          // Absent means enabled -- only an explicit false mutes.
          const enabled = prefs[g.key] !== false;
          return (
            <View key={g.key} style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText variant="label" color={M.text} style={{ fontSize: 16 }}>
                  {g.label}
                </AppText>
                <AppText variant="caption" color={M.muted} style={{ marginTop: 2 }}>
                  {g.description}
                </AppText>
              </View>
              <Switch
                value={enabled}
                disabled={update.isPending}
                onValueChange={(next) => onToggle(g.key, next)}
                trackColor={{ false: M.border, true: M.green }}
                accessibilityLabel={g.label}
              />
            </View>
          );
        })}

        <AppText variant="caption" color={M.faint} style={styles.footer}>
          Turning everything off here does not stop the app itself updating — you
          will still see activity when you open it.
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    list: { padding: S.md, gap: S.sm },
    intro: { marginBottom: S.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      backgroundColor: M.card,
      borderRadius: R.md,
      padding: S.md,
    },
    footer: { marginTop: S.md, paddingHorizontal: S.xs },
  });
