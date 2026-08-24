import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { TEAM_ROLE_LABEL } from '@features/teams/domain/teamSchema';
import { useMyChallenges } from '@features/teams/presentation/useChallenges';
import { useTeamFixtures, useTeamMembers, useTeamOverview, useTeamStats } from '@features/teams/presentation/useTeams';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import type { Database } from '@shared/types/database.types';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

type Fixture = Database['public']['Functions']['get_team_fixtures']['Returns'][number];
type Tab = 'Overview' | 'Players' | 'Fixtures' | 'Stats';
const tabs: Tab[] = ['Overview', 'Players', 'Fixtures', 'Stats'];
const date = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function TeamDetails(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>(); const teamId = id ?? ''; const router = useRouter();
  const overview = useTeamOverview(teamId); const members = useTeamMembers(teamId); const stats = useTeamStats(teamId); const fixtures = useTeamFixtures(teamId);
  const challenges = useMyChallenges();
  const [tab, setTab] = useState<Tab>('Overview');
  const sportLabel = useSportLabel();

  const teamActiveChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.from_team_id === teamId && c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data, teamId]);

  if (overview.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Team details' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText muted>Loading team...</AppText>
        </View>
      </Screen>
    );
  }
  const team = overview.data;
  if (overview.isError || !team) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Team details' }} />
        <View style={styles.center}>
          <AppText>Unable to load team</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void overview.refetch()} />
        </View>
      </Screen>
    );
  }
  const stat = stats.data;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Team details' }} />
      <View style={styles.hero}>
        {team.logo_url ? (
          <Image source={{ uri: team.logo_url }} style={styles.logo} />
        ) : (
          <View style={styles.logo}>
            <AppText variant="heading">{team.name.slice(0, 1).toUpperCase()}</AppText>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{team.name}</AppText>
          <AppText muted>{sportLabel(team.sport)} · {team.player_count} players</AppText>
          <Pressable onPress={() => router.push(`/player/${team.owner_id}`)}>
            <AppText variant="caption" color={colors.primary}>Captain · {team.captain_name ?? 'Team owner'}</AppText>
          </Pressable>
        </View>
      </View>

      {/* Live Radar banner if this team currently has an active opponent scan */}
      {teamActiveChallenge ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/match/create/searching',
              params: { challengeId: teamActiveChallenge.id },
            })
          }
          style={styles.radarBanner}
          accessibilityRole="button"
          accessibilityLabel="Live radar search in progress. Tap to view radar."
        >
          <View style={styles.radarPill}>
            <View style={styles.radarDot} />
            <AppText variant="caption" color="#000" style={{ fontWeight: '800', fontSize: 10 }}>
              LIVE RADAR
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label" numberOfLines={1} style={{ fontSize: 14 }}>
              Searching for Opponent
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {teamActiveChallenge.match_name || 'Team Challenge'} · Tap to view radar
            </AppText>
          </View>
          <AppText color={colors.primary}>›</AppText>
        </Pressable>
      ) : null}

      <View style={styles.statRow}>
        {[['Matches', stat?.matches_played ?? 0], ['Wins', stat?.wins ?? 0], ['Losses', stat?.losses ?? 0], ['Win rate', stat?.win_rate == null ? '—' : `${stat.win_rate}%`]].map(([l, v]) => (
          <View style={styles.stat} key={String(l)}>
            <AppText variant="caption" muted>{l}</AppText>
            <AppText variant="heading">{v}</AppText>
          </View>
        ))}
      </View>
      <View style={styles.tabs}>
        {tabs.map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <AppText variant="caption" color={tab === t ? colors.primary : colors.textMuted}>{t}</AppText>
          </Pressable>
        ))}
      </View>
      {tab === 'Overview' && (
        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
          <View style={styles.card}>
            <AppText variant="label">Team info</AppText>
            <Info label="Team name" value={team.name} />
            <Info label="Sport" value={sportLabel(team.sport)} />
            <Info label="Players" value={String(team.player_count)} />
            <Info label="Captain" value={team.captain_name ?? 'Team owner'} />
            {team.home_ground ? <Info label="Home ground" value={team.home_ground} /> : null}
            {team.description ? (
              <>
                <AppText variant="label" style={{ marginTop: spacing.sm }}>Team description</AppText>
                <AppText muted>{team.description}</AppText>
              </>
            ) : null}
          </View>

          {team.i_am_owner ? (
            <View style={styles.ownerActions}>
              {teamActiveChallenge ? (
                <>
                  <Button
                    label="⚡ View Live Radar"
                    onPress={() => {
                      router.push({
                        pathname: '/match/create/searching',
                        params: { challengeId: teamActiveChallenge.id },
                      });
                    }}
                  />
                  <Button
                    label="+ Post Another Match"
                    variant="secondary"
                    onPress={() => {
                      router.push({
                        pathname: '/match/create',
                        params: {
                          type: 'team_vs_team',
                          sport: team.sport,
                          teamId: team.id,
                        },
                      });
                    }}
                  />
                </>
              ) : (
                <Button
                  label="⚡ Find Opponent (Radar)"
                  onPress={() => {
                    router.push({
                      pathname: '/match/create',
                      params: {
                        type: 'team_vs_team',
                        sport: team.sport,
                        teamId: team.id,
                      },
                    });
                  }}
                />
              )}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Direct Challenge"
                    variant="secondary"
                    onPress={() =>
                      router.push({
                        pathname: '/teams/challenge',
                        params: { teamId: team.id },
                      })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Manage Team"
                    variant="secondary"
                    onPress={() => router.push(`/teams/${teamId}/manage`)}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      )}
      {tab === 'Players' && (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">Team players ({team.player_count})</AppText>
          {members.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (members.data ?? []).length === 0 ? (
            <AppText muted>No players yet</AppText>
          ) : (
            members.data?.map(m => (
              <Pressable style={styles.row} key={m.id} onPress={() => router.push(`/player/${m.user_id}`)}>
                <View style={styles.avatar}>
                  <AppText>{(m.profile?.full_name ?? 'P')[0]}</AppText>
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="label">{m.profile?.full_name ?? 'Player'}</AppText>
                  <AppText variant="caption" muted>{TEAM_ROLE_LABEL[m.role]}{m.profile?.area_name ? ` · ${m.profile.area_name}` : ''}</AppText>
                </View>
                <AppText color={colors.primary}>›</AppText>
              </Pressable>
            ))
          )}
        </View>
      )}
      {tab === 'Fixtures' && <Fixtures fixtures={fixtures.data ?? []} loading={fixtures.isLoading} onOpen={(matchId) => router.push(`/match/${matchId}`)} />}
      {tab === 'Stats' && (
        <View style={styles.card}>
          <AppText variant="label">Team stats</AppText>
          {!stat || stat.matches_played === 0 ? (
            <AppText muted>No match statistics yet</AppText>
          ) : (
            <>
              <Info label="Matches played" value={String(stat.matches_played)} />
              <Info label="Wins" value={String(stat.wins)} />
              <Info label="Losses" value={String(stat.losses)} />
              <Info label="Win rate" value={`${stat.win_rate ?? 0}%`} />
              {stat.highest_score != null ? <Info label="Highest team score" value={String(stat.highest_score)} /> : null}
              {stat.lowest_score != null ? <Info label="Lowest team score" value={String(stat.lowest_score)} /> : null}
            </>
          )}
        </View>
      )}
    </Screen>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.info}>
      <AppText muted>{label}</AppText>
      <AppText>{value}</AppText>
    </View>
  );
}
/**
 * `get_team_fixtures` returns the opponent already resolved relative to this
 * team — there is no team_a_name/team_b_name pair to read, and the team's own
 * score is `our_runs`. Splitting on the function's own `is_upcoming` flag also
 * keeps the "played but not yet marked completed" case on the right side.
 */
