/**
 * Toss — mockup screens 17-19 as one screen with four states.
 *
 * Splitting these into separate routes would mean pushing and popping on a
 * server state change, which fights the back button. One screen that renders
 * from `toss.decision` is simpler and cannot get out of step:
 *
 *   no toss row        -> "Flip the coin" (either captain, picks overs)
 *   toss, no decision, I won  -> "You won the toss — bat or bowl?"
 *   toss, no decision, I lost  -> waiting (polls until they choose)
 *   decision made      -> result + who bats first
 *
 * A spectator (a player who is not a captain) sees the same states read-only.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';

import { CoinFlip, CoinResting } from '@features/matches/presentation/CoinFlip';
import { useMock } from '@shared/theme/mockTheme';

import { AppError } from '@core/errors/AppError';
import { useMatch } from '@features/matches/presentation/useMatches';
import {
  usePerformToss,
  useSetTossDecision,
  useToss, useRedoToss } from '@features/matches/presentation/useToss';
import { OVERS_OPTIONS } from '@features/matches/domain/tossSchema';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

export default function TossScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const router = useRouter();

  const match = useMatch(matchId);
  const toss = useToss(matchId);
  const performToss = usePerformToss(matchId);
  const setDecision = useSetTossDecision(matchId);
  const redoToss = useRedoToss(matchId);

  const [overs, setOvers] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);
  const M = useMock();

  /**
   * The coin animates only for the captain who pressed Flip in this session.
   * Anyone opening a toss that is already decided — the other captain, a
   * spectator, or the same user after a reload — sees it at rest, because
   * replaying a settled result on every mount would be theatre, not feedback.
   */
  const [flippedHere, setFlippedHere] = useState(false);
  const [landed, setLanded] = useState(false);

  const onFlip = async (): Promise<void> => {
    setError(null);
    try {
      setFlippedHere(true);
      setLanded(false);
      await performToss.mutateAsync(match.data?.overs ?? overs);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not do the toss.');
    }
  };

  /**
   * Re-roll. Goes through redo_toss, not perform_toss — the latter is idempotent
   * and would hand back the same face. The server refuses once bat or bowl has
   * been chosen and notifies both captains, because the other side was already
   * told who won.
   */
  const onFlipAgain = (): void => {
    Alert.alert(
      'Flip again?',
      'This replaces the current result. Both captains are told the toss was re-flipped.',
      [
        { text: 'Keep this result', style: 'cancel' },
        {
          text: 'Flip again',
          style: 'destructive',
          onPress: () => {
            setError(null);
            setFlippedHere(true);
            setLanded(false);
            redoToss.mutate(undefined, {
              onError: (e) =>
                setError(e instanceof AppError ? e.message : 'Could not flip again.'),
            });
          },
        },
      ],
    );
  };

  const onChoose = async (decision: 'bat' | 'bowl'): Promise<void> => {
    setError(null);
    try {
      await setDecision.mutateAsync(decision);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not save your choice.');
    }
  };

  if (match.isLoading || toss.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Toss' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const data = toss.data;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Toss' }} />

      {/* ---------------- No toss yet ---------------- */}
      {!data ? (
        <View style={styles.card}>
          <CoinResting />
          <AppText variant="heading" center>Time for the toss</AppText>
          <AppText variant="caption" muted>
            Either captain can flip. The coin is decided on the server, so neither side
            can influence it.
          </AppText>

          <AppText variant="label" style={styles.sectionTop}>
            Overs per innings
          </AppText>
          <View style={styles.chipRow}>
            {OVERS_OPTIONS.map((n) => (
              <Button
                key={n}
                label={`${n}`}
                variant={n === overs ? 'primary' : 'secondary'}
                onPress={() => setOvers(n)}
              />
            ))}
          </View>

          <View style={styles.cta}>
            <Button label="Flip the coin" loading={performToss.isPending} onPress={() => void onFlip()} />
          </View>
          <AppText variant="caption" muted>
            Only the two captains can do this.
          </AppText>
        </View>
      ) : null}

      {/* ---------------- Flipped, awaiting the winner's call ---------------- */}
      {data && !data.decision ? (
        <View style={styles.card}>
          <CoinFlip
            outcome={data.outcome}
            animate={flippedHere}
            flipKey={data.created_at}
            onSettled={() => setLanded(true)}
            M={M}
          />

          {/*
            The result is withheld until the coin settles — naming the winner
            while it is still spinning spoils the only moment this screen has.
            `flippedHere` is false for everyone else, so they are never made to
            wait for an animation that is not playing for them.
          */}
          {!flippedHere || landed ? (
            <MotiView
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 15 }}
            >
              <AppText variant="caption" muted center>
                It landed {data.outcome}
              </AppText>
              <AppText variant="heading" center>
                {data.winner_team_name} won the toss
              </AppText>
            </MotiView>
          ) : (
            <AppText variant="caption" muted center>
              Flipping…
            </AppText>
          )}

          {data.i_am_winner && (!flippedHere || landed) ? (
            <>
              <AppText variant="caption" muted>
                What do you want to do?
              </AppText>
              <View style={styles.cta}>
                <Button
                  label="Bat first"
                  loading={setDecision.isPending}
                  onPress={() => void onChoose('bat')}
                />
              </View>
              <View style={styles.ctaTight}>
                <Button
                  label="Bowl first"
                  variant="secondary"
                  disabled={setDecision.isPending}
                  onPress={() => void onChoose('bowl')}
                />
              </View>
            </>
          ) : (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="caption" muted>
                Waiting for their captain to choose bat or bowl.
              </AppText>
            </View>
          )}
        
          {/*
            Captains only, and only while the toss is unspent. Server-side
            redo_toss refuses once bat or bowl is chosen, so this is a mirror of
            the real rule rather than the rule itself.
          */}
          {data.i_am_captain && !data.decision && (!flippedHere || landed) ? (
            <View style={styles.cta}>
              <Button
                label="Flip again"
                variant="secondary"
                loading={redoToss.isPending}
                onPress={onFlipAgain}
              />
              <AppText variant="caption" muted center>
                Replaces this result. Both captains are notified.
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ---------------- Decided ---------------- */}
      {data?.decision ? (
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
          style={styles.card}
        >
          <AppText variant="caption" muted>
            It landed {data.outcome}
          </AppText>
          <AppText variant="heading">{data.winner_team_name} won the toss</AppText>
          <AppText style={styles.big}>
            and chose to {data.decision} first
          </AppText>
          {data.overs ? (
            <AppText variant="caption" muted>
              {data.overs} overs per innings
            </AppText>
          ) : null}

          <View style={styles.cta}>
            <Button
              label="Back to match"
              variant="secondary"
              onPress={() => router.replace(`/match/${matchId}`)}
            />
          </View>
          <AppText variant="caption" muted>
            Scoring opens from the match screen once the game starts.
          </AppText>
        </MotiView>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.danger} style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
    card: {
      gap: spacing.sm,
      padding: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionTop: { marginTop: spacing.md },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    cta: { marginTop: spacing.md },
    ctaTight: { marginTop: spacing.xs },
    waiting: { marginTop: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
    big: { fontSize: 20, fontWeight: '700', color: colors.primary },
    error: { marginTop: spacing.md },
  });
