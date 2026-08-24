import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { CHALLENGE_STATUS_LABEL } from '@features/teams/domain/challengeSchema';
import type { ChallengeListItem } from '@features/teams/domain/challengeSchema';
import {
  useCancelChallenge,
  useMyChallenges,
  useRespondToChallenge,
} from '@features/teams/presentation/useChallenges';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${hh}:${mm}`;
}

export default function ChallengesScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const challenges = useMyChallenges();
  const respond = useRespondToChallenge();
  const cancel = useCancelChallenge();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { incoming, outgoing } = useMemo(() => {
    const rows = challenges.data ?? [];
    return {
      incoming: rows.filter((r) => r.direction === 'incoming'),
      outgoing: rows.filter((r) => r.direction === 'outgoing'),
    };
  }, [challenges.data]);

  const onAccept = (c: ChallengeListItem): void => {
    Alert.alert(
      'Accept this challenge?',
      `A match will be created at ${c.venue_name} on ${formatWhen(c.scheduled_at)}, and both squads go straight onto the sheet as confirmed.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Accept',
          onPress: () => {
            setBusyId(c.id);
            respond.mutate(
              { challengeId: c.id, accept: true },
              {
                onSuccess: (updated) => {
                  setBusyId(null);
                  if (updated.match_id) {
                    router.push({
                      pathname: '/match/[id]',
                      params: { id: updated.match_id },
                    });
                  }
                },
                onError: (e) => {
                  setBusyId(null);
                  Alert.alert(
                    'Could not accept',
                    e instanceof AppError ? e.message : 'Please try again.',
                  );
                },
              },
            );
          },
        },
      ],
    );
  };

  const onDecline = (c: ChallengeListItem): void => {
    setBusyId(c.id);
    respond.mutate(
      { challengeId: c.id, accept: false },
      {
        onSuccess: () => setBusyId(null),
        onError: (e) => {
          setBusyId(null);
          Alert.alert('Could not decline', e instanceof AppError ? e.message : 'Please try again.');
        },
      },
    );
  };

  const onCancel = (c: ChallengeListItem): void => {
    Alert.alert('Withdraw this challenge?', `${c.to_team_name} will no longer see it.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: () => {
          setBusyId(c.id);
          cancel.mutate(c.id, {
            onSuccess: () => setBusyId(null),
            onError: (e) => {
              setBusyId(null);
              Alert.alert(
                'Could not withdraw',
                e instanceof AppError ? e.message : 'Please try again.',
              );
            },
          });
        },
      },
    ]);
  };

  const renderRow = (c: ChallengeListItem): React.ReactNode => {
    const isOpenChallenge = c.status === 'open';
    const opponent =
      c.direction === 'incoming'
        ? c.from_team_name
        : isOpenChallenge
          ? 'Radar Opponent Search'
          : c.to_team_name;
    const busy = busyId === c.id;
    return (
      <View key={c.id} style={styles.row}>
        <View style={styles.rowHead}>
          <AppText variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {c.match_name}
          </AppText>
          <AppText variant="caption" muted>
            {c.is_expired && c.status === 'pending' ? 'Expired' : CHALLENGE_STATUS_LABEL[c.status]}
          </AppText>
        </View>

        <AppText variant="caption" muted>
          {c.direction === 'incoming' ? `From ${opponent}` : `To ${opponent}`}
        </AppText>
        <AppText variant="caption" muted>
          {c.venue_name} · {formatWhen(c.scheduled_at)} · {c.total_slots} players
        </AppText>
        {c.message ? (
          <AppText variant="caption" muted>
            “{c.message}”
          </AppText>
        ) : null}

        {isOpenChallenge && c.direction === 'outgoing' ? (
          <View style={styles.actions}>
            <Button
              label="⚡ View Live Radar"
              onPress={() =>
                router.push({
                  pathname: '/match/create/searching',
                  params: { challengeId: c.id },
                })
              }
            />
            <Button
              label="View Offers"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/teams/offers',
                  params: { challengeId: c.id },
                })
              }
            />
            {c.i_can_cancel ? (
              <Button
                label="Withdraw"
                variant="danger"
                disabled={busy}
                onPress={() => onCancel(c)}
              />
            ) : null}
          </View>
        ) : (
          <>
            {c.i_can_respond ? (
              <View style={styles.actions}>
                <Button label="Accept" disabled={busy} onPress={() => onAccept(c)} />
                <Button
                  label="Decline"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => onDecline(c)}
                />
              </View>
            ) : null}

            {c.i_can_cancel ? (
              <View style={styles.actions}>
                <Button
                  label="Withdraw"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => onCancel(c)}
                />
              </View>
            ) : null}

            {c.status === 'accepted' && c.match_id ? (
              <View style={styles.actions}>
                <Button
                  label="Open match"
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: '/match/[id]', params: { id: c.match_id as string } })
                  }
                />
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Challenges' }} />

      {challenges.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : challenges.isError ? (
        <View style={styles.notice}>
          <AppText muted>Could not load challenges.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void challenges.refetch()} />
        </View>
      ) : (challenges.data ?? []).length === 0 ? (
        <View style={styles.notice}>
          <AppText variant="label">No challenges yet</AppText>
          <AppText variant="caption" muted>
            Open one of your teams and challenge another squad with their invite code.
          </AppText>
        </View>
      ) : (
        <>
          <AppText variant="label" muted style={styles.heading}>
            INCOMING
          </AppText>
          {incoming.length === 0 ? (
            <AppText variant="caption" muted>
              Nothing here yet.
            </AppText>
          ) : (
            incoming.map(renderRow)
          )}

          <AppText variant="label" muted style={styles.heading}>
            SENT
          </AppText>
          {outgoing.length === 0 ? (
            <AppText variant="caption" muted>
              Nothing here yet.
            </AppText>
          ) : (
            outgoing.map(renderRow)
          )}
        </>
      )}
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    heading: { marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.5 },
    notice: { gap: spacing.sm, paddingVertical: spacing.lg, alignItems: 'flex-start' },
    row: {
      gap: 2,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  });
