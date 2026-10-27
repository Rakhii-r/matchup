/**
 * Profile — the player's own statistics screen.
 *
 * Team-level match figures: matches played, wins, win rate, and Player of the Match awards.
 * Account settings, the admin entry and Log Out live on `/profile/settings`,
 * behind the gear in this screen's header.
 * Individual player batting/bowling averages have been simplified to focus on team outcomes.
 */
import { useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRefreshAll } from '@shared/ui/useRefreshAll';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';

import { useAuthStore } from '@core/auth/authStore';
import {
  PLAYING_ROLE_LABEL,
  type BattingHistoryRow,
  type PlayerStats,
} from '@features/dashboard/data/dashboardRepository';
import {
  usePendingActions,
  usePlayerBattingHistory,
  usePlayerStats,
} from '@features/dashboard/presentation/useDashboard';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useTabContentPadding } from '@shared/theme/responsive';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import { IconTile, StadiumBackdrop, TINT, type TintName } from '@shared/ui/decor';
import {
  IconBarChart,
  IconBell,
  IconChevron,
  IconClock,
  IconCricket,
  IconGear,
  IconEdit,
  IconPin,
  IconStar,
  IconTrophy,
  IconUser,
  type IconProps,
} from '@shared/ui/icons';

type Styles = ReturnType<typeof makeStyles>;

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const OUTCOME_LABEL: Record<BattingHistoryRow['outcome'], string> = {
  won: 'Won',
  lost: 'Lost',
  tied: 'Tied',
};

/** Recent games shown before "View All" is tapped. */
const RECENT_PREVIEW = 2;

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function Notice({
  styles,
  M,
  text,
  onRetry,
}: {
  styles: Styles;
  M: MockPalette;
  text: string;
  onRetry: () => void;
}): React.ReactNode {
  return (
    <View style={styles.notice}>
      <AppText variant="caption" color={M.muted} style={styles.noticeText}>
        {text}
      </AppText>
      <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button">
        <AppText variant="label" color={M.text}>
          Retry
        </AppText>
      </Pressable>
    </View>
  );
}

function Hero({
  styles,
  M,
  fullName,
  areaName,
  avatarUrl,
  roleLabel,
  sports,
  sportLabel,
  onEdit,
}: {
  styles: Styles;
  M: MockPalette;
  fullName: string | null;
  areaName: string | null;
  avatarUrl: string | null;
  roleLabel: string | null;
  sports: Sport[];
  sportLabel: (sport: Sport) => string;
  onEdit: () => void;
}): React.ReactNode {
  const initial = fullName?.trim().charAt(0).toUpperCase() ?? '';
  const sportsText = sports.map(sportLabel).join(' · ');
  return (
    <View style={styles.hero}>
      <Pressable
        style={styles.avatarWrap}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Edit profile photo and details"
      >
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
          ) : initial ? (
            <AppText variant="title" color={M.green} style={styles.avatarInitial}>
              {initial}
            </AppText>
          ) : (
            <IconUser color={M.faint} size={56} />
          )}
        </View>
        <View style={styles.avatarEdit}>
          <IconEdit color={M.limeInk} size={16} />
        </View>
      </Pressable>

      <AppText variant="title" color={M.text} style={styles.heroName} numberOfLines={2}>
        {fullName || 'Your profile'}
      </AppText>

      <View style={styles.heroMeta}>
        {areaName ? (
          <View style={styles.heroMetaItem}>
            <IconPin color={M.text} size={16} />
            <AppText variant="label" color={M.text} numberOfLines={1} style={styles.heroMetaText}>
              {areaName}
            </AppText>
          </View>
        ) : null}
        {areaName && sportsText ? <View style={styles.heroMetaRule} /> : null}
        {sportsText ? (
          <View style={styles.heroMetaItem}>
            <IconCricket color={M.text} size={16} />
            <AppText variant="label" color={M.text} numberOfLines={1} style={styles.heroMetaText}>
              {sportsText}
            </AppText>
          </View>
        ) : null}
      </View>

      {roleLabel ? (
        <View style={styles.rolePill}>
          <IconStar color={M.green} size={13} />
          <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
            {roleLabel}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const RING_SIZE = 132;
const RING_STROKE = 13;

/** Win ratio as a ring. The arc starts at twelve o'clock and runs clockwise. */
function WinRing({ styles, M, rate }: { styles: Styles; M: MockPalette; rate: number | null }) {
  const r = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, rate ?? 0));
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityLabel={rate === null ? 'Win ratio not available' : `Win ratio ${pct} percent`}
    >
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          stroke={M.border}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        {pct > 0 ? (
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={r}
            stroke={M.green}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - pct / 100)}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        ) : null}
      </Svg>
      <View style={styles.ringLabel}>
        <AppText variant="title" color={M.text} style={styles.ringValue}>
          {rate === null ? '—' : `${pct}%`}
        </AppText>
        <AppText variant="caption" color={M.muted}>
          Win Ratio
        </AppText>
      </View>
    </View>
  );
}

