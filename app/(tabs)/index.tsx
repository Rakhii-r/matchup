/**
 * Home — the player dashboard.
 *
 * Answers "what is happening near me, and what is happening to me?". Every
 * section is horizontal by design: the reference puts four browsable rails on
 * one screen, and a vertical list of any one of them would push the rest below
 * the fold.
 *
 * Every figure comes from a real row. There is no seeded data — an account with
 * no matches reads empty, and each rail states that plainly rather than showing
 * a plausible-looking placeholder.
 *
 * Sports come from the `sports` table, never from a hard-coded list, so a sport
 * hidden in Sports Management disappears here on the next refetch.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { usePendingActions, usePlayerStats } from '@features/dashboard/presentation/useDashboard';
import { useJoinedMatches, useNearbyMatches } from '@features/matches/presentation/useMatches';
import { useActiveSports, useSportLabel } from '@features/sports/presentation/useSports';
import {
  useApplyToChallenge,
  useMyChallenges,
  useNearbyOpenChallenges,
} from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import type { NearbyOpenChallenge } from '@features/teams/domain/challengeSchema';
import { useVenues } from '@features/venues/presentation/useVenues';
import type { Sport } from '@shared/types/database.types';
import { useTheme } from '@shared/theme/ThemeContext';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import {
  IconBell,
  IconCalendar,
  IconChevron,
  IconClock,
  IconClose,
  IconMoon,
  IconPin,
  IconStar,
  IconSun,
} from '@shared/ui/icons';
import { SPORT_IMAGE, venueImage } from '@shared/ui/sportImages';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() < 12 ? 'AM' : 'PM';
  return `${d.getDate()} ${MONTH[d.getMonth()]} · ${hh}:${mm} ${ap}`;
}

/**
 * Straight-line distance in km. `nearby_matches` filters by radius server-side
 * but returns the plain match row, so the per-card distance is derived here
 * rather than by widening the RPC's return type.
 */
