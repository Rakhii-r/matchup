/**
 * Toss — Captain Heads/Tails Call Selection, Coin Flip Animation, and Winner Decision.
 *
 * Flow:
 *   1. No toss row: Captain selects HEADS or TAILS, picks overs (for cricket), and taps "Flip the coin".
 *   2. Flipped (no decision yet):
 *      - Explains call vs. outcome ("Team called Heads · Coin landed Heads").
 *      - If I won: Choose Bat / Bowl (or Serve / Receive).
 *      - If I lost / Spectator: Waiting indicator for the winning captain.
 *   3. Decision made: Result summary + Who bats first + Back to Match.
 *
 * ORGANISER-ONLY. `matches.creator_id` is the only account that may call, flip,
 * re-flip or choose bat/bowl — `perform_toss`, `redo_toss` and
 * `set_toss_decision` all raise NOT_THE_ORGANISER for anyone else. Both squads
 * see the same three states; only the organiser's phone has controls. Box
 * cricket is played with one person holding the app while both captains stand
 * next to them, and the previous rule (anyone on the sheet) let the opposing
 * captain flip the coin and, worse, claim the scoring keypad by opening it
 * first.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';

import { CoinFlip, CoinResting } from '@features/matches/presentation/CoinFlip';
import { useMock } from '@shared/theme/mockTheme';

import { AppError } from '@core/errors/AppError';
import { useAuthStore } from '@core/auth/authStore';
import { useMatch } from '@features/matches/presentation/useMatches';
import {
  usePerformToss,
  useSetTossDecision,
  useToss,
  useRedoToss,
} from '@features/matches/presentation/useToss';
import {
  OVERS_OPTIONS,
  sportUsesOvers,
  tossDecisionLabel,
  tossDecisionVerb,
  type TossCall,
} from '@features/matches/domain/tossSchema';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { IconBolt, IconCheck, IconClock, IconCoin, IconCricketBall } from '@shared/ui/icons';
import { Button } from '@shared/ui/Button';
import { IconTile, StadiumBackdrop } from '@shared/ui/decor';

// The same two faces CoinFlip lands on, reused small for the call buttons.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HEADS = require('../../../../assets/images/head coin -64.jpg') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TAILS = require('../../../../assets/images/tails coin- 64.jpg') as number;

const CALLS: { key: TossCall; label: string; hint: string; image: number }[] = [
  { key: 'heads', label: 'HEADS', hint: 'Call Heads', image: HEADS },
  { key: 'tails', label: 'TAILS', hint: 'Call Tails', image: TAILS },
];

interface TossPanelProps {
  matchId: string;
  /**
   * Supplied by the Match Center: once the toss is decided the natural next
   * step is the scoring tab, not a trip back to the lobby. Left undefined by
   * the standalone /toss route, which still dismisses to the match.
   */
  onProceed?: () => void;
}

