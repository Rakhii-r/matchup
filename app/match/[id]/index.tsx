import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import {
  useAttendance,
  useAttendanceActions,
  useJoinOpenMatch,
  useMatch,
  useMatchPlayers,
  useMatchPlayersRealtime,
  useMatchSides,
  useMatchStatus,
  useMyMembership,
  usePlayerActions,
  useRematch,
  useRequestToJoin,
  useRespondToMatchInvite,
} from '@features/matches/presentation/useMatches';
import type { PlayerWithProfile } from '@features/matches/data/matchRepository';
import { PLAYER_STATUS_LABEL } from '@features/matches/domain/matchSchema';
import { ReportBlockBar } from '@features/safety/presentation/ReportBlockBar';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { Match } from '@features/matches/domain/matchSchema';
import type { Sport } from '@shared/types/database.types';
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

/** Plain-text invite for WhatsApp. Recipients type the code into Join with code. */
function buildShareText(match: Match, sportLabel: (s: Sport) => string): string {
  const lines = [
    `${match.match_name} — ${sportLabel(match.sport)}`,
    formatWhen(match.scheduled_at),
  ];
  if (match.venue_text || match.area_name) {
    lines.push((match.venue_text || match.area_name) as string);
  }
  lines.push(
    '',
    `We need ${match.missing_count} more.`,
    '',
    `Join code: ${match.share_code}`,
    'Open SIXFOUR 24 and tap "Join with code".',
  );
  return lines.join('\n');
}

const STATUS_COLOR = (colors: AppColors): Record<Match['status'], string> => ({
  open: colors.accent,
  locked: colors.warning,
  completed: colors.success,
  cancelled: colors.danger,
});