function distanceKm(
  from: { lat: number; lng: number },
  to: { lat: number | null; lng: number | null },
): number | null {
  if (to.lat == null || to.lng == null) return null;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function km(value: number | null): string {
  if (value == null) return '';
  return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} km`;
}

// ---------------------------------------------------------------------------
// Calendar Modal
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const CAL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** YYYY-MM-DD string from a Date (local time). */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build a lookup: dateKey → array of { matchName, matchId, time }. */
function buildMatchesByDate(
  joined: { match: { id: string; match_name: string; scheduled_at: string; status: string } }[],
): Map<string, { matchName: string; matchId: string; time: string; status: string }[]> {
  const map = new Map<string, { matchName: string; matchId: string; time: string; status: string }[]>();
  for (const { match } of joined) {
    const d = new Date(match.scheduled_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = dateKey(d);
    const hh = d.getHours() % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ap = d.getHours() < 12 ? 'AM' : 'PM';
    const entry = { matchName: match.match_name, matchId: match.id, time: `${hh}:${mm} ${ap}`, status: match.status };
    const arr = map.get(key);
    if (arr) arr.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

/** Number of days in a month (1-indexed month). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Day-of-week (0=Sun) the month starts on. */
function startDow(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function CalendarModal({
  visible,
  onClose,
  matchesByDate,
  M,
  onOpenMatch,
}: {
  visible: boolean;
  onClose: () => void;
  matchesByDate: Map<string, { matchName: string; matchId: string; time: string; status: string }[]>;
  M: MockPalette;
  onOpenMatch: (id: string) => void;
}): React.ReactNode {
  const cs = useMemo(() => calStyles(M), [M]);
  const today = useMemo(() => new Date(), []);
  const todayKey = dateKey(today);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1); // 1-indexed
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const goPrev = useCallback(() => {
    setViewMonth((m) => {
      if (m === 1) { setViewYear((y) => y - 1); return 12; }
      return m - 1;
    });
    setSelectedDate(null);
  }, []);

  const goNext = useCallback(() => {
    setViewMonth((m) => {
      if (m === 12) { setViewYear((y) => y + 1); return 1; }
      return m + 1;
    });
    setSelectedDate(null);
  }, []);

  const days = daysInMonth(viewYear, viewMonth);
  const dow = startDow(viewYear, viewMonth);

  // Build the 6×7 grid: null for empty cells, day number otherwise.
  const cells: (number | null)[] = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedMatches = selectedDate ? matchesByDate.get(selectedDate) ?? [] : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={cs.overlay}>
        <View style={cs.sheet}>
          {/* Header */}
          <View style={cs.header}>
            <AppText variant="heading" color={M.text} style={{ fontSize: 18 }}>
              My Schedule
            </AppText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close calendar">
              <IconClose color={M.muted} size={22} />
            </Pressable>
          </View>

          {/* Month navigator */}
          <View style={cs.monthRow}>
            <Pressable onPress={goPrev} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month">
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <IconChevron color={M.text} size={20} />
              </View>
            </Pressable>
            <AppText variant="label" color={M.text} style={{ fontSize: 16 }}>
              {CAL_MONTHS[viewMonth - 1]} {viewYear}
            </AppText>
            <Pressable onPress={goNext} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next month">
              <IconChevron color={M.text} size={20} />
            </Pressable>
          </View>

          {/* Weekday labels */}
          <View style={cs.weekRow}>
            {WEEKDAYS.map((wd) => (
              <View key={wd} style={cs.weekCell}>
                <AppText variant="caption" color={M.muted} center style={{ fontSize: 12 }}>
                  {wd}
                </AppText>
              </View>
            ))}
          </View>

          {/* Date grid */}
          <View style={cs.grid}>
            {cells.map((day, i) => {
              if (day == null) return <View key={`e${i}`} style={cs.dayCell} />;
              const key = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = key === todayKey;
              const hasMatch = matchesByDate.has(key);
              const isSelected = key === selectedDate;
              return (
                <Pressable
                  key={key}
                  style={[
                    cs.dayCell,
                    isToday && cs.todayCell,
                    isSelected && cs.selectedCell,
                  ]}
                  onPress={() => setSelectedDate(isSelected ? null : key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${day} ${CAL_MONTHS[viewMonth - 1]}${hasMatch ? ', has matches' : ''}`}
                >
                  <AppText
                    variant={isToday || isSelected ? 'label' : 'body'}
                    color={isSelected ? M.limeInk : isToday ? M.green : M.text}
                    center
                    style={{ fontSize: 14 }}
                  >
                    {day}
                  </AppText>
                  {hasMatch ? <View style={cs.dot} /> : null}
                </Pressable>
              );
            })}
          </View>

          {/* Selected date match list */}
          {selectedDate ? (
            <View style={cs.matchList}>
              {selectedMatches.length === 0 ? (
                <AppText variant="caption" color={M.muted} center>
                  No matches on this day
                </AppText>
              ) : (
                selectedMatches.map((m) => (
                  <Pressable
                    key={m.matchId}
                    style={cs.matchRow}
                    onPress={() => { onClose(); onOpenMatch(m.matchId); }}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.matchName} at ${m.time}`}
                  >
                    <View style={cs.matchDot} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="label" color={M.text} numberOfLines={1} style={{ fontSize: 14 }}>
                        {m.matchName}
                      </AppText>
                      <AppText variant="caption" color={M.muted}>
                        {m.time} · {m.status.toUpperCase()}
                      </AppText>
                    </View>
                    <IconChevron color={M.muted} size={16} />
                  </Pressable>
                ))
              )}
            </View>
          ) : (
            <View style={cs.matchList}>
              <AppText variant="caption" color={M.faint} center>
                Tap a date to see your matches
              </AppText>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const calStyles = (M: MockPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: M.bg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: S.lg,
      paddingTop: S.lg,
      paddingBottom: S.xl + 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: S.md,
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: S.md,
      paddingHorizontal: S.xs,
    },
    weekRow: {
      flexDirection: 'row',
      marginBottom: S.xs,
    },
    weekCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: S.xs,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    dayCell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
    },
    todayCell: {
      borderWidth: 1.5,
      borderColor: M.green,
    },
    selectedCell: {
      backgroundColor: M.lime,
    },
    dot: {
      position: 'absolute',
      bottom: 4,
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: M.green,
    },
    matchList: {
      marginTop: S.md,
      gap: S.sm,
    },
    matchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
    },
    matchDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: M.green,
    },
  });

export default function HomeScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const { isDark, setScheme } = useTheme();

  const profile = useAuthStore((s) => s.profile);
  const [sport, setSport] = useState<Sport | null>(null);

  const coords =
    profile?.home_lat != null && profile?.home_lng != null
      ? { lat: profile.home_lat, lng: profile.home_lng }
      : null;

  const stats = usePlayerStats();
  const actions = usePendingActions();
  const sports = useActiveSports();
  const nearby = useNearbyMatches(coords, sport);
  const venues = useVenues();
  const joined = useJoinedMatches();
  const challenges = useMyChallenges();
  const openChallenges = useNearbyOpenChallenges(coords, sport);
  const applyToChallenge = useApplyToChallenge();
  const myTeams = useMyTeamsOverview();
  const sportLabel = useSportLabel();
  const [challengingId, setChallengingId] = useState<string | null>(null);

  const activeChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data]);

  const onChallengeTeam = useCallback(
    (item: NearbyOpenChallenge) => {
      const ownedMatching = (myTeams.data ?? []).filter(
        (t) => t.i_am_owner && (!item.sport || t.sport === item.sport),
      );

      if (ownedMatching.length === 0) {
        Alert.alert(
          'Team needed',
          `You need a ${item.sport === 'box_cricket' ? 'Cricket' : item.sport} team to challenge this squad. Create a team first!`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Create Team', onPress: () => router.push('/teams/create') },
          ],
        );
        return;
      }

      const send = (teamId: string) => {
        setChallengingId(item.challenge_id);
        applyToChallenge.mutate(
          { challengeId: item.challenge_id, teamId },
          {
            onSuccess: () => {
              setChallengingId(null);
              Alert.alert(
                'Challenge Sent! ⚡',
                `Your request to play against ${item.from_team_name} was sent! Their captain has been notified to accept.`,
              );
              void openChallenges.refetch();
            },
            onError: (e: unknown) => {
              setChallengingId(null);
              const msg = e instanceof AppError ? e.message : 'Could not send challenge request.';
              Alert.alert('Challenge Request', msg);
            },
          },
        );
      };

      if (ownedMatching.length === 1 && ownedMatching[0]) {
        send(ownedMatching[0].id);
        return;
      }

      Alert.alert(
        'Choose Your Team',
        `Select which squad will challenge ${item.from_team_name}:`,
        [
          ...ownedMatching.map((t) => ({
            text: t.name,
            onPress: () => send(t.id),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    },
    [applyToChallenge, myTeams.data, openChallenges, router],
  );

  const firstName = (stats.data?.full_name ?? profile?.full_name ?? '').split(' ')[0] || 'there';
  const area = stats.data?.area_name ?? profile?.area_name ?? null;

  const upcoming = (joined.data ?? [])
    .filter((j) => j.match.status !== 'completed' && new Date(j.match.scheduled_at) >= new Date())
    .sort((a, b) => a.match.scheduled_at.localeCompare(b.match.scheduled_at));

  const [calendarOpen, setCalendarOpen] = useState(false);
  const matchesByDate = useMemo(() => buildMatchesByDate(joined.data ?? []), [joined.data]);

  const refreshing =
    nearby.isRefetching ||
    venues.isRefetching ||
    joined.isRefetching ||
    sports.isRefetching ||
    challenges.isRefetching ||
    openChallenges.isRefetching;

  const onRefresh = (): void => {
    void nearby.refetch();
    void venues.refetch();
    void joined.refetch();
    void sports.refetch();
    void challenges.refetch();
    void openChallenges.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={M.green} />
        }
      >
        {/* ---------------- Header ---------------- */}
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" color={M.muted}>
              {greeting(new Date())},
            </AppText>
            <AppText variant="title" color={M.text} style={{ fontSize: 22 }} numberOfLines={1}>
              {firstName} 👋
            </AppText>
            {area ? (
              <View style={styles.areaRow}>
                <IconPin color={M.muted} size={12} />
                <AppText variant="caption" color={M.muted} numberOfLines={1}>
                  {area}
                </AppText>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => setScheme(isDark ? 'light' : 'dark')}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? (
              <IconSun color={M.text} size={18} />
            ) : (
              <IconMoon color={M.text} size={18} />
            )}
          </Pressable>
          <Pressable
            onPress={() => setCalendarOpen(true)}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Your match schedule"
          >
            <IconCalendar color={M.text} size={18} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/activity')}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={
              (actions.data ?? []).length > 0
                ? `Notifications, ${(actions.data ?? []).length} needing attention`
                : 'Notifications'
            }
          >
            <IconBell color={M.text} size={18} />
            {(actions.data ?? []).length > 0 ? <View style={styles.badge} /> : null}
          </Pressable>
        </View>

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

        {/* ---------------- Create match ---------------- */}
        <Pressable
          style={styles.createCta}
          onPress={() => router.push('/match/create')}
          accessibilityRole="button"
          accessibilityLabel="Create a match"
        >
          <AppText variant="label" color={M.ctaText} style={{ fontSize: 16 }}>
            + Create a Match
          </AppText>
        </Pressable>

        {/* ---------------- Sports ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="SPORTS"
          actionLabel={sport ? 'Clear filter' : undefined}
          onAction={sport ? () => setSport(null) : undefined}
        />
        {sports.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (sports.data ?? []).length === 0 ? (
          <AppText variant="caption" color={M.faint}>
            No sports are active right now.
          </AppText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(sports.data ?? []).map((s) => {
              const on = sport === s.sport;
              return (
                <Pressable
                  key={s.id}
                  // Tapping a sport filters this screen's own rail AND carries
                  // the choice into Matches, which seeds its filter from the
                  // route param. Navigating without the param was the bug:
                  // Matches opened showing every sport.
                  onPress={() => {
                    setSport(on ? null : s.sport);
                    if (!on) {
                      router.push({
                        pathname: '/(tabs)/matches',
                        params: { sport: s.sport },
                      });
                    }
                  }}
                  style={[styles.sportCard, on && styles.sportCardOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${s.name}${on ? ', filter active' : ', filter matches'}`}
                >
                  <ImageBackground
                    source={SPORT_IMAGE[s.sport]}
                    style={styles.sportImage}
                    imageStyle={styles.sportImageRadius}
                  >
                    {/* Scrim, as on the Matches sport cards: the photo alone is
                        too busy for the name to read against. */}
                    <View style={styles.sportShade} />
                    <View style={styles.sportTextWrap}>
                      <AppText variant="caption" color={M.text} numberOfLines={1}>
                        {s.name}
                      </AppText>
                    </View>
                  </ImageBackground>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* ---------------- Match Offers (Looking for Opponents) ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="MATCH OFFERS (LOOKING FOR OPPONENTS)"
          actionLabel="See All"
          onAction={() => router.push('/(tabs)/matches')}
        />
        {openChallenges.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (openChallenges.data ?? []).length === 0 ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text}>
              No open match offers nearby
            </AppText>
            <AppText variant="caption" color={M.muted}>
              Post a match for your squad to invite and challenge nearby teams.
            </AppText>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(openChallenges.data ?? []).map((c) => {
              const isMine = (myTeams.data ?? []).some((t) => t.id === c.from_team_id && t.i_am_owner);
              const isBusy = challengingId === c.challenge_id && applyToChallenge.isPending;

              return (
                <View key={c.challenge_id} style={[styles.wideCard, { borderColor: isMine ? M.green : M.border }]}>
                  <View style={styles.pillRow}>
                    <View style={[styles.pill, { backgroundColor: isMine ? M.card : '#202028' }]}>
                      <AppText variant="caption" color={isMine ? M.green : '#E8FF59'} style={{ fontWeight: '800', fontSize: 10 }}>
                        {isMine ? '⚡ YOUR SEARCH' : '⚡ OPPONENT WANTED'}
                      </AppText>
                    </View>
                    <AppText variant="caption" color={M.faint}>
                      {c.distance_m > 0 ? `${(c.distance_m / 1000).toFixed(1)} km` : ''}
                    </AppText>
                  </View>

                  <Pressable onPress={() => router.push(`/teams/${c.from_team_id}`)}>
                    <AppText variant="label" color={M.text} numberOfLines={1}>
                      {c.from_team_name}
                    </AppText>
                    <AppText variant="caption" color={M.green} style={{ fontSize: 11 }}>
                      {sportLabel(c.sport as Sport)} · View Squad →
                    </AppText>
                  </Pressable>

                  <View style={styles.metaRow}>
                    <IconClock color={M.muted} size={12} />
                    <AppText variant="caption" color={M.muted} numberOfLines={1}>
                      {formatWhen(c.scheduled_at)}
                    </AppText>
                  </View>
                  {c.venue_name || c.area_name ? (
                    <View style={styles.metaRow}>
                      <IconPin color={M.muted} size={12} />
                      <AppText variant="caption" color={M.muted} numberOfLines={1}>
                        {c.venue_name || c.area_name}
                      </AppText>
                    </View>
                  ) : null}

                  <View style={[styles.joinRow, { marginTop: S.xs }]}>
                    {isMine ? (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/match/create/searching',
                            params: { challengeId: c.challenge_id },
                          })
                        }
                        style={[styles.joinBtn, { flex: 1, alignItems: 'center' }]}
                      >
                        <AppText variant="caption" color={M.ctaText} style={{ fontWeight: '700' }}>
                          View Radar
                        </AppText>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => onChallengeTeam(c)}
                        disabled={isBusy}
                        style={[styles.joinBtn, { flex: 1, alignItems: 'center', backgroundColor: '#E8FF59' }]}
                      >
                        {isBusy ? (
                          <ActivityIndicator color="#000" size="small" />
                        ) : (
                          <AppText variant="caption" color="#000" style={{ fontWeight: '800' }}>
                            ⚡ Send Request
                          </AppText>
                        )}
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* ---------------- Games near you ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="GAMES NEAR YOU"
          actionLabel="See All"
          onAction={() => router.push('/(tabs)/matches')}
        />
        {!coords ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text}>
              No location saved
            </AppText>
            <AppText variant="caption" color={M.muted}>
              {area
                ? `We know you're in ${area}, but not where that is on a map. Capture your location once and nearby games appear here.`
                : 'Capture your location once and nearby games appear here.'}
            </AppText>
            <Pressable
              onPress={() => router.push('/profile/edit')}
              accessibilityRole="button"
              accessibilityLabel="Capture your location"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <AppText variant="caption" color={M.green}>
                Capture my location →
              </AppText>
            </Pressable>
          </View>
        ) : nearby.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (nearby.data ?? []).length === 0 ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text}>
              No open games within 5 km
            </AppText>
            <AppText variant="caption" color={M.muted}>
              Create one and let players near you join.
            </AppText>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(nearby.data ?? []).map((m) => (
              <Pressable
                key={m.id}
                style={styles.wideCard}
                onPress={() => router.push(`/match/${m.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${m.match_name}, ${m.missing_count} slots open. Open match`}
              >
                <View style={styles.pillRow}>
                  <View style={styles.pill}>
                    <AppText variant="caption" color={M.green}>
                      {m.status === 'open' ? 'JOINABLE' : m.status.toUpperCase()}
                    </AppText>
                  </View>
                  <AppText variant="caption" color={M.faint}>
                    {km(distanceKm(coords, m))}
                  </AppText>
                </View>
                <AppText variant="label" color={M.text} numberOfLines={1}>
                  {m.match_name}
                </AppText>
                <View style={styles.metaRow}>
                  <IconClock color={M.muted} size={12} />
                  <AppText variant="caption" color={M.muted} numberOfLines={1}>
                    {formatWhen(m.scheduled_at)}
                  </AppText>
                </View>
                {m.venue_text || m.area_name ? (
                  <View style={styles.metaRow}>
                    <IconPin color={M.muted} size={12} />
                    <AppText variant="caption" color={M.muted} numberOfLines={1}>
                      {m.venue_text || m.area_name}
                    </AppText>
                  </View>
                ) : null}
                <View style={styles.joinRow}>
                  <AppText variant="caption" color={M.muted}>
                    {m.filled_slots}/{m.total_slots} players
                  </AppText>
                  <View style={styles.joinBtn}>
                    <AppText variant="caption" color={M.ctaText}>
                      Join Match
                    </AppText>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ---------------- Venues ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="VENUES"
          actionLabel="See All"
          onAction={() => router.push('/(tabs)/venues')}
        />
        {venues.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (venues.data ?? []).length === 0 ? (
          <View style={styles.card}>
            <AppText variant="caption" color={M.muted}>
              No venues listed yet.
            </AppText>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(venues.data ?? []).map((v) => (
              <Pressable
                key={v.id}
                style={styles.venueCard}
                onPress={() => router.push('/(tabs)/venues')}
                accessibilityRole="button"
                accessibilityLabel={`${v.name}, ${v.address}. Open venues`}
              >
                <Image source={venueImage(v)} style={styles.venueImg} />
                <View style={{ padding: S.sm, gap: 2 }}>
                  <AppText variant="label" color={M.text} numberOfLines={1}>
                    {v.name}
                  </AppText>
                  <AppText variant="caption" color={M.muted} numberOfLines={1}>
                    {v.address}
                  </AppText>
                  <View style={styles.venueMeta}>
                    {v.rating != null ? (
                      <View style={styles.metaRow}>
                        <IconStar color={M.green} size={11} />
                        <AppText variant="caption" color={M.muted}>
                          {v.rating}
                        </AppText>
                      </View>
                    ) : null}
                    {coords ? (
                      <AppText variant="caption" color={M.faint}>
                        {km(distanceKm(coords, v))}
                      </AppText>
                    ) : null}
                    {v.price_per_hour != null ? (
                      <AppText variant="caption" color={M.green}>
                        ₹{v.price_per_hour}/hr
                      </AppText>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ---------------- Your matches ---------------- */}
        {upcoming.length > 0 ? (
          <>
            <SectionHead
              M={M}
              styles={styles}
              title="YOUR MATCHES"
              actionLabel="See All"
              onAction={() => router.push('/teams/matches')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              {upcoming.map(({ match, myStatus }) => (
                <Pressable
                  key={match.id}
                  style={styles.wideCard}
                  onPress={() => router.push(`/match/${match.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${match.match_name}. Open match`}
                >
                  <View style={styles.pillRow}>
                    <View style={styles.pill}>
                      <AppText variant="caption" color={M.green}>
                        {match.status.toUpperCase()}
                      </AppText>
                    </View>
                    {myStatus === 'invited' ? (
                      <AppText variant="caption" color={M.danger}>
                        Reply needed
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="label" color={M.text} numberOfLines={2}>
                    {match.match_name}
                  </AppText>
                  <View style={styles.metaRow}>
                    <IconClock color={M.muted} size={12} />
                    <AppText variant="caption" color={M.muted}>
                      {formatWhen(match.scheduled_at)}
                    </AppText>
                  </View>
                  {match.venue_text || match.area_name ? (
                    <View style={styles.metaRow}>
                      <IconPin color={M.muted} size={12} />
                      <AppText variant="caption" color={M.muted} numberOfLines={1}>
                        {match.venue_text || match.area_name}
                      </AppText>
                    </View>
                  ) : null}
                  <AppText variant="caption" color={M.green} style={{ marginTop: S.xs }}>
                    View Match →
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}
      </ScrollView>

      <CalendarModal
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        matchesByDate={matchesByDate}
        M={M}
        onOpenMatch={(id) => router.push(`/match/${id}`)}
      />
    </SafeAreaView>
  );
}

function SectionHead({
  M,
  styles,
  title,
  actionLabel,
  onAction,
}: {
  M: MockPalette;
  styles: ReturnType<typeof makeStyles>;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactNode {
  return (
    <View style={styles.sectionHead}>
      <AppText variant="caption" color={M.muted} style={{ letterSpacing: 0.5 }}>
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={`${actionLabel}, ${title}`} hitSlop={10}>
          <AppText variant="caption" color={M.green}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    scroll: { paddingVertical: S.md, paddingBottom: S.xl, gap: S.sm },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.xs,
      paddingHorizontal: S.md,
      marginBottom: S.sm,
    },
    areaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: 9,
      right: 10,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: M.danger,
    },
    createCta: {
      marginHorizontal: S.md,
      minHeight: 52,
      borderRadius: R.md,
      backgroundColor: M.lime,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.md,
      marginTop: S.md,
    },
    // Rails bleed to the screen edge so the next card peeks in, which is what
    // tells the user the row scrolls.
    rail: { paddingHorizontal: S.md, gap: S.sm },
    card: {
      marginHorizontal: S.md,
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.xs,
    },
    sportCard: {
      width: 92,
      height: 92,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      overflow: 'hidden',
    },
    sportCardOn: { backgroundColor: M.lime, borderColor: M.lime },
    sportImage: { flex: 1, justifyContent: 'flex-end' },
    sportImageRadius: { borderRadius: R.md },
    sportShade: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: M.overlay,
    },
    sportTextWrap: { paddingHorizontal: S.xs, paddingBottom: S.xs },
    wideCard: {
      width: 250,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      padding: S.md,
      gap: S.xs,
    },
    pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pill: {
      paddingHorizontal: S.sm,
      paddingVertical: 2,
      borderRadius: R.pill,
      borderWidth: 1,
      borderColor: M.green,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    joinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: S.xs,
    },
    joinBtn: {
      paddingHorizontal: S.md,
      minHeight: 32,
      borderRadius: R.pill,
      backgroundColor: M.lime,
      alignItems: 'center',
      justifyContent: 'center',
    },
    venueCard: {
      width: 200,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      overflow: 'hidden',
    },
    venueImg: { width: '100%', height: 92, backgroundColor: M.cardHi },
    venueMeta: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: 2 },
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
  });
