import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import {
  useAttendance,
  useAttendanceActions,
  useMatch,
  useMatchPlayers,
  useMatchStatus,
  useMyMembership,
  usePlayerActions,
  useRequestToJoin,
} from '@features/matches/presentation/useMatches';
import type { PlayerWithProfile } from '@features/matches/data/matchRepository';
import { PLAYER_STATUS_LABEL, SPORT_LABEL } from '@features/matches/domain/matchSchema';
import { ReportBlockBar } from '@features/safety/presentation/ReportBlockBar';
import type { Match } from '@features/matches/domain/matchSchema';
import { colors, radius, spacing } from '@shared/theme';
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

const STATUS_COLOR: Record<Match['status'], string> = {
  open: colors.accent,
  locked: colors.warning,
  completed: colors.success,
  cancelled: colors.danger,
};

export default function MatchDetailScreen(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const userId = useAuthStore((s) => s.session?.user.id);

  const match = useMatch(matchId);
  const players = useMatchPlayers(matchId);
  const membership = useMyMembership(matchId);
  const attendance = useAttendance(matchId);

  const playerActions = usePlayerActions(matchId);
  const matchStatus = useMatchStatus(matchId);
  const attendanceActions = useAttendanceActions(matchId);
  const requestToJoin = useRequestToJoin(matchId);
  const [joinError, setJoinError] = useState<string | null>(null);

  const data = match.data;
  const isCreator = Boolean(data && userId && data.creator_id === userId);

  const onRequestToJoin = async (): Promise<void> => {
    setJoinError(null);
    try {
      await requestToJoin.mutateAsync();
    } catch (e) {
      setJoinError(e instanceof AppError ? e.message : 'Could not join that match.');
    }
  };

  const onCancelMatch = (): void => {
    Alert.alert(
      'Cancel this match?',
      'Everyone who joined will lose their place and the match will stop showing to nearby players. This cannot be undone.',
      [
        { text: 'Keep match', style: 'cancel' },
        {
          text: 'Cancel match',
          style: 'destructive',
          onPress: () => matchStatus.cancel.mutate(),
        },
      ],
    );
  };

  const attendedById = useMemo(
    () => new Map((attendance.data ?? []).map((a) => [a.user_id, a.attended])),
    [attendance.data],
  );

  const confirmedCount = useMemo(
    () => (players.data ?? []).filter((p) => p.status === 'confirmed').length,
    [players.data],
  );

  if (match.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Match' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (match.isError || !data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Match' }} />
        <View style={styles.center}>
          <AppText muted>This match could not be found.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void match.refetch()} />
        </View>
      </Screen>
    );
  }

  const canManage = data.status === 'open' || data.status === 'locked';
  const canMarkAttendance = data.status === 'locked' || data.status === 'completed';
  const actionsBusy = playerActions.setStatus.isPending || playerActions.remove.isPending;
  const isCancelled = data.status === 'cancelled';
  // A stranger who arrived from the nearby feed or a shared link: not the
  // organiser, and not yet in the queue. This is the only state that offers the
  // join action — once they have a membership row the status card takes over.
  const canRequestToJoin =
    !isCreator && !membership.isLoading && !membership.data && data.status === 'open';

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: data.match_name }} />

      {isCancelled ? (
        <View style={styles.cancelledBanner}>
          <AppText variant="label" color={colors.textInverse}>
            This match was cancelled
          </AppText>
          <AppText variant="caption" color={colors.textInverse}>
            The organiser called it off. It no longer appears to nearby players.
          </AppText>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="heading">{data.match_name}</AppText>
          <View style={[styles.badge, { backgroundColor: STATUS_COLOR[data.status] }]}>
            <AppText variant="caption" color={colors.textInverse}>
              {data.status}
            </AppText>
          </View>
        </View>
        <AppText variant="caption" muted>{SPORT_LABEL[data.sport]}</AppText>
        {data.venue_text ? <AppText muted>{data.venue_text}</AppText> : null}
        <AppText>{formatWhen(data.scheduled_at)}</AppText>
        <AppText variant="caption" muted>
          {confirmedCount} confirmed · {data.missing_count} needed
        </AppText>
        {data.notes ? (
          <AppText variant="caption" muted>
            {data.notes}
          </AppText>
        ) : null}
        {isCreator ? (
          <View style={styles.codeBox}>
            <AppText variant="caption" muted>
              Share code
            </AppText>
            <AppText variant="heading">{data.share_code}</AppText>
          </View>
        ) : null}
      </View>

      {canRequestToJoin ? (
        <View style={styles.card}>
          <AppText variant="label">Want in?</AppText>
          <AppText variant="caption" muted>
            The organiser reviews requests and confirms the final team. You&apos;ll see your
            status here once you ask to join.
          </AppText>
          <Button
            label="Request to join"
            loading={requestToJoin.isPending}
            onPress={() => void onRequestToJoin()}
          />
          {joinError ? (
            <AppText variant="caption" color={colors.danger}>
              {joinError}
            </AppText>
          ) : null}
          <ReportBlockBar
            targetUserId={data.creator_id}
            matchId={data.id}
            targetLabel="organiser"
          />
        </View>
      ) : null}

      {!isCreator && membership.data ? (
        <View style={styles.card}>
          <AppText variant="label">Your status</AppText>
          <AppText>{PLAYER_STATUS_LABEL[membership.data.status]}</AppText>
          {(data.status === 'open' || data.status === 'locked') &&
          membership.data.status !== 'confirmed' ? (
            <Button
              label="Withdraw"
              variant="danger"
              loading={playerActions.remove.isPending}
              onPress={() => playerActions.remove.mutate(membership.data!.id)}
            />
          ) : null}
          <ReportBlockBar
            targetUserId={data.creator_id}
            matchId={data.id}
            targetLabel="organiser"
          />
        </View>
      ) : null}

      {isCreator ? (
        <View style={{ gap: spacing.md }}>
          <AppText variant="label" muted>
            Players
          </AppText>

          {players.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (players.data ?? []).length === 0 ? (
            <AppText muted>No one has joined yet. Share your code above.</AppText>
          ) : (
            (players.data ?? []).map((p: PlayerWithProfile) => {
              const name = p.profile?.full_name ?? 'Player';
              const attended = attendedById.get(p.user_id);
              return (
                <View key={p.id} style={styles.playerRow}>
                  <View style={styles.playerInfo}>
                    <AppText variant="label">{name}</AppText>
                    <AppText variant="caption" muted>
                      {PLAYER_STATUS_LABEL[p.status]}
                    </AppText>
                  </View>

                  {canManage && p.status === 'interested' ? (
                    <View style={styles.playerActions}>
                      <Button
                        label="Approve"
                        disabled={actionsBusy}
                        onPress={() =>
                          playerActions.setStatus.mutate({ playerId: p.id, status: 'approved' })
                        }
                      />
                      <Button
                        label="Reject"
                        variant="secondary"
                        disabled={actionsBusy}
                        onPress={() => playerActions.remove.mutate(p.id)}
                      />
                    </View>
                  ) : null}

                  {canManage && p.status === 'approved' ? (
                    <View style={styles.playerActions}>
                      <Button
                        label="Confirm"
                        disabled={actionsBusy}
                        onPress={() =>
                          playerActions.setStatus.mutate({ playerId: p.id, status: 'confirmed' })
                        }
                      />
                      <Button
                        label="Remove"
                        variant="secondary"
                        disabled={actionsBusy}
                        onPress={() => playerActions.remove.mutate(p.id)}
                      />
                    </View>
                  ) : null}

                  {canMarkAttendance && p.status === 'confirmed' ? (
                    <View style={styles.playerActions}>
                      <Button
                        label={attended === true ? 'Present ✓' : 'Present'}
                        variant={attended === true ? 'primary' : 'secondary'}
                        disabled={attendanceActions.mark.isPending}
                        onPress={() =>
                          attendanceActions.mark.mutate({ userId: p.user_id, attended: true })
                        }
                      />
                      <Button
                        label={attended === false ? 'Absent ✓' : 'Absent'}
                        variant={attended === false ? 'danger' : 'secondary'}
                        disabled={attendanceActions.mark.isPending}
                        onPress={() =>
                          attendanceActions.mark.mutate({ userId: p.user_id, attended: false })
                        }
                      />
                    </View>
                  ) : null}
                  <ReportBlockBar targetUserId={p.user_id} matchId={data.id} />
                </View>
              );
            })
          )}

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {data.status === 'open' ? (
              <Button
                label="Lock team"
                loading={matchStatus.lock.isPending}
                disabled={confirmedCount === 0}
                onPress={() => matchStatus.lock.mutate()}
              />
            ) : null}
            {data.status === 'locked' ? (
              <Button
                label="Mark completed"
                loading={matchStatus.complete.isPending}
                onPress={() => matchStatus.complete.mutate()}
              />
            ) : null}
            {canManage ? (
              <Button
                label="Cancel match"
                variant="danger"
                loading={matchStatus.cancel.isPending}
                onPress={onCancelMatch}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxl,
  },
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancelledBanner: {
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    marginBottom: spacing.lg,
  },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  codeBox: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  playerRow: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playerInfo: { gap: 2 },
  playerActions: { flexDirection: 'row', gap: spacing.sm },
});
