/**
 * Scorecard — Team-level scores and match result.
 * Displays overall team summaries (runs/wickets/overs) for both innings.
 */
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useMatch } from '@features/matches/presentation/useMatches';
import { useLiveState } from '@features/scoring/presentation/useScoring';
import { formatOvers } from '@features/scoring/domain/scoringSchema';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Screen } from '@shared/ui/Screen';

export default function ScorecardScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';

  const match = useMatch(matchId);
  const live = useLiveState(matchId, true); // no polling; this is a report

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
  const isSecondInnings = s.innings_number === 2;

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
        <AppText variant="label" style={styles.sectionHeader}>
          Match Summary
        </AppText>

        {isSecondInnings ? (
          <>
            {/* 1st Innings: Bowling Team */}
            <View style={styles.teamScoreRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{s.bowling_team}</AppText>
                <AppText variant="caption" muted>
                  1st Innings
                </AppText>
              </View>
              <AppText variant="heading" style={styles.scoreText}>
                {s.target !== null ? `${s.target - 1} runs` : '—'}
              </AppText>
            </View>

            <View style={styles.divider} />

            {/* 2nd Innings: Batting Team */}
            <View style={styles.teamScoreRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{s.batting_team}</AppText>
                <AppText variant="caption" muted>
                  2nd Innings
                </AppText>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText variant="heading" style={styles.scoreText}>
                  {s.runs}/{s.wickets}
                </AppText>
                <AppText variant="caption" muted>
                  ({formatOvers(s.legal_balls)} ov)
                </AppText>
              </View>
            </View>
          </>
        ) : (
          <>
            {/* 1st Innings: Batting Team */}
            <View style={styles.teamScoreRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{s.batting_team}</AppText>
                <AppText variant="caption" muted>
                  1st Innings
                </AppText>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText variant="heading" style={styles.scoreText}>
                  {s.runs}/{s.wickets}
                </AppText>
                <AppText variant="caption" muted>
                  ({formatOvers(s.legal_balls)} ov)
                </AppText>
              </View>
            </View>

            <View style={styles.divider} />

            {/* 2nd Innings: Bowling Team */}
            <View style={styles.teamScoreRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{s.bowling_team}</AppText>
                <AppText variant="caption" muted>
                  2nd Innings
                </AppText>
              </View>
              <AppText variant="body" muted style={styles.scoreText}>
                Yet to bat
              </AppText>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
    card: {
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    result: { backgroundColor: colors.primary, borderColor: colors.primary },
    sectionHeader: {
      marginBottom: spacing.xs,
    },
    teamScoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    scoreText: {
      textAlign: 'right',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing.xs,
    },
  });
