import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { CHALLENGE_STATUS_LABEL } from '@features/teams/domain/challengeSchema';
import type { ChallengeListItem } from '@features/teams/domain/challengeSchema';
import {
  useCancelChallenge,
  useMyChallenges,
  useRespondToChallenge,
} from '@features/teams/presentation/useChallenges';
import type { ChallengeStatus } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { IconTile } from '@shared/ui/decor';
import { IconCalendar, IconChevron, IconInbox, IconSwords, IconUsers } from '@shared/ui/icons';
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
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
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
      `A match will be created${c.venue_name ? ` at ${c.venue_name}` : ''} on ${formatWhen(c.scheduled_at)}, and both squads go straight onto the sheet as confirmed.`,
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
    Alert.alert('Withdraw this challenge?', `${c.to_team_name ?? 'Nearby teams'} will no longer see it.`, [
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

  /** Status colour: what is live is green, what failed is red, the rest is grey. */
  const tone = (status: ChallengeStatus, expired: boolean): { fg: string; bg: string } => {
    if (expired || status === 'expired' || status === 'declined') {
      return { fg: M.danger, bg: `${M.danger}1F` };
    }
    if (status === 'cancelled') return { fg: M.muted, bg: M.cardHi };
    return { fg: M.green, bg: M.chip };
  };

  const renderRow = (c: ChallengeListItem): React.ReactNode => {
    const isOpenChallenge = c.status === 'open';
    // An open challenge names no opponent at all, so `to_team_name` is null for
    // every one of them -- live, withdrawn or expired. Printing it raw is what
    // produced "To null".
    const opponent =
      c.direction === 'incoming'
        ? c.from_team_name
        : (c.to_team_name ?? (isOpenChallenge ? 'Radar opponent search' : 'Open challenge'));
    const busy = busyId === c.id;
    const expired = c.is_expired && c.status === 'pending';
    const t = tone(c.status, expired);
    const openGame =
      c.status === 'accepted' && c.match_id
        ? () => router.push({ pathname: '/match/[id]', params: { id: c.match_id as string } })
        : null;

    return (
      <View key={c.id} style={[styles.row, { borderLeftColor: t.fg }]}>
        <Pressable
          onPress={openGame ?? undefined}
          disabled={!openGame}
          style={styles.rowMain}
          accessibilityRole={openGame ? 'button' : undefined}
          accessibilityLabel={openGame ? `${c.match_name}. Open game` : undefined}
        >
          <IconTile size={48}>
            {c.to_team_name ? (
              <IconSwords color={M.green} size={22} />
            ) : (
              <IconUsers color={M.green} size={22} />
            )}
          </IconTile>

          <View style={styles.rowBody}>
            <View style={styles.rowHead}>
              <AppText variant="label" color={M.text} numberOfLines={1} style={styles.rowTitle}>
                {c.match_name}
              </AppText>
              <View style={[styles.statusPill, { backgroundColor: t.bg }]}>
                <AppText variant="caption" color={t.fg} style={styles.statusText}>
                  {expired ? 'Expired' : CHALLENGE_STATUS_LABEL[c.status]}
                </AppText>
              </View>
            </View>

            <AppText variant="caption" color={M.muted} numberOfLines={1} style={styles.rowLine}>
              {c.direction === 'incoming' ? `From ${opponent}` : `To ${opponent}`}
            </AppText>
            <View style={styles.whenRow}>
              <IconCalendar color={M.muted} size={15} />
              <AppText variant="caption" color={M.muted} numberOfLines={1} style={styles.whenText}>
                {c.venue_name ? `${c.venue_name} · ` : ''}
                {formatWhen(c.scheduled_at)} • {c.total_slots} players
              </AppText>
            </View>
            {c.message ? (
              <AppText variant="caption" color={M.muted} numberOfLines={2} style={styles.rowLine}>
                “{c.message}”
              </AppText>
            ) : null}
          </View>

          {openGame ? <IconChevron color={M.green} size={18} /> : null}
        </Pressable>

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
          </>
        )}
      </View>
    );
  };

  const emptyBox = (text: string): React.ReactNode => (
    <View style={styles.empty}>
      <IconTile size={44}>
        <IconInbox color={M.green} size={22} />
      </IconTile>
      <View style={{ flex: 1 }}>
        <AppText variant="label" color={M.text}>
          Nothing here yet.
        </AppText>
        <AppText variant="caption" color={M.muted}>
          {text}
        </AppText>
      </View>
    </View>
  );

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Challenges' }} />

      {challenges.isLoading ? (
        <ActivityIndicator color={M.green} />
      ) : challenges.isError ? (
        <View style={styles.notice}>
          <AppText color={M.muted}>Could not load challenges.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void challenges.refetch()} />
        </View>
      ) : (
        <>
          <AppText variant="label" color={M.muted} style={styles.heading}>
            INCOMING ({incoming.length})
          </AppText>
          {incoming.length === 0
            ? emptyBox('You’ll see incoming challenges from other teams here.')
            : incoming.map(renderRow)}

          <AppText variant="label" color={M.muted} style={styles.heading}>
            SENT ({outgoing.length})
          </AppText>
          {outgoing.length === 0
            ? emptyBox('Open one of your teams and challenge another squad with their invite code.')
            : outgoing.map(renderRow)}
        </>
      )}
    </Screen>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    heading: { marginTop: S.md, marginBottom: S.sm + 2, letterSpacing: 0.8 },
    notice: { gap: S.sm, paddingVertical: S.lg, alignItems: 'flex-start' },
    empty: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: M.border,
      backgroundColor: M.chip,
      marginBottom: S.sm,
    },
    row: {
      padding: S.md,
      marginBottom: S.sm + 4,
      borderRadius: R.lg,
      borderWidth: 1,
      borderLeftWidth: 4,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    rowMain: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 4 },
    rowBody: { flex: 1, minWidth: 0, gap: 3 },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    rowTitle: { flex: 1, fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    rowLine: { fontSize: 13 },
    whenRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    whenText: { flex: 1, fontSize: 13 },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill },
    statusText: { fontWeight: '700', fontSize: 12 },
    /*
      Wraps because the outgoing-open-fixture row carries THREE content-sized
      buttons -- "View Live Radar", "View Offers", "Withdraw" -- and Button has
      no style prop, so it sizes to its label plus 2 x spacing.lg of padding.
      On a 360dp phone that overflows, and without wrapping the third button is
      simply painted off the right edge with no way to reach it.
    */
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.sm,
      marginTop: S.sm + 4,
    },
  });
