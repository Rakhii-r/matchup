import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { AppError } from '@core/errors/AppError';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { TEAM_ROLE_LABEL } from '@features/teams/domain/teamSchema';
import { useMyChallenges } from '@features/teams/presentation/useChallenges';
import { useSetTeamFormat } from '@features/teams/presentation/useRecruit';
import {
  useTeamFixtures,
  useTeamMemberActions,
  useTeamMembers,
  useTeamOverview,
  useTeamStats,
  useUploadTeamLogo,
  useRemoveTeamLogo,
} from '@features/teams/presentation/useTeams';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import type { Database } from '@shared/types/database.types';
import { useMock } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { HillsArt, IconTile, TINT, type TintName } from '@shared/ui/decor';
import {
  IconArrowRight,
  IconBarChart,
  IconBolt,
  IconCalendar,
  IconCamera,
  IconCricket,
  IconCrown,
  IconDoc,
  IconEdit,
  IconGamepad,
  IconGear,
  IconGrid,
  IconInfo,
  IconPin,
  IconSwords,
  IconTarget,
  IconTrophy,
  IconUsers,
  type IconProps,
} from '@shared/ui/icons';
import { Screen } from '@shared/ui/Screen';

type Fixture = Database['public']['Functions']['get_team_fixtures']['Returns'][number];
type Tab = 'Overview' | 'Players' | 'Fixtures' | 'Stats';
type Glyph = (p: IconProps) => React.ReactNode;
const tabs: { key: Tab; Icon: Glyph }[] = [
  { key: 'Overview', Icon: IconDoc },
  { key: 'Players', Icon: IconUsers },
  { key: 'Fixtures', Icon: IconCalendar },
  { key: 'Stats', Icon: IconBarChart },
];
const date = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function TeamDetails(): React.ReactNode {
  const { colors } = useTheme();
  const M = useMock();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = id ?? '';
  const router = useRouter();
  const overview = useTeamOverview(teamId);
  const members = useTeamMembers(teamId);
  const stats = useTeamStats(teamId);
  const fixtures = useTeamFixtures(teamId);
  const setTeamFormat = useSetTeamFormat(teamId);
  const memberActions = useTeamMemberActions(teamId);
  const challenges = useMyChallenges();
  const uploadLogo = useUploadTeamLogo(teamId);
  const removeLogo = useRemoveTeamLogo(teamId);
  const [tab, setTab] = useState<Tab>('Overview');
  const sportLabel = useSportLabel();

  const onChangePhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Needed', 'Photo permission is needed to select a team image.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });
      if (!res.canceled && res.assets[0]?.base64) {
        uploadLogo.mutate(res.assets[0].base64, {
          onError: (err) => {
            Alert.alert('Upload Failed', err instanceof AppError ? err.message : 'Could not upload team photo.');
          },
        });
      }
    } catch {
      Alert.alert('Photo Library', 'Could not access photo library.');
    }
  };

  const teamActiveChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.from_team_id === teamId && c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data, teamId]);

  const confirmRemoveMember = (m: any) => {
    Alert.alert(
      'Remove member?',
      `${m.profile?.full_name ?? 'This player'} will be removed from ${overview.data?.name ?? 'the team'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => memberActions.mutate(m.id),
        },
      ],
    );
  };

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
      <View style={[styles.hero, { backgroundColor: M.chip }]}>
        <HillsArt variant="stumps" width={190} />
        {team.i_am_owner ? (
          <Pressable
            onPress={() => void onChangePhoto()}
            disabled={uploadLogo.isPending}
            style={styles.logoContainer}
            accessibilityRole="button"
            accessibilityLabel="Change team photo"
          >
            {team.logo_url ? (
              <Image source={{ uri: team.logo_url }} style={styles.logo} />
            ) : (
              <View style={styles.logo}>
                <AppText variant="title" color={colors.primary}>
                  {team.name.slice(0, 1).toUpperCase()}
                </AppText>
              </View>
            )}
            <View style={styles.cameraBadge}>
              {uploadLogo.isPending ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <IconCamera color={colors.textInverse} size={13} />
              )}
            </View>
          </Pressable>
        ) : team.logo_url ? (
          <Image source={{ uri: team.logo_url }} style={styles.logo} />
        ) : (
          <View style={styles.logo}>
            <AppText variant="title" color={colors.primary}>
              {team.name.slice(0, 1).toUpperCase()}
            </AppText>
          </View>
        )}
        <View style={styles.heroText}>
          <AppText variant="heading" numberOfLines={1} style={styles.heroName}>
            {team.name}
          </AppText>
          <AppText muted numberOfLines={1}>
            {sportLabel(team.sport)} • {team.player_count} players
          </AppText>
          <Pressable
            onPress={() => router.push(`/player/${team.owner_id}`)}
            style={styles.captainPill}
            accessibilityRole="button"
            accessibilityLabel={`Captain ${team.captain_name ?? 'Team owner'}. View profile`}
          >
            <IconCrown color={colors.primary} size={16} />
            <AppText variant="caption" color={colors.primary} style={{ fontWeight: '700' }}>
              Captain:
            </AppText>
            <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
              {team.captain_name ?? 'Team owner'}
            </AppText>
          </Pressable>
        </View>
        {team.i_am_owner ? (
          <Pressable
            onPress={() => router.push(`/teams/${teamId}/edit`)}
            style={styles.editBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Edit team"
          >
            <IconEdit color={colors.primary} size={18} />
          </Pressable>
        ) : null}
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
            <AppText variant="caption" color={colors.textInverse} style={{ fontWeight: '800', fontSize: 10 }}>
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
        {(
          [
            ['Games', stat?.matches_played ?? 0, IconGamepad, 'blue'],
            ['Wins', stat?.wins ?? 0, IconTrophy, 'amber'],
            ['Losses', stat?.losses ?? 0, IconTarget, 'red'],
            ['Win rate', stat?.win_rate == null ? '—' : `${stat.win_rate}%`, IconBarChart, 'green'],
          ] as [string, string | number, Glyph, TintName][]
        ).map(([l, v, Icon, tint], i) => (
          <View style={[styles.stat, i > 0 ? styles.statDivider : null]} key={l}>
            <IconTile size={40} color={TINT[tint].bg}>
              <Icon color={TINT[tint].fg} size={20} />
            </IconTile>
            <AppText variant="caption" muted>
              {l}
            </AppText>
            <AppText variant="heading" style={styles.statValue}>
              {v}
            </AppText>
          </View>
        ))}
      </View>
      <View style={styles.tabs}>
        {tabs.map(({ key: t, Icon }) => {
          const on = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t}
            >
              <Icon color={on ? colors.textInverse : colors.textMuted} size={16} />
              <AppText
                variant="caption"
                color={on ? colors.textInverse : colors.textMuted}
                numberOfLines={1}
                style={{ fontWeight: on ? '700' : '500' }}
              >
                {t}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {tab === 'Overview' && (
        <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <IconTile size={32} color={colors.primary}>
                <IconInfo color={colors.textInverse} size={18} />
              </IconTile>
              <AppText variant="heading" style={styles.cardTitle}>
                Team info
              </AppText>
            </View>
            <Info tint="violet" icon={IconEdit} label="Team name" value={team.name} />
            <Info tint="green" icon={IconCricket} label="Sport" value={sportLabel(team.sport)} />
            <Info tint="blue" icon={IconUsers} label="Players" value={String(team.player_count)} />
            <Info tint="amber" icon={IconCrown} label="Captain" value={team.captain_name ?? 'Team owner'} />
            {team.home_ground ? (
              <Info tint="red" icon={IconPin} label="Home ground" value={team.home_ground} />
            ) : null}
            {team.description ? (
              <Info tint="teal" icon={IconDoc} label="Team description" value={team.description} last />
            ) : null}
          </View>

          {team.i_am_owner ? (
            <View style={styles.ownerActions}>
              {teamActiveChallenge ? (
                <>
                  <Button
                    label="View Live Radar"
                    icon={() => <IconBolt color={BOLT} size={20} />}
                    trailing={(c) => <IconArrowRight color={c} size={20} />}
                    onPress={() => {
                      router.push({
                        pathname: '/match/create/searching',
                        params: { challengeId: teamActiveChallenge.id },
                      });
                    }}
                  />
                  <Button
                    label="+ Post Another Game"
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
                  label="Find Opponent (Radar)"
                  icon={() => <IconBolt color={BOLT} size={20} />}
                  trailing={(c) => <IconArrowRight color={c} size={20} />}
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
                    label="Challenge"
                    variant="secondary"
                    icon={(c) => <IconSwords color={c} size={18} />}
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
                    label="Manage"
                    variant="secondary"
                    icon={(c) => <IconGear color={c} size={18} />}
                    onPress={() => router.push(`/teams/${teamId}/manage`)}
                  />
                </View>
              </View>
              {/*
                FORMAT.

                `target_size` used to mean "recruiting to N players" and put the
                team on the solo-player Find Players board. That board is gone
                (3 Sep 2026); the column now declares the format the squad plays
                -- 6 means "we are a 6 v 6 side" -- and it is the single value
                strict matchmaking filters on at both ends. Undeclared is not a
                wildcard: it is invisible, in both directions, which is why the
                empty state says so plainly.

                A format larger than the current squad is refused server-side
                (SQUAD_TOO_SMALL_FOR_FORMAT), so sizes the team cannot field are
                shown disabled rather than as a tap that fails.
              */}
              <View style={[styles.cardHead, { marginTop: spacing.md }]}>
                <IconGrid color={colors.primary} size={20} />
                <AppText variant="heading" style={styles.cardTitle}>
                  Format
                </AppText>
              </View>
              <AppText variant="caption" muted>
                {team.target_size
                  ? `Default format: ${team.target_size} v ${team.target_size}. You can challenge any match your squad has enough players for (${team.player_count} player${team.player_count === 1 ? '' : 's'} available).`
                  : `Choose your default match format. You can challenge any match format as long as your squad has enough players (${team.player_count} player${team.player_count === 1 ? '' : 's'} available).`}
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[4, 6, 8, 10, 12].map((n) => {
                  const on = team.target_size === n;
                  const canField = team.player_count >= n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => {
                        if (!canField && !on) {
                          Alert.alert(
                            'More Players Needed',
                            `${n} v ${n} requires at least ${n} players in your team. Your team currently has ${team.player_count} player${team.player_count === 1 ? '' : 's'}. Share your invite code to add more players!`,
                          );
                          return;
                        }
                        setTeamFormat.mutate(on ? null : n, {
                          onError: (e: unknown) =>
                            Alert.alert(
                              'Format not set',
                              e instanceof AppError ? e.message : 'Could not set the format.',
                            ),
                        });
                      }}
                      disabled={setTeamFormat.isPending}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on, disabled: !on && !canField }}
                      accessibilityLabel={
                        on
                          ? `Clear the ${n} a side format`
                          : canField
                            ? `Play ${n} a side`
                            : `${n} a side needs ${n} players, this team has ${team.player_count}`
                      }
                      style={{
                        minHeight: 44,
                        minWidth: 72,
                        paddingHorizontal: spacing.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: radius.pill,
                        borderWidth: 1.5,
                        opacity: !on && !canField ? 0.45 : 1,
                        backgroundColor: on ? M.chip : colors.surface,
                        borderColor: on ? colors.primary : colors.border,
                      }}
                    >
                      <AppText
                        variant="label"
                        color={on ? colors.primary : colors.textMuted}
                        style={{ fontWeight: on ? '700' : '500' }}
                      >
                        {`${n} v ${n}`}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.note}>
                <IconInfo color={colors.textMuted} size={16} />
                <AppText variant="caption" muted style={{ flex: 1 }}>
                  Short of players? Share the invite code — a squad grows by
                  invitation now, not by strangers asking to join.
                </AppText>
              </View>
            </View>
          ) : null}
        </View>
      )}
      {tab === 'Players' && (
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
            <AppText variant="label">Team players ({team.player_count})</AppText>
            {team.i_am_owner ? (
              <Button
                label="+ Invite"
                variant="secondary"
                onPress={() => router.push(`/teams/${teamId}/invite`)}
              />
            ) : null}
          </View>
          {members.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (members.data ?? []).length === 0 ? (
            <AppText muted>No players yet</AppText>
          ) : (
            members.data?.map((m) => (
              <View style={styles.playerCard} key={m.id}>
                <Pressable
                  style={styles.playerMainRow}
                  onPress={() => router.push(`/player/${m.user_id}`)}
                >
                  <View style={styles.avatar}>
                    <AppText>{(m.profile?.full_name ?? 'P')[0]}</AppText>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <AppText variant="label">{m.profile?.full_name ?? 'Player'}</AppText>
                      {m.role === 'owner' ? (
                        <View style={styles.ownerBadge}>
                          <AppText variant="caption" style={styles.ownerBadgeText}>Captain</AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText variant="caption" muted>
                      {m.profile?.area_name ? m.profile.area_name : TEAM_ROLE_LABEL[m.role]}
                    </AppText>
                  </View>
                  <AppText color={colors.primary}>›</AppText>
                </Pressable>

                {/* Captain controls. A squad has one captain and no other roles, so
                    removing a player is the only roster action left. */}
                {team.i_am_owner && m.role !== 'owner' ? (
                  <View style={styles.playerActionRow}>
                    <Button
                      label="Remove"
                      variant="danger"
                      onPress={() => confirmRemoveMember(m)}
                    />
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>
      )}
      {tab === 'Fixtures' && <Fixtures fixtures={fixtures.data ?? []} loading={fixtures.isLoading} onOpen={(matchId) => router.push(`/match/${matchId}`)} />}
      {tab === 'Stats' && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <IconBarChart color={colors.primary} size={20} />
            <AppText variant="heading" style={styles.cardTitle}>
              Team stats
            </AppText>
          </View>
          {!stat || stat.matches_played === 0 ? (
            <AppText muted>No game statistics yet</AppText>
          ) : (
            <>
              <Info label="Games played" value={String(stat.matches_played)} />
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
function Info({
  icon: Icon,
  tint = 'green',
  label,
  value,
  last = false,
}: {
  icon?: Glyph;
  tint?: TintName;
  label: string;
  value: string;
  /** Drops the divider under the final row of a card. */
  last?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.info, last ? null : styles.infoRule]}>
      {Icon ? (
        <IconTile size={36} square color={TINT[tint].bg}>
          <Icon color={TINT[tint].fg} size={18} />
        </IconTile>
      ) : null}
      <AppText muted style={{ fontSize: 15 }}>
        {label}
      </AppText>
      <AppText numberOfLines={3} style={styles.infoValue}>
        {value}
      </AppText>
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
          {upcoming.length ? upcoming.map(render) : <AppText muted>No upcoming games</AppText>}
          <AppText variant="label" style={{ marginTop: spacing.md }}>Recent</AppText>
          {recent.length ? recent.map(render) : <AppText muted>No recent games</AppText>}
        </>
      )}
    </View>
  );
}
// The bolt on a filled green button: brand amber, readable on both greens.
const BOLT = '#F5B400';

const makeStyles = (colors: AppColors) => StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 20,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  heroText: { flex: 1, minWidth: 0, gap: 4, paddingRight: 28 },
  heroName: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 24, lineHeight: 30 },
  captainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    maxWidth: '100%',
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  editBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: colors.surface },
  statRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  statValue: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 22 },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  tabOn: { backgroundColor: colors.primary },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  cardTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 18 },
  info: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: 10 },
  infoRule: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoValue: { flex: 1, textAlign: 'right', fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 16 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  playerCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  playerMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playerActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  ownerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primary + '25',
  },
  ownerBadgeText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 11,
  },
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
    backgroundColor: colors.textInverse,
  },
  logoContainer: {
    position: 'relative',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
