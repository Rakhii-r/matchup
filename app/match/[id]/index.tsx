import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { useAuthStore } from '@core/auth/authStore';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import { AppError } from '@core/errors/AppError';
import { LineupPickerSheet } from '@features/matches/presentation/LineupPickerSheet';
import { useSetMatchLineup } from '@features/matches/presentation/useLineup';
import {
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
import { useSlotCountdown } from '@features/matches/presentation/useSlotCountdown';
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
  // Muted, not danger: nothing went wrong, the slot simply ran out.
  expired: colors.textMuted,
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
  const setLineup = useSetMatchLineup(matchId);
  const [pickingLineup, setPickingLineup] = useState(false);
  const sides = useMatchSides(matchId);
  const membership = useMyMembership(matchId);

  const playerActions = usePlayerActions(matchId);
  const matchStatus = useMatchStatus(matchId);
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

  // A finished match belongs on the result screen.
  //
  // Two things matter here. It is an EFFECT, not a call in the render body:
  // navigating while React is rendering re-enters this component mid-commit and
  // then fires again on every render until it unmounts. And it is a FOCUS
  // effect, because a native stack keeps this screen alive underneath the score
  // and result screens — a plain effect firing from down there would replace
  // whatever route is on top instead of this one. `replace` takes this screen
  // out of the stack, so back from the result goes where it came from rather
  // than bouncing off this redirect.
  const isCompleted = match.data?.status === 'completed';
  useFocusEffect(
    useCallback(() => {
      if (isCompleted) router.replace(`/match/${matchId}/result`);
    }, [isCompleted, matchId, router]),
  );

  const data = match.data;
  const isCreator = Boolean(data && userId && data.creator_id === userId);
  const isCaptain = Boolean(
    isCreator ||
      membership.data?.role === 'creator' ||
      (data?.team_b_id && membership.data?.status === 'confirmed'),
  );

  /*
    Who may open the captains' chat. NOT `isCaptain` above: that is true for any
    confirmed player on a team fixture, while `send_captain_message` admits only
    the OWNER of team A or team B. Offering the button on the looser rule sent
    every other player to "Only the two team captains can use this chat."
  */
  const myTeams = useMyTeamsOverview();
  const isTeamCaptain = (myTeams.data ?? []).some(
    (t) => t.i_am_owner && (t.id === data?.team_a_id || t.id === data?.team_b_id),
  );


  /**
   * The booked slot. Shared with the result and scoring screens rather than
   * recomputed here — this screen used to keep its own copy, which recreated
   * `new Date()` on every render (so its useMemo never memoised) and, worse,
   * gated on `endTime && now < endTime`. A null `end_time` means the match has
   * NO booked slot, not that the slot has run out, so that test hid "Start Next
   * Match" on every one of the 19 matches created before the slot became
   * mandatory — the exact gating `create_rematch` was changed to stop doing.
   */
  const slot = useSlotCountdown(data?.end_time);

  const canStartNextMatch = Boolean(
    data &&
    (isCreator || Boolean(membership.data)) &&
    data.status === 'completed' &&
    // Not `hasSlot && !expired`: no slot means no cut-off to be past.
    !slot.expired &&
    // create_rematch is organiser-only, so anyone else would only reach
    // NOT_THE_ORGANISER by tapping. Was `isCreator || membership.data`.
    isCreator
  );

  const onStartNextMatch = async (): Promise<void> => {
    setRematchError(null);
    try {
      const newMatch = await rematch.mutateAsync(matchId);
      router.push(`/match/${newMatch.id}/toss`);
    } catch (e) {
      setRematchError(e instanceof AppError ? e.message : 'Could not start the next round.');
    }
  };

  const onRequestToJoin = async (): Promise<void> => {
    setJoinError(null);
    try {
      await requestToJoin.mutateAsync();
    } catch (e) {
      setJoinError(e instanceof AppError ? e.message : 'Could not join that game.');
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
      setJoinError(e instanceof AppError ? e.message : 'Could not join that game.');
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
      'Cannot play this game?',
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

  /**
   * Start the match: lock the sheet, then go straight to the Match Center.
   *
   * Locking is what "started" means here (see the CTA below), and it is not
   * reversible from the UI, so it asks first. Navigation hangs off the
   * mutation's success rather than firing alongside it -- landing on the
   * scoring console while the server is still refusing to start an innings on
   * an open match is worse than a moment's wait on the button.
   */
  const onStartMatch = (): void => {
    Alert.alert(
      'Start the match?',
      'Nobody else can join once the match starts, and the toss and scoring open up.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Start match',
          onPress: () =>
            matchStatus.lock.mutate(undefined, {
              onSuccess: () => router.push(`/match/${matchId}/live`),
              onError: (e: unknown) =>
                Alert.alert(
                  'Could not start',
                  e instanceof AppError ? e.message : 'Could not start the match.',
                ),
            }),
        },
      ],
    );
  };

  const onCancelMatch = (): void => {
    Alert.alert(
      'Cancel this game?',
      'Everyone who joined will lose their place and the game will stop showing to nearby players. This cannot be undone.',
      [
        { text: 'Keep game', style: 'cancel' },
        {
          text: 'Cancel game',
          style: 'destructive',
          onPress: () => matchStatus.cancel.mutate(),
        },
      ],
    );
  };

  const confirmedCount = useMemo(
    () => (players.data ?? []).filter((p) => p.status === 'confirmed').length,
    [players.data],
  );

  if (match.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Game' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (match.isError || !data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Game' }} />
        <View style={styles.center}>
          <AppText muted>This game could not be found.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void match.refetch()} />
        </View>
      </Screen>
    );
  }

  // Already completed — the effect above is sending us to the result screen.
  // This is just what is on screen for the frame or two until it lands.
  if (data.status === 'completed') {
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
  const actionsBusy = playerActions.setStatus.isPending || playerActions.remove.isPending;
  const isCancelled = data.status === 'cancelled';
  // Its time ran out and expire_stale_matches() closed it. Every action the
  // screen gates on "cancelled" must gate on this too -- an expired game is
  // just as over, and the server refuses joins, venue changes and toss on it.
  const isExpired = data.status === 'expired';
  const isOver = isCancelled || isExpired;
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
    isOpenMatch && !isCreator && !membership.isLoading && !membership.data && !isOver;

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

  /*
    THE SQUAD THIS VIEWER STILL OWES.

    Only ONE captain is present when a fixture is accepted, so only their squad
    is named there; the other captain names theirs here. Their side has just
    themselves on it until they do, which is why "1 of 4" is the trigger rather
    than any flag — the seat count IS the state.
  */
  // The seat itself carries the team, so there is no need to infer it from the
  // role — and a captain is the only person who can act on it anyway.
  const myTeamId = isCaptain ? membership.data?.team_id ?? null : null;
  const iAmHomeSide = Boolean(myTeamId) && myTeamId === data?.team_a_id;
  const myTeamName = iAmHomeSide ? sides.data?.team_a_name : sides.data?.team_b_name;
  const mySideCount = iAmHomeSide ? sideA.length : sideB.length;
  const lineupFormat = Math.max(Math.floor((data?.total_slots ?? 0) / 2), 1);
  const needsLineup =
    Boolean(myTeamId) && !isOver && data?.match_type === 'team_vs_team' && mySideCount < lineupFormat;
  const unsided = roster.filter((p) => p.side === null);
  const isFixture = sideA.length > 0 || sideB.length > 0;

  // Anyone actually on the sheet may see the roster. Previously this whole
  // block was gated on isCreator, so the opposing captain opened the match and
  // saw no players at all.
  const canSeeRoster = isCreator || Boolean(membership.data);

  const renderPlayer = (p: PlayerWithProfile): React.ReactNode => {
    const name = p.profile?.full_name ?? 'Player';
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

      {isOver ? (
        <View style={styles.cancelledBanner}>
          <AppText variant="label" color={colors.textInverse}>
            {isCancelled ? 'This game was cancelled' : 'This game is over'}
          </AppText>
          <AppText variant="caption" color={colors.textInverse}>
            {isCancelled
              ? 'The organiser called it off. It no longer appears to nearby players.'
              : 'Its time ran out before a result was recorded. It no longer appears to nearby players.'}
          </AppText>
        </View>
      ) : null}

      {data.challenge_id ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/match/create/searching',
              params: { challengeId: data.challenge_id },
            })
          }
          style={styles.radarBanner}
          accessibilityRole="button"
          accessibilityLabel="View Live Radar Scanner"
        >
          <View style={styles.radarPill}>
            <View style={styles.radarDot} />
            <AppText variant="caption" color="#000" style={{ fontWeight: '800', fontSize: 10 }}>
              LIVE RADAR
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label" color="#FFFFFF" numberOfLines={1}>
              Opponent Radar Active
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.7)">
              Tap to open live radar and scan nearby teams
            </AppText>
          </View>
          <AppText variant="label" color="#6cf8bb">
            View →
          </AppText>
        </Pressable>
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
                {isFull ? 'GAME FULL' : `${seatsLeft} ${seatsLeft === 1 ? 'spot' : 'spots'} left`}
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
            {isFull ? 'This game is full' : 'Join this game'}
          </AppText>
          <AppText variant="caption" muted>
            {isFull
              ? `All ${data.total_slots} places have been taken.`
              : 'You will join this game as an individual player. No team needed.'}
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
              This game is no longer taking players.
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
      {!isCreator && membership.data?.status === 'invited' && !isOver ? (
        <View style={styles.card}>
          <AppText variant="label">Can you make it?</AppText>
          <AppText variant="caption" muted>
            Your team was booked into this game. You are not counted until you confirm.
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
            {isOpenMatch ? "You've joined this game" : 'Your status'}
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
        Start the next game in this booked slot. Hidden once the slot has
        passed; a match with no slot at all has no cut-off and keeps the card.
      */}
      {canStartNextMatch ? (
        <View style={styles.card}>
          <AppText variant="label">
            {slot.hasSlot ? 'Time left in your slot' : 'Play another round'}
          </AppText>
          <AppText variant="caption" muted>
            {slot.hasSlot
              ? `The slot runs until ${slot.endsAtLabel}. Start another match with the same players?`
              : 'This game has no booked end time, so nothing is counting down. Start another with the same players?'}
          </AppText>
          {slot.label ? (
            <AppText variant="caption" color={colors.accent}>
              {slot.label}
            </AppText>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="⚡ Start Next Round"
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
        Captain-to-Captain Chat for Team Fixtures
      */}
      {!isOver && data && data.team_a_id && data.team_b_id && isTeamCaptain ? (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="label">Captains Chat 💬</AppText>
            <View style={[styles.badge, { backgroundColor: `${colors.primary}20` }]}>
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>
                Direct Channel
              </AppText>
            </View>
          </View>
          <AppText variant="caption" muted>
            Chat directly with{' '}
            {isCreator
              ? (sides.data?.team_b_name ?? 'opponent captain')
              : (sides.data?.team_a_name ?? 'host captain')}{' '}
            regarding ground location, arrival time, and match rules.
          </AppText>
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Open Captains Chat"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: matchId,
                    matchId,
                    teamName: isCreator ? sides.data?.team_b_name : sides.data?.team_a_name,
                  },
                })
              }
            />
          </View>
        </View>
      ) : null}

      {/*
        Venue tag. Attached or cleared by organiser/captains.
      */}
      {!isOver ? (
        <View style={[styles.card, !data.venue_id && isCreator && { borderColor: colors.primary }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="label">📍 Venue & Ground</AppText>
            {!data.venue_id && isCreator ? (
              <View style={[styles.badge, { backgroundColor: colors.warning }]}>
                <AppText variant="caption" color="#FFFFFF" style={{ fontWeight: '600' }}>
                  Action Required
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText variant="caption" muted>
            {data.venue_id
              ? data.venue_text
              : isCreator
                ? 'Where are you playing? Pick the ground so both squads know where to go.'
                : (data.venue_text || data.area_name || 'Your organiser has not picked a ground yet.')}
          </AppText>
          {/*
            The app has no booking relationship with any turf, so it must never
            imply the slot is held. Shown whenever a ground IS set.
          */}
          {data.venue_id ? (
            <AppText variant="caption" muted style={{ marginTop: spacing.xs }}>
              sixfour24 has not reserved this turf — call the ground to confirm your slot.
            </AppText>
          ) : null}
          {isCreator ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label={data.venue_id ? 'Change ground' : 'Select ground'}
                variant={data.venue_id ? 'secondary' : 'primary'}
                onPress={() => router.push(`/match/${matchId}/venue`)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {needsLineup && myTeamId ? (
        <View style={styles.card}>
          <AppText variant="label">
            {`Pick your ${lineupFormat} v ${lineupFormat} squad`}
          </AppText>
          <AppText variant="caption" muted>
            {`Only the players you pick are notified about this match. ${mySideCount} of ${lineupFormat} named so far.`}
          </AppText>
          <Button label="Pick squad" onPress={() => setPickingLineup(true)} />
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
            {isFull ? 'Your game is full' : `${seatsLeft} ${seatsLeft === 1 ? 'spot' : 'spots'} remaining`}
          </AppText>
          <AppText variant="caption" muted>
            {isFull
              ? 'Nobody else can join. Lock the game when you are ready.'
              : 'Share the game so the remaining places fill up.'}
          </AppText>
          <Button label="Share game" variant="secondary" onPress={onShareWhatsApp} />
        </View>
      ) : null}

      {/*
        The one thing this screen is for once everybody is in. Starting a match
        IS locking it: `locked` is the status that already means "team is set,
        the game is on", which is why there is no separate "Lock team" button
        any more -- two buttons for one state change is how you get a host who
        has locked the game and still cannot find how to start it.

        Everything the game itself needs -- toss, keypad, scorecard -- lives in
        the Match Center behind this button, so the lobby stays pre-match.
      */}
      {!isOver && !isCompleted ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {isCreator && data.status === 'open' ? (
            <Button
              label="Start match"
              shine
              loading={matchStatus.lock.isPending}
              disabled={confirmedCount === 0}
              onPress={onStartMatch}
            />
          ) : null}
          {isCreator && data.status === 'locked' ? (
            <Button
              label="Resume match →"
              onPress={() => router.push(`/match/${matchId}/live`)}
            />
          ) : null}
          {/*
            On the sheet but not running it. `membership.data` is the test: a
            stranger who has not joined has no row and gets the join card above
            instead of a window into somebody else's game.
          */}
          {!isCreator && membership.data && data.status === 'locked' ? (
            <Button
              label="Watch live scorecard →"
              onPress={() => router.push(`/match/${matchId}/live?tab=live`)}
            />
          ) : null}
          {!isCreator && membership.data && data.status === 'open' ? (
            <AppText variant="caption" muted center>
              Waiting for the host to start the match.
            </AppText>
          ) : null}
        </View>
      ) : null}

      {isCreator ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {data.status === 'locked' ? (
            <Button
              label="Mark completed"
              loading={matchStatus.complete.isPending}
              onPress={() => matchStatus.complete.mutate()}
            />
          ) : null}
          {canManage ? (
            <Button
              label="Cancel game"
              variant="danger"
              loading={matchStatus.cancel.isPending}
              onPress={onCancelMatch}
            />
          ) : null}
        </View>
      ) : null}
      {pickingLineup && myTeamId && userId ? (
        <LineupPickerSheet
          visible
          onClose={() => setPickingLineup(false)}
          teamId={myTeamId}
          teamName={myTeamName ?? 'Your team'}
          captainId={userId}
          format={lineupFormat}
          busy={setLineup.isPending}
          confirmLabel="Save squad"
          onConfirm={(userIds) =>
            setLineup.mutate(
              { teamId: myTeamId, userIds },
              {
                onSuccess: () => setPickingLineup(false),
                onError: (e: unknown) =>
                  Alert.alert(
                    'Squad',
                    e instanceof AppError ? e.message : 'Could not save the squad.',
                  ),
              },
            )
          }
        />
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
    radarBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: '#6cf8bb',
      backgroundColor: '#0F1810',
      marginBottom: spacing.lg,
    },
    radarPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: '#6cf8bb',
    },
    radarDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: '#000000',
    },
  });
