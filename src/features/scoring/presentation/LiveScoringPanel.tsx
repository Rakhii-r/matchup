/**
 * Live scoring — mockup screens 20 & 21.
 *
 * Single scorer: whoever starts the innings owns the keypad for the whole
 * match. Everyone else on the sheet sees the same screen read-only, polling
 * every 4s. The scorer does not poll — their own writes refetch, and polling
 * would fight their input mid-tap.
 *
 * The keypad sends a ball and nothing else — runs, an optional extra, and
 * whether a wicket fell. It does NOT record who was on strike or who bowled:
 * box-cricket sides are picked on the ground and most of the sheet never
 * reaches `confirmed`, so the player pickers were always empty and the keypad
 * could never be enabled. Balls are therefore unattributed, and there are no
 * per-player figures for a match scored here.
 *
 * Over and ball numbers, totals and strike rotation are all derived
 * server-side from the delivery log, so a dropped response can never leave this
 * screen and the database disagreeing.
 */
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useAuthStore } from '@core/auth/authStore';
import { SlotBadge } from '@features/matches/presentation/SlotBadge';
import { useMatch } from '@features/matches/presentation/useMatches';
import { useSlotCountdown } from '@features/matches/presentation/useSlotCountdown';
import {
  useEndInnings,
  useFinishMatch,
  useLiveState,
  useRecordDelivery,
  useStartInnings,
  useThisOver,
  useUndoLastDelivery,
} from '@features/scoring/presentation/useScoring';
import {
  EXTRA_LABEL,
  WICKET_LABEL,
  chase,
  formatOvers,
  runRate,
} from '@features/scoring/domain/scoringSchema';
import type { ExtraType, WicketType } from '@shared/types/database.types';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { useMock } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { HillsArt, IconTile } from '@shared/ui/decor';
import {
  IconArrowRight,
  IconBarChart,
  IconCricket,
  IconCricketBall,
  IconFlag,
  IconPlus,
  IconUndo,
  IconWicket,
} from '@shared/ui/icons';

const RUN_BUTTONS = [0, 1, 2, 3, 4, 6];
/*
  Byes and leg byes removed on the owner's call -- box cricket does not score
  them. 'bye' and 'leg_bye' remain valid in the DB CHECK so historical rows
  still read back; nothing new can create one.
*/
const EXTRAS: ExtraType[] = ['wide', 'no_ball'];
const WICKETS: WicketType[] = ['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket'];

interface LiveScoringPanelProps {
  matchId: string;
  /**
   * Supplied by the Match Center so "Scorecard" switches tab instead of
   * pushing a whole screen on top of the one you are already in.
   */
  onOpenScorecard?: () => void;
}

