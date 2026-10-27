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
import { LinearGradient } from 'expo-linear-gradient';
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
  tossPurposeLabel,
  type TossCall,
} from '@features/matches/domain/tossSchema';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import {
  IconArrowRight,
  IconBadminton,
  IconBolt,
  IconCheck,
  IconClock,
  IconClose,
  IconCoin,
  IconCricket,
  IconCricketBall,
  IconTarget,
  IconTrophy,
  IconUndo,
} from '@shared/ui/icons';
import { Button } from '@shared/ui/Button';
import { IconTile } from '@shared/ui/decor';

// The same two faces CoinFlip lands on, reused small for the call buttons.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HEADS = require('../../../../assets/images/coin-heads.png') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TAILS = require('../../../../assets/images/coin-tails.png') as number;

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
  const decisionIcons =
    sport === 'badminton'
      ? {
          bat: <IconBadminton color={colors.primary} size={26} />,
          bowl: <IconTarget color={colors.primary} size={26} />,
        }
      : {
          bat: <IconCricket color={colors.primary} size={26} />,
          bowl: <IconCricketBall size={26} />,
        };
  const winnerName = sideName(data?.winner_team_name) ?? 'The winning side';
  const callerName = sideName(data?.calling_team_name) ?? 'Organiser';
  const callWon = data ? data.called_face === data.outcome : false;

  /** "Called HEADS · Landed TAILS", with a tick or cross for whether the call came up. */
  const callSummary = data ? (
    <View style={styles.summaryPill}>
      <AppText variant="caption" muted>
        {callerName} called{' '}
        <AppText variant="caption" color={colors.text} style={styles.strong}>
          {(data.called_face || 'heads').toUpperCase()}
        </AppText>
        {'  ·  '}Landed{' '}
        <AppText variant="caption" color={colors.text} style={styles.strong}>
          {data.outcome.toUpperCase()}
        </AppText>
      </AppText>
      <View
        style={[
          styles.summaryDot,
          { backgroundColor: callWon ? colors.primary : colors.textMuted },
        ]}
      >
        {callWon ? (
          <IconCheck color={colors.textInverse} size={10} strokeWidth={3.5} />
        ) : (
          <IconClose color={colors.textInverse} size={10} strokeWidth={3.5} />
        )}
      </View>
    </View>
  ) : null;

  /*
    A decided toss always wins over "calling again". The build testers had
    left Bat/Bowl tappable under the re-call screen; once a decision landed the
    screen stayed on "Flip the coin", and every tap after that was refused
    with TOSS_ALREADY_DECIDED -- the "coin stops flipping" report. Deriving
    this means no path (a tap, a poll, another device) can strand it there.
  */
  const recallOpen = recalling && !data?.decision;

  return (
    <>
      {/* ---------------- State 1: No toss yet, or calling again ---------------- */}
      {!data || recallOpen ? (
        <View style={[styles.card, styles.cardClip]}>
          <LinearGradient
            colors={[colors.primary, colors.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroBadge}>
              <IconCoin color={colors.onPhoto} size={14} />
              <AppText variant="caption" color={colors.onPhoto} style={styles.strong}>
                {recallOpen ? 'RE-TOSS' : 'TOSS'}
              </AppText>
            </View>
            <CoinResting size={104} />
            <AppText variant="heading" color={colors.onPhoto} center style={styles.heroTitle}>
              {recallOpen ? 'Call it again' : 'Time for the toss'}
            </AppText>
            <AppText variant="caption" color={colors.onPhoto} center style={styles.heroSub}>
              {tossPurposeLabel(sport)} The coin is flipped fairly on the server.
            </AppText>
          </LinearGradient>

          <View style={styles.body}>
            {isOrganiser ? (
              <View style={styles.section}>
                <StepLabel n={1} text="Make the call" styles={styles} />
                <View style={styles.callRow}>
                  {CALLS.map((c) => {
                    const on = selectedCall === c.key;
                    return (
                      <Pressable
                        key={c.key}
                        onPress={() => setSelectedCall(c.key)}
                        style={[
                          styles.callOption,
                          on ? [styles.callOptionOn, { backgroundColor: M.chip }] : null,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={c.hint}
                      >
                        <Image
                          source={c.image}
                          style={[styles.callCoin, on ? null : styles.callCoinOff]}
                        />
                        <AppText
                          variant="label"
                          color={on ? colors.primary : colors.text}
                          style={styles.callLabel}
                        >
                          {c.label}
                        </AppText>
                        <View style={[styles.radio, on ? styles.radioOn : null]}>
                          {on ? (
                            <IconCheck color={colors.textInverse} size={12} strokeWidth={3} />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {showOversPicker ? (
              <View style={styles.section}>
                <StepLabel n={isOrganiser ? 2 : 1} text="Overs per innings" styles={styles} />
                <View style={styles.oversRow}>
                  {OVERS_OPTIONS.map((n) => {
                    const on = n === overs;
                    return (
                      <Pressable
                        key={n}
                        onPress={() => setOvers(n)}
                        disabled={!isOrganiser}
                        style={[styles.oversChip, on ? styles.oversChipOn : null]}
                        accessibilityRole="radio"
                        accessibilityState={{
                          selected: on,
                          disabled: !isOrganiser,
                        }}
                        accessibilityLabel={`${n} overs per innings`}
                      >
                        <AppText
                          variant="label"
                          color={on ? colors.textInverse : colors.text}
                          style={styles.oversNum}
                        >
                          {n}
                        </AppText>
                        <AppText
                          variant="caption"
                          color={on ? colors.textInverse : colors.textMuted}
                        >
                          overs
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : usesOvers && lockedOvers !== null ? (
              <View style={styles.infoRow}>
                <IconClock color={colors.primary} size={16} />
                <AppText variant="caption" muted>
                  {lockedOvers} overs per innings, set for this match.
                </AppText>
              </View>
            ) : null}

            {isOrganiser ? (
              <View style={styles.cta}>
                <Button
                  label="Flip the coin"
                  icon={(c) => <IconBolt color={c} size={18} />}
                  loading={performToss.isPending || redoToss.isPending}
                  onPress={() => void onFlip()}
                />
                <AppText variant="caption" muted center>
                  Calling {selectedCall.toUpperCase()}
                  {showOversPicker ? ` · ${overs} overs` : ''}
                </AppText>
              </View>
            ) : (
              /*
                Read-only. perform_toss would refuse this person with
                NOT_THE_ORGANISER, so a live button would only buy them an error
                they could not have avoided.
              */
              <View style={styles.infoRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <AppText variant="caption" muted style={styles.flex}>
                  The organiser makes the call and flips the coin. The result appears here as soon
                  as they do.
                </AppText>
              </View>
            )}
          </View>
        </View>
      ) : null}

      {/* ---------------- State 2: Flipped, awaiting the winner's choice ---------------- */}
      {data && !data.decision && !recallOpen ? (
        <View style={[styles.card, styles.body]}>
          <CoinFlip
            outcome={data.outcome}
            animate={flippedHere}
            flipKey={data.created_at}
            onSettled={() => setLanded(true)}
            size={140}
            M={M}
          />

          {!flippedHere || landed ? (
            <MotiView
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 15 }}
              style={styles.resultBlock}
            >
              {callSummary}
              <AppText variant="heading" center style={styles.title}>
                {data.i_am_winner ? 'You won the toss!' : `${winnerName} won the toss`}
              </AppText>
            </MotiView>
          ) : (
            <AppText variant="label" muted center>
              Flipping…
            </AppText>
          )}

          {!flippedHere || landed ? (
            data.i_am_winner ? (
              <View style={styles.section}>
                <AppText variant="label" center style={styles.sectionTitle}>
                  {sport === 'badminton' ? 'Serve or receive?' : 'Bat or bowl?'}
                </AppText>
                <View style={styles.decisionRow}>
                  {(['bat', 'bowl'] as const).map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => void onChoose(d)}
                      disabled={setDecision.isPending}
                      style={({ pressed }) => [
                        styles.decisionBtn,
                        pressed
                          ? {
                              backgroundColor: M.chip,
                              borderColor: colors.primary,
                            }
                          : null,
                        setDecision.isPending ? styles.dim : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={tossDecisionLabel(sport, d)}
                    >
                      <IconTile size={52}>{decisionIcons[d]}</IconTile>
                      <AppText variant="label" style={styles.decisionLabel}>
                        {tossDecisionLabel(sport, d)}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
                {setDecision.isPending ? <ActivityIndicator color={colors.primary} /> : null}
              </View>
            ) : (
              <View style={styles.infoRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <AppText variant="caption" muted style={styles.flex}>
                  Waiting for {winnerName} to choose{' '}
                  {sport === 'badminton' ? 'serve or receive' : 'bat or bowl'}.
                </AppText>
              </View>
            )
          ) : null}

          {isOrganiser && (!flippedHere || landed) ? (
            <Pressable
              onPress={onFlipAgain}
              disabled={redoToss.isPending}
              hitSlop={8}
              style={styles.flipAgain}
              accessibilityRole="button"
              accessibilityHint="Replaces this result. Both captains are notified."
            >
              <IconUndo color={colors.textMuted} size={15} />
              <AppText variant="caption" muted style={styles.strong}>
                Flip again
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* ---------------- State 3: Decided ---------------- */}
      {data?.decision && !recallOpen ? (
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
          style={[styles.card, styles.body]}
        >
          <View style={styles.trophyWrap}>
            <IconTile size={72}>
              <IconTrophy color={colors.primary} size={34} />
            </IconTile>
          </View>
          <AppText variant="heading" center style={styles.title}>
            {winnerName} won the toss
          </AppText>
          <View style={[styles.decisionPill, { backgroundColor: M.chip }]}>
            {decisionIcons[data.decision as 'bat' | 'bowl']}
            <AppText variant="label" color={colors.primary} style={styles.strong}>
              Elected to {tossDecisionVerb(sport, data.decision as 'bat' | 'bowl')} first
            </AppText>
          </View>

          <View style={styles.factRow}>
            <Fact
              label="Call"
              value={(data.called_face || 'heads').toUpperCase()}
              styles={styles}
            />
            <Fact label="Landed" value={data.outcome.toUpperCase()} styles={styles} />
            {usesOvers && data.overs ? (
              <Fact label="Overs" value={String(data.overs)} styles={styles} />
            ) : null}
          </View>

          <View style={styles.cta}>
            <Button
              label="Proceed to game"
              trailing={(c) => <IconArrowRight color={c} size={18} />}
              onPress={() => (onProceed ? onProceed() : router.dismissTo(`/match/${matchId}`))}
            />
          </View>
        </MotiView>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <AppText variant="caption" color={colors.danger}>
            {error}
          </AppText>
        </View>
      ) : null}
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function StepLabel({
  n,
  text,
  styles,
}: {
  n: number;
  text: string;
  styles: Styles;
}): React.ReactNode {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}>
        <AppText variant="caption" style={styles.stepNumText}>
          {n}
        </AppText>
      </View>
      <AppText variant="label" style={styles.sectionTitle}>
        {text}
      </AppText>
    </View>
  );
}

function Fact({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: Styles;
}): React.ReactNode {
  return (
    <View style={styles.fact}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="label" style={styles.factValue}>
        {value}
      </AppText>
    </View>
  );
}

/**
 * An open match's sides are toss-time shells named "<match name> · Side A"
 * (see perform_toss). The match name is already on screen, so only "Side A"
 * is worth repeating -- the full string truncated badly on a phone.
 */
function sideName(name: string | null | undefined): string | null {
  if (!name) return null;
  const side = /·\s*(Side [AB])$/.exec(name);
  return side?.[1] ?? name;
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: spacing.xxl,
    },
    flex: { flex: 1 },
    dim: { opacity: 0.6 },
    strong: { fontWeight: '800' },
    card: {
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardClip: { overflow: 'hidden' },
    body: { padding: spacing.lg, gap: spacing.lg },
    hero: {
      alignItems: 'center',
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.lg,
      gap: spacing.xs,
    },
    heroBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    heroTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      fontSize: 24,
      lineHeight: 30,
    },
    heroSub: { opacity: 0.85, maxWidth: 280 },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      fontSize: 22,
      lineHeight: 28,
    },
    section: { gap: spacing.sm + 2 },
    sectionTitle: {
      fontSize: 16,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
    },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepNum: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNumText: {
      color: colors.textInverse,
      fontWeight: '800',
      fontSize: 12,
      lineHeight: 14,
    },
    callRow: { flexDirection: 'row', gap: spacing.sm + 2 },
    callOption: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    callOptionOn: { borderColor: colors.primary, borderWidth: 2 },
    callCoin: { width: 40, height: 40, borderRadius: 20 },
    callCoinOff: { opacity: 0.55 },
    callLabel: {
      flex: 1,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      fontSize: 16,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    // Three to a row; six options make two tidy rows on any phone width.
    oversRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    oversChip: {
      flexBasis: '30%',
      flexGrow: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    oversChipOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    oversNum: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      fontSize: 18,
      lineHeight: 22,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.background,
    },
    cta: { gap: spacing.sm },
    resultBlock: { gap: spacing.sm, alignItems: 'center' },
    summaryPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      alignSelf: 'center',
    },
    summaryDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    decisionRow: { flexDirection: 'row', gap: spacing.sm + 2 },
    decisionBtn: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    decisionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      fontSize: 16,
    },
    flipAgain: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      alignSelf: 'center',
      paddingVertical: spacing.xs,
    },
    trophyWrap: { alignItems: 'center' },
    decisionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      alignSelf: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
    },
    factRow: {
      flexDirection: 'row',
      borderRadius: radius.md,
      backgroundColor: colors.background,
      paddingVertical: spacing.sm + 2,
    },
    fact: { flex: 1, alignItems: 'center', gap: 2 },
    factValue: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      fontSize: 16,
    },
    errorBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.danger,
    },
  });
