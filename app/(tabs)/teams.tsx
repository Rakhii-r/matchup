/**
 * Teams tab.
 *
 * A thin hub, not a reimplementation. Every action here pushes to the existing
 * `/teams/*` routes — create, join, detail, challenges and the open
 * challenge poster all already exist and are untouched.
 *
 * The list comes from a single `get_my_teams_overview` call. Rendering a card
 * per team and letting each card fetch its own overview and stats cost 1 + 2N
 * round trips; this is flat in the number of teams, and it also removes the
 * per-card loading flicker that showed an em-dash where the player count
 * belonged.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { useAuthStore } from '@core/auth/authStore';
import { useChatInbox } from '@features/chat/presentation/useCaptainChat';
import { usePendingActions } from '@features/dashboard/presentation/useDashboard';
import { useAllMyBookedMatches } from '@features/matches/presentation/useMatches';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { TeamOverviewRow } from '@features/teams/data/teamRepository';
import { useMyChallenges } from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useTabContentPadding } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { HillsArt, IconTile, TINT } from '@shared/ui/decor';
import {
  IconBarChart,
  IconBell,
  IconCalendar,
  IconChevron,
  IconGamepad,
  IconPlus,
  IconSend,
  IconSort,
  IconSwords,
  IconTarget,
  IconTrophy,
  IconUser,
  IconUserPlus,
  IconUsers,
} from '@shared/ui/icons';

/** W–L, with the tie count appended only when there is one to report. */
function record(team: TeamOverviewRow): string {
  return team.ties > 0
    ? `${team.wins}–${team.losses}–${team.ties}`
    : `${team.wins}–${team.losses}`;
}

type SortMode = 'latest' | 'name';

// The one non-emerald accent on this screen: it is what separates "a challenge
// aimed at you" from the green matchmaking rows above it at a glance.
const ACCENT_VIOLET = '#5B4FD9';