function Fixtures({ fixtures, loading, onOpen }: { fixtures: Fixture[]; loading: boolean; onOpen: (id: string) => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const upcoming = fixtures.filter(f => f.is_upcoming);
  const recent = fixtures.filter(f => !f.is_upcoming);
  const render = (f: Fixture) => (
    <Pressable
      key={f.match_id}
      style={styles.card}
      onPress={() => {
        if (!f.is_upcoming) router.push(`/match/${f.match_id}/result`);
        else onOpen(f.match_id);
      }}
    >
      <AppText variant="caption" color={f.is_upcoming ? colors.primary : colors.textMuted}>{f.is_upcoming ? 'UPCOMING' : (f.outcome ?? f.status).toUpperCase()}</AppText>
      <AppText variant="label">{f.is_home ? 'vs' : 'away to'} {f.opponent_name ?? 'Opponent TBD'}</AppText>
      <AppText muted>{date(f.scheduled_at)}{f.venue_text ? ` · ${f.venue_text}` : ''}</AppText>
      {f.our_runs != null ? <AppText>{f.our_runs} – {f.their_runs ?? 0}</AppText> : null}
      {f.result_text ? <AppText variant="caption" muted>{f.result_text}</AppText> : null}
    </Pressable>
  );
  return (
    <View style={{ gap: spacing.sm }}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          {<AppText variant="label">Upcoming</AppText>}
          {upcoming.length ? upcoming.map(render) : <AppText muted>No upcoming matches</AppText>}
          <AppText variant="label" style={{ marginTop: spacing.md }}>Recent</AppText>
          {recent.length ? recent.map(render) : <AppText muted>No recent matches</AppText>}
        </>
      )}
    </View>
  );
}
const makeStyles = (colors: AppColors) => StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  hero: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md },
  logo: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  statRow: { flexDirection: 'row', marginBottom: spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
  tabOn: { borderBottomWidth: 2, borderColor: colors.primary },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.sm },
  info: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  ownerActions: { gap: spacing.sm, marginTop: spacing.xs },
  radarBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  radarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  radarDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#000',
  },
});
