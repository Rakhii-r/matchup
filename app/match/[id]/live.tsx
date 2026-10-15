/**
 * Match Center — where the game is actually played.
 *
 * The lobby (`match/[id]/index.tsx`) is now pre-match only: who is coming, where
 * it is, and the share code. Everything that happens once the ball is in play
 * lives here, behind the host's "Start match" button.
 *
 * Three tabs over three panels that were, until this screen existed, three
 * separate routes. The routes still exist as redirects into this screen — 77
 * push notifications already deep-link to /match/<id>/toss — which is why the
 * panels take `matchId` as a prop rather than reading it from the URL.
 *
 * WHICH TAB OPENS. An explicit `?tab=` wins, because that is a deep link or a
 * redirect saying where to land. With no parameter the screen follows the game:
 * before the toss is decided the only thing anybody can do is the toss, and
 * after it the scoring console is the point. Once chosen, the tab is the user's
 * — the toss resolving under them must not yank the screen away mid-tap, so the
 * derived default is applied once and then left alone.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { TossPanel } from '@features/matches/presentation/TossPanel';
import { useMatch } from '@features/matches/presentation/useMatches';
import { useToss } from '@features/matches/presentation/useToss';
import { LiveScoringPanel } from '@features/scoring/presentation/LiveScoringPanel';
import { ScorecardPanel } from '@features/scoring/presentation/ScorecardPanel';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { PageHeader, StadiumBackdrop } from '@shared/ui/decor';
import { IconCoin, IconDoc, IconLive, type IconProps } from '@shared/ui/icons';
import { Screen } from '@shared/ui/Screen';

type Tab = 'toss' | 'live' | 'card';

const TABS: {
  key: Tab;
  label: string;
  /** Screen title while this tab is showing. */
  title: string;
  Icon: (p: IconProps) => React.ReactNode;
}[] = [
  { key: 'toss', label: 'Toss', title: 'Toss', Icon: IconCoin },
  { key: 'live', label: 'Live', title: 'Live Scoring', Icon: IconLive },
  { key: 'card', label: 'Scorecard', title: 'Match Details', Icon: IconDoc },
];

function isTab(v: string | undefined): v is Tab {
  return v === 'toss' || v === 'live' || v === 'card';
}

export default function MatchCenter(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const matchId = id ?? '';

  const match = useMatch(matchId);
  const toss = useToss(matchId);

  // `null` means "nobody has chosen yet, follow the game". The moment anyone
  // taps a tab -- or the toss panel hands over after bat/bowl is picked -- this
  // holds a real value and the derived default stops applying, so the screen
  // never moves under someone who is using it.
  const [picked, setPicked] = useState<Tab | null>(() => (isTab(tabParam) ? tabParam : null));

  // Derived during render, not synced in an effect: before the toss is decided
  // the toss is the only thing anybody can do, and the moment it is decided the
  // scoring console is the point ("the toss unlocks scoring").
  const tab: Tab = picked ?? (toss.data?.decision ? 'live' : 'toss');

  const title = match.data?.match_name ?? 'Match';

  if (match.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Match' }} />
        <PageHeader title="Match" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  // A called-off game has no toss, no keypad and no scorecard to show: the
  // server refuses all three, so the screen says so rather than rendering three
  // tabs of errors.
  const status = match.data?.status;
  if (status === 'cancelled' || status === 'expired') {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <PageHeader title={title} />
        <View style={styles.center}>
          <AppText variant="label">
            {status === 'cancelled' ? 'This game was cancelled' : 'This game expired'}
          </AppText>
          <AppText variant="caption" muted center style={{ marginTop: spacing.xs }}>
            There is nothing left to score.
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title }} />
      {/* Behind everything, pinned to the bottom of the content. */}
      <StadiumBackdrop />

      <PageHeader
        title={TABS.find((t) => t.key === tab)?.title ?? title}
        subtitle={match.data?.match_name ?? undefined}
      />

      <View style={styles.tabs}>
        {TABS.map((t, i) => {
          const on = tab === t.key;
          const tint = on ? colors.primary : colors.textMuted;
          return (
            <Pressable
              key={t.key}
              onPress={() => setPicked(t.key)}
              style={[styles.tab, i > 0 && !on ? styles.tabDivider : null, on && styles.tabOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
            >
              <t.Icon color={tint} size={20} />
              <AppText variant="label" color={tint} style={{ fontSize: 15 }}>
                {t.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {tab === 'toss' ? (
        <TossPanel matchId={matchId} onProceed={() => setPicked('live')} />
      ) : null}
      {tab === 'live' ? (
        <LiveScoringPanel matchId={matchId} onOpenScorecard={() => setPicked('card')} />
      ) : null}
      {tab === 'card' ? <ScorecardPanel matchId={matchId} /> : null}
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    tabs: {
      flexDirection: 'row',
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.xs,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 3,
      borderBottomColor: 'transparent',
    },
    tabDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
    tabOn: { borderBottomColor: colors.primary },
  });
