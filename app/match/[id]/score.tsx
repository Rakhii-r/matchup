/**
 * Live scoring — mockup screens 20 & 21.
 *
 * Single scorer: whoever starts the innings owns the keypad for the whole
 * match. Everyone else on the sheet sees the same screen read-only, polling
 * every 4s. The scorer does not poll — their own writes refetch, and polling
 * would fight their input mid-tap.
 *
 * The keypad sends a ball and nothing else. Over and ball numbers, totals and
 * strike rotation are all derived server-side from the delivery log, so a
 * dropped response can never leave this screen and the database disagreeing.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useMatch, useMatchPlayers } from '@features/matches/presentation/useMatches';
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
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

const RUN_BUTTONS = [0, 1, 2, 3, 4, 6];
const EXTRAS: ExtraType[] = ['wide', 'no_ball', 'bye', 'leg_bye'];
const WICKETS: WicketType[] = ['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket'];

export default function ScoreScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const router = useRouter();

  // Fetched once with polling off, then re-read with the real flag: the screen
  // cannot know whether it is the scorer until the first response arrives.
  const firstPass = useLiveState(matchId, false);
  const isScorer = firstPass.data?.i_am_scorer ?? false;

  const live = useLiveState(matchId, isScorer);
  const state = live.data ?? null;
  const inningsId = state?.innings_id ?? null;

  const thisOver = useThisOver(inningsId, isScorer);
  const players = useMatchPlayers(matchId);
  // Read to tell "second innings closed" from "match actually finished": the
  // innings status alone cannot distinguish them, and only one of the two needs
  // the recovery card below.
  const match = useMatch(matchId);

  const startInnings = useStartInnings(matchId);
  const record = useRecordDelivery(matchId, inningsId);
  const undo = useUndoLastDelivery(matchId, inningsId);
  const endInnings = useEndInnings(matchId, inningsId);
  const finishMatch = useFinishMatch(matchId);

  const [striker, setStriker] = useState<string | null>(null);
  const [nonStriker, setNonStriker] = useState<string | null>(null);
  const [bowler, setBowler] = useState<string | null>(null);
  const [extra, setExtra] = useState<ExtraType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  // Only confirmed players can be on the field. Split by side so the striker
  // picker never offers a fielder.
  const batters = useMemo(
    () =>
      (players.data ?? []).filter(
        (p) => p.status === 'confirmed' && p.team_id === state?.batting_team_id,
      ),
    [players.data, state?.batting_team_id],
  );
  const bowlers = useMemo(
    () =>
      (players.data ?? []).filter(
        (p) => p.status === 'confirmed' && p.team_id === state?.bowling_team_id,
      ),
    [players.data, state?.bowling_team_id],
  );

  const ready = Boolean(striker && bowler);

  async function send(runs: number, wicket: WicketType | null): Promise<void> {
    if (!striker || !bowler) {
      setError('Pick the striker and the bowler first.');
      return;
    }
    setError(null);
    try {
      await record.mutateAsync({
        strikerId: striker,
        nonStrikerId: nonStriker,
        bowlerId: bowler,
        // Byes and leg byes come off the pad — the runs belong to extras, not
        // the batter, and the DB rejects the other combination outright.
        runsOffBat: extra === 'bye' || extra === 'leg_bye' ? 0 : runs,
        extraType: extra,
        // A wide or no-ball is worth 1 penalty plus whatever was run.
        extraRuns:
          extra === 'wide' || extra === 'no_ball'
            ? 1 + runs
            : extra
              ? runs
              : 0,
        wicketType: wicket,
        outPlayerId: wicket ? striker : null,
      });
      setExtra(null);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not record that ball.');
    }
  }

  function onWicket(): void {
    Alert.alert('How out?', undefined, [
      ...WICKETS.map((w) => ({ text: WICKET_LABEL[w], onPress: () => void send(0, w) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

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
      setError(e instanceof AppError ? e.message : 'Could not finish the match.');
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
   * "Finish match" card below retries step 2 alone.
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
          : 'The innings was closed but the match could not be finished. Tap Finish match to try again.',
      );
      setEnding(false);
      return;
    }
    router.replace(`/match/${matchId}/result`);
  }

  if (live.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Scoring' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  // No innings yet.
  if (!state) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Scoring' }} />
        <View style={styles.card}>
          <AppText variant="heading">Not started</AppText>
          <AppText variant="caption" muted>
            The toss decides who bats. Whoever starts the innings scores the whole match.
          </AppText>
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
          {error ? (
            <AppText variant="caption" color={colors.danger}>
              {error}
            </AppText>
          ) : null}
        </View>
      </Screen>
    );
  }

  const rr = runRate(state.runs, state.legal_balls);
  const ch = chase(state);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: state.batting_team }} />

      {/* ---------------- Scoreboard ---------------- */}
      <View style={styles.board}>
        <AppText variant="caption" muted>
          {state.batting_team} · innings {state.innings_number}
        </AppText>
        <AppText style={styles.score}>
          {state.runs}/{state.wickets}
        </AppText>
        <AppText variant="caption" muted>
          ({formatOvers(state.legal_balls)}
          {state.overs_limit ? ` / ${state.overs_limit}` : ''} overs)
        </AppText>
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
        {ch ? (
          <AppText variant="caption" style={{ color: colors.primary }}>
            Need {ch.need} from {ch.balls} balls
          </AppText>
        ) : null}
      </View>

      {/* ---------------- This over ---------------- */}
      <View style={styles.card}>
        <AppText variant="label">This over</AppText>
        <View style={styles.row}>
          {(thisOver.data ?? []).length === 0 ? (
            <AppText variant="caption" muted>
              No balls yet.
            </AppText>
          ) : (
            (thisOver.data ?? []).map((b) => (
              <View
                key={b.seq}
                style={[styles.chip, b.wicket_type ? styles.chipWicket : null]}
              >
                <AppText variant="caption" color={colors.textInverse}>
                  {b.label}
                </AppText>
              </View>
            ))
          )}
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
            <AppText variant="label">Striker</AppText>
            <PlayerRow
              items={batters.map((p) => ({ id: p.user_id, name: p.profile?.full_name ?? 'Player' }))}
              selected={striker}
              onSelect={setStriker}
            />
            <AppText variant="label" style={{ marginTop: spacing.sm }}>
              Non-striker
            </AppText>
            <PlayerRow
              items={batters
                .filter((p) => p.user_id !== striker)
                .map((p) => ({ id: p.user_id, name: p.profile?.full_name ?? 'Player' }))}
              selected={nonStriker}
              onSelect={setNonStriker}
            />
            <AppText variant="label" style={{ marginTop: spacing.sm }}>
              Bowler
            </AppText>
            <PlayerRow
              items={bowlers.map((p) => ({ id: p.user_id, name: p.profile?.full_name ?? 'Player' }))}
              selected={bowler}
              onSelect={setBowler}
            />
          </View>

          <View style={styles.card}>
            <AppText variant="label">Extra (optional)</AppText>
            <View style={styles.row}>
              {EXTRAS.map((e) => (
                <Button
                  key={e}
                  label={EXTRA_LABEL[e]}
                  variant={extra === e ? 'primary' : 'secondary'}
                  onPress={() => setExtra(extra === e ? null : e)}
                />
              ))}
            </View>
            {extra ? (
              <AppText variant="caption" muted>
                {extra === 'wide' || extra === 'no_ball'
                  ? 'Tap the runs RUN off it — the penalty run is added automatically, and the ball is re-bowled.'
                  : 'Tap the runs taken. They go to extras, not the batter.'}
              </AppText>
            ) : null}
          </View>

          <View style={styles.card}>
            <AppText variant="label">Runs</AppText>
            <View style={styles.row}>
              {RUN_BUTTONS.map((n) => (
                <Button
                  key={n}
                  label={`${n}`}
                  disabled={!ready || record.isPending}
                  onPress={() => void send(n, null)}
                />
              ))}
            </View>
            <View style={[styles.row, { marginTop: spacing.sm }]}>
              <Button
                label="Wicket"
                variant="danger"
                disabled={!ready || record.isPending}
                onPress={onWicket}
              />
              <Button
                label="Undo"
                variant="secondary"
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
            {!ready ? (
              <AppText variant="caption" muted>
                Pick a striker and a bowler to enable the keypad.
              </AppText>
            ) : null}
          </View>

          <View style={styles.card}>
            <Button
              label={state.innings_number === 1 ? 'End innings' : 'End match'}
              variant="secondary"
              // First innings: `endInnings.isPending` is the whole write, so
              // `ending` stays false and this reduces to the old behaviour.
              // Second innings: `ending` spans end_innings AND finish_match.
              loading={ending || endInnings.isPending}
              onPress={() =>
                Alert.alert(
                  state.innings_number === 1 ? 'End this innings?' : 'End the match?',
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
                            onSuccess: () => router.push(`/match/${matchId}/scorecard`),
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
            <Button label="Finish match" loading={ending} onPress={() => void finish()} />
          </View>
        </View>
      ) : null}

      {match.data?.status === 'completed' ? (
        <View style={styles.card}>
          <AppText variant="label">Match complete</AppText>
          {match.data.result_text ? (
            <AppText variant="caption" muted>
              {match.data.result_text}
            </AppText>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="View result"
              onPress={() => router.replace(`/match/${matchId}/result`)}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Button
          label="Scorecard"
          variant="secondary"
          onPress={() => router.push(`/match/${matchId}/scorecard`)}
        />
      </View>

      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}

interface PlayerRowProps {
  items: { id: string; name: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function PlayerRow({ items, selected, onSelect }: PlayerRowProps): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (items.length === 0) {
    return (
      <AppText variant="caption" muted>
        Nobody confirmed on this side yet.
      </AppText>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.row}>
        {items.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: p.id === selected }}
            style={[styles.pill, p.id === selected ? styles.pillOn : null]}
          >
            <AppText variant="caption" color={p.id === selected ? colors.textInverse : colors.text}>
              {p.name}
            </AppText>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
    board: {
      gap: spacing.xs,
      padding: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    score: { fontSize: 40, fontWeight: '800', color: colors.text },
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
    chip: {
      minWidth: 32,
      paddingHorizontal: spacing.xs,
      paddingVertical: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    chipWicket: { backgroundColor: colors.danger },
    pill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  });