export function TossPanel({ matchId, onProceed }: TossPanelProps): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const match = useMatch(matchId);
  const toss = useToss(matchId);
  const myUserId = useAuthStore((s) => s.session?.user.id);
  const performToss = usePerformToss(matchId);
  const setDecision = useSetTossDecision(matchId);
  const redoToss = useRedoToss(matchId);

  const sport = match.data?.sport ?? null;

  /** Overs exist for box cricket only, and only until the first flip fixes them. */
  const usesOvers = sportUsesOvers(sport);
  const lockedOvers = match.data?.overs ?? null;
  const showOversPicker = usesOvers && lockedOvers === null;

  /**
   * The organiser — the only person with controls on this screen.
   *
   * This is the exact test the three toss RPCs now apply
   * (`matches.creator_id <> auth.uid()` → NOT_THE_ORGANISER), so the client is
   * neither stricter nor looser than the server. Read from the match row rather
   * than `get_toss.i_am_winner` because it has to be known BEFORE a toss row
   * exists, and `get_toss` returns nothing then.
   */
  const isOrganiser = match.data?.creator_id !== undefined && match.data.creator_id === myUserId;

  const [selectedCall, setSelectedCall] = useState<TossCall>('heads');
  const [overs, setOvers] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);
  const M = useMock();

  const [flippedHere, setFlippedHere] = useState(false);
  const [landed, setLanded] = useState(false);
  /*
    "Flip again" used to re-flip immediately on whatever call was still in
    state, so the captain never got to call it -- the coin just moved. It now
    returns to the call screen and the next flip goes through redo_toss.
  */
  const [recalling, setRecalling] = useState(false);

  const onFlip = async (): Promise<void> => {
    setError(null);
    try {
      setFlippedHere(true);
      setLanded(false);
      if (recalling) {
        // redo_toss replaces the existing row; perform_toss would collide with it.
        await redoToss.mutateAsync(selectedCall);
        setRecalling(false);
      } else {
        await performToss.mutateAsync({
          call: selectedCall,
          overs: showOversPicker ? overs : null,
        });
      }
    } catch (e) {
      setFlippedHere(false);
      setLanded(false);
      setError(e instanceof AppError ? e.message : 'Could not do the toss.');
    }
  };

  const onFlipAgain = (): void => {
    Alert.alert(
      'Flip again?',
      'You will call heads or tails again, then flip. This replaces the current result and both captains are told.',
      [
        { text: 'Keep this result', style: 'cancel' },
        {
          text: 'Flip again',
          style: 'destructive',
          onPress: () => {
            setError(null);
            setFlippedHere(false);
            setLanded(false);
            setRecalling(true);
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
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const data = toss.data;

  return (
    <>
      {/* ---------------- State 1: No toss yet, or calling again ---------------- */}
      {!data || recalling ? (
        <View style={[styles.card, styles.cardClip]}>
          {/* Pale stadium wash behind the coin; it never takes a tap. */}
          <View pointerEvents="none" style={[styles.heroWash, { backgroundColor: M.chip }]}>
            <StadiumBackdrop height={150} net={false} />
          </View>
          <CoinResting />
          <AppText variant="heading" center style={styles.title}>
            Time for the Toss
          </AppText>
          <AppText variant="body" muted center style={{ fontSize: 14 }}>
            Select your call (Heads or Tails). The coin is flipped randomly on the server.
          </AppText>

          {/* Captain's Heads/Tails Call Selection */}
          {isOrganiser ? (
            <View style={styles.callSection}>
              <View style={styles.sectionHead}>
                <IconTile size={30}>
                  <IconCoin color={colors.primary} size={16} />
                </IconTile>
                <AppText variant="label" style={styles.sectionTitle}>
                  Choose your call
                </AppText>
              </View>
              <View style={styles.callRow}>
                {CALLS.map((c) => {
                  const on = selectedCall === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => setSelectedCall(c.key)}
                      style={[
                        styles.callOption,
                        on ? [styles.callOptionSelected, { backgroundColor: M.chip }] : null,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={c.hint}
                    >
                      <Image source={c.image} style={styles.callCoin} />
                      <AppText
                        variant="label"
                        color={on ? colors.primary : colors.text}
                        style={styles.callLabel}
                      >
                        {c.label}
                      </AppText>
                      <AppText variant="caption" muted>
                        {c.hint}
                      </AppText>
                      {on ? (
                        <View style={styles.checkBadge}>
                          <IconCheck color={colors.textInverse} size={13} strokeWidth={3} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Overs selection for box cricket */}
          {showOversPicker ? (
            <>
              <View style={styles.sectionHead}>
                <IconTile size={30} color={colors.primary}>
                  <IconClock color={colors.textInverse} size={16} />
                </IconTile>
                <AppText variant="label" style={styles.sectionTitle}>
                  Overs per innings
                </AppText>
              </View>
              <View style={styles.oversGrid}>
                {OVERS_OPTIONS.map((n) => {
                  const on = n === overs;
                  return (
                    <View key={n} style={styles.oversCell}>
                      <Pressable
                        onPress={() => setOvers(n)}
                        style={[styles.oversBtn, on ? styles.oversBtnOn : null]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${n} overs per innings`}
                      >
                        <AppText variant="label" color={on ? colors.textInverse : colors.primary}>
                          {n} Overs
                        </AppText>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          ) : usesOvers && lockedOvers !== null ? (
            <AppText variant="caption" muted style={styles.sectionTop}>
              {lockedOvers} overs per innings set for this match.
            </AppText>
          ) : null}

          {isOrganiser ? (
            <>
              <View style={styles.cta}>
                <Button
                  label={`Flip the Coin (${selectedCall.toUpperCase()})`}
                  icon={() => <IconBolt color="#F5B400" size={20} />}
                  loading={performToss.isPending || redoToss.isPending}
                  onPress={() => void onFlip()}
                />
              </View>
              <AppText variant="caption" muted center>
                You are running this game, so the call and the flip are yours.
              </AppText>
            </>
          ) : (
            /*
              Read-only. perform_toss would refuse this person with
              NOT_THE_ORGANISER, so a live button would only buy them an error
              they could not have avoided.
            */
            <AppText variant="caption" muted center style={styles.sectionTop}>
              The game organiser makes the call and flips the coin. The result appears here as
              soon as they do.
            </AppText>
          )}
        </View>
      ) : null}

      {/* ---------------- State 2: Flipped, awaiting the winner's choice ---------------- */}
      {data && !data.decision ? (
        <View style={styles.card}>
          <CoinFlip
            outcome={data.outcome}
            animate={flippedHere}
            flipKey={data.created_at}
            onSettled={() => setLanded(true)}
            M={M}
          />

          {!flippedHere || landed ? (
            <MotiView
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 15 }}
              style={{ gap: spacing.xs }}
            >
              {/* Call vs Outcome explanation */}
              <View style={styles.callSummaryBox}>
                <AppText variant="caption" muted center>
                  {data.calling_team_name ? data.calling_team_name : 'Calling captain'} called{' '}
                  <AppText variant="caption" color={colors.primary} style={{ fontWeight: '800' }}>
                    {(data.called_face || 'heads').toUpperCase()}
                  </AppText>{' '}
                  · Coin landed{' '}
                  <AppText variant="caption" color={colors.primary} style={{ fontWeight: '800' }}>
                    {data.outcome.toUpperCase()}
                  </AppText>
                </AppText>
              </View>

              <AppText variant="heading" center style={{ fontSize: 22 }}>
                {data.i_am_winner ? '🎉 You won the toss!' : `🎉 ${data.winner_team_name} won the toss`}
              </AppText>
            </MotiView>
          ) : (
            <AppText variant="caption" muted center>
              Flipping…
            </AppText>
          )}

          {data.i_am_winner && (!flippedHere || landed) ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <AppText variant="label" center style={{ fontSize: 16 }}>
                What is your decision?
              </AppText>
              <View style={styles.decisionRow}>
                <Pressable
                  onPress={() => void onChoose('bat')}
                  disabled={setDecision.isPending}
                  style={[styles.decisionBtn, { backgroundColor: colors.primary }]}
                  accessibilityRole="button"
                >
                  <AppText style={{ fontSize: 24 }}>🏏</AppText>
                  <AppText variant="label" color={colors.textInverse} style={{ fontWeight: '800' }}>
                    {tossDecisionLabel(sport, 'bat').toUpperCase()}
                  </AppText>
                </Pressable>

                <Pressable
                  onPress={() => void onChoose('bowl')}
                  disabled={setDecision.isPending}
                  style={[styles.decisionBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                  accessibilityRole="button"
                >
                  <IconCricketBall size={24} />
                  <AppText variant="label" color={colors.text} style={{ fontWeight: '800' }}>
                    {tossDecisionLabel(sport, 'bowl').toUpperCase()}
                  </AppText>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="caption" muted>
                Waiting for {data.winner_team_name} captain to choose {sport === 'badminton' ? 'serve or receive' : 'bat or bowl'}.
              </AppText>
            </View>
          )}

          {isOrganiser && !data.decision && (!flippedHere || landed) ? (
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

      {/* ---------------- State 3: Decided ---------------- */}
      {data?.decision ? (
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
          style={styles.card}
        >
          <View style={styles.callSummaryBox}>
            <AppText variant="caption" muted center>
              {data.calling_team_name ? data.calling_team_name : 'Calling captain'} called{' '}
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '800' }}>
                {(data.called_face || 'heads').toUpperCase()}
              </AppText>{' '}
              · Coin landed{' '}
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '800' }}>
                {data.outcome.toUpperCase()}
              </AppText>
            </AppText>
          </View>

          <AppText variant="heading" center style={styles.title}>
            {data.winner_team_name} won the toss
          </AppText>
          <AppText style={styles.big} center>
            and elected to {tossDecisionVerb(sport, data.decision as 'bat' | 'bowl')} first
          </AppText>

          {usesOvers && data.overs ? (
            <AppText variant="caption" muted center>
              {data.overs} overs per innings
            </AppText>
          ) : null}

          <View style={styles.cta}>
            <Button
              label="Proceed to Game →"
              onPress={() =>
                onProceed ? onProceed() : router.dismissTo(`/match/${matchId}`)
              }
            />
          </View>
          <AppText variant="caption" muted center>
            Game innings and batting orders are locked in.
          </AppText>
        </MotiView>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.danger} style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
    card: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardClip: { overflow: 'hidden' },
    heroWash: { position: 'absolute', top: 0, left: 0, right: 0, height: 330, opacity: 0.7 },
    title: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 24, lineHeight: 30 },
    sectionTop: { marginTop: spacing.xs, fontWeight: '700' },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    sectionTitle: { fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    callSection: { gap: spacing.sm },
    callRow: { flexDirection: 'row', gap: spacing.sm + 2 },
    callOption: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    callOptionSelected: { borderColor: colors.primary },
    callCoin: { width: 48, height: 48, borderRadius: 24, marginBottom: 2 },
    callLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 17 },
    checkBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    callSummaryBox: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.xs,
    },
    // Two to a row; cell padding stands in for the gap so halves stay exact.
    oversGrid: { flexDirection: 'row', flexWrap: 'wrap', margin: -5 },
    oversCell: { width: '50%', padding: 5 },
    oversBtn: {
      minHeight: 50,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    oversBtnOn: { backgroundColor: colors.primary },
    cta: { marginTop: spacing.sm },
    decisionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    decisionBtn: {
      flex: 1,
      padding: spacing.md,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    waiting: { marginTop: spacing.md, gap: spacing.sm, alignItems: 'center' },
    big: { fontSize: 18, fontWeight: '700', color: colors.primary },
    error: { marginTop: spacing.md },
  });
