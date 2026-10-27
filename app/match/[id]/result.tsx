/**
 * Match Complete & Scorecard Screen.
 * Shows the winner banner, match result text, full innings scorecards, and squad lineups.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRefreshAll } from '@shared/ui/useRefreshAll';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useAuthStore } from '@core/auth/authStore';
import {
  useMatch,
  useMatchPlayers,
  useMatchSeries,
  useMatchSides,
  useRematch,
} from '@features/matches/presentation/useMatches';
import { useSlotCountdown } from '@features/matches/presentation/useSlotCountdown';
import { useMyVenueRating, useRateVenue } from '@features/venues/presentation/useVenues';
import { useLiveState, useMatchInnings, useSetMotm } from '@features/scoring/presentation/useScoring';
import { formatOvers } from '@features/scoring/domain/scoringSchema';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconBack, IconClock, IconPin, IconStar, IconUsers } from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';

const TOUCH = 44;
const MARK = 80;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unavailable';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MatchResultScreen(): React.ReactNode {
  const M = useMock();
  const { refreshing, onRefresh } = useRefreshAll();
  const styles = useMemo(() => makeStyles(M), [M]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const router = useRouter();

  const match = useMatch(matchId);
  const live = useLiveState(matchId, true); // no polling — match is finished
  // Both innings as stored rows. `get_live_state` returns only the last one, so
  // the first innings used to be shown as `target - 1` — a total with no
  // wickets and no overs, and nothing at all if the chase never started.
  const innings = useMatchInnings(matchId);
  const sides = useMatchSides(matchId);
  const players = useMatchPlayers(matchId);
  const series = useMatchSeries(matchId);
  const rematch = useRematch();
  const [rematchError, setRematchError] = useState<string | null>(null);

  // The booked slot bounds the whole session, not just this game. Every game in
  // the series carries the same `end_time`, so this reads the same on Round 1
  // and on Game 4.
  const slot = useSlotCountdown(match.data?.end_time);

  const state = live.data ?? null;
  const inningsRows = useMemo(() => innings.data ?? [], [innings.data]);

  /** Innings rows carry team IDs; `teams` is members-only, so names come from get_match_sides. */
  const teamName = useMemo(() => {
    const sd = sides.data;
    return (teamId: string): string => {
      if (sd?.team_a_id === teamId) return sd.team_a_name ?? 'Team A';
      if (sd?.team_b_id === teamId) return sd.team_b_name ?? 'Team B';
      return 'Team';
    };
  }, [sides.data]);

  const first = useMemo(() => inningsRows.find((r) => r.number === 1) ?? null, [inningsRows]);
  const second = useMemo(() => inningsRows.find((r) => r.number === 2) ?? null, [inningsRows]);

  const firstRuns =
    first !== null ? first.runs : state?.target != null ? state.target - 1 : null;

  const winner = useMemo(() => {
    if (second === null || firstRuns === null) return null;
    if (second.runs > firstRuns) return teamName(second.batting_team_id);
    if (firstRuns > second.runs) return teamName(second.bowling_team_id);
    return null;
  }, [firstRuns, second, teamName]);

  const isTie = second !== null && firstRuns !== null && second.runs === firstRuns;
  const resultText = match.data?.result_text ?? null;
  const headline = winner ?? (isTie ? 'Game tied' : null);

  const motmId = match.data?.motm_user_id ?? null;
  const motmName = useMemo(() => {
    if (motmId === null) return null;
    const row = (players.data ?? []).find((p) => p.user_id === motmId);
    return row?.profile?.full_name ?? 'Player';
  }, [motmId, players.data]);

  const games = useMemo(() => series.data ?? [], [series.data]);

  /**
   * Wins per side across the slot, and the games that have a score to show.
   *
   * Counted from `winner_team_id` rather than by re-deriving from innings: that
   * column is what `finish_match` wrote, and a tie legitimately leaves it null,
   * which must count for neither side rather than for the first one.
   */
  const seriesScore = useMemo(() => {
    const sd = sides.data;
    let a = 0;
    let b = 0;
    let decided = 0;
    for (const g of games) {
      if (g.status !== 'completed') continue;
      decided += 1;
      if (sd?.team_a_id && g.winner_team_id === sd.team_a_id) a += 1;
      else if (sd?.team_b_id && g.winner_team_id === sd.team_b_id) b += 1;
    }
    return { a, b, decided };
  }, [games, sides.data]);

  /**
   * The number the next game will carry. `create_rematch` derives it the same
   * way — one more than the games already in the series — so the label on the
   * button matches the name the row comes back with.
   */
  const nextGameNumber = games.length > 0 ? games.length + 1 : 2;

  /**
   * Who may start the next game, and when.
   *
   * Membership is NOT re-checked here: `create_rematch` already permits the
   * organiser, a captain or any player, and duplicating that rule in the client
   * is how the button came to be hidden from people the server would have
   * allowed. The slot IS checked, because the server refusing after the tap is
   * a worse experience than a button that has visibly gone quiet — and a null
   * `end_time` (a match with no booked slot at all) is not an expiry, so
   * `slot.expired` stays false for those and the button stays live.
   */
  const isCompleted = match.data?.status === 'completed';
  const myUserId = useAuthStore((s) => s.session?.user.id);
  /**
   * `create_rematch` is organiser-only, so this mirrors it. The opponent still
   * sees the result, the slot countdown and the series score — they simply have
   * no button, rather than a button that returns NOT_THE_ORGANISER.
   */
  const isOrganiser = match.data?.creator_id !== undefined && match.data.creator_id === myUserId;

  const setMotm = useSetMotm(matchId);
  // Mirrors set_motm's own gate so the picker is not offered to someone the
  // server will refuse. The scorer counts too: on a chase they are the only
  // person present when the game auto-completes.
  const canAwardMotm =
    match.data?.status === 'completed' &&
    Boolean(myUserId) &&
    (match.data?.creator_id === myUserId || match.data?.scorer_id === myUserId);

  /*
    Rating the ground.

    venues.rating / rating_count were shown all over the app but nothing could
    ever write them. This is the honest moment to ask: the game just finished
    at this ground and the person is on its sheet, which is exactly the
    condition rate_venue enforces (NOT_PLAYED_HERE otherwise). my_venue_rating
    still decides -- a player looking at someone else's result has not earned it.
  */
  const venueId = match.data?.venue_id ?? null;
  const myVenueRating = useMyVenueRating(venueId);
  const rateVenue = useRateVenue();

  const onRateVenue = (stars: number): void => {
    if (!venueId) return;
    rateVenue.mutate(
      { venueId, rating: stars },
      {
        onError: (e: unknown) =>
          Alert.alert(
            'Could not save your rating',
            e instanceof Error ? e.message : 'Please try again.',
          ),
      },
    );
  };

  /** Tapping the current holder clears the award rather than re-setting it. */
  const onPickMotm = (userId: string, alreadyChosen: boolean): void => {
    setMotm.mutate(alreadyChosen ? null : userId, {
      onError: (e: unknown) =>
        Alert.alert(
          'Could not save',
          e instanceof Error ? e.message : 'Please try again.',
        ),
    });
  };
  const canPlayAgain = isCompleted && !slot.expired && isOrganiser;

  const onPlayAgain = async () => {
    setRematchError(null);
    try {
      const newMatch = await rematch.mutateAsync(matchId);
      router.replace(`/match/${newMatch.id}/toss`);
    } catch (e) {
      setRematchError(e instanceof AppError ? e.message : 'Could not start the next round.');
    }
  };

  const roster = useMemo(() => players.data ?? [], [players.data]);
  const sideA = useMemo(() => roster.filter((p) => p.side === 'a'), [roster]);
  const sideB = useMemo(() => roster.filter((p) => p.side === 'b'), [roster]);

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/teams/matches');
  };

  if (match.isLoading || live.isLoading || innings.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.statePad}>
          <View style={styles.stateBox}>
            <ActivityIndicator color={M.green} size="large" />
            <AppText variant="body" color={M.muted} center>
              Loading game scorecard…
            </AppText>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (match.isError || !match.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.statePad}>
          <View style={styles.stateBox}>
            <AppText variant="body" color={M.danger} center>
              {match.isError ? 'Could not load this game result.' : 'That game no longer exists.'}
            </AppText>
            <Pressable onPress={() => void match.refetch()} style={styles.secondaryBtn} accessibilityRole="button">
              <AppText variant="label" color={M.green}>
                Try again
              </AppText>
            </Pressable>
            <Pressable onPress={onBack} style={styles.secondaryBtn} accessibilityRole="button">
              <AppText variant="label" color={M.green}>
                Back
              </AppText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const m = match.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <IconBack color={M.text} />
        </Pressable>
        <View style={styles.headerText}>
          <AppText variant="heading" color={M.text}>
            Game Scorecard
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {m.match_name}
          </AppText>
        </View>
        <View style={{ width: TOUCH }} />
      </View>

      {/*
        The booked slot, stated before anything else. It is the one fact on this
        screen that is still changing, and it decides whether the session
        continues — so it sits above the result rather than next to the button
        at the bottom of a scroll.
      */}
      {slot.hasSlot ? (
        <View style={slot.expired ? styles.slotBarEnded : styles.slotBar}>
          <IconClock color={slot.expired ? M.danger : M.green} size={14} />
          <AppText
            variant="caption"
            color={slot.expired ? M.danger : M.green}
            style={styles.slotBarText}
          >
            {slot.expired
              ? `Slot time ended · booked time expired at ${slot.endsAtLabel}`
              : `⏳ ${slot.label}`}
          </AppText>
        </View>
      ) : null}

      {/*
        The 30- and 10-minute warnings. A push for the same marks goes out from
        `enqueue_slot_reminders`, but that only helps someone whose phone is
        locked; this is for the group standing on the ground with the result
        screen open, who would otherwise see nothing until the button died.
        Dismissible, because it is a reminder and not a decision.
      */}
      {slot.warning !== null ? (
        <View style={styles.warnBar}>
          <AppText variant="caption" color={M.text} style={styles.warnText}>
            {slot.warning === 30
              ? `About ${slot.minutesLeft} minutes left — enough for one more game.`
              : `Only ${slot.minutesLeft} minutes left in your booked slot.`}
          </AppText>
          <Pressable
            onPress={slot.dismissWarning}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss slot reminder"
          >
            <AppText variant="caption" color={M.green}>
              Got it
            </AppText>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={M.green} />}
      >
        {/* Winner / Result Celebration Card */}
        <View style={styles.winnerCard}>
          <View style={styles.markOuter}>
            <View style={styles.mark}>
              <IconStar size={36} color={M.limeInk} />
            </View>
          </View>

          <AppText center style={styles.title}>
            MATCH COMPLETED
          </AppText>

          {headline ? (
            <AppText center style={styles.winner}>
              {headline}
            </AppText>
          ) : null}

          {resultText ? (
            <View style={styles.resultPill}>
              <AppText variant="body" color={M.green} center style={{ fontWeight: '700' }}>
                {resultText}
              </AppText>
            </View>
          ) : (
            <AppText variant="body" color={M.muted} center>
              Game concluded
            </AppText>
          )}
        </View>

        {/* Match Metadata Card */}
        <View style={styles.card}>
          <View style={styles.metaHeader}>
            <Image source={SPORT_IMAGE[m.sport]} style={styles.sportThumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="heading" color={M.text} style={{ fontSize: 16 }}>
                {m.match_name}
              </AppText>
              <AppText variant="caption" color={M.muted}>
                {m.sport === 'box_cricket' ? '🏏 Box Cricket' : '🏸 Badminton'} · {m.total_slots} Slots
              </AppText>
            </View>
            <View style={styles.completedBadge}>
              <AppText variant="caption" color={M.green} style={{ fontWeight: '800', fontSize: 10 }}>
                FINAL
              </AppText>
            </View>
          </View>

          <View style={styles.detailRow}>
            <IconClock color={M.green} size={14} />
            <AppText variant="caption" color={M.text}>
              {formatWhen(m.scheduled_at)}
            </AppText>
          </View>
          <View style={styles.detailRow}>
            <IconPin color={M.green} size={14} />
            <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ flex: 1 }}>
              {m.venue_text || m.area_name || 'Ground Location'}
            </AppText>
          </View>
        </View>

        {/*
          The session, when there has been more than one game in it. A single
          game is not a series and rendering "Round 1" on its own would be noise,
          so this appears only from the second game onward.
        */}
        {games.length > 1 ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text} style={{ fontSize: 15 }}>
              🔁 THIS SLOT · {games.length} GAMES
            </AppText>

            <View style={styles.seriesScoreRow}>
              <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ flex: 1 }}>
                {sides.data?.team_a_name ?? 'Side A'}
              </AppText>
              <AppText variant="heading" color={M.green} style={{ fontSize: 20 }}>
                {seriesScore.a} — {seriesScore.b}
              </AppText>
              <AppText
                variant="caption"
                color={M.muted}
                numberOfLines={1}
                style={{ flex: 1, textAlign: 'right' }}
              >
                {sides.data?.team_b_name ?? 'Side B'}
              </AppText>
            </View>

            {games.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => router.replace(`/match/${g.id}/result`)}
                disabled={g.is_current || g.status !== 'completed'}
                accessibilityRole="button"
                style={styles.seriesRow}
              >
                <AppText
                  variant="caption"
                  color={g.is_current ? M.green : M.text}
                  style={{ fontWeight: g.is_current ? '800' : '400' }}
                >
                  Round {g.game_number}
                  {g.is_current ? ' · this one' : ''}
                </AppText>
                <AppText variant="caption" color={M.muted}>
                  {g.status === 'completed'
                    ? g.team_a_runs !== null || g.team_b_runs !== null
                      ? `${g.team_a_runs ?? 0}/${g.team_a_wickets ?? 0} v ${g.team_b_runs ?? 0}/${g.team_b_wickets ?? 0}`
                      : 'No score recorded'
                    : g.status === 'cancelled'
                      ? 'Cancelled'
                      : g.status === 'expired'
                        ? 'Time up'
                        : 'In progress'}
                </AppText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Scorecard Summary */}
        <View style={styles.card}>
          <AppText variant="label" color={M.text} style={{ fontSize: 15, marginBottom: S.xs }}>
            📊 INNINGS SCORECARD
          </AppText>

          {inningsRows.length > 0 ? (
            inningsRows.map((inn, i) => (
              <View key={inn.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.inningsRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText
                      variant="heading"
                      color={M.text}
                      style={{ fontSize: 16 }}
                      numberOfLines={1}
                    >
                      {teamName(inn.batting_team_id)}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      {inn.number === 1 ? '1st' : '2nd'} Innings ({formatOvers(inn.legal_balls)} ov)
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText variant="heading" color={M.green} style={{ fontSize: 18 }}>
                      {inn.runs}/{inn.wickets}
                    </AppText>
                    {inn.target !== null ? (
                      <AppText variant="caption" color={M.muted}>
                        Target: {inn.target}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              </View>
            ))
          ) : (
            <AppText variant="body" color={M.muted}>
              No ball-by-ball score was recorded for this game.
            </AppText>
          )}

          {inningsRows.length > 0 ? (
            <Pressable
              onPress={() => router.push(`/match/${matchId}/scorecard`)}
              accessibilityRole="button"
              style={styles.secondaryBtn}
            >
              <AppText variant="label" color={M.green}>
                View full scorecard
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {/*
          Player of the Game.

          The award had no way in at all: finish_match accepted an id but the
          client always sent null, so the profile stat read 0 for everyone
          forever. It lives here rather than on the scoring keypad because a
          chase auto-completes inside record_delivery -- on those games the
          scorer never taps Finish and would never see a picker there.

          Organiser or scorer only; set_motm re-checks that, and refuses anyone
          who was not on the sheet.
        */}
        {motmName || canAwardMotm ? (
          <View style={styles.card}>
            <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
              🌟 PLAYER OF THE GAME
            </AppText>
            {motmName ? (
              <AppText variant="heading" color={M.text} style={{ fontSize: 18 }}>
                {motmName}
              </AppText>
            ) : (
              <AppText variant="caption" color={M.muted} style={{ marginTop: 2 }}>
                Not awarded yet.
              </AppText>
            )}

            {canAwardMotm ? (
              <View style={styles.motmPicker}>
                {roster.map((p) => {
                  const chosen = p.user_id === motmId;
                  return (
                    <Pressable
                      key={p.user_id}
                      onPress={() => onPickMotm(p.user_id, chosen)}
                      disabled={setMotm.isPending}
                      style={[
                        styles.motmChip,
                        { borderColor: chosen ? M.green : M.border },
                        chosen ? { backgroundColor: M.iconChip } : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chosen }}
                      accessibilityLabel={`${chosen ? 'Remove' : 'Award'} Player of the Game${
                        chosen ? ' from' : ' to'
                      } ${p.profile?.full_name ?? 'Player'}`}
                    >
                      <AppText variant="caption" color={chosen ? M.green : M.text}>
                        {p.profile?.full_name ?? 'Player'}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {venueId && myVenueRating.data?.canRate ? (
          <View style={styles.card}>
            <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
              RATE THIS GROUND
            </AppText>
            <AppText variant="caption" color={M.muted} style={{ marginTop: 2 }}>
              {match.data?.venue_text ?? 'This venue'} —{' '}
              {myVenueRating.data.myRating != null
                ? 'tap to change your rating.'
                : 'only players who turned up can rate.'}
            </AppText>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = (myVenueRating.data?.myRating ?? 0) >= n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => onRateVenue(n)}
                    disabled={rateVenue.isPending}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Rate ${n} out of 5`}
                  >
                    <AppText style={{ fontSize: 28, opacity: on ? 1 : 0.25 }}>★</AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Squad Lineups */}
        {roster.length > 0 ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: S.xs }}>
              <IconUsers color={M.green} size={16} />
              <AppText variant="label" color={M.text} style={{ fontSize: 15 }}>
                MATCH LINEUPS ({roster.length} Players)
              </AppText>
            </View>

            {sideA.length > 0 ? (
              <View style={{ gap: 4, marginTop: 4 }}>
                <AppText variant="caption" color={M.muted} style={{ fontWeight: '700' }}>
                  Side A ({sideA.length})
                </AppText>
                <View style={styles.playerChipsWrap}>
                  {sideA.map((p) => (
                    <View key={p.id} style={styles.playerChip}>
                      <AppText variant="caption" color={M.text}>
                        {p.profile?.full_name ?? 'Player'}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {sideB.length > 0 ? (
              <View style={{ gap: 4, marginTop: S.sm }}>
                <AppText variant="caption" color={M.muted} style={{ fontWeight: '700' }}>
                  Side B ({sideB.length})
                </AppText>
                <View style={styles.playerChipsWrap}>
                  {sideB.map((p) => (
                    <View key={p.id} style={styles.playerChip}>
                      <AppText variant="caption" color={M.text}>
                        {p.profile?.full_name ?? 'Player'}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        {canPlayAgain ? (
          <View style={styles.rematchBox}>
            <Pressable
              onPress={() => void onPlayAgain()}
              disabled={rematch.isPending}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cta, { opacity: rematch.isPending ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
            >
              {rematch.isPending ? (
                <ActivityIndicator color={M.limeInk} />
              ) : (
                <AppText variant="label" color={M.limeInk} style={styles.ctaLabel}>
                  ⚡ Play Next Round (Round {nextGameNumber})
                </AppText>
              )}
            </Pressable>
            {slot.hasSlot ? (
              <AppText variant="caption" color={M.muted} center style={styles.helperText}>
                Same teams, same ground · {slot.label}
              </AppText>
            ) : null}
            {rematchError ? (
              <AppText variant="caption" color={M.danger} center style={styles.helperText}>
                {rematchError}
              </AppText>
            ) : null}
          </View>
        ) : isCompleted && slot.expired ? (
          /*
            Not a disabled button. The slot is over and no tap will bring it
            back, so the space says what happened and what to do next instead of
            leaving a dead control for people to press.
          */
          <View style={styles.expiredBox}>
            <AppText variant="label" color={M.danger} center>
              Slot time ended
            </AppText>
            <AppText variant="caption" color={M.muted} center>
              Your booked time expired at {slot.endsAtLabel}. Book another slot to keep playing.
            </AppText>
          </View>
        ) : null}

        <Pressable onPress={onBack} accessibilityRole="button" style={styles.secondaryBtn}>
          <AppText variant="label" color={M.green}>
            ← Back to Games
          </AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    motmPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs, marginTop: S.sm },
    starRow: { flexDirection: 'row', gap: S.sm, marginTop: S.sm },
    motmChip: {
      paddingHorizontal: S.sm,
      paddingVertical: 6,
      borderRadius: R.sm,
      borderWidth: 1,
    },
    safe: { flex: 1, backgroundColor: M.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.lg,
      paddingVertical: S.sm,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    backBtn: {
      width: TOUCH,
      height: TOUCH,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -S.sm,
    },
    headerText: { flex: 1, alignItems: 'center' },

    scroll: {
      paddingHorizontal: S.lg,
      paddingTop: S.md,
      paddingBottom: S.xl,
      gap: S.md,
      flexGrow: 1,
    },

    winnerCard: {
      backgroundColor: M.card,
      borderRadius: 24,
      borderWidth: 1.5,
      borderColor: M.border,
      padding: S.lg,
      alignItems: 'center',
      gap: S.sm,
    },
    markOuter: { alignItems: 'center', marginBottom: S.xs },
    mark: {
      width: MARK,
      height: MARK,
      borderRadius: MARK / 2,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 4,
      borderColor: M.cardHi,
    },
    title: { fontSize: 13, fontWeight: '800', color: M.muted, letterSpacing: 1.2 },
    winner: { fontSize: 26, fontWeight: '800', color: M.text },
    resultPill: {
      paddingHorizontal: S.md,
      paddingVertical: 6,
      borderRadius: R.pill,
      backgroundColor: 'rgba(34, 197, 94, 0.14)',
      borderWidth: 1,
      borderColor: M.green,
      marginTop: S.xs,
    },

    card: {
      backgroundColor: M.card,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
    },
    metaHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      marginBottom: 2,
    },
    sportThumb: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: M.cardHi,
    },
    completedBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: R.pill,
      backgroundColor: 'rgba(34, 197, 94, 0.14)',
    },

    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },

    inningsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    divider: {
      height: 1,
      backgroundColor: M.border,
      marginVertical: 4,
    },

    playerChipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 2,
    },
    playerChip: {
      paddingHorizontal: S.sm,
      paddingVertical: 4,
      borderRadius: R.pill,
      backgroundColor: M.cardHi,
      borderWidth: 1,
      borderColor: M.border,
    },

    stateBox: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.lg,
      alignItems: 'center',
      gap: S.md,
    },
    statePad: { flex: 1, justifyContent: 'center', padding: S.lg },

    footer: {
      paddingHorizontal: S.lg,
      paddingTop: S.sm,
      paddingBottom: S.lg,
      backgroundColor: M.bg,
      borderTopWidth: 1,
      borderTopColor: M.border,
      gap: S.sm,
    },
    rematchBox: { gap: S.xs },
    helperText: { marginTop: 2 },

    slotBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: S.lg,
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
    },
    slotBarEnded: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: S.lg,
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
    },
    slotBarText: { fontWeight: '700' },

    warnBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      paddingVertical: 8,
      paddingHorizontal: S.lg,
      backgroundColor: M.cardHi,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    warnText: { flex: 1 },

    seriesScoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: S.sm,
      paddingVertical: S.xs,
    },
    seriesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: S.sm,
      paddingVertical: 5,
      borderTopWidth: 1,
      borderTopColor: M.border,
    },

    expiredBox: {
      gap: 4,
      paddingVertical: S.sm,
      paddingHorizontal: S.md,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.danger,
      backgroundColor: 'rgba(239, 68, 68, 0.10)',
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
      backgroundColor: M.green,
      borderRadius: R.pill,
    },
    ctaLabel: { fontSize: 16, fontWeight: '700' },
    secondaryBtn: {
      minHeight: 44,
      paddingHorizontal: S.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.border,
      backgroundColor: M.card,
    },
  });
