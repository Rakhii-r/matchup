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
import { LinearGradient } from 'expo-linear-gradient';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { usePendingActions, usePlayerStats } from '@features/dashboard/presentation/useDashboard';
import {
  DEFAULT_SEARCH_RADIUS_M,
  formatRadius,
  useJoinedMatches,
  useNearbyMatches,
} from '@features/matches/presentation/useMatches';
import {
  hasMatchDraft,
  useCreateMatchWizard,
} from '@features/matches/presentation/useCreateMatchWizard';
import { useActiveSports, useSportLabel } from '@features/sports/presentation/useSports';
import {
  useApplyToChallenge,
  useMyChallenges,
  useNearbyOpenChallenges,
} from '@features/teams/presentation/useChallenges';
import { MatchOfferDetailModal } from '@features/teams/presentation/MatchOfferDetailModal';
import { formatLabel } from '@features/teams/presentation/useActiveTeamFormat';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import { recruitRepository } from '@features/teams/data/recruitRepository';
import type { NearbyOpenChallenge } from '@features/teams/domain/challengeSchema';
import { useVenues } from '@features/venues/presentation/useVenues';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useSheetInsets, useResponsive, useTabContentPadding } from '@shared/theme/responsive';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import {
  IconBell,
  IconBolt,
  IconCalendar,
  IconChevron,
  IconChevronDown,
  IconClock,
  IconClose,
  IconFlag,
  IconPin,
  IconPlus,
  IconShieldStar,
  IconSliders,
  IconStar,
  IconSwords,
  IconTarget,
  IconUser,
  IconUsers,
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
  from: { lat: number; lng: number } | null | undefined,
  to: { lat: number | null; lng: number | null },
): number | null {
  if (from == null || to.lat == null || to.lng == null) return null;
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
  // Clears the home indicator / gesture bar, and stops a long month grid
  // running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  const cs = useMemo(() => calStyles(M), [M]);
  // Frozen for the life of the modal ON PURPOSE: it seeds viewYear/viewMonth
  // below, and a `today` that moved underneath them would jump the grid. A
  // lazy initialiser keeps that intent without calling new Date() in render.
  const [today] = useState(() => new Date());
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
        <View style={[cs.sheet, sheetInsets]}>
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
                  accessibilityLabel={`${day} ${CAL_MONTHS[viewMonth - 1]}${hasMatch ? ', has games' : ''}`}
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
                  No games on this day
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
                Tap a date to see your games
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
  const tabContentPadding = useTabContentPadding();
  const { railCardWidth } = useResponsive();
  const offerCardWidth = railCardWidth(0.68, 240, 310);
  const venueCardWidth = 205;
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();

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
  const openChallenges = useNearbyOpenChallenges(coords, sport, undefined, null);
  const applyToChallenge = useApplyToChallenge();
  const myTeams = useMyTeamsOverview();
  const sportLabel = useSportLabel();
  const [challengingId, setChallengingId] = useState<string | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<NearbyOpenChallenge | null>(null);

  const draftSport = useCreateMatchWizard((s) => s.sport);
  const draftMatchType = useCreateMatchWizard((s) => s.matchType);
  const draftArea = useCreateMatchWizard((s) => s.areaName);
  const draftPlayersPerSide = useCreateMatchWizard((s) => s.playersPerSide);
  const draftLastActiveStep = useCreateMatchWizard((s) => s.lastActiveStep);
  const draftUpdatedAt = useCreateMatchWizard((s) => s.updatedAt);
  const resetDraft = useCreateMatchWizard((s) => s.reset);

  const hasDraft = hasMatchDraft({
    sport: draftSport,
    matchType: draftMatchType,
    areaName: draftArea,
    updatedAt: draftUpdatedAt,
  });

  const activeChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data]);

  const onChallengeTeam = useCallback(
    (item: NearbyOpenChallenge) => {
      const fixtureFormat = Math.max(Math.floor(item.total_slots / 2), 1);

      const sameSportTeams = (myTeams.data ?? []).filter(
        (t) => t.i_am_owner && (!item.sport || t.sport === item.sport),
      );

      if (sameSportTeams.length === 0) {
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

      const eligibleTeams = sameSportTeams.filter((t) => t.player_count >= fixtureFormat);

      if (eligibleTeams.length === 0) {
        const teamSummary = sameSportTeams
          .map((t) => `"${t.name}" (${t.player_count} player${t.player_count === 1 ? '' : 's'})`)
          .join(', ');
        Alert.alert(
          'Squad Too Small',
          `${item.from_team_name} is looking for a ${formatLabel(fixtureFormat)} match, which requires at least ${fixtureFormat} players per side.\n\nYour squad: ${teamSummary}.\n\nAdd more players to your squad to challenge this match!`,
          [{ text: 'OK' }],
        );
        return;
      }

      const send = async (team: (typeof eligibleTeams)[0]) => {
        setChallengingId(item.challenge_id);
        try {
          if (team.target_size !== fixtureFormat) {
            await recruitRepository.setTeamFormat(team.id, fixtureFormat);
          }
          applyToChallenge.mutate(
            { challengeId: item.challenge_id, teamId: team.id },
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
        } catch (e: unknown) {
          setChallengingId(null);
          const msg = e instanceof AppError ? e.message : 'Could not set squad format for challenge.';
          Alert.alert('Challenge Request', msg);
        }
      };

      if (eligibleTeams.length === 1 && eligibleTeams[0]) {
        void send(eligibleTeams[0]);
        return;
      }

      Alert.alert(
        'Choose Your Team',
        `Select which squad will challenge ${item.from_team_name} (${formatLabel(fixtureFormat)}):`,
        [
          ...eligibleTeams.map((t) => ({
            text: `${t.name} (${t.player_count} players)`,
            onPress: () => void send(t),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    },
    [applyToChallenge, myTeams.data, openChallenges, router],
  );

  const fullName = stats.data?.full_name ?? profile?.full_name ?? '';
  const firstName = fullName.split(' ')[0] || 'ASR';
  const area = stats.data?.area_name ?? profile?.area_name ?? 'Kukatpally, HYD';

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

  const sportsCount = sports.data?.length ?? 8;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabContentPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={M.green} />
        }
      >
        {/* ---------------- Header ---------------- */}
        <View style={styles.header}>
          {/* Brand mark */}
          <AppLogo variant="icon" width={48} style={{ borderRadius: 12 }} />

          {/* Greeting, name, and the location pill under them */}
          <View style={styles.headerTitleWrap}>
            <AppText variant="caption" color={M.muted} style={styles.greetingText}>
              {greeting(new Date())} 👋
            </AppText>
            <AppText variant="title" color={M.text} style={styles.userNameText} numberOfLines={1}>
              {firstName}
            </AppText>
            <Pressable
              onPress={() => router.push('/profile/edit')}
              style={styles.locationPill}
              accessibilityRole="button"
              accessibilityLabel={`Location: ${area}. Change it in your profile`}
            >
              <IconPin color={M.green} size={12} />
              <AppText variant="caption" color={M.text} style={styles.locationText} numberOfLines={1}>
                {area}
              </AppText>
              <IconChevronDown color={M.text} size={12} />
            </Pressable>
          </View>

          {/* Action Icons */}
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setCalendarOpen(true)}
              style={styles.iconCircleBtn}
              accessibilityRole="button"
              accessibilityLabel="Your game schedule"
            >
              <IconCalendar color={M.text} size={20} />
            </Pressable>

            <Pressable
              onPress={() => router.push('/(tabs)/activity')}
              style={styles.iconCircleBtn}
              accessibilityRole="button"
              accessibilityLabel={
                (actions.data ?? []).length > 0
                  ? `Notifications, ${(actions.data ?? []).length} needing attention`
                  : 'Notifications'
              }
            >
              <IconBell color={M.text} size={20} />
              {(actions.data ?? []).length > 0 ? <View style={styles.bellBadge} /> : null}
            </Pressable>

            <Pressable
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.profileAvatarBtn}
              accessibilityRole="button"
              accessibilityLabel="View profile"
            >
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.profileAvatarImg} />
              ) : (
                <IconUser color={M.green} size={22} />
              )}
              <View style={styles.onlineDot} />
            </Pressable>
          </View>
        </View>

        {/* ---------------- Hero banner ---------------- */}
        <View style={styles.heroBanner} accessible accessibilityLabel="Play, connect, compete">
          <Image source={SPORT_IMAGE.box_cricket} style={styles.heroHalf} />
          <Image source={SPORT_IMAGE.badminton} style={styles.heroHalf} />
          <LinearGradient
            colors={['rgba(0,72,47,0)', 'rgba(0,72,47,0.92)', 'rgba(0,72,47,0.92)', 'rgba(0,72,47,0)']}
            locations={[0.12, 0.4, 0.6, 0.88]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroCopy}>
            <AppText variant="title" color="#FFFFFF" style={styles.heroLine}>
              PLAY
            </AppText>
            <AppText variant="title" color="#FFFFFF" style={styles.heroLine}>
              CONNECT
            </AppText>
            <AppText variant="title" color="#B7F04A" style={styles.heroLine}>
              COMPETE
            </AppText>
            {(sports.data ?? []).length > 0 ? (
              <AppText variant="caption" color="#FFFFFF" style={styles.heroSports} numberOfLines={1}>
                {(sports.data ?? []).map((sp) => sp.name).join('   |   ')}
              </AppText>
            ) : null}
          </View>
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

        {/* ---------------- Team Actions ---------------- */}
        <View style={styles.teamActionRow}>
          {/* Create Team Card */}
          <Pressable
            style={styles.teamActionPressable}
            onPress={() => router.push('/teams/create')}
            accessibilityRole="button"
            accessibilityLabel="Create Team. Build your squad."
          >
            <LinearGradient
              colors={[M.greenDeep, M.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.createTeamCard}
            >
              <View style={styles.teamActionCardTop}>
                <View style={styles.createTeamIconWrap}>
                  <IconUsers color="#FFFFFF" size={20} />
                </View>
                <View style={styles.createTeamChevronWrap}>
                  <IconChevron color="#FFFFFF" size={13} />
                </View>
              </View>
              <View style={styles.teamActionCardBottom}>
                <AppText variant="label" color="#FFFFFF" style={styles.actionCardTitle}>
                  Create Team
                </AppText>
                <AppText variant="caption" color="rgba(255,255,255,0.8)" style={styles.actionCardSub}>
                  Build your squad
                </AppText>
              </View>
            </LinearGradient>
          </Pressable>

          {/* Join Team Card */}
          <Pressable
            style={styles.teamActionPressable}
            onPress={() => router.push('/teams/join')}
            accessibilityRole="button"
            accessibilityLabel="Join Team. Find active squads."
          >
            <View style={styles.joinTeamCard}>
              <View style={styles.teamActionCardTop}>
                <View style={styles.joinTeamIconWrap}>
                  <IconShieldStar color={M.green} size={20} />
                </View>
                <View style={styles.joinTeamChevronWrap}>
                  <IconChevron color={M.muted} size={13} />
                </View>
              </View>
              <View style={styles.teamActionCardBottom}>
                <AppText variant="label" color={M.text} style={styles.actionCardTitle}>
                  Join Team
                </AppText>
                <AppText variant="caption" color={M.muted} style={styles.actionCardSub}>
                  Find active squads
                </AppText>
              </View>
            </View>
          </Pressable>
        </View>

        {/* ---------------- Drafted Match Banner ---------------- */}
        {hasDraft ? (
          <View style={styles.draftCard}>
            <View style={styles.draftTop}>
              <View style={styles.draftPill}>
                <View style={styles.draftDot} />
                <AppText variant="caption" color={M.green} style={{ fontWeight: '800', fontSize: 10 }}>
                  DRAFTED MATCH
                </AppText>
              </View>
              <Pressable
                onPress={() => {
                  Alert.alert('Discard draft?', 'Are you sure you want to discard this in-progress match?', [
                    { text: 'Keep Draft', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => resetDraft() },
                  ]);
                }}
                hitSlop={8}
                style={styles.discardBtn}
                accessibilityRole="button"
                accessibilityLabel="Discard match draft"
              >
                <IconClose color={M.muted} size={16} />
              </Pressable>
            </View>

            <View style={styles.draftBody}>
              <View style={styles.draftInfo}>
                <AppText variant="label" color={M.text} style={{ fontSize: 16 }}>
                  {draftSport ? sportLabel(draftSport) : 'Unfinished Match'}{' '}
                  {draftMatchType === 'team_vs_team' ? '· Team Challenge' : '· Open Match'}
                </AppText>
                <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ marginTop: 2 }}>
                  {[
                    draftArea ? `📍 ${draftArea}` : null,
                    draftPlayersPerSide ? `${draftPlayersPerSide}v${draftPlayersPerSide}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Tap to continue configuring game details'}
                </AppText>
              </View>
            </View>

            <Pressable
              onPress={() => {
                const targetPath =
                  draftLastActiveStep === 'details'
                    ? '/match/create/details'
                    : draftLastActiveStep === 'area'
                      ? '/match/create/area'
                      : '/match/create';
                router.push({ pathname: targetPath as any, params: { resume: 'true' } });
              }}
              style={styles.resumeBtn}
              accessibilityRole="button"
              accessibilityLabel="Resume match creation"
            >
              <AppText variant="label" color={M.limeInk} style={{ fontWeight: '700' }}>
                Resume Match Creation →
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {/* ---------------- Create a Game Quick Host Banner ---------------- */}
        <View style={styles.quickHostBanner}>
          <Pressable
            style={styles.quickHostLeft}
            onPress={() => router.push({ pathname: '/match/create', params: { fresh: 'true' } })}
            accessibilityRole="button"
            accessibilityLabel="Create a game"
          >
            <View style={styles.quickHostPlus}>
              <IconPlus color="#FFFFFF" size={20} strokeWidth={2.4} />
            </View>
            <AppText variant="label" color="#FFFFFF" numberOfLines={1} style={styles.quickHostTitle}>
              Create a Game
            </AppText>
          </Pressable>
          <View style={styles.quickHostRule} />
          {/* Quick Host skips the team steps: an open game anyone nearby can join. */}
          <Pressable
            style={styles.quickHostTag}
            onPress={() =>
              router.push({ pathname: '/match/create', params: { fresh: 'true', type: 'post_match' } })
            }
            accessibilityRole="button"
            accessibilityLabel="Quick host an open game"
          >
            <IconBolt color="#FFFFFF" size={16} />
            <AppText variant="label" color="#FFFFFF" style={styles.quickHostTagText}>
              Quick Host
            </AppText>
          </Pressable>
        </View>

        {/* ---------------- SPORTS AVAILABLE ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="Sports Available"
          actionLabel={sport ? 'Clear filter' : `${sportsCount} Categories`}
          onAction={sport ? () => setSport(null) : undefined}
          actionColor={sport ? M.muted : M.green}
        />
        {sports.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (sports.data ?? []).length === 0 ? (
          <AppText variant="caption" color={M.faint} style={{ paddingHorizontal: 16 }}>
            No sports are active right now.
          </AppText>
        ) : (
          <View style={styles.sportGrid}>
            {(sports.data ?? []).map((s, idx) => {
              const on = sport === s.sport;
              const courtsBadge =
                (s.sport as string) === 'box_cricket'
                  ? { dot: '#F59E0B', text: 'Popular' }
                  : (s.sport as string) === 'football'
                    ? { dot: '#10B981', text: '9 Turfs' }
                    : { dot: '#10B981', text: `${12 + (idx * 2)} Courts` };

              return (
                <Pressable
                  key={s.id}
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
                  accessibilityLabel={`${s.name}${on ? ', filter active' : ', filter games'}`}
                >
                  <ImageBackground
                    source={SPORT_IMAGE[s.sport]}
                    style={styles.sportImage}
                    imageStyle={styles.sportImageRadius}
                  >
                    <LinearGradient
                      colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.85)']}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.sportContentWrap}>
                      <AppText variant="label" color="#FFFFFF" style={styles.sportTitle} numberOfLines={1}>
                        {s.name}
                      </AppText>
                      <View style={styles.sportBadgeRow}>
                        <View style={[styles.sportDot, { backgroundColor: courtsBadge.dot }]} />
                        <AppText variant="caption" color="#E2E8F0" style={styles.sportBadgeText}>
                          {courtsBadge.text}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.sportChevron}>
                      <IconChevron color="#FFFFFF" size={14} />
                    </View>
                  </ImageBackground>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ---------------- MATCH OFFERS ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="Match Offers"
          badgeLabel="Challenge"
          actionLabel="See All →"
          onAction={() => router.push('/(tabs)/matches')}
        />
        {openChallenges.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (openChallenges.data ?? []).length === 0 ? (
          <View style={styles.cardContainer}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardIconWrap}>
                <IconSwords color={M.green} size={22} />
              </View>
              <View style={styles.cardTextCol}>
                <AppText variant="label" color={M.text} style={styles.cardTitle}>
                  No open match offers nearby
                </AppText>
                <AppText variant="caption" color={M.muted} style={styles.cardDesc}>
                  Post an open challenge for your squad to invite and play competitive matches against top local teams.
                </AppText>
              </View>
            </View>

            <View style={styles.cardActionRow}>
              <Pressable
                style={styles.primaryPillBtn}
                onPress={() => router.push('/teams/matches')}
                accessibilityRole="button"
                accessibilityLabel="Post Challenge"
              >
                <IconFlag color="#FFFFFF" size={16} />
                <AppText variant="label" color="#FFFFFF" style={styles.primaryPillBtnText}>
                  Post Challenge
                </AppText>
              </Pressable>

              <Pressable
                style={styles.secondaryPillBtn}
                onPress={() => router.push('/(tabs)/matches')}
                accessibilityRole="button"
                accessibilityLabel="Filter by Radius"
              >
                <IconSliders color={M.text} size={16} />
                <AppText variant="label" color={M.text} style={styles.secondaryPillBtnText}>
                  Filter by Radius
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(openChallenges.data ?? []).map((c) => {
              const isMine = (myTeams.data ?? []).some((t) => t.id === c.from_team_id && t.i_am_owner);
              const isBusy = challengingId === c.challenge_id && applyToChallenge.isPending;

              return (
                <Pressable
                  key={c.challenge_id}
                  onPress={() => setSelectedOffer(c)}
                  style={({ pressed }) => [
                    styles.wideCard,
                    { width: offerCardWidth },
                    {
                      borderColor: isMine ? M.green : M.border,
                      transform: [{ scale: pressed ? 0.99 : 1 }],
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.from_team_name} match offer. Tap to view match and team details.`}
                >
                  <View style={styles.pillRow}>
                    <View style={[styles.pill, { backgroundColor: isMine ? M.chip : M.chip }]}>
                      <AppText variant="caption" color={M.green} style={{ fontWeight: '800', fontSize: 10 }}>
                        {isMine ? '⚡ YOUR SEARCH' : '⚡ OPPONENT WANTED'}
                      </AppText>
                    </View>
                    <AppText variant="caption" color={M.faint}>
                      {c.distance_m > 0 ? `${(c.distance_m / 1000).toFixed(1)} km` : ''}
                    </AppText>
                  </View>

                  <View>
                    <AppText variant="label" color={M.text} numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>
                      {c.from_team_name}
                    </AppText>
                    <AppText variant="caption" color={M.green} style={{ fontSize: 11, fontWeight: '600', marginTop: 2 }}>
                      {`${sportLabel(c.sport as Sport)} · ${formatLabel(Math.max(Math.floor(c.total_slots / 2), 1))} · View Profile & Stats →`}
                    </AppText>
                  </View>

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
                        onPress={(e) => {
                          e.stopPropagation?.();
                          router.push({
                            pathname: '/match/create/searching',
                            params: { challengeId: c.challenge_id },
                          });
                        }}
                        style={[styles.joinBtn, { flex: 1, alignItems: 'center' }]}
                      >
                        <AppText variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>
                          View Radar
                        </AppText>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setSelectedOffer(c);
                        }}
                        disabled={isBusy}
                        style={[styles.joinBtn, { flex: 1, alignItems: 'center' }]}
                      >
                        {isBusy ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <AppText variant="caption" color="#FFFFFF" style={{ fontWeight: '800' }}>
                            ⚡ Send Request
                          </AppText>
                        )}
                      </Pressable>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* ---------------- GAMES NEAR YOU ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="Games Near You"
          hasDot
          actionLabel="See All →"
          onAction={() => router.push('/(tabs)/matches')}
        />
        {nearby.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (nearby.data ?? []).length === 0 ? (
          <View style={styles.cardContainer}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardIconWrap}>
                <IconTarget color={M.green} size={22} />
              </View>
              <View style={styles.cardTextCol}>
                <View style={styles.cardTitleLine}>
                  <AppText variant="label" color={M.text} style={styles.cardTitle}>
                    {coords
                      ? `No open games within ${formatRadius(DEFAULT_SEARCH_RADIUS_M)}`
                      : 'No open games within 5 km'}
                  </AppText>
                  <AppText variant="caption" color={M.faint} style={styles.radiusTag}>
                    {'< 5 km'}
                  </AppText>
                </View>
                <AppText variant="caption" color={M.muted} style={styles.cardDesc}>
                  Be the first to host a pickup game and invite local players to join.
                </AppText>
              </View>
            </View>

            <View style={styles.pickupFooterRow}>
              <AppText variant="caption" color={M.muted} style={{ fontSize: 12 }}>
                Looking for quick 6v6 or doubles?
              </AppText>
              <Pressable
                onPress={() => router.push({ pathname: '/match/create', params: { fresh: 'true' } })}
                accessibilityRole="button"
                accessibilityLabel="Host pickup game"
              >
                <AppText variant="label" color={M.green} style={styles.hostPickupLink}>
                  + Host Pickup →
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(nearby.data ?? []).map((m) => (
              <Pressable
                key={m.id}
                style={[styles.wideCard, { width: offerCardWidth }]}
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
                <AppText variant="label" color={M.text} numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>
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
                    <AppText variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>
                      Join Game
                    </AppText>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ---------------- FEATURED VENUES ---------------- */}
        <SectionHead
          M={M}
          styles={styles}
          title="Featured Venues"
          subtitle="Verified athletic boxes & courts"
          actionLabel="See All →"
          onAction={() => router.push('/(tabs)/venues')}
        />
        {venues.isLoading ? (
          <ActivityIndicator color={M.green} />
        ) : (venues.data ?? []).length === 0 ? (
          <View style={styles.cardContainer}>
            <AppText variant="caption" color={M.muted}>
              No venues listed yet.
            </AppText>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {(venues.data ?? []).map((v, idx) => {
              const ratingVal = v.rating ?? (idx % 2 === 0 ? '4.8' : '5.0');
              const priceVal = v.price_per_hour ?? (idx % 2 === 0 ? 800 : 900);
              const tagLabel = idx % 2 === 0 ? 'Open Now' : 'Lightning Fast';
              const distText = coords ? km(distanceKm(coords, v)) : (idx % 2 === 0 ? '506 km' : '338 m away');

              return (
                <Pressable
                  key={v.id}
                  style={[styles.venueCard, { width: venueCardWidth }]}
                  onPress={() => router.push('/(tabs)/venues')}
                  accessibilityRole="button"
                  accessibilityLabel={`${v.name}, ${v.address}. Open venues`}
                >
                  <View style={styles.venueImgWrap}>
                    <Image source={venueImage(v)} style={styles.venueImg} />
                    {/* Rating badge */}
                    <View style={styles.venueRatingBadge}>
                      <IconStar color="#F59E0B" size={11} />
                      <AppText variant="caption" color="#0F172A" style={styles.venueRatingText}>
                        {ratingVal}
                      </AppText>
                    </View>
                    {/* Price badge */}
                    <View style={styles.venuePriceBadge}>
                      <AppText variant="caption" color="#FFFFFF" style={styles.venuePriceText}>
                        ₹{priceVal}/hr
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.venueBody}>
                    <AppText variant="label" color={M.text} numberOfLines={1} style={styles.venueName}>
                      {v.name}
                    </AppText>
                    <View style={styles.venueLocationRow}>
                      <IconPin color={M.muted} size={11} />
                      <AppText variant="caption" color={M.muted} numberOfLines={1} style={styles.venueAddress}>
                        {v.address || 'Wakad, Pune'}
                      </AppText>
                    </View>
                    <View style={styles.venueFooter}>
                      <View style={styles.venueDistChip}>
                        <AppText variant="caption" color={M.green} style={styles.venueDistText}>
                          {distText}
                        </AppText>
                      </View>
                      <AppText variant="caption" color={M.green} style={styles.venueStatusText}>
                        {tagLabel}
                      </AppText>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* ---------------- Your matches ---------------- */}
        {upcoming.length > 0 ? (
          <>
            <SectionHead
              M={M}
              styles={styles}
              title="Your Games"
              actionLabel="See All →"
              onAction={() => router.push('/teams/matches')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              {upcoming.map(({ match, myStatus }) => (
                <Pressable
                  key={match.id}
                  style={[styles.wideCard, { width: offerCardWidth }]}
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
                  <AppText variant="caption" color={M.green} style={{ marginTop: S.xs, fontWeight: '700' }}>
                    View Game →
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

      <MatchOfferDetailModal
        visible={selectedOffer !== null}
        onClose={() => setSelectedOffer(null)}
        offer={selectedOffer}
        onSendRequest={(item) => {
          setSelectedOffer(null);
          onChallengeTeam(item);
        }}
        requesting={challengingId === selectedOffer?.challenge_id && applyToChallenge.isPending}
        isMine={(myTeams.data ?? []).some((t) => t.id === selectedOffer?.from_team_id && t.i_am_owner)}
        onViewRadar={(challengeId) => {
          setSelectedOffer(null);
          router.push({
            pathname: '/match/create/searching',
            params: { challengeId },
          });
        }}
      />
    </SafeAreaView>
  );
}

function SectionHead({
  M,
  styles,
  title,
  subtitle,
  badgeLabel,
  hasDot,
  actionLabel,
  actionColor,
  onAction,
}: {
  M: MockPalette;
  styles: ReturnType<typeof makeStyles>;
  title: string;
  subtitle?: string;
  badgeLabel?: string;
  hasDot?: boolean;
  actionLabel?: string;
  actionColor?: string;
  onAction?: () => void;
}): React.ReactNode {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadLeft}>
        <View style={styles.sectionHeadTitleRow}>
          <AppText variant="heading" color={M.text} style={styles.sectionHeadTitle}>
            {title}
          </AppText>
          {badgeLabel ? (
            <View style={styles.sectionBadge}>
              <AppText variant="caption" color={M.green} style={styles.sectionBadgeText}>
                {badgeLabel}
              </AppText>
            </View>
          ) : null}
          {hasDot ? <View style={styles.sectionDot} /> : null}
        </View>
        {subtitle ? (
          <AppText variant="caption" color={M.muted} style={styles.sectionSubtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}, ${title}`}
          hitSlop={10}
        >
          <AppText variant="caption" color={actionColor ?? M.green} style={styles.sectionActionText}>
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
    scroll: { paddingTop: S.xs, paddingBottom: S.xl, gap: 12 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 10,
    },
    headerTitleWrap: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      gap: 1,
    },
    greetingText: {
      fontSize: 12,
      lineHeight: 16,
    },
    userNameText: {
      fontSize: 22,
      lineHeight: 26,
      fontWeight: '700',
      letterSpacing: -0.3,
    },
    locationPill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      marginTop: 3,
      backgroundColor: M.chip,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 12,
    },
    locationText: {
      fontSize: 12,
      fontWeight: '600',
      maxWidth: 130,
    },
    heroBanner: {
      flexDirection: 'row',
      height: 150,
      marginHorizontal: 16,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: M.greenDeep,
    },
    heroHalf: { flex: 1, height: '100%' },
    heroCopy: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroLine: {
      fontSize: 24,
      lineHeight: 26,
      letterSpacing: 1,
      // Room on both sides: Android clips the last glyph of a tightly
      // measured line, which is what turned PLAY into "PLA".
      paddingHorizontal: 10,
      textAlign: 'center',
    },
    heroSports: { marginTop: 10, fontSize: 12, fontWeight: '600' },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    iconCircleBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: M.cardHi,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bellBadge: {
      position: 'absolute',
      top: 10,
      right: 11,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#F97316',
    },
    profileAvatarBtn: {
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
    profileAvatarImg: {
      width: '100%',
      height: '100%',
    },
    onlineDot: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#10B981',
      borderWidth: 1.5,
      borderColor: '#FFFFFF',
    },
    teamActionRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 12,
      marginHorizontal: 16,
    },
    teamActionPressable: {
      flex: 1,
      minWidth: 0,
      borderRadius: 18,
      overflow: 'hidden',
    },
    createTeamCard: {
      padding: 14,
      minHeight: 112,
      justifyContent: 'space-between',
      borderRadius: 18,
    },
    joinTeamCard: {
      padding: 14,
      minHeight: 112,
      justifyContent: 'space-between',
      borderRadius: 18,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
      shadowColor: '#000',
      shadowOpacity: 0.03,
      shadowRadius: 6,
      elevation: 1,
    },
    teamActionCardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    createTeamIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.18)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    createTeamChevronWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: 'rgba(255,255,255,0.18)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinTeamIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: M.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinTeamChevronWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: M.cardHi,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teamActionCardBottom: {
      gap: 2,
    },
    actionCardTitle: {
      fontSize: 15,
      fontWeight: '700',
    },
    actionCardSub: {
      fontSize: 11,
    },
    quickHostBanner: {
      marginHorizontal: 16,
      minHeight: 60,
      borderRadius: 18,
      backgroundColor: M.greenDeep,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      shadowColor: M.green,
      shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 3 },
      shadowRadius: 6,
      elevation: 3,
    },
    quickHostLeft: {
      flex: 1,
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    quickHostPlus: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickHostTitle: {
      flexShrink: 1,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      fontWeight: '700',
    },
    quickHostRule: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.3)' },
    quickHostTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      backgroundColor: 'rgba(255,255,255,0.14)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
      paddingHorizontal: 14,
      borderRadius: 22,
    },
    quickHostTagText: {
      fontSize: 14,
      fontWeight: '700',
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginTop: 8,
    },
    sectionHeadLeft: {
      flex: 1,
      minWidth: 0,
    },
    sectionHeadTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sectionHeadTitle: {
      fontSize: 17,
      lineHeight: 22,
    },
    sectionBadge: {
      backgroundColor: M.chip,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 10,
    },
    sectionBadgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    sectionDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: '#10B981',
    },
    sectionSubtitle: {
      fontSize: 11,
      marginTop: 2,
    },
    sectionActionText: {
      fontSize: 13,
      fontWeight: '700',
    },
    rail: { paddingHorizontal: 16, gap: 10 },
    sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 },
    sportChevron: {
      position: 'absolute',
      right: 10,
      bottom: 12,
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.6)',
      backgroundColor: 'rgba(0,0,0,0.25)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sportCard: {
      // Two to a row; a third sport wraps underneath rather than scrolling away.
      flexBasis: '45%',
      flexGrow: 1,
      height: 104,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: '#0F172A',
      borderWidth: 1,
      borderColor: M.border,
    },
    sportCardOn: {
      borderWidth: 2,
      borderColor: M.green,
    },
    sportImage: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sportImageRadius: {
      borderRadius: 16,
    },
    sportContentWrap: {
      padding: 10,
      gap: 2,
    },
    sportTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      fontWeight: '700',
    },
    sportBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    sportDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    sportBadgeText: {
      fontSize: 12,
      fontWeight: '600',
    },
    cardContainer: {
      marginHorizontal: 16,
      backgroundColor: M.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: M.border,
      padding: 16,
      gap: 12,
      shadowColor: '#000',
      shadowOpacity: 0.02,
      shadowRadius: 6,
      elevation: 1,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    cardIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: M.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTextCol: {
      flex: 1,
      minWidth: 0,
    },
    cardTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 18,
    },
    radiusTag: {
      fontSize: 11,
      fontWeight: '600',
    },
    cardDesc: {
      fontSize: 12,
      lineHeight: 17,
      marginTop: 3,
    },
    cardActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 2,
    },
    primaryPillBtn: {
      flex: 1,
      height: 44,
      borderRadius: 12,
      backgroundColor: M.green,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    primaryPillBtnText: {
      fontSize: 14,
      fontWeight: '700',
    },
    secondaryPillBtn: {
      flex: 1,
      height: 44,
      borderRadius: 12,
      backgroundColor: M.cardHi,
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryPillBtnText: {
      fontSize: 14,
      fontWeight: '600',
    },
    pickupFooterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: M.border,
      paddingTop: 10,
      marginTop: 2,
    },
    hostPickupLink: {
      fontSize: 14,
      fontWeight: '700',
    },
    wideCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      padding: 14,
      gap: 8,
      shadowColor: '#000',
      shadowOpacity: 0.02,
      shadowRadius: 6,
      elevation: 1,
    },
    pillRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    pill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: R.pill,
      backgroundColor: M.chip,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    joinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    joinBtn: {
      paddingHorizontal: 14,
      minHeight: 32,
      borderRadius: R.pill,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },
    venueCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.02,
      shadowRadius: 6,
      elevation: 1,
    },
    venueImgWrap: {
      width: '100%',
      height: 108,
      backgroundColor: M.cardHi,
    },
    venueImg: {
      width: '100%',
      height: '100%',
    },
    venueRatingBadge: {
      position: 'absolute',
      top: 8,
      left: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: '#FFFFFF',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 10,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 4,
      elevation: 2,
    },
    venueRatingText: {
      fontSize: 11,
      fontWeight: '700',
    },
    venuePriceBadge: {
      position: 'absolute',
      bottom: 8,
      right: 8,
      backgroundColor: 'rgba(0,0,0,0.78)',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 6,
    },
    venuePriceText: {
      fontSize: 10,
      fontWeight: '700',
    },
    venueBody: {
      padding: 10,
      gap: 4,
    },
    venueName: {
      fontSize: 13,
      fontWeight: '700',
    },
    venueLocationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    venueAddress: {
      fontSize: 11,
      flex: 1,
    },
    venueFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    venueDistChip: {
      backgroundColor: M.chip,
      paddingHorizontal: 7,
      paddingVertical: 2.5,
      borderRadius: 6,
    },
    venueDistText: {
      fontSize: 10,
      fontWeight: '600',
    },
    venueStatusText: {
      fontSize: 11,
      fontWeight: '700',
    },
    draftCard: {
      marginHorizontal: 16,
      backgroundColor: M.card,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: M.green,
      padding: 14,
      gap: 8,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 3,
    },
    draftTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    draftPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: M.chip,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: R.pill,
    },
    draftDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: M.green,
    },
    discardBtn: {
      padding: 4,
    },
    draftBody: {
      gap: 2,
    },
    draftInfo: {
      gap: 2,
    },
    resumeBtn: {
      backgroundColor: M.green,
      borderRadius: R.sm,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    radarBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: M.green,
      backgroundColor: M.card,
      marginHorizontal: 16,
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
      backgroundColor: '#FFFFFF',
    },
  });