function PerformanceCard({
  styles,
  M,
  stats,
}: {
  styles: Styles;
  M: MockPalette;
  stats: PlayerStats | null | undefined;
}): React.ReactNode {
  // An em-dash until the figures arrive: a row of zeros would read as a record.
  const show = (n: number | undefined, suffix = ''): string =>
    n === undefined ? '—' : `${n}${suffix}`;
  const rows: {
    label: string;
    value: string;
    tint: TintName;
    Icon?: (p: IconProps) => React.ReactNode;
  }[] = [
    { label: 'Games Won', value: show(stats?.wins), tint: 'green', Icon: IconTrophy },
    { label: 'Total Matches', value: show(stats?.matches_played), tint: 'blue', Icon: IconBarChart },
    { label: 'Win Ratio', value: show(stats?.win_rate, '%'), tint: 'amber' },
    { label: 'Player of the Game', value: show(stats?.motm), tint: 'violet', Icon: IconStar },
  ];
  return (
    <View style={styles.panel}>
      <AppText variant="heading" color={M.text} style={styles.panelTitle}>
        Performance
      </AppText>
      <View style={styles.perfBody}>
        <WinRing styles={styles} M={M} rate={stats ? stats.win_rate : null} />
        <View style={styles.perfRule} />
        <View style={styles.perfList}>
          {rows.map(({ label, value, tint, Icon }, i) => (
            <View key={label} style={[styles.perfRow, i > 0 ? styles.perfRowRule : null]}>
              <IconTile size={36} color={TINT[tint].bg}>
                {Icon ? (
                  <Icon color={TINT[tint].fg} size={18} />
                ) : (
                  <AppText variant="label" color={TINT[tint].fg} style={styles.percentGlyph}>
                    %
                  </AppText>
                )}
              </IconTile>
              <AppText variant="caption" color={M.text} numberOfLines={2} style={styles.perfLabel}>
                {label}
              </AppText>
              <AppText variant="heading" color={M.text} style={styles.perfValue}>
                {value}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function MatchCard({
  styles,
  M,
  row,
  onPress,
}: {
  styles: Styles;
  M: MockPalette;
  row: BattingHistoryRow;
  onPress: () => void;
}): React.ReactNode {
  const tint: TintName = row.outcome === 'won' ? 'green' : row.outcome === 'lost' ? 'red' : 'amber';

  return (
    <Pressable
      style={styles.matchCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.match_name}, ${OUTCOME_LABEL[row.outcome]}. Open result`}
    >
      <IconTile size={52} color={TINT[tint].bg}>
        <IconTrophy color={TINT[tint].fg} size={24} />
      </IconTile>
      <View style={styles.matchMain}>
        <AppText variant="label" color={M.text} style={styles.matchOpponent} numberOfLines={1}>
          {row.opponent_name ? `vs ${row.opponent_name}` : row.match_name}
        </AppText>
        <View style={styles.matchMetaRow}>
          <View style={[styles.outcomeBadge, { backgroundColor: TINT[tint].bg }]}>
            <AppText variant="caption" color={TINT[tint].fg} style={styles.outcomeText}>
              {OUTCOME_LABEL[row.outcome]}
            </AppText>
          </View>
          {row.is_motm ? (
            <View style={[styles.motm, { backgroundColor: TINT.violet.bg }]}>
              <IconStar color={TINT.violet.fg} size={11} />
              <AppText variant="caption" color={TINT.violet.fg} style={styles.motmText}>
                POTM
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.matchWhen}>
        <AppText variant="caption" color={M.muted}>
          Played
        </AppText>
        <AppText variant="label" color={M.text}>
          {formatDay(row.played_at)}
        </AppText>
      </View>
      <IconChevron color={M.text} size={18} />
    </Pressable>
  );
}

export default function ProfileScreen(): React.ReactNode {
  const M = useMock();
  const { refreshing, onRefresh } = useRefreshAll();
  // Reserve the tab bar plus the device's bottom inset, or the last card in
  // this list sits underneath the bar.
  const tabContentPadding = useTabContentPadding();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const sportLabel = useSportLabel();
  const sports = profile?.sport_pref ?? [];
  const statsQuery = usePlayerStats();
  const historyQuery = usePlayerBattingHistory(10);
  const pendingCount = (usePendingActions().data ?? []).length;
  const [showAllRecent, setShowAllRecent] = useState(false);

  const stats = statsQuery.data;
  const history = historyQuery.data ?? [];
  const recent = showAllRecent ? history : history.slice(0, RECENT_PREVIEW);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabContentPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={M.green} />}
      >
        {/* Sky and stadium behind the header and the identity block. */}
        <View style={styles.heroArea}>
          <LinearGradient
            colors={[M.chip, M.bg]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <StadiumBackdrop height={210} net={false} />

          <View style={styles.header}>
            <AppLogo variant="icon" width={48} style={{ borderRadius: 12 }} />
            <View style={styles.headerActions}>
              <Pressable
                style={styles.headerBtn}
                onPress={() => router.push('/(tabs)/activity')}
                accessibilityRole="button"
                accessibilityLabel={
                  pendingCount > 0
                    ? `Notifications, ${pendingCount} needing attention`
                    : 'Notifications'
                }
              >
                <IconBell color={M.text} size={22} />
                {pendingCount > 0 ? <View style={styles.bellDot} /> : null}
              </Pressable>
              <Pressable
                style={styles.headerBtn}
                onPress={() => router.push('/profile/settings' as never)}
                accessibilityRole="button"
                accessibilityLabel="Account settings"
              >
                <IconGear color={M.text} size={22} />
              </Pressable>
            </View>
          </View>

          {/* 1 — identity, from the logged-in profile */}
          <Hero
            styles={styles}
            M={M}
            fullName={profile?.full_name ?? stats?.full_name ?? null}
            areaName={profile?.area_name ?? stats?.area_name ?? null}
            avatarUrl={profile?.avatar_url ?? stats?.avatar_url ?? null}
            roleLabel={stats?.playing_role ? PLAYING_ROLE_LABEL[stats.playing_role] : null}
            sports={sports}
            sportLabel={sportLabel}
            onEdit={() => router.push('/profile/edit' as never)}
          />
        </View>

        <View style={styles.content}>
          {/* 2 — career figures */}
          <PerformanceCard styles={styles} M={M} stats={stats} />
          {statsQuery.isError ? (
            <Notice
              styles={styles}
              M={M}
              text="Couldn't load your career figures."
              onRetry={() => void statsQuery.refetch()}
            />
          ) : null}

          {/* 3 — recent games */}
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              <IconClock color={M.green} size={22} />
              <AppText variant="heading" color={M.text} style={styles.panelTitleInline}>
                Recent Games
              </AppText>
              {history.length > RECENT_PREVIEW ? (
                <Pressable
                  onPress={() => setShowAllRecent((v) => !v)}
                  hitSlop={10}
                  style={styles.viewAll}
                  accessibilityRole="button"
                  accessibilityLabel={showAllRecent ? 'Show fewer games' : 'View all recent games'}
                >
                  <AppText variant="caption" color={M.text} style={{ fontSize: 13 }}>
                    {showAllRecent ? 'Show less' : 'View All'}
                  </AppText>
                  <IconChevron color={M.text} size={14} />
                </Pressable>
              ) : null}
            </View>

            {historyQuery.isError ? (
              <Notice
                styles={styles}
                M={M}
                text="Couldn't load your recent games."
                onRetry={() => void historyQuery.refetch()}
              />
            ) : recent.length > 0 ? (
              recent.map((row) => (
                <MatchCard
                  key={row.match_id}
                  styles={styles}
                  M={M}
                  row={row}
                  onPress={() => router.push(`/match/${row.match_id}/result` as never)}
                />
              ))
            ) : (
              <View style={styles.empty}>
                <AppText variant="label" color={M.text}>
                  {historyQuery.isLoading ? 'Loading your games…' : 'No completed games yet'}
                </AppText>
                <AppText variant="caption" color={M.muted} style={styles.emptyHint}>
                  {historyQuery.isLoading
                    ? 'One moment.'
                    : 'Your game results appear here once a fixture you played is finished.'}
                </AppText>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    // The scroll view itself is edge to edge so the sky can be; `content`
    // carries the side padding for everything below the hero.
    scroll: { paddingBottom: S.xl },
    content: { paddingHorizontal: S.md },
    heroArea: { paddingBottom: S.lg, overflow: 'hidden' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.md,
      paddingVertical: S.sm,
    },
    headerActions: { flexDirection: 'row', gap: S.sm + 2 },
    headerBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 3,
    },
    bellDot: {
      position: 'absolute',
      top: 10,
      right: 11,
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: M.danger,
      borderWidth: 1.5,
      borderColor: M.card,
    },

    // 1 - identity
    hero: { alignItems: 'center', paddingHorizontal: S.lg, marginTop: S.xs },
    avatarWrap: { width: 132, height: 132 },
    avatar: {
      width: 132,
      height: 132,
      borderRadius: 66,
      backgroundColor: M.card,
      borderWidth: 5,
      borderColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 6,
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarInitial: { fontSize: 52, lineHeight: 60 },
    avatarEdit: {
      position: 'absolute',
      right: 2,
      bottom: 2,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: M.lime,
      borderWidth: 2.5,
      borderColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroName: { fontSize: 26, lineHeight: 32, marginTop: S.sm + 4, textAlign: 'center' },
    heroMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: S.sm + 4,
      marginTop: S.sm,
    },
    heroMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
    heroMetaText: { flexShrink: 1, fontSize: 15 },
    heroMetaRule: { width: 1, height: 18, backgroundColor: M.muted },
    rolePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: S.sm + 2,
      paddingHorizontal: S.sm + 4,
      paddingVertical: 5,
      borderRadius: R.pill,
      backgroundColor: M.card,
    },

    // panels
    panel: {
      backgroundColor: M.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      marginBottom: S.md,
    },
    panelTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, fontWeight: '700' },
    panelHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.sm + 4 },
    panelTitleInline: {
      flex: 1,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
      fontWeight: '700',
    },
    viewAll: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },

    // 2 - performance
    perfBody: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 4, marginTop: S.sm + 4 },
    perfRule: { width: 1, alignSelf: 'stretch', backgroundColor: M.border },
    perfList: { flex: 1, minWidth: 0 },
    perfRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, paddingVertical: 8 },
    perfRowRule: { borderTopWidth: 1, borderTopColor: M.border },
    perfLabel: { flex: 1, fontSize: 13, lineHeight: 17 },
    perfValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, fontWeight: '700' },
    percentGlyph: { fontSize: 18, fontWeight: '800' },
    ring: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
    ringLabel: { position: 'absolute', alignItems: 'center' },
    ringValue: { fontSize: 28, lineHeight: 32 },

    // 3 - recent games
    empty: { paddingVertical: S.sm },
    emptyHint: { marginTop: S.xs },
    matchCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm + 4,
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.sm + 4,
      marginBottom: S.sm,
      minHeight: 44,
    },
    matchMain: { flex: 1, minWidth: 0, gap: 6 },
    matchOpponent: { fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    matchMetaRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    matchWhen: { alignItems: 'flex-end' },
    outcomeBadge: {
      paddingHorizontal: S.md,
      paddingVertical: 4,
      borderRadius: R.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    outcomeText: {
      fontWeight: '700',
    },
    motm: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: R.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    motmText: { marginLeft: 3, fontSize: 11, fontWeight: '800' },

    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      marginTop: S.sm,
      minHeight: 44,
    },
    noticeText: { flex: 1 },
    retry: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: S.md,
      marginLeft: S.sm,
      borderRadius: R.sm,
      borderWidth: 1,
      borderColor: M.border,
    },
  });
