import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import {
  useAttendance,
  useAttendanceActions,
  useMatch,
  useMatchPlayers,
  useMatchSides,
  useMatchStatus,
  useMyMembership,
  usePlayerActions,
  useRequestToJoin,
  useRespondToMatchInvite,
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

/** Plain-text invite for WhatsApp. Recipients type the code into Join with code. */
function buildShareText(match: Match): string {
  const lines = [
    `${match.match_name} — ${SPORT_LABEL[match.sport]}`,
    formatWhen(match.scheduled_at),
  ];
  if (match.venue_text) lines.push(match.venue_text);
  lines.push(
    '',
    `We need ${match.missing_count} more.`,
    '',
    `Join code: ${match.share_code}`,
    'Open SIXFOUR 24 and tap "Join with code".',
  );
  return lines.join('\n');
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
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.user.id);

  const match = useMatch(matchId);
  const players = useMatchPlayers(matchId);
  const sides = useMatchSides(matchId);
  const membership = useMyMembership(matchId);
  const attendance = useAttendance(matchId);

  const playerActions = usePlayerActions(matchId);
  const matchStatus = useMatchStatus(matchId);
  const attendanceActions = useAttendanceActions(matchId);
  const requestToJoin = useRequestToJoin(matchId);
  const respondToInvite = useRespondToMatchInvite(matchId);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "Copied" label reverts on a timer, so it must not fire after unmount.
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

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

  /**
   * Answer an invite raised when this player's squad was booked into a team
   * fixture. Declining cannot be undone — the RPC refuses a second answer with
   * INVITE_ALREADY_ANSWERED — so it asks first.
   */
  const onRespondToInvite = async (accept: boolean): Promise<void> => {
    setInviteError(null);
    try {
      await respondToInvite.mutateAsync(accept);
    } catch (e) {
      setInviteError(e instanceof AppError ? e.message : 'Could not save your reply.');
    }
  };

  const onDeclineInvite = (): void => {
    Alert.alert(
      'Cannot play this match?',
      'Your organiser will be told so they can find a replacement. You cannot undo this.',
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'I cannot play',
          style: 'destructive',
          onPress: () => void onRespondToInvite(false),
        },
      ],
    );
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

  const onCopyCode = (): void => {
    Clipboard.setStringAsync(data.share_code)
      .then(() => {
        setCodeCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCodeCopied(false), 2000);
      })
      .catch(() => {
        Alert.alert('Could not copy', `Share code: ${data.share_code}`);
      });
  };

  const onShareWhatsApp = (): void => {
    // wa.me is a universal link: opens the WhatsApp app when installed, and
    // WhatsApp Web in a browser otherwise. Unlike the whatsapp:// scheme it
    // needs no Android <queries> manifest entry.
    const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(data))}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open WhatsApp', `Send this code instead: ${data.share_code}`);
    });
  };

  // A team fixture has two sides; an ordinary match has none and renders one
  // flat list. Splitting here rather than in the query keeps the roster a
  // single fetch.
  const roster = players.data ?? [];
  const sideA = roster.filter((p) => p.side === 'a');
  const sideB = roster.filter((p) => p.side === 'b');
  const unsided = roster.filter((p) => p.side === null);
  const isFixture = sideA.length > 0 || sideB.length > 0;

  // Anyone actually on the sheet may see the roster. Previously this whole
  // block was gated on isCreator, so the opposing captain opened the match and
  // saw no players at all.
  const canSeeRoster = isCreator || Boolean(membership.data);

  const renderPlayer = (p: PlayerWithProfile): React.ReactNode => {
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

        {/* Every action below belongs to the organiser alone. */}
        {isCreator && canManage && p.status === 'interested' ? (
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

        {isCreator && canManage && p.status === 'approved' ? (
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

        {isCreator && canMarkAttendance && p.status === 'confirmed' ? (
          <View style={styles.playerActions}>
            <Button
              label={attended === true ? 'Present ✓' : 'Present'}
              variant={attended === true ? 'primary' : 'secondary'}
              disabled={attendanceActions.mark.isPending}
              onPress={() => attendanceActions.mark.mutate({ userId: p.user_id, attended: true })}
            />
            <Button
              label={attended === false ? 'Absent ✓' : 'Absent'}
              variant={attended === false ? 'danger' : 'secondary'}
              disabled={attendanceActions.mark.isPending}
              onPress={() => attendanceActions.mark.mutate({ userId: p.user_id, attended: false })}
            />
          </View>
        ) : null}

        {/* Never offer to report or block yourself. */}
        {p.user_id !== userId ? (
          <ReportBlockBar targetUserId={p.user_id} matchId={data.id} />
        ) : null}
      </View>
    );
  };

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
              {codeCopied ? 'Copied' : 'Share code — tap to copy'}
            </AppText>
            <Pressable onPress={onCopyCode} accessibilityRole="button" hitSlop={8}>
              <AppText variant="heading">{data.share_code}</AppText>
            </Pressable>
            {data.status === 'open' ? (
              <Button
                label="Share on WhatsApp"
                variant="secondary"
                onPress={onShareWhatsApp}
              />
            ) : null}
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

      {/*
        Invited: the app put this player on the sheet because their squad was
        booked into a fixture. They have not agreed to anything yet, and they
        are not counted in filled_slots until they do.
      */}
      {!isCreator && membership.data?.status === 'invited' && !isCancelled ? (
        <View style={styles.card}>
          <AppText variant="label">Can you make it?</AppText>
          <AppText variant="caption" muted>
            Your team was booked into this match. You are not counted until you confirm.
          </AppText>
          <Button
            label="Confirm I'm playing"
            loading={respondToInvite.isPending}
            onPress={() => void onRespondToInvite(true)}
          />
          <Button
            label="I can't play"
            variant="secondary"
            disabled={respondToInvite.isPending}
            onPress={onDeclineInvite}
          />
          {inviteError ? (
            <AppText variant="caption" color={colors.danger}>
              {inviteError}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!isCreator && membership.data ? (
        <View style={styles.card}>
          <AppText variant="label">Your status</AppText>
          <AppText>{PLAYER_STATUS_LABEL[membership.data.status]}</AppText>
          {/*
            An invited player answers with the card above; offering Withdraw as
            well would be two buttons for the same decision, and Withdraw
            deletes the row rather than telling the organiser why.
          */}
          {(data.status === 'open' || data.status === 'locked') &&
          membership.data.status !== 'confirmed' &&
          membership.data.status !== 'invited' ? (
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

      {/*
        Toss. Only for a real fixture — a casual match has no captains, and
        perform_toss refuses it with NOT_A_FIXTURE. Shown to every player, not
        just captains, because the rest of the squad wants to know who bats.
      */}
      {isFixture && !isCancelled ? (
        <View style={styles.card}>
          <AppText variant="label">Toss</AppText>
          <AppText variant="caption" muted>
            Decides who bats first. Either captain can flip; the result is generated on
            the server.
          </AppText>
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Open toss"
              variant="secondary"
              onPress={() => router.push(`/match/${matchId}/toss`)}
            />
          </View>
        </View>
      ) : null}

      {/*
        Scoring. Open to everyone on the sheet — watchers get the live score
        read-only, and only the scorer sees the keypad. Gating this on
        "am I the scorer" would hide the live score from the other 21 people.
      */}
      {isFixture && !isCancelled ? (
        <View style={styles.card}>
          <AppText variant="label">Scoring</AppText>
          <AppText variant="caption" muted>
            Ball by ball. The first captain or organiser to start the innings scores the
            match; everyone else follows live.
          </AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <Button label="Live scoring" onPress={() => router.push(`/match/${matchId}/score`)} />
            <Button
              label="Scorecard"
              variant="secondary"
              onPress={() => router.push(`/match/${matchId}/scorecard`)}
            />
          </View>
        </View>
      ) : null}

      {canSeeRoster ? (
        <View style={{ gap: spacing.md }}>
          {players.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : roster.length === 0 ? (
            <>
              <AppText variant="label" muted>
                Players
              </AppText>
              <AppText muted>
                {isCreator
                  ? 'No one has joined yet. Share your code above.'
                  : 'No players on the sheet yet.'}
              </AppText>
            </>
          ) : isFixture ? (
            <>
              {/*
                Two squads, labelled. Team names come from get_match_sides
                because `teams` is members-only — the opposing captain cannot
                read your team's name through a plain select.
              */}
              <AppText variant="label" muted>
                {sides.data?.team_a_name ?? 'Home side'} · {sideA.length}
              </AppText>
              {sideA.map(renderPlayer)}

              <AppText variant="label" muted>
                {sides.data?.team_b_name ?? 'Away side'} · {sideB.length}
              </AppText>
              {sideB.length > 0 ? (
                sideB.map(renderPlayer)
              ) : (
                <AppText variant="caption" muted>
                  No one from this squad has confirmed yet.
                </AppText>
              )}

              {/* Anyone who joined by code or browsing, not through a squad. */}
              {unsided.length > 0 ? (
                <>
                  <AppText variant="label" muted>
                    Other players · {unsided.length}
                  </AppText>
                  {unsided.map(renderPlayer)}
                </>
              ) : null}
            </>
          ) : (
            <>
              <AppText variant="label" muted>
                Players
              </AppText>
              {roster.map(renderPlayer)}
            </>
          )}
        </View>
      ) : null}

      {isCreator ? (
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
    gap: spacing.sm,
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