export default function TeamsTab(): React.ReactNode {
  const M = useMock();
  // Reserve the tab bar plus the device's bottom inset, or the last card in
  // this list sits underneath the bar.
  const tabContentPadding = useTabContentPadding();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const actions = usePendingActions();
  const teams = useMyTeamsOverview();
  const challenges = useMyChallenges();
  const booked = useAllMyBookedMatches();
  const [sort, setSort] = useState<SortMode>('latest');

  // The RPC's own order is "Latest", so that mode leaves it untouched.
  const rows = useMemo(() => {
    const list = teams.data ?? [];
    return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list;
  }, [teams.data, sort]);

  const upcomingMatchesCount = (booked.data ?? []).filter(
    (item) => item.match.status === 'open' || item.match.status === 'locked',
  ).length;

  const activeChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data]);

  const incomingCount = (challenges.data ?? []).filter(
    (c) => c.direction === 'incoming' && c.i_can_respond,
  ).length;
  const pendingCount = (actions.data ?? []).length;
  const unreadChats = (useChatInbox().data ?? []).reduce((sum, c) => sum + c.unread, 0);

  // Finding an opponent opens the live radar directly.
  const openRadar = (): void => {
    if (activeChallenge) {
      router.push({
        pathname: '/match/create/searching',
        params: { challengeId: activeChallenge.id },
      });
    } else {
      router.push('/match/create/searching');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabContentPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={teams.isRefetching}
            onRefresh={() => {
              void teams.refetch();
              void challenges.refetch();
              void booked.refetch();
            }}
            tintColor={M.green}
          />
        }
      >
        {/* ---------------- Header ---------------- */}
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="title" color={M.text} style={styles.title}>
              Teams
            </AppText>
            <AppText variant="caption" color={M.muted} style={{ fontSize: 13 }}>
              Build. Play. Grow Together.
            </AppText>
          </View>
          <Pressable
            onPress={() => router.push('/(tabs)/activity')}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={
              pendingCount > 0 ? `Notifications, ${pendingCount} needing attention` : 'Notifications'
            }
          >
            <IconBell color={M.text} size={20} />
            {pendingCount > 0 ? <View style={styles.bellDot} /> : null}
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.avatarBtn}
            accessibilityRole="button"
            accessibilityLabel="View profile"
          >
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
            ) : (
              <IconUser color={M.green} size={22} />
            )}
          </Pressable>
        </View>

        {/* ---------------- Create / Join ---------------- */}
        <View style={styles.pairRow}>
          <Pressable
            style={styles.pairPressable}
            onPress={() => router.push('/teams/create')}
            accessibilityRole="button"
            accessibilityLabel="Create a team. Start your squad."
          >
            <LinearGradient
              colors={[M.greenDeep, M.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.createCard}
            >
              <View style={styles.pairTop}>
                <View style={styles.createPlus}>
                  <IconPlus color={M.green} size={20} strokeWidth={3} />
                </View>
                <View style={styles.createChevron}>
                  <IconChevron color={M.limeInk} size={16} />
                </View>
              </View>
              <AppText variant="label" color={M.limeInk} style={styles.pairTitle}>
                Create Team
              </AppText>
              <AppText variant="caption" color={M.limeInk} style={styles.pairSubOnGreen}>
                Start your squad
              </AppText>
            </LinearGradient>
          </Pressable>

          <Pressable
            style={styles.pairPressable}
            onPress={() => router.push('/teams/join')}
            accessibilityRole="button"
            accessibilityLabel="Join a team with an invite code"
          >
            <View style={styles.joinCard}>
              <View style={styles.pairTop}>
                <IconTile size={40} color={TINT.amber.bg}>
                  <IconUserPlus color={TINT.amber.fg} size={20} />
                </IconTile>
                <IconTile size={36} square>
                  <IconChevron color={M.green} size={16} />
                </IconTile>
              </View>
              <AppText variant="label" color={M.text} style={styles.pairTitle}>
                Join with Code
              </AppText>
              <AppText variant="caption" color={M.muted} style={{ fontSize: 13 }}>
                Join an existing team
              </AppText>
            </View>
          </Pressable>
        </View>

        {/* ---------------- Find Opponent (Radar) ---------------- */}
        <Pressable
          style={styles.radarCard}
          onPress={openRadar}
          accessibilityRole="button"
          accessibilityLabel={
            activeChallenge
              ? 'Live radar search in progress. Tap to view radar.'
              : 'Find an opponent team on radar'
          }
        >
          <HillsArt variant="plain" width={150} />
          <IconTile size={56} color={M.green}>
            <IconTarget color={M.limeInk} size={30} />
          </IconTile>
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <AppText variant="label" color={M.text} style={styles.rowTitle} numberOfLines={1}>
                {activeChallenge ? 'Searching for Opponent' : 'Find Opponent (Radar)'}
              </AppText>
              {activeChallenge ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <AppText variant="caption" color={M.limeInk} style={styles.pillText}>
                    LIVE
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ fontSize: 13 }}>
              {activeChallenge
                ? `${activeChallenge.match_name || 'Team Challenge'} · Tap to view radar`
                : 'Discover nearby teams and challenge them'}
            </AppText>
          </View>
          <IconChevron color={M.green} size={18} />
        </Pressable>

        {/* ---------------- Booked & Scheduled ---------------- */}
        <Pressable
          style={styles.rowCard}
          onPress={() => router.push('/teams/matches')}
          accessibilityRole="button"
          accessibilityLabel="View all booked and scheduled games"
        >
          <IconTile size={52} color={TINT.blue.fg}>
            <IconCalendar color="#FFFFFF" size={24} />
          </IconTile>
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <AppText variant="label" color={M.text} style={styles.rowTitle} numberOfLines={2}>
                Booked & Scheduled Games
              </AppText>
              {upcomingMatchesCount > 0 ? (
                <View style={styles.countPill}>
                  <AppText variant="caption" color={M.green} style={styles.pillText}>
                    {upcomingMatchesCount}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color={M.muted} numberOfLines={2} style={{ fontSize: 13 }}>
              View fixtures, game timings, lineups & scorecards
            </AppText>
          </View>
          <IconChevron color={M.green} size={18} />
        </Pressable>

        {/* ---------------- Directed Challenges ---------------- */}
        <Pressable
          style={styles.rowCard}
          onPress={() => router.push('/teams/challenges')}
          accessibilityRole="button"
          accessibilityLabel="Directed challenges"
        >
          <IconTile size={52} color={ACCENT_VIOLET}>
            <IconSwords color="#FFFFFF" size={24} />
          </IconTile>
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <AppText variant="label" color={M.text} style={styles.rowTitle} numberOfLines={1}>
                Directed Challenges
              </AppText>
              {incomingCount > 0 ? (
                <View style={styles.countPill}>
                  <AppText variant="caption" color={M.green} style={styles.pillText}>
                    {incomingCount} NEW
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color={M.muted} numberOfLines={2} style={{ fontSize: 13 }}>
              View and respond to challenges from other teams
            </AppText>
          </View>
          <IconChevron color={M.green} size={18} />
        </Pressable>

        {/* ---------------- Captain chats ---------------- */}
        <Pressable
          style={styles.rowCard}
          onPress={() => router.push('/chat')}
          accessibilityRole="button"
          accessibilityLabel={
            unreadChats > 0 ? `Captain chats, ${unreadChats} unread` : 'Captain chats'
          }
        >
          <IconTile size={52} color={TINT.teal.fg}>
            <IconSend color="#FFFFFF" size={22} />
          </IconTile>
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <AppText variant="label" color={M.text} style={styles.rowTitle} numberOfLines={1}>
                Captain Chats
              </AppText>
              {unreadChats > 0 ? (
                <View style={styles.unreadPill}>
                  <AppText variant="caption" color="#FFFFFF" style={styles.pillText}>
                    {unreadChats > 99 ? '99+' : unreadChats}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color={M.muted} numberOfLines={2} style={{ fontSize: 13 }}>
              Message opposing captains before and after a game is fixed
            </AppText>
          </View>
          <IconChevron color={M.green} size={18} />
        </Pressable>

        {/* ---------------- My teams ---------------- */}
        <View style={styles.sectionRow}>
          <AppText variant="label" color={M.muted} style={styles.section}>
            MY TEAMS{rows.length > 0 ? ` (${rows.length})` : ''}
          </AppText>
          {rows.length > 1 ? (
            <Pressable
              onPress={() => setSort((v) => (v === 'latest' ? 'name' : 'latest'))}
              hitSlop={10}
              style={styles.sortBtn}
              accessibilityRole="button"
              accessibilityLabel={`Sorted by ${sort === 'latest' ? 'latest' : 'name'}. Tap to change.`}
            >
              <IconSort color={M.muted} size={16} />
              <AppText variant="caption" color={M.muted} style={{ fontSize: 13 }}>
                {sort === 'latest' ? 'Latest' : 'A–Z'}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {teams.isLoading ? (
          <ActivityIndicator color={M.green} style={{ marginTop: S.md }} />
        ) : teams.isError ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text}>
              Could not load your teams
            </AppText>
            <Pressable
              onPress={() => void teams.refetch()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading teams"
              style={styles.retry}
            >
              <AppText variant="caption" color={M.green}>
                Try again
              </AppText>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text}>
              No teams yet
            </AppText>
            <AppText variant="caption" color={M.muted}>
              Create a squad you play with regularly, or join one with an invite code.
            </AppText>
          </View>
        ) : (
          rows.map((t) => <TeamCard key={t.id} team={t} M={M} styles={styles} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Styles are passed in rather than rebuilt here: makeStyles calls
 * StyleSheet.create, so calling it inside the card ran once per card per
 * render — three times per card in the previous version.
 */
function TeamCard({
  team,
  M,
  styles,
}: {
  team: TeamOverviewRow;
  M: MockPalette;
  styles: ReturnType<typeof makeStyles>;
}): React.ReactNode {
  const router = useRouter();
  const sportLabel = useSportLabel();

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/teams/[id]', params: { id: team.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${team.name}, ${team.player_count} players. Open team`}
    >
      <View style={styles.cardHead}>
        {team.logo_url ? (
          <Image source={{ uri: team.logo_url }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoFallback]}>
            <AppText variant="heading" color={M.limeInk}>
              {team.name.slice(0, 1).toUpperCase()}
            </AppText>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="heading" color={M.text} numberOfLines={1} style={{ fontSize: 18 }}>
            {team.name}
          </AppText>
          <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ fontSize: 13 }}>
            {sportLabel(team.sport)} · {team.player_count}{' '}
            {team.player_count === 1 ? 'player' : 'players'}
            {team.i_am_owner ? ' · Captain' : ''}
          </AppText>
        </View>
        {/* Squad size against the declared format; just the size when there is none. */}
        <View style={styles.sizePill}>
          <IconUsers color={M.green} size={14} />
          <AppText variant="caption" color={M.green} style={styles.pillText}>
            {team.target_size ? `${team.player_count}/${team.target_size}` : team.player_count}
          </AppText>
        </View>
        <IconChevron color={M.text} size={18} />
      </View>

      <View style={styles.statRow}>
        <Mini
          icon={<IconGamepad color={TINT.blue.fg} size={18} />}
          label="Games"
          value={team.matches_played}
          M={M}
          styles={styles}
        />
        <View style={styles.statDivider} />
        <Mini
          icon={<IconTrophy color={TINT.amber.fg} size={18} />}
          label={team.matches_played > 0 ? `Wins · ${record(team)}` : 'Wins'}
          value={team.wins}
          M={M}
          styles={styles}
        />
        <View style={styles.statDivider} />
        <Mini
          icon={<IconBarChart color={TINT.green.fg} size={18} />}
          label="Win Rate"
          value={`${team.win_rate}%`}
          M={M}
          styles={styles}
        />
      </View>
    </Pressable>
  );
}

function Mini({
  icon,
  label,
  value,
  M,
  styles,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  M: MockPalette;
  styles: ReturnType<typeof makeStyles>;
}): React.ReactNode {
  return (
    <View style={styles.mini}>
      <View style={styles.miniTop}>
        {icon}
        <AppText variant="label" color={M.text} style={{ fontSize: 17 }}>
          {value}
        </AppText>
      </View>
      <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ fontSize: 12 }}>
        {label}
      </AppText>
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    scroll: { padding: S.md, paddingBottom: S.xl, gap: 12 },

    header: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.xs },
    title: { fontSize: 30, lineHeight: 36 },
    // 44 is the iOS HIG / Android touch-target floor.
    headerBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bellDot: {
      position: 'absolute',
      top: 9,
      right: 10,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: M.danger,
      borderWidth: 1.5,
      borderColor: M.card,
    },
    avatarBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: M.green,
      backgroundColor: M.chip,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },

    pairRow: { flexDirection: 'row', gap: 12 },
    pairPressable: { flex: 1 },
    pairTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: S.sm + 2,
    },
    pairTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
    },
    pairSubOnGreen: { fontSize: 13, opacity: 0.85 },
    createCard: {
      borderRadius: 20,
      padding: S.md,
      minHeight: 118,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 5,
    },
    createPlus: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: M.limeInk,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createChevron: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.16)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinCard: {
      borderRadius: 20,
      padding: S.md,
      minHeight: 118,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },

    radarCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: S.md,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.chip,
      overflow: 'hidden',
    },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: S.md,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: {
      fontSize: 16,
      lineHeight: 21,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontWeight: '700',
      flexShrink: 1,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: R.pill,
      backgroundColor: M.green,
    },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: M.limeInk },
    countPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: R.pill,
      backgroundColor: M.chip,
    },
    unreadPill: {
      minWidth: 22,
      alignItems: 'center',
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: R.pill,
      backgroundColor: M.danger,
    },
    pillText: { fontWeight: '800', fontSize: 11 },

    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: S.md,
    },
    section: { letterSpacing: 0.6, fontSize: 14 },
    sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },

    card: {
      backgroundColor: M.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: 12,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    logo: { width: 52, height: 52, borderRadius: 26 },
    logoFallback: { backgroundColor: M.green, alignItems: 'center', justifyContent: 'center' },
    sizePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: R.pill,
      backgroundColor: M.chip,
    },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: M.cardHi,
      borderRadius: R.md,
      paddingVertical: 10,
      paddingHorizontal: S.sm,
    },
    statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: M.border },
    mini: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
    miniTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    retry: { minHeight: 44, justifyContent: 'center' },
  });
