/**
 * Profile — the player's own statistics screen.
 *
 * Team-level match figures: matches played, wins, win rate, and Player of the Match awards.
 * Individual player batting/bowling averages have been simplified to focus on team outcomes.
 */
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { authRepository } from '@features/auth/data/authRepository';
import { useAuthStore } from '@core/auth/authStore';
import {
  PLAYING_ROLE_LABEL,
  type BattingHistoryRow,
  type PlayerStats,
} from '@features/dashboard/data/dashboardRepository';
import {
  usePlayerBattingHistory,
  usePlayerStats,
} from '@features/dashboard/presentation/useDashboard';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { Sport } from '@shared/types/database.types';
import { useTheme } from '@shared/theme/ThemeContext';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import {
  IconBolt,
  IconChevron,
  IconMoon,
  IconSun,
  IconEdit,
  IconLogout,
  IconMenu,
  IconPin,
  IconShieldCheck,
  IconStar,
  IconUser,
} from '@shared/ui/icons';

type Styles = ReturnType<typeof makeStyles>;

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const OUTCOME_LABEL: Record<BattingHistoryRow['outcome'], string> = {
  won: 'Won',
  lost: 'Lost',
  tied: 'Tied',
};

type TabKey = 'overview' | 'recent';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'recent', label: 'Recent' },
];

const settingsFor = (
  M: MockPalette,
): { key: string; label: string; Icon: typeof IconEdit; tint: string; route?: string }[] => [
  { key: 'edit', label: 'Edit Profile', Icon: IconEdit, tint: M.border, route: '/profile/edit' },
  { key: 'sports', label: 'Sport Preferences', Icon: IconBolt, tint: M.border, route: '/profile/edit' },
];

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function shareOfMatches(part: number, matches: number): string {
  return matches > 0 ? `${Math.round((100 * part) / matches)}% of matches` : '—';
}

