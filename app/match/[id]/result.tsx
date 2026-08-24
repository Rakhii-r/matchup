/**
 * Match Complete & Scorecard Screen.
 * Shows the winner banner, match result text, full innings scorecards, and squad lineups.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { useMatch, useMatchPlayers, useRematch } from '@features/matches/presentation/useMatches';
import { useLiveState } from '@features/scoring/presentation/useScoring';
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
  const styles = useMemo(() => makeStyles(M), [M]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.user.id);

  const match = useMatch(matchId);
  const live = useLiveState(matchId, true); // no polling — match is finished
  const players = useMatchPlayers(matchId);
  const rematch = useRematch();
  const [rematchError, setRematchError] = useState<string | null>(null);

  const state = live.data ?? null;
  const isSecondInnings = state !== null && state.innings_number === 2;
  const second = isSecondInnings ? state : null;
  const firstRuns = second !== null && second.target !== null ? second.target - 1 : null;

  const winner = useMemo(() => {
    if (second === null || firstRuns === null) return null;
    if (second.runs > firstRuns) return second.batting_team;
    if (firstRuns > second.runs) return second.bowling_team;
    return null;
  }, [firstRuns, second]);

  const isTie = second !== null && firstRuns !== null && second.runs === firstRuns;
  const resultText = match.data?.result_text ?? null;
  const headline = winner ?? (isTie ? 'Match tied' : null);

  const motmId = match.data?.motm_user_id ?? null;
  const motmName = useMemo(() => {
    if (motmId === null) return null;
    const row = (players.data ?? []).find((p) => p.user_id === motmId);
    return row?.profile?.full_name ?? 'Player';
  }, [motmId, players.data]);

  const isCreator = Boolean(match.data && userId && match.data.creator_id === userId);
  const now = useMemo(() => new Date(), []);
  const endTimeIso = match.data?.end_time;
  const endTime = useMemo(() => (endTimeIso ? new Date(endTimeIso) : null), [endTimeIso]);
  const hasTimeRemaining = Boolean(endTime && now < endTime);
  const canPlayAgain = match.data?.status === 'completed' && isCreator && hasTimeRemaining;

  const timeLeftFormatted = useMemo(() => {
    if (!endTime || now >= endTime) return null;
    const diffMs = endTime.getTime() - now.getTime();
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }, [endTime, now]);

  const onPlayAgain = async () => {
    setRematchError(null);
    try {
      const newMatch = await rematch.mutateAsync(matchId);
      router.replace(`/match/${newMatch.id}/toss`);
    } catch (e) {
      setRematchError(e instanceof AppError ? e.message : 'Could not start next match.');
    }
  };

  const roster = useMemo(() => players.data ?? [], [players.data]);
  const sideA = useMemo(() => roster.filter((p) => p.side === 'a'), [roster]);
  const sideB = useMemo(() => roster.filter((p) => p.side === 'b'), [roster]);

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/teams/matches');
  };

  if (match.isLoading || live.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.statePad}>
          <View style={styles.stateBox}>
            <ActivityIndicator color={M.green} size="large" />
            <AppText variant="body" color={M.muted} center>
              Loading match scorecard…
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
              {match.isError ? 'Could not load this match result.' : 'That match no longer exists.'}
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
            Match Scorecard
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {m.match_name}
          </AppText>
        </View>
        <View style={{ width: TOUCH }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
              Match concluded
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

        {/* Scorecard Summary */}
        <View style={styles.card}>
          <AppText variant="label" color={M.text} style={{ fontSize: 15, marginBottom: S.xs }}>
            📊 INNINGS SCORECARD
          </AppText>

          {state ? (
            isSecondInnings ? (
              <>
                {/* 1st Innings: Bowling Team */}
                <View style={styles.inningsRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="heading" color={M.text} style={{ fontSize: 16 }}>
                      {state.bowling_team || '1st Innings'}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      1st Innings
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText variant="heading" color={M.green} style={{ fontSize: 18 }}>
                      {state.target !== null ? `${state.target - 1} runs` : '—'}
                    </AppText>
                  </View>
                </View>

                <View style={styles.divider} />

                {/* 2nd Innings: Batting Team */}
                <View style={styles.inningsRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="heading" color={M.text} style={{ fontSize: 16 }}>
                      {state.batting_team || '2nd Innings'}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      2nd Innings ({formatOvers(state.legal_balls)} ov)
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText variant="heading" color={M.green} style={{ fontSize: 18 }}>
                      {state.runs}/{state.wickets}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      Target: {state.target}
                    </AppText>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.inningsRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="heading" color={M.text} style={{ fontSize: 16 }}>
                    {state.batting_team || '1st Innings'}
                  </AppText>
                  <AppText variant="caption" color={M.muted}>
                    ({formatOvers(state.legal_balls)} ov)
                  </AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText variant="heading" color={M.green} style={{ fontSize: 18 }}>
                    {state.runs}/{state.wickets}
                  </AppText>
                </View>
              </View>
            )
          ) : (
            <AppText variant="body" color={M.muted}>
              No ball-by-ball score was recorded for this match.
            </AppText>
          )}
        </View>

        {/* Player of the Match if available */}
        {motmName ? (
          <View style={styles.card}>
            <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
              🌟 PLAYER OF THE MATCH
            </AppText>
            <AppText variant="heading" color={M.text} style={{ fontSize: 18 }}>
              {motmName}
            </AppText>
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
                  ⚡ Play Again
                </AppText>
              )}
            </Pressable>
            {timeLeftFormatted ? (
              <AppText variant="caption" color={M.muted} center style={styles.helperText}>
                Time left in slot: {timeLeftFormatted}
              </AppText>
            ) : null}
            {rematchError ? (
              <AppText variant="caption" color={M.danger} center style={styles.helperText}>
                {rematchError}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <Pressable onPress={onBack} accessibilityRole="button" style={styles.secondaryBtn}>
          <AppText variant="label" color={M.green}>
            ← Back to Matches
          </AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
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
