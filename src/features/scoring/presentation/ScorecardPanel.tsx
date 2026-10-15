/**
 * Scorecard — every innings of the match with its team total.
 *
 * Team totals only. Scoring records runs, extras and wickets without naming a
 * striker or a bowler (see the team_only_scoring migration), so there are no
 * per-player batting or bowling figures to show. `get_batting_card` and
 * `get_bowling_card` still exist and still report correctly for matches that
 * were scored with players; nothing in the app calls them.
 *
 * The rows come from `innings`, not `get_live_state`: the latter returns only
 * the innings in play, which made the first innings a derived `target - 1` with
 * no wickets and no overs.
 */
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SlotBadge } from '@features/matches/presentation/SlotBadge';
import { useMatch, useMatchSides } from '@features/matches/presentation/useMatches';
import { useSlotCountdown } from '@features/matches/presentation/useSlotCountdown';
import { useMatchInnings } from '@features/scoring/presentation/useScoring';
import { formatOvers, runRate } from '@features/scoring/domain/scoringSchema';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { useMock } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconTile } from '@shared/ui/decor';
import { IconCricket } from '@shared/ui/icons';

interface ScorecardPanelProps {
  matchId: string;
}

export function ScorecardPanel({ matchId }: ScorecardPanelProps): React.ReactNode {
  const { colors } = useTheme();
  const M = useMock();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const match = useMatch(matchId);
  const innings = useMatchInnings(matchId);
  const sides = useMatchSides(matchId);
  const slot = useSlotCountdown(match.data?.end_time);

  /**
   * Innings rows carry team IDs, not names — `teams` is members-only, so the
   * table cannot join to it for a player on the opposing side. get_match_sides
   * is the read model that may hand out both names.
   */
  const teamName = useMemo(() => {
    const sd = sides.data;
    return (teamId: string): string => {
      if (sd?.team_a_id === teamId) return sd.team_a_name ?? 'Team A';
      if (sd?.team_b_id === teamId) return sd.team_b_name ?? 'Team B';
      return 'Team';
    };
  }, [sides.data]);

  if (innings.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const rows = innings.data ?? [];

  if (rows.length === 0) {
    return (
      <>
        <View style={styles.card}>
          <AppText muted>No scoring yet for this game.</AppText>
        </View>
      </>
    );
  }

  return (
    <>
      <SlotBadge slot={slot} />

      {match.data?.result_text ? (
        <View style={[styles.card, styles.result]}>
          <AppText variant="heading" color={colors.textInverse}>
            {match.data.result_text}
          </AppText>
        </View>
      ) : null}

      {rows.map((inn) => {
        const rr = runRate(inn.runs, inn.legal_balls);
        return (
          <View key={inn.id} style={[styles.card, styles.innings]}>
            <View style={styles.head}>
              <IconTile size={52}>
                <IconCricket color={colors.primary} size={26} />
              </IconTile>
              <View style={styles.flex}>
                <AppText variant="heading" numberOfLines={1} style={styles.team}>
                  {teamName(inn.batting_team_id)}
                </AppText>
                <View style={styles.metaRow}>
                  <AppText variant="caption" muted>
                    {inn.number === 1 ? '1st' : '2nd'} innings ·{' '}
                    {inn.status === 'in_progress' ? 'In progress' : 'Completed'}
                  </AppText>
                  {inn.status === 'in_progress' ? (
                    <View style={[styles.livePill, { backgroundColor: M.chip }]}>
                      <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                      <AppText variant="caption" color={colors.primary} style={styles.liveText}>
                        Live
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={[styles.scoreBox, { backgroundColor: M.chip }]}>
                <AppText variant="heading" color={colors.primary} style={styles.score}>
                  {inn.runs}/{inn.wickets}
                </AppText>
                <AppText variant="caption" muted>
                  ({formatOvers(inn.legal_balls)} ov)
                </AppText>
              </View>
            </View>

            {rr !== null || inn.target !== null ? (
              <AppText variant="caption" muted>
                {rr !== null ? `Run rate ${rr}` : ''}
                {rr !== null && inn.target !== null ? ' · ' : ''}
                {inn.target !== null ? `Chasing ${inn.target} to win.` : ''}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    // The green spine marks an innings card apart from a notice card.
    innings: { borderLeftWidth: 4, borderLeftColor: colors.primary },
    result: { backgroundColor: colors.primary, borderColor: colors.primary },
    flex: { flex: 1, minWidth: 0, gap: 4 },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
    team: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 18 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    liveDot: { width: 7, height: 7, borderRadius: 4 },
    liveText: { fontWeight: '700' },
    scoreBox: {
      alignItems: 'center',
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    score: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 22 },
  });