function SectionHeading({
  styles,
  M,
  title,
}: {
  styles: Styles;
  M: MockPalette;
  title: string;
}): React.ReactNode {
  return (
    <View style={styles.sectionHeading}>
      <AppText variant="heading" color={M.text} style={styles.sectionTitle}>
        {title}
      </AppText>
    </View>
  );
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

function HeroCard({
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
  return (
    <View style={styles.hero}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
          ) : initial ? (
            <AppText variant="title" color={M.text} style={styles.avatarInitial}>
              {initial}
            </AppText>
          ) : (
            <IconUser color={M.faint} size={44} />
          )}
        </View>
        <Pressable
          style={styles.avatarEdit}
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Edit profile photo and details"
        >
          <IconEdit color={M.limeInk} size={16} />
        </Pressable>
      </View>

      <AppText variant="title" color={M.text} style={styles.heroName}>
        {fullName || 'Your profile'}
      </AppText>

      {areaName ? (
        <View style={styles.heroRow}>
          <IconPin color={M.muted} size={14} />
          <AppText variant="caption" color={M.muted} style={styles.heroArea}>
            {areaName}
          </AppText>
        </View>
      ) : null}

      <View style={styles.chipRow}>
        {roleLabel ? (
          <View style={[styles.chip, { backgroundColor: M.chip }]}>
            <IconStar color={M.green} size={13} />
            <AppText variant="caption" color={M.text} style={styles.chipText}>
              {roleLabel}
            </AppText>
          </View>
        ) : null}
        {sports.map((sport) => (
          <View key={sport} style={[styles.chip, { backgroundColor: M.chip }]}>
            <IconBolt color={M.muted} size={13} />
            <AppText variant="caption" color={M.muted} style={styles.chipText}>
              {sportLabel(sport)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function CareerRow({
  styles,
  M,
  stats,
}: {
  styles: Styles;
  M: MockPalette;
  stats: PlayerStats | null | undefined;
}): React.ReactNode {
  const cells: { label: string; value: string }[] = [
    { label: 'Matches', value: stats ? String(stats.matches_played) : '—' },
    { label: 'Wins', value: stats ? String(stats.wins) : '—' },
    { label: 'Win Rate', value: stats ? `${stats.win_rate}%` : '—' },
    { label: 'POTM', value: stats ? String(stats.motm) : '—' },
  ];
  return (
    <View style={styles.careerCard}>
      {cells.map((cell, i) => (
        <View key={cell.label} style={[styles.careerCell, i > 0 ? styles.careerCellDivided : null]}>
          <AppText variant="heading" color={M.text} style={styles.careerValue}>
            {cell.value}
          </AppText>
          <AppText variant="caption" color={M.muted} center style={styles.careerLabel}>
            {cell.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function TabBar({
  styles,
  M,
  active,
  onChange,
}: {
  styles: Styles;
  M: MockPalette;
  active: TabKey;
  onChange: (key: TabKey) => void;
}): React.ReactNode {
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const on = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={[styles.tab, on ? { backgroundColor: M.lime } : null]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <AppText variant="label" color={on ? M.limeInk : M.muted} style={styles.tabText}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function PerfTile({
  styles,
  M,
  label,
  value,
  sub,
}: {
  styles: Styles;
  M: MockPalette;
  label: string;
  value: string;
  sub: string;
}): React.ReactNode {
  return (
    <View style={styles.tile}>
      <AppText variant="caption" color={M.muted}>
        {label}
      </AppText>
      <AppText variant="title" color={M.text} style={styles.tileValue}>
        {value}
      </AppText>
      <AppText variant="caption" color={M.faint}>
        {sub}
      </AppText>
    </View>
  );
}

function MatchCard({
  styles,
  M,
  row,
}: {
  styles: Styles;
  M: MockPalette;
  row: BattingHistoryRow;
}): React.ReactNode {
  const outcomeColor =
    row.outcome === 'won' ? M.green : row.outcome === 'lost' ? M.danger : M.muted;
  const outcomeBg =
    row.outcome === 'won' ? `${M.green}20` : row.outcome === 'lost' ? `${M.danger}20` : `${M.muted}20`;

  return (
    <View style={styles.matchCard}>
      <View style={styles.matchMain}>
        <View style={styles.matchTitleRow}>
          <AppText variant="label" color={M.text} style={styles.matchOpponent} numberOfLines={1}>
            {row.opponent_name ?? 'Opponent'}
          </AppText>
          {row.is_motm ? (
            <View style={[styles.motm, { backgroundColor: M.lime }]}>
              <IconStar color={M.limeInk} size={11} />
              <AppText variant="caption" color={M.limeInk} style={styles.motmText}>
                POTM
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.matchMetaRow}>
          <AppText variant="caption" color={M.muted}>
            {formatDay(row.played_at)}
          </AppText>
        </View>
      </View>
      <View style={[styles.outcomeBadge, { backgroundColor: outcomeBg }]}>
        <AppText variant="caption" color={outcomeColor} style={styles.outcomeText}>
          {OUTCOME_LABEL[row.outcome]}
        </AppText>
      </View>
    </View>
  );
}

export default function ProfileScreen(): React.ReactNode {
  const M = useMock();
  const { isDark, setScheme } = useTheme();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);
  const sportLabel = useSportLabel();
  const sports = profile?.sport_pref ?? [];
  const statsQuery = usePlayerStats();
  const historyQuery = usePlayerBattingHistory(10);
  const [tab, setTab] = useState<TabKey>('overview');

  const stats = statsQuery.data;
  const history = historyQuery.data;
  const played = stats?.matches_played ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconMenu color={M.text} />
        <AppLogo width={84} />
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 1 — identity, from the logged-in profile */}
        <HeroCard
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

        {/* 2 — career totals */}
        <CareerRow styles={styles} M={M} stats={stats} />
        {statsQuery.isError ? (
          <Notice
            styles={styles}
            M={M}
            text="Couldn't load your career figures."
            onRetry={() => void statsQuery.refetch()}
          />
        ) : null}

        {/* 3 — tabs */}
        <TabBar styles={styles} M={M} active={tab} onChange={setTab} />

        {/* 4 — Overview Performance Tiles */}
        {tab === 'overview' ? (
          <>
            <SectionHeading styles={styles} M={M} title="Performance" />
            <View style={styles.tileGrid}>
              <PerfTile
                styles={styles}
                M={M}
                label="Matches Won"
                value={String(stats?.wins ?? 0)}
                sub={`${stats?.matches_played ?? 0} Played`}
              />
              <PerfTile
                styles={styles}
                M={M}
                label="Win Rate"
                value={`${stats?.win_rate ?? 0}%`}
                sub={`${stats?.wins ?? 0} ${(stats?.wins ?? 0) === 1 ? 'Win' : 'Wins'}`}
              />
              <PerfTile
                styles={styles}
                M={M}
                label="Player of Match"
                value={String(stats?.motm ?? 0)}
                sub={shareOfMatches(stats?.motm ?? 0, played)}
              />
              <PerfTile
                styles={styles}
                M={M}
                label="Total Matches"
                value={String(played)}
                sub={`${stats?.wins ?? 0} Won · ${(stats?.matches_played ?? 0) - (stats?.wins ?? 0)} Other`}
              />
            </View>
          </>
        ) : null}

        {/* 5 — Recent Matches */}
        {tab === 'recent' ? (
          <>
            <SectionHeading styles={styles} M={M} title="Recent Matches" />
            {historyQuery.isError ? (
              <Notice
                styles={styles}
                M={M}
                text="Couldn't load your recent matches."
                onRetry={() => void historyQuery.refetch()}
              />
            ) : history && history.length > 0 ? (
              history.map((row) => <MatchCard key={row.match_id} styles={styles} M={M} row={row} />)
            ) : (
              <View style={styles.card}>
                <AppText variant="body" color={M.text}>
                  {historyQuery.isLoading ? 'Loading your matches…' : 'No completed matches yet'}
                </AppText>
                <AppText variant="caption" color={M.muted} style={styles.emptyHint}>
                  {historyQuery.isLoading
                    ? 'One moment.'
                    : 'Your match results appear here once a fixture you played is finished.'}
                </AppText>
              </View>
            )}
          </>
        ) : null}

        {/* Settings */}
        <AppText variant="caption" color={M.faint} style={styles.settingsLabel}>
          ACCOUNT SETTINGS
        </AppText>
        <Pressable
          style={styles.settingRow}
          onPress={() => setScheme(isDark ? 'light' : 'dark')}
          accessibilityRole="switch"
          accessibilityState={{ checked: isDark }}
          accessibilityLabel={`Appearance, currently ${isDark ? 'dark' : 'light'}. Double tap to switch to ${isDark ? 'light' : 'dark'}.`}
        >
          <View style={[styles.settingIcon, { backgroundColor: M.iconChip }]}>
            {isDark ? <IconMoon color={M.green} size={20} /> : <IconSun color={M.green} size={20} />}
          </View>
          <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
            Appearance
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {isDark ? 'Dark' : 'Light'}
          </AppText>
        </Pressable>

        {settingsFor(M).map(({ key, label, Icon, tint, route }) => (
          <Pressable
            key={key}
            style={styles.settingRow}
            onPress={() => {
              if (route) router.push(route as never);
            }}
            accessibilityRole="button"
          >
            <View style={[styles.settingIcon, { backgroundColor: tint }]}>
              <Icon color={M.green} size={20} />
            </View>
            <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
              {label}
            </AppText>
            <IconChevron color={M.muted} size={18} />
          </Pressable>
        ))}

        {isSuperadmin ? (
          <>
            <AppText variant="caption" color={M.faint} style={styles.settingsLabel}>
              ADMIN
            </AppText>
            <Pressable
              style={styles.settingRow}
              onPress={() => router.push('/admin' as never)}
              accessibilityRole="button"
            >
              <View style={[styles.settingIcon, { backgroundColor: M.border }]}>
                <IconShieldCheck color={M.green} size={20} />
              </View>
              <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 16 }}>
                Admin Portal
              </AppText>
              <IconChevron color={M.muted} size={18} />
            </Pressable>
          </>
        ) : null}

        <Pressable
          style={styles.logout}
          onPress={() => {
            void authRepository.signOut();
            router.replace('/(auth)/sign-in');
          }}
          accessibilityRole="button"
        >
          <IconLogout color={M.danger} size={18} />
          <AppText variant="label" color={M.danger} style={{ marginLeft: S.sm }}>
            Log Out
          </AppText>
        </Pressable>
      </ScrollView>
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
      paddingVertical: S.md,
    },
    scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },

    // 1 — hero
    hero: {
      alignItems: 'center',
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      paddingVertical: S.lg,
      paddingHorizontal: S.md,
      marginTop: S.sm,
    },
    avatarWrap: { width: 96, height: 96 },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: M.cardHi,
      borderWidth: 3,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarInitial: { fontSize: 36, fontWeight: '800' },
    avatarEdit: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: M.lime,
      borderWidth: 2,
      borderColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroName: { fontSize: 24, fontWeight: '800', marginTop: S.md, textAlign: 'center' },
    heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: S.xs },
    heroArea: { marginLeft: 4 },
    chipRow: {
      flexDirection: 'row',
      gap: S.sm,
      marginTop: S.md,
      flexWrap: 'wrap',
      justifyContent: 'center',
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: R.pill,
      paddingHorizontal: S.md,
      paddingVertical: 6,
    },
    chipText: { marginLeft: 5, fontWeight: '600' },

    // 2 — career row
    careerCard: {
      flexDirection: 'row',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      paddingVertical: S.md,
      marginTop: S.md,
    },
    careerCell: { flex: 1, alignItems: 'center', paddingHorizontal: S.xs },
    careerCellDivided: { borderLeftWidth: 1, borderLeftColor: M.border },
    careerValue: { fontSize: 22, fontWeight: '800' },
    careerLabel: { fontSize: 11, marginTop: 2 },

    // 3 — tabs
    tabBar: {
      flexDirection: 'row',
      backgroundColor: M.card,
      borderRadius: R.pill,
      borderWidth: 1,
      borderColor: M.border,
      padding: 4,
      marginTop: S.lg,
    },
    tab: {
      flex: 1,
      minHeight: 44,
      borderRadius: R.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabText: { fontSize: 14, fontWeight: '700' },

    sectionHeading: { marginTop: S.lg, marginBottom: S.sm },
    sectionTitle: { fontSize: 18, fontWeight: '800' },

    // 4 — performance tiles
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.md },
    tile: {
      flexGrow: 1,
      flexBasis: '45%',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
    },
    tileValue: { fontSize: 26, fontWeight: '800', marginVertical: 2 },

    // shared card
    card: {
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
    },
    emptyHint: { marginTop: S.xs },

    // recent matches
    matchCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      marginBottom: S.sm,
      minHeight: 44,
    },
    matchMain: { flex: 1 },
    matchTitleRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    matchOpponent: { fontSize: 16, flexShrink: 1 },
    matchMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    outcomeBadge: {
      paddingHorizontal: S.md,
      paddingVertical: 6,
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

    settingsLabel: { letterSpacing: 1, fontWeight: '700', marginTop: S.xl, marginBottom: S.sm },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      marginBottom: S.md,
      minHeight: 44,
    },
    settingIcon: {
      width: 40,
      height: 40,
      borderRadius: R.sm,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: S.md,
    },
    logout: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: M.border,
      borderRadius: R.md,
      paddingVertical: S.md + 2,
      marginTop: S.lg,
      minHeight: 44,
    },
  });
