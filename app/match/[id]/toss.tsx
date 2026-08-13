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
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';

import { AppError } from '@core/errors/AppError';
import { useMatch } from '@features/matches/presentation/useMatches';
import {
  usePerformToss,
  useSetTossDecision,
  useToss,
} from '@features/matches/presentation/useToss';
import { OVERS_OPTIONS } from '@features/matches/domain/tossSchema';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

export default function TossScreen(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const router = useRouter();

  const match = useMatch(matchId);
  const toss = useToss(matchId);
  const performToss = usePerformToss(matchId);
  const setDecision = useSetTossDecision(matchId);

  const [overs, setOvers] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);

  const onFlip = async (): Promise<void> => {
    setError(null);
    try {
      await performToss.mutateAsync(match.data?.overs ?? overs);
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not do the toss.');
    }
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
          <AppText variant="heading">Time for the toss</AppText>
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
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 14 }}
          style={styles.card}
        >
          <AppText variant="caption" muted>
            It landed {data.outcome}
          </AppText>
          <AppText variant="heading">{data.winner_team_name} won the toss</AppText>

          {data.i_am_winner ? (
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
        </MotiView>
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

const styles = StyleSheet.create({
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
