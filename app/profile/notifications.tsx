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
import { useMemo, useState } from 'react';
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

/** Mid grey: visible as an empty track on both light and dark cards. */
const SWITCH_TRACK_OFF = '#94A3B8';

export default function NotificationSettingsScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const update = useUpdateNotifPrefs();

  // What the switches show. Seeded once from the profile and flipped locally on
  // tap, so a switch moves in the same frame as the finger -- it no longer
  // waits on the network or on an app-wide profile re-render. Absent means
  // enabled; only an explicit false mutes.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const saved = (useAuthStore.getState().profile?.notif_prefs ?? {}) as Record<string, boolean>;
    return Object.fromEntries(GROUPS.map((g) => [g.key, saved[g.key] !== false]));
  });

  const onToggle = (key: string, next: boolean): void => {
    setEnabled((prev) => ({ ...prev, [key]: next }));
    update.mutate(
      { [key]: next },
      {
        onError: (e: unknown) => {
          // Put back only this switch; others may have saved since.
          setEnabled((prev) => ({ ...prev, [key]: !next }));
          Alert.alert(
            'Could not save',
            e instanceof Error ? e.message : 'Please check your connection and try again.',
          );
        },
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
          const on = enabled[g.key] ?? true;
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
              {/*
                Never disabled while saving: greying every switch out on each
                tap was half of the reported flicker. Taps queue instead (see
                useUpdateNotifPrefs).
              */}
              <Switch
                value={on}
                onValueChange={(next) => onToggle(g.key, next)}
                // Explicit on both platforms: Android's default ON thumb is a
                // pale teal that testers read as "not on", and M.border made
                // the OFF track nearly invisible.
                trackColor={{ false: SWITCH_TRACK_OFF, true: M.green }}
                thumbColor={on ? '#FFFFFF' : '#F1F5F9'}
                ios_backgroundColor={SWITCH_TRACK_OFF}
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
