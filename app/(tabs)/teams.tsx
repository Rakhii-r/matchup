/**
 * Teams tab.
 *
 * A thin hub, not a reimplementation. Every action here pushes to the existing
 * `/teams/*` routes — create, join, detail, challenges, offers and the open
 * challenge poster all already exist and are untouched.
 *
 * The list comes from a single `get_my_teams_overview` call. Rendering a card
 * per team and letting each card fetch its own overview and stats cost 1 + 2N
 * round trips; this is flat in the number of teams, and it also removes the
 * per-card loading flicker that showed an em-dash where the player count
 * belonged.
 */
import { useMemo } from 'react';
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

import { useAllMyBookedMatches } from '@features/matches/presentation/useMatches';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { TeamOverviewRow } from '@features/teams/data/teamRepository';
import { useMyChallenges } from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconCalendar, IconChevron } from '@shared/ui/icons';

/** W–L, with the tie count appended only when there is one to report. */
function record(team: TeamOverviewRow): string {
  return team.ties > 0
    ? `${team.wins}–${team.losses}–${team.ties}`
    : `${team.wins}–${team.losses}`;
}

export default function TeamsTab(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const teams = useMyTeamsOverview();
  const challenges = useMyChallenges();
  const booked = useAllMyBookedMatches();
  const rows = teams.data ?? [];

  const upcomingMatchesCount = (booked.data ?? []).filter(
    (item) => item.match.status === 'open' || item.match.status === 'locked',
  ).length;

  const activeChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={teams.isRefetching}
            onRefresh={() => void teams.refetch()}
            tintColor={M.green}
          />
        }
      >
        <AppText variant="title" color={M.text} style={{ fontSize: 24 }}>
          Teams
        </AppText>

        {/* Live Radar banner for active team challenge */}
        {activeChallenge ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/match/create/searching',
                params: { challengeId: activeChallenge.id },
              })
            }
            style={styles.radarBanner}
            accessibilityRole="button"
            accessibilityLabel="Live radar search in progress. Tap to view radar."
          >
            <View style={styles.radarPill}>
              <View style={styles.radarDot} />
              <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 10 }}>
                LIVE RADAR
              </AppText>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label" color={M.text} numberOfLines={1} style={{ fontSize: 14 }}>
                Searching for Opponent
              </AppText>
              <AppText variant="caption" color={M.muted} numberOfLines={1}>
                {activeChallenge.match_name || 'Team Challenge'} · Tap to view radar
              </AppText>
            </View>
            <IconChevron color={M.green} size={18} />
          </Pressable>
        ) : null}

        <View style={styles.btnRow}>
          <Pressable
            style={styles.ctaSolid}
            onPress={() => router.push('/teams/create')}
            accessibilityRole="button"
            accessibilityLabel="Create a team"
          >
            <AppText variant="caption" color={M.ctaText}>
              + Create team
            </AppText>
          </Pressable>
          <Pressable
            style={styles.ctaGhost}
            onPress={() => router.push('/teams/join')}
            accessibilityRole="button"
            accessibilityLabel="Join a team with an invite code"
          >
            <AppText variant="caption" color={M.text}>
              Join with code
            </AppText>
          </Pressable>
        </View>

        <View style={styles.btnRow}>
          {/* Finding an opponent opens live radar dish directly */}
          <Pressable
            style={[styles.ctaGhost, activeChallenge ? styles.ctaActiveRadar : null]}
            onPress={() => {
              if (activeChallenge) {
                router.push({
                  pathname: '/match/create/searching',
                  params: { challengeId: activeChallenge.id },
                });
              } else {
                router.push('/match/create/searching');
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Find an opponent team on radar"
          >
            <AppText variant="caption" color={activeChallenge ? M.green : M.text} style={{ fontWeight: activeChallenge ? '700' : '500' }}>
              {activeChallenge ? '⚡ View Live Radar' : 'Find opponent (Radar)'}
            </AppText>
          </Pressable>
          <Pressable
            style={styles.ctaGhost}
            onPress={() => router.push('/teams/offers')}
            accessibilityRole="button"
            accessibilityLabel="Match offers"
          >
            <AppText variant="caption" color={M.text}>
              Match offers
            </AppText>
          </Pressable>
        </View>

        {/* Booked & Scheduled Matches banner */}
        <Pressable
          style={styles.bookedBanner}
          onPress={() => router.push('/teams/matches')}
          accessibilityRole="button"
          accessibilityLabel="View all booked and scheduled matches"
        >
          <View style={styles.bookedIconWrap}>
            <IconCalendar color={M.limeInk} size={20} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="label" color={M.text} style={{ fontWeight: '700' }}>
                Booked & Scheduled Matches
              </AppText>
              {upcomingMatchesCount > 0 ? (
                <View style={styles.badgePill}>
                  <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 10 }}>
                    {upcomingMatchesCount} UPCOMING
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color={M.muted}>
              View fixtures, match timings, lineups & scorecards
            </AppText>
          </View>
          <IconChevron color={M.green} size={18} />
        </Pressable>

        <Pressable
          style={styles.ctaGhostWide}
          onPress={() => router.push('/teams/challenges')}
          accessibilityRole="button"
          accessibilityLabel="Directed challenges"
        >
          <AppText variant="caption" color={M.text}>
            Directed challenges
          </AppText>
        </Pressable>

        <AppText variant="caption" color={M.muted} style={styles.section}>
          MY TEAMS{rows.length > 0 ? ` (${rows.length})` : ''}
        </AppText>

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
  const played = team.matches_played > 0;

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
            <AppText variant="label" color={M.green}>
              {team.name.slice(0, 1).toUpperCase()}
            </AppText>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" color={M.text} numberOfLines={1}>
            {team.name}
          </AppText>
          <AppText variant="caption" color={M.muted} numberOfLines={1}>
            {sportLabel(team.sport)} · {team.player_count}{' '}
            {team.player_count === 1 ? 'player' : 'players'}
            {team.i_am_owner ? ' · Captain' : ''}
          </AppText>
        </View>
        <AppText color={M.green}>›</AppText>
      </View>

      {played ? (
        <View style={styles.statRow}>
          <Mini label="Played" value={team.matches_played} M={M} styles={styles} />
          <Mini label="Record" value={record(team)} M={M} styles={styles} />
          <Mini label="Win rate" value={`${team.win_rate}%`} M={M} styles={styles} />
        </View>
      ) : (
        // A row of zeros reads as broken data. Say the true thing instead.
        <AppText variant="caption" color={M.faint} style={{ marginTop: S.sm }}>
          No matches played yet
        </AppText>
      )}
    </Pressable>
  );
}

function Mini({
  label,
  value,
  M,
  styles,
}: {
  label: string;
  value: string | number;
  M: MockPalette;
  styles: ReturnType<typeof makeStyles>;
}): React.ReactNode {
  return (
    <View style={styles.mini}>
      <AppText variant="caption" color={M.muted}>
        {label}
      </AppText>
      <AppText variant="label" color={M.text}>
        {value}
      </AppText>
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    scroll: { padding: S.md, paddingBottom: S.xl, gap: S.sm },
    section: { marginTop: S.md, letterSpacing: 0.5 },
    btnRow: { flexDirection: 'row', gap: S.sm },
    // minHeight 44 is the iOS HIG / Android touch-target floor. Padding alone
    // left these pills around 34pt tall.
    ctaSolid: {
      flex: 1,
      minHeight: 44,
      paddingVertical: S.sm,
      paddingHorizontal: S.sm,
      borderRadius: R.pill,
      backgroundColor: M.lime,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaGhost: {
      flex: 1,
      minHeight: 44,
      paddingVertical: S.sm,
      paddingHorizontal: S.sm,
      borderRadius: R.pill,
      borderWidth: 1,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaGhostWide: {
      minHeight: 44,
      paddingVertical: S.sm,
      borderRadius: R.pill,
      borderWidth: 1,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.xs,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    logo: { width: 44, height: 44, borderRadius: 22 },
    logoFallback: {
      backgroundColor: M.cardHi,
      borderWidth: 1,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statRow: {
      flexDirection: 'row',
      marginTop: S.sm,
      paddingTop: S.sm,
      borderTopWidth: 1,
      borderTopColor: M.border,
    },
    mini: { flex: 1, alignItems: 'center', gap: 2 },
    retry: { minHeight: 44, justifyContent: 'center' },
    ctaActiveRadar: {
      borderColor: M.green,
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
    },
    radarBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.green,
      backgroundColor: M.card,
      marginBottom: S.xs,
    },
    radarPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: R.pill,
      backgroundColor: M.green,
    },
    radarDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: M.limeInk,
    },
    bookedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.border,
      backgroundColor: M.card,
      marginBottom: S.xs,
    },
    bookedIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgePill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: R.pill,
      backgroundColor: 'rgba(34, 197, 94, 0.16)',
      borderWidth: 1,
      borderColor: M.green,
    },
  });
