/**
 * Scorecard — mockup screens 24 & 25.
 *
 * Reads the same two RPCs the live screen uses, so a completed match and a
 * match still in progress render identically. There is no separate "final"
 * shape to keep in sync.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useMatch } from '@features/matches/presentation/useMatches';
import {
  useBattingCard,
  useBowlingCard,
  useLiveState,
} from '@features/scoring/presentation/useScoring';
import { WICKET_LABEL, formatOvers } from '@features/scoring/domain/scoringSchema';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Screen } from '@shared/ui/Screen';

export default function ScorecardScreen(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';

  const match = useMatch(matchId);
  const live = useLiveState(matchId, true); // no polling; this is a report
  const inningsId = live.data?.innings_id ?? null;
  const batting = useBattingCard(inningsId);
  const bowling = useBowlingCard(inningsId);

  if (live.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Scorecard' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!live.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Scorecard' }} />
        <View style={styles.card}>
          <AppText muted>No scoring yet for this match.</AppText>
        </View>
      </Screen>
    );
  }

  const s = live.data;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Scorecard' }} />

      {match.data?.result_text ? (
        <View style={[styles.card, styles.result]}>
          <AppText variant="heading" color={colors.textInverse}>
            {match.data.result_text}
          </AppText>
        </View>
      ) : null}

      <View style={styles.card}>
        <AppText variant="label">
          {s.batting_team} — {s.runs}/{s.wickets} ({formatOvers(s.legal_balls)} ov)
        </AppText>
      </View>

      <View style={styles.card}>
        <AppText variant="label">Batting</AppText>
        <View style={styles.headRow}>
          <AppText variant="caption" muted style={styles.colName}>
            Batter
          </AppText>
          <AppText variant="caption" muted style={styles.col}>R</AppText>
          <AppText variant="caption" muted style={styles.col}>B</AppText>
          <AppText variant="caption" muted style={styles.col}>4s</AppText>
          <AppText variant="caption" muted style={styles.col}>6s</AppText>
          <AppText variant="caption" muted style={styles.colWide}>SR</AppText>
        </View>
        {(batting.data ?? []).length === 0 ? (
          <AppText variant="caption" muted>No balls faced yet.</AppText>
        ) : (
          (batting.data ?? []).map((b) => (
            <View key={b.user_id} style={styles.dataRow}>
              <View style={styles.colName}>
                <AppText>{b.full_name ?? 'Player'}</AppText>
                <AppText variant="caption" muted>
                  {b.is_out && b.wicket_type ? WICKET_LABEL[b.wicket_type] : 'not out'}
                </AppText>
              </View>
              <AppText style={styles.col}>{b.runs}</AppText>
              <AppText style={styles.col}>{b.balls}</AppText>
              <AppText style={styles.col}>{b.fours}</AppText>
              <AppText style={styles.col}>{b.sixes}</AppText>
              <AppText style={styles.colWide}>{b.strike_rate ?? '—'}</AppText>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <AppText variant="label">Bowling</AppText>
        <View style={styles.headRow}>
          <AppText variant="caption" muted style={styles.colName}>Bowler</AppText>
          <AppText variant="caption" muted style={styles.col}>O</AppText>
          <AppText variant="caption" muted style={styles.col}>R</AppText>
          <AppText variant="caption" muted style={styles.col}>W</AppText>
          <AppText variant="caption" muted style={styles.colWide}>Econ</AppText>
        </View>
        {(bowling.data ?? []).length === 0 ? (
          <AppText variant="caption" muted>Nobody has bowled yet.</AppText>
        ) : (
          (bowling.data ?? []).map((b) => (
            <View key={b.user_id} style={styles.dataRow}>
              <AppText style={styles.colName}>{b.full_name ?? 'Player'}</AppText>
              <AppText style={styles.col}>{b.overs_text}</AppText>
              <AppText style={styles.col}>{b.runs}</AppText>
              <AppText style={styles.col}>{b.wickets}</AppText>
              <AppText style={styles.colWide}>{b.economy ?? '—'}</AppText>
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  result: { backgroundColor: colors.primary, borderColor: colors.primary },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dataRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  colName: { flex: 3 },
  col: { flex: 1, textAlign: 'right' },
  colWide: { flex: 1.4, textAlign: 'right' },
});
