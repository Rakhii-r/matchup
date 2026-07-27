import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import {
  useAttendance,
  useAttendanceActions,
  useMatch,
  useMatchPlayers,
  useMatchStatus,
  useMyMembership,
  usePlayerActions,
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

  const data = match.data;
  const isCreator = Boolean(data && userId && data.creator_id === userId);

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

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: SPORT_LABEL[data.sport] }} />

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <AppText variant="heading">{SPORT_LABEL[data.sport]}</AppText>
          <View style={[styles.badge, { backgroundColor: STATUS_COLOR[data.status] }]}>
            <AppText variant="caption" color={colors.textInverse}>
              {data.status}
            </AppText>
          </View>
        </View>
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