export default function MatchDetailScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const joinOpen = useJoinOpenMatch();
  const respondToInvite = useRespondToMatchInvite(matchId);
  const rematch = useRematch();

  // Requirement: the seat count and the Players list move the moment someone
  // joins, without a pull-to-refresh. `match_players` is the table Realtime
  // publishes, and filled_slots is derived from it by a trigger, so one
  // subscription keeps both honest.
  useMatchPlayersRealtime(matchId);
  const sportLabel = useSportLabel();
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [rematchError, setRematchError] = useState<string | null>(null);
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

  const now = new Date();
  const endTime = data?.end_time ? new Date(data.end_time) : null;
  const hasSlotTimeRemaining = Boolean(endTime && now < endTime);
  const canStartNextMatch = Boolean(
    data &&
    (isCreator || Boolean(membership.data)) &&
    data.status === 'completed' &&
    hasSlotTimeRemaining
  );

  const slotTimeRemainingFormatted = useMemo(() => {
    if (!endTime || now >= endTime) return null;
    const diffMs = endTime.getTime() - now.getTime();
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }, [endTime, now]);

  const onStartNextMatch = async (): Promise<void> => {
    setRematchError(null);
    try {
      const newMatch = await rematch.mutateAsync(matchId);
      router.push(`/match/${newMatch.id}/toss`);
    } catch (e) {
      setRematchError(e instanceof AppError ? e.message : 'Could not start next match.');
    }
  };

  const onRequestToJoin = async (): Promise<void> => {
    setJoinError(null);
    try {
      await requestToJoin.mutateAsync();
    } catch (e) {
      setJoinError(e instanceof AppError ? e.message : 'Could not join that match.');
    }
  };

  /**
   * Post a Match: the seat is taken immediately, with no organiser in the way.
   * Every refusal — full, already started, cancelled, or an overlapping match
   * of this player's own — is decided inside `join_open_match` under a row
   * lock, so the button stays enabled and the reason comes back as copy.
   */
  const onJoinOpenMatch = async (): Promise<void> => {
    setJoinError(null);
    try {
      await joinOpen.mutateAsync(matchId);
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

  // If match is already completed, redirect straight to the result & scorecard screen
  if (data.status === 'completed') {
    router.replace(`/match/${matchId}/result`);
    return (
      <Screen>
        <Stack.Screen options={{ title: data.match_name }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText muted style={{ marginTop: spacing.sm }}>
            Loading scorecard…
          </AppText>
        </View>
      </Screen>
    );
  }

  // Post a Match. `filled_slots` rather than the roster length is the seat
  // count here on purpose: a stranger who has not joined yet cannot read the
  // roster at all (list_match_players shows them only themselves), but they can
  // read the match row, so this is the only figure that is correct for
  // everybody looking at the screen.
  const isOpenMatch = data.match_type === 'open';
  const seatsTaken = data.filled_slots;
  const seatsLeft = Math.max(data.total_slots - seatsTaken, 0);
  const isFull = seatsLeft === 0;

  const canManage = data.status === 'open' || data.status === 'locked';
  const canMarkAttendance = data.status === 'locked';
  const actionsBusy = playerActions.setStatus.isPending || playerActions.remove.isPending;
  const isCancelled = data.status === 'cancelled';
  // A stranger who arrived from the nearby feed or a shared link: not the
  // organiser, and not yet in the queue. This is the only state that offers the
  // join action — once they have a membership row the status card takes over.
  const canRequestToJoin =
    !isCreator &&
    !isOpenMatch &&
    !membership.isLoading &&
    !membership.data &&
    data.status === 'open';

  // The open-match equivalent. Same "not me, not already in" test, but there is
  // no queue behind it — confirming takes the seat.
  const canJoinOpenMatch =
    isOpenMatch && !isCreator && !membership.isLoading && !membership.data && !isCancelled;

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
    const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(data, sportLabel))}`;
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
    // Who this person is on the sheet. Only an open match writes a row for its
    // creator, so this badge is exactly the HOST / PLAYER distinction the flow
    // is built around; a team fixture keeps the queue status it always showed.
    const isHost = p.user_id === data.creator_id;
    return (
      <View key={p.id} style={styles.playerRow}>
        <View style={styles.playerHead}>
          <View style={styles.playerInfo}>
            <AppText variant="label">
              {name}
              {p.user_id === userId ? ' (You)' : ''}
            </AppText>
            <AppText variant="caption" muted>
              {isOpenMatch
                ? isHost
                  ? 'Host · Creator'
                  : 'Player'
                : PLAYER_STATUS_LABEL[p.status]}
            </AppText>
          </View>
          {isOpenMatch ? (
            <View style={[styles.roleBadge, isHost ? styles.roleBadgeHost : null]}>
              <AppText variant="caption" color={isHost ? colors.textInverse : colors.textMuted}>
                {isHost ? 'CREATOR' : 'PLAYER'}
              </AppText>
            </View>
          ) : null}
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
          <View style={[styles.badge, { backgroundColor: STATUS_COLOR(colors)[data.status] }]}>
            <AppText variant="caption" color={colors.textInverse}>
              {data.status}
            </AppText>
          </View>
        </View>
        <AppText variant="caption" muted>{sportLabel(data.sport)}</AppText>
        {data.venue_text || data.area_name ? (
          <AppText muted>{data.venue_text || data.area_name}</AppText>
        ) : null}
        <AppText>{formatWhen(data.scheduled_at)}</AppText>
        {isOpenMatch ? (
          <>
            <AppText variant="caption" color={colors.primaryDark}>
              Open for all players to join
            </AppText>
            <View style={styles.seatRow}>
              <AppText variant="label">
                {seatsTaken} / {data.total_slots} Players
              </AppText>
              <AppText variant="caption" color={isFull ? colors.warning : colors.textMuted}>
                {isFull ? 'MATCH FULL' : `${seatsLeft} ${seatsLeft === 1 ? 'spot' : 'spots'} left`}
              </AppText>
            </View>
          </>
        ) : (
          <AppText variant="caption" muted>
            {confirmedCount} confirmed · {data.missing_count} needed
          </AppText>
        )}
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
        Post a Match, seen by someone who has not joined. No approval copy,
        because there is no approval: the seat is theirs on tap. The button is
        only withheld when there is genuinely nothing to tap — the sheet is
        full, or the match is no longer taking players.
      */}
      {canJoinOpenMatch ? (
        <View style={styles.card}>
          <AppText variant="label">
            {isFull ? 'This match is full' : 'Join this match'}
          </AppText>
          <AppText variant="caption" muted>
            {isFull
              ? `All ${data.total_slots} places have been taken.`
              : 'You will join this match as an individual player. No team needed.'}
          </AppText>
          <AppText variant="caption" muted>
            {seatsTaken} / {data.total_slots} players
            {isFull ? '' : ` · ${seatsLeft} ${seatsLeft === 1 ? 'spot' : 'spots'} left`}
          </AppText>
          {data.status === 'open' && !isFull ? (
            <Button
              label="Confirm join"
              loading={joinOpen.isPending}
              onPress={() => void onJoinOpenMatch()}
            />
          ) : null}
          {data.status !== 'open' && !isFull ? (
            <AppText variant="caption" muted>
              This match is no longer taking players.
            </AppText>
          ) : null}
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
          <AppText variant="label">
            {isOpenMatch ? "You've joined this match" : 'Your status'}
          </AppText>
          <AppText>
            {isOpenMatch
              ? `You are one of the ${seatsTaken} players on the sheet.`
              : PLAYER_STATUS_LABEL[membership.data.status]}
          </AppText>
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
        Time left in slot — Play Again / Next Match card
      */}
      {canStartNextMatch ? (
        <View style={styles.card}>
          <AppText variant="label">Time left in your slot</AppText>
          <AppText variant="caption" muted>
            The slot runs until {data.end_time ? formatWhen(data.end_time).split(', ')[1] ?? formatWhen(data.end_time) : 'the booked end time'}. Start another match with the same players?
          </AppText>
          {slotTimeRemainingFormatted ? (
            <AppText variant="caption" color={colors.accent}>
              Time remaining: {slotTimeRemainingFormatted}
            </AppText>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="⚡ Start Next Match"
              loading={rematch.isPending}
              onPress={() => void onStartNextMatch()}
            />
          </View>
          {rematchError ? (
            <AppText variant="caption" color={colors.danger}>
              {rematchError}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {/*
        Toss. Shown to all players on the sheet for any uncancelled match.
      */}
      {!isCancelled ? (
        <View style={styles.card}>
          <AppText variant="label">Toss</AppText>
          <AppText variant="caption" muted>
            Decides who bats first. Either captain or organiser can flip; the result is generated on
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
        read-only, and only the scorer sees the keypad.
      */}
      {!isCancelled ? (
        <View style={styles.card}>
          <AppText variant="label">Scoring</AppText>
          <AppText variant="caption" muted>
            Ball by ball. The first captain or organiser to start the innings scores the
            match; everyone else follows live.
          </AppText>
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <Button
              label="Live scoring"
              variant="primary"
              onPress={() => router.push(`/match/${matchId}/score`)}
            />
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

      {isCreator && isOpenMatch ? (
        <View style={styles.card}>
          <AppText variant="label">
            {isFull ? 'Your match is full' : `${seatsLeft} ${seatsLeft === 1 ? 'spot' : 'spots'} remaining`}
          </AppText>
          <AppText variant="caption" muted>
            {isFull
              ? 'Nobody else can join. Lock the match when you are ready.'
              : 'Share the match so the remaining places fill up.'}
          </AppText>
          <Button label="Share match" variant="secondary" onPress={onShareWhatsApp} />
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

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
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
    playerInfo: { flex: 1, gap: 2 },
    playerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    playerActions: { flexDirection: 'row', gap: spacing.sm },
    roleBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    roleBadgeHost: { backgroundColor: colors.primary, borderColor: colors.primary },
    seatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
  });