export function LiveScoringPanel({
  matchId,
  onOpenScorecard,
}: LiveScoringPanelProps): React.ReactNode {
  const { colors } = useTheme();
  const M = useMock();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const openScorecard = useCallback(() => {
    if (onOpenScorecard) {
      onOpenScorecard();
      return;
    }
    router.push(`/match/${matchId}/scorecard`);
  }, [onOpenScorecard, router, matchId]);

  // Fetched once with polling off, then re-read with the real flag: the screen
  // cannot know whether it is the scorer until the first response arrives.
  const firstPass = useLiveState(matchId, false);
  const isScorer = firstPass.data?.i_am_scorer ?? false;

  const live = useLiveState(matchId, isScorer);
  const state = live.data ?? null;
  const inningsId = state?.innings_id ?? null;

  const thisOver = useThisOver(inningsId, isScorer);
  // Read to tell "second innings closed" from "game actually finished": the
  // innings status alone cannot distinguish them, and only one of the two needs
  // the recovery card below.
  const match = useMatch(matchId);

  const startInnings = useStartInnings(matchId);
  const record = useRecordDelivery(matchId, inningsId);
  const undo = useUndoLastDelivery(matchId, inningsId);
  const endInnings = useEndInnings(matchId, inningsId);
  const finishMatch = useFinishMatch(matchId);

  // Time left on the booked slot. It gates nothing on this screen — a slot that
  // runs out mid-over must never strand a half-scored innings, so this game
  // stays finishable and only the NEXT one is refused, on the result screen and
  // in `create_rematch`.
  const slot = useSlotCountdown(match.data?.end_time);

  /**
   * The organiser — the only account `start_innings` will accept as a new
   * scorer. Once `matches.scorer_id` is set it is the authority for every
   * subsequent write, which is why `isScorer` (from get_live_state) still gates
   * the keypad below and this only gates the one button that CLAIMS the role.
   */
  const myUserId = useAuthStore((s) => s.session?.user.id);
  const isOrganiser = match.data?.creator_id !== undefined && match.data.creator_id === myUserId;

  const [extra, setExtra] = useState<ExtraType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  // The second innings ends itself on the ball that settles it — the target is
  // reached, or the overs run out (see the auto_complete_second_innings
  // migration). Nobody taps anything: the match is simply complete on the next
  // refetch, and this takes everyone watching to the result.
  //
  // A focus effect, not a plain one: the scorecard can be pushed on top of this
  // screen, and a plain effect firing from underneath would replace THAT route
  // instead of this one.
  const matchCompleted = match.data?.status === 'completed';
  useFocusEffect(
    useCallback(() => {
      if (matchCompleted) router.replace(`/match/${matchId}/result`);
    }, [matchCompleted, matchId, router]),
  );

  async function send(runs: number, wicket: WicketType | null): Promise<void> {
    setError(null);
    try {
      await record.mutateAsync({
        // Unattributed: nobody is named on the ball. The columns are nullable
        // as of the team_only_scoring migration.
        strikerId: null,
        nonStrikerId: null,
        bowlerId: null,
        runsOffBat: runs,
        extraType: extra,
        // A wide or no-ball is worth 1 penalty plus whatever was run.
        extraRuns: extra ? 1 + runs : 0,
        wicketType: wicket,
        outPlayerId: null,
      });
      setExtra(null);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not record that ball.');
    }
  }

  /*
    Why this is a panel and not an Alert.

    It used to be `Alert.alert('How out?', ...)` with all six wicket types plus
    Cancel. Android's native alert renders AT MOST THREE buttons -- the rest are
    silently dropped -- so most dismissals could not be recorded at all, which
    is why wickets never appeared on the scoreboard.
  */
  const [wicketOpen, setWicketOpen] = useState(false);

  /**
   * Finish the match — the second half of the end-of-match sequence, on its own
   * so the recovery card below can retry it without closing an innings twice.
   *
   * `finish_match` is what computes the winner and writes
   * `matches.status = 'completed'` and `result_text`. `end_innings` never
   * touches the match, so skipping this leaves the fixture forever in progress.
   */
  async function finish(): Promise<void> {
    if (ending) return;
    setError(null);
    setEnding(true);
    try {
      // null MOTM: there is no Player of the Match picker in the app yet, and
      // finish_match coalesces null onto the existing column rather than
      // clearing it. Inventing a name here would be worse than leaving it unset.
      await finishMatch.mutateAsync(null);
    } catch (e) {
      // Mapped in scoringRepository (NOT_THE_SCORER, SECOND_INNINGS_MISSING…).
      // Surfaced as-is, never re-mapped and never swallowed.
      setError(e instanceof AppError ? e.message : 'Could not finish the game.');
      setEnding(false);
      return;
    }
    // `ending` is deliberately NOT cleared: this replaces the route, and
    // clearing it would re-enable the button for the frame before the
    // transition. Same reasoning as the `submitting` flag in app/teams/create.tsx.
    router.replace(`/match/${matchId}/result`);
  }

  /**
   * End the SECOND innings. Two sequential writes, not one:
   *
   *   1. end_innings  — closes the innings row. That is all it does.
   *   2. finish_match — computes the winner and completes the match.
   *
   * `endInnings.isPending` covers only the first, and flips back to false the
   * instant the innings closes while finish_match is still in flight. Binding
   * the button to it would leave it live mid-sequence — the double-submit that
   * created two identical teams in app/teams/create.tsx. The single `ending`
   * flag spans BOTH calls instead.
   *
   * If step 2 fails after step 1 succeeded the innings is closed and the match
   * is not. That is said out loud, the scorer stays on this screen, and the
   * "Finish game" card below retries step 2 alone.
   */
  async function endSecondInnings(): Promise<void> {
    if (ending) return;
    setError(null);
    setEnding(true);
    try {
      await endInnings.mutateAsync();
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not end the innings.');
      setEnding(false);
      return;
    }
    try {
      await finishMatch.mutateAsync(null);
    } catch (e) {
      setError(
        e instanceof AppError
          ? `${e.message} The innings is closed but the match is not finished — tap Finish match to try again.`
          : 'The innings was closed but the game could not be finished. Tap Finish game to try again.',
      );
      setEnding(false);
      return;
    }
    router.replace(`/match/${matchId}/result`);
  }

  if (live.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // No innings yet.
  if (!state) {
    return (
      <>
        <SlotBadge slot={slot} />
        <View style={styles.card}>
          <AppText variant="heading">Not started</AppText>
          <AppText variant="caption" muted>
            {isOrganiser
              ? 'The toss decides who bats. You are running this game, so the keypad is yours all the way through.'
              : 'The toss decides who bats. The game organiser scores; the live total appears here as soon as they start.'}
          </AppText>
          {isOrganiser ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Start first innings"
                loading={startInnings.isPending}
                onPress={() => {
                  setError(null);
                  startInnings.mutate(undefined, {
                    onError: (e: unknown) =>
                      setError(e instanceof AppError ? e.message : 'Could not start.'),
                  });
                }}
              />
            </View>
          ) : null}
          {error ? (
            <AppText variant="caption" color={colors.danger}>
              {error}
            </AppText>
          ) : null}
        </View>
      </>
    );
  }

  const rr = runRate(state.runs, state.legal_balls);
  const ch = chase(state);
  const balls = thisOver.data ?? [];

  /** Card heading: a tinted glyph tile beside the section title. */
  const head = (icon: React.ReactNode, title: string, right?: React.ReactNode): React.ReactNode => (
    <View style={styles.sectionHead}>
      <IconTile size={36}>{icon}</IconTile>
      <AppText variant="label" style={styles.sectionTitle}>
        {title}
      </AppText>
      {right}
    </View>
  );

  return (
    <>
      <SlotBadge slot={slot} />

      {/* ---------------- Scoreboard ---------------- */}
      <View style={[styles.board, { backgroundColor: M.chip }]}>
        <HillsArt variant="bat" width={200} />
        <View style={styles.boardTop}>
          <AppText variant="label" numberOfLines={1} style={styles.boardTeam}>
            {state.batting_team}
          </AppText>
          <View style={styles.inningsPill}>
            <AppText variant="caption" color={colors.primary} style={{ fontWeight: '700' }}>
              Innings {state.innings_number}
            </AppText>
          </View>
        </View>
        <AppText style={styles.score}>
          {state.runs}/{state.wickets}
        </AppText>
        <AppText variant="body" muted>
          ({formatOvers(state.legal_balls)}
          {state.overs_limit ? ` / ${state.overs_limit}` : ''} overs)
        </AppText>
        {rr !== null || (ch !== null && ch.rrr !== null) ? (
          <View style={styles.row}>
            {rr !== null ? (
              <AppText variant="caption" muted>
                CRR {rr}
              </AppText>
            ) : null}
            {ch?.rrr !== null && ch !== null ? (
              <AppText variant="caption" muted>
                REQ {ch.rrr}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {ch ? (
          <AppText variant="caption" style={{ color: colors.primary, fontWeight: '700' }}>
            Need {ch.need} from {ch.balls} balls
          </AppText>
        ) : null}
      </View>

      {/* ---------------- This over ---------------- */}
      <View style={styles.card}>
        <View style={styles.overRow}>
          <IconTile size={36}>
            <IconCricketBall size={18} />
          </IconTile>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="label" style={styles.sectionTitle}>
              This over
            </AppText>
            {balls.length === 0 ? (
              <AppText variant="caption" muted>
                No balls yet.
              </AppText>
            ) : null}
          </View>
          <View style={styles.ballRow}>
            {balls.length === 0
              ? // Six empty places, so the over reads as six balls to come.
                [0, 1, 2, 3, 4, 5].map((i) => (
                  <View key={i} style={[styles.ball, { backgroundColor: M.chip }]} />
                ))
              : balls.map((b) => (
                  <View
                    key={b.seq}
                    style={[styles.ball, styles.ballFilled, b.wicket_type ? styles.ballWicket : null]}
                  >
                    <AppText variant="caption" color={colors.textInverse} style={styles.ballText}>
                      {b.label}
                    </AppText>
                  </View>
                ))}
          </View>
        </View>
      </View>

      {!isScorer ? (
        <View style={styles.card}>
          <AppText variant="caption" muted>
            Live. {state.bowling_team} are bowling. Only the scorer can record balls.
          </AppText>
        </View>
      ) : null}

      {/* ---------------- Keypad (scorer only) ---------------- */}
      {isScorer && state.status === 'in_progress' ? (
        <>
          <View style={styles.card}>
            {head(<IconPlus color={colors.primary} size={18} strokeWidth={3} />, 'Extra (optional)')}
            <View style={styles.indent}>
              <View style={styles.row}>
                {EXTRAS.map((e) => {
                  const on = extra === e;
                  return (
                    <Pressable
                      key={e}
                      onPress={() => setExtra(on ? null : e)}
                      style={[styles.extraBtn, on ? styles.extraBtnOn : null]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={EXTRA_LABEL[e]}
                    >
                      <AppText variant="label" color={on ? colors.textInverse : colors.primary}>
                        {EXTRA_LABEL[e]}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
              {extra ? (
                <AppText variant="caption" muted>
                  Tap the runs RUN off it — the penalty run is added automatically,
                  and the ball is re-bowled.
                </AppText>
              ) : null}
            </View>
          </View>

          {wicketOpen ? (
            <View style={styles.card}>
              {head(<IconWicket color={colors.danger} size={18} />, 'How out?')}
              <View style={styles.row}>
                {WICKETS.map((w) => (
                  <Button
                    key={w}
                    label={WICKET_LABEL[w]}
                    variant="danger"
                    disabled={record.isPending}
                    onPress={() => {
                      setWicketOpen(false);
                      void send(0, w);
                    }}
                  />
                ))}
              </View>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setWicketOpen(false)}
              />
            </View>
          ) : null}

          <View style={styles.card}>
            {head(<IconCricket color={colors.primary} size={18} />, 'Runs')}
            <View style={styles.indent}>
              <View style={styles.keys}>
                {RUN_BUTTONS.map((n) => (
                  <View key={n} style={styles.keyCell}>
                    <Pressable
                      disabled={record.isPending}
                      onPress={() => void send(n, null)}
                      style={({ pressed }) => [
                        styles.key,
                        { opacity: record.isPending ? 0.5 : pressed ? 0.8 : 1 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${n} run${n === 1 ? '' : 's'}`}
                      accessibilityState={{ disabled: record.isPending }}
                    >
                      <AppText variant="heading" color={colors.textInverse} style={styles.keyText}>
                        {n}
                      </AppText>
                    </Pressable>
                  </View>
                ))}
              </View>
              <View style={styles.pair}>
                <View style={styles.pairCell}>
                  <Button
                    label="Wicket"
                    variant="danger"
                    icon={(c) => <IconWicket color={c} size={20} />}
                    disabled={record.isPending}
                    onPress={() => setWicketOpen((v) => !v)}
                  />
                </View>
                <View style={styles.pairCell}>
                  <Button
                    label="Undo"
                    variant="secondary"
                    icon={(c) => <IconUndo color={c} size={20} />}
                    loading={undo.isPending}
                    onPress={() => {
                      setError(null);
                      undo.mutate(undefined, {
                        onError: (e: unknown) =>
                          setError(e instanceof AppError ? e.message : 'Could not undo.'),
                      });
                    }}
                  />
                </View>
              </View>
            </View>
          </View>

          <View style={styles.action}>
            <Button
              label={state.innings_number === 1 ? 'End innings' : 'End game'}
              icon={(c) => <IconFlag color={c} size={20} />}
              trailing={(c) => <IconArrowRight color={c} size={20} />}
              // First innings: `endInnings.isPending` is the whole write, so
              // `ending` stays false and this reduces to the old behaviour.
              // Second innings: `ending` spans end_innings AND finish_match.
              loading={ending || endInnings.isPending}
              onPress={() =>
                Alert.alert(
                  state.innings_number === 1 ? 'End this innings?' : 'End the game?',
                  'You can undo the last ball to reopen it if this was a mistake.',
                  [
                    { text: 'Keep scoring', style: 'cancel' },
                    {
                      text: 'End',
                      onPress: () => {
                        if (state.innings_number === 1) {
                          // Unchanged: close the innings, then the "Innings
                          // over → Start second innings" card takes over.
                          endInnings.mutate(undefined, {
                            onSuccess: () => openScorecard(),
                            onError: (e: unknown) =>
                              setError(
                                e instanceof AppError ? e.message : 'Could not end the innings.',
                              ),
                          });
                          return;
                        }
                        void endSecondInnings();
                      },
                    },
                  ],
                )
              }
            />
          </View>
        </>
      ) : null}

      {isScorer && state.status === 'completed' && state.innings_number === 1 ? (
        <View style={styles.card}>
          <AppText variant="label">Innings over</AppText>
          <AppText variant="caption" muted>
            {state.batting_team} made {state.runs}/{state.wickets}. {state.bowling_team} need{' '}
            {state.runs + 1} to win.
          </AppText>
          <View style={{ marginTop: spacing.md }}>
            <Button
              label="Start second innings"
              loading={startInnings.isPending}
              onPress={() => startInnings.mutate()}
            />
          </View>
        </View>
      ) : null}

      {/*
        Second innings closed, match not finished. `end_innings` only closes the
        innings row, so this is the state left behind when finish_match failed —
        or when the app died between the two calls. It is recoverable: retrying
        finish_match alone needs nothing but the second innings to exist.
      */}
      {isScorer &&
      state.status === 'completed' &&
      state.innings_number === 2 &&
      match.isSuccess &&
      match.data?.status !== 'completed' ? (
        <View style={styles.card}>
          <AppText variant="label">Innings closed — no result yet</AppText>
          <AppText variant="caption" muted>
            {state.batting_team} finished on {state.runs}/{state.wickets}. The match is not
            complete until the result is recorded — that is what works out who won.
          </AppText>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Finish game" loading={ending} onPress={() => void finish()} />
          </View>
        </View>
      ) : null}

      <View style={styles.action}>
        <Button
          label="Scorecard"
          variant="secondary"
          icon={(c) => <IconBarChart color={c} size={20} />}
          onPress={openScorecard}
        />
      </View>

      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
    board: {
      gap: 2,
      padding: spacing.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    boardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
    boardTeam: { flexShrink: 1, fontSize: 16 },
    inningsPill: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
    },
    score: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 52,
      lineHeight: 58,
      fontWeight: '700',
      color: colors.text,
    },
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    // A bare full-width action: the button is its own card.
    action: { marginBottom: spacing.sm + 4 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
    sectionTitle: { flex: 1, fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    // Lines the body up under the title, clear of the 36pt glyph tile.
    indent: { gap: spacing.sm, paddingLeft: 36 + spacing.sm + 4 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    overRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
    ballRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: '60%' },
    ball: { minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    ballFilled: { backgroundColor: colors.primary, paddingHorizontal: 6 },
    ballWicket: { backgroundColor: colors.danger },
    ballText: { fontWeight: '700', fontSize: 11 },
    extraBtn: {
      minHeight: 48,
      minWidth: 112,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    extraBtnOn: { backgroundColor: colors.primary },
    // Five keys to a row. Cell padding stands in for a gap so the percentages
    // add up to exactly one row on every width.
    keys: { flexDirection: 'row', flexWrap: 'wrap', margin: -4 },
    keyCell: { width: '20%', padding: 4 },
    key: {
      minHeight: 52,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyText: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 20 },
    pair: { flexDirection: 'row', gap: spacing.sm + 2, marginTop: spacing.xs },
    pairCell: { flex: 1 },
  });
