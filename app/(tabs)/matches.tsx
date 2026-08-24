import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { showDemoMatches } from '@core/config/env';
import { getCurrentCoords } from '@core/location/location';
import type { Coords } from '@core/location/location';
import { AppError } from '@core/errors/AppError';
import {
  useJoinedMatches,
  useJoinOpenMatch,
  useNearbyMatches,
  useRequestToJoinAny,
} from '@features/matches/presentation/useMatches';
import { DEMO_MATCHES, isDemoMatch } from '@features/matches/domain/demoMatches';
import {
  useApplyToChallenge,
  useMyChallenges,
  useNearbyOpenChallenges,
} from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import type { NearbyOpenChallenge } from '@features/teams/domain/challengeSchema';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { Match } from '@features/matches/domain/matchSchema';
import type { MatchStatus, Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import {
  IconChevron,
  IconClock,
  IconPin,
  IconPlus,
  IconSend,
} from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${hh}:${mm}`;
}

const SPORT_CARDS: { value: Sport; label: string }[] = [
  { value: 'box_cricket', label: 'Cricket' },
  { value: 'badminton', label: 'Badminton' },
];

const STATUS_LABEL: Record<MatchStatus, string> = {
  open: 'OPEN',
  locked: 'LOCKED',
  completed: 'DONE',
  cancelled: 'CANCELLED',
};

/**
 * Type guard for an untrusted route param. The value arrives as
 * `string | string[] | undefined` from `useLocalSearchParams`, so it is checked
 * against the app's own sport keys rather than cast. SPORT_IMAGE is a
 * `Record<Sport, …>`, i.e. exhaustive over Sport, so adding a sport later
 * cannot leave this validator behind.
 */
function isSport(value: unknown): value is Sport {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPORT_IMAGE, value);
}

/** De-duplicate matches by id, keeping first occurrence and stable order. */
function dedupeById(rows: Match[]): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Pressable that scales down slightly while pressed. */
function ScalePressable({
  onPress,
  style,
  children,
  accessibilityLabel,
}: {
  onPress: () => void;
  style?: object;
  children: React.ReactNode;
  /** Required when the child is an icon with no text, or the button is unlabelled. */
  accessibilityLabel?: string;
}): React.ReactNode {
  const scale = useMemo(() => new Animated.Value(1), []);
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      accessibilityRole="button"
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Pulsing skeleton card shown while nearby matches load. */
function SkeletonCards(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const opacity = useMemo(() => new Animated.Value(0.35), []);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <View style={{ gap: S.md, paddingTop: S.md }}>
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={[styles.skeleton, { opacity }]}>
          <View style={styles.skeletonThumb} />
          <View style={{ flex: 1, gap: S.sm }}>
            <View style={[styles.skeletonLine, { width: '55%' }]} />
            <View style={[styles.skeletonLine, { width: '35%' }]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

/** Premium empty state: pulsing location marker, headline, description, CTA. */
function EmptyState({ onCreate }: { onCreate: () => void }): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyMarkerWrap}>
        <MotiView
          from={{ scale: 0.7, opacity: 0.6 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{
            type: 'timing',
            duration: 1400,
            loop: true,
            repeatReverse: false,
          }}
          style={styles.emptyRing}
        />
        <View style={styles.emptyMarker}>
          <IconPin color={M.green} size={26} />
        </View>
      </View>
      <AppText variant="heading" color={M.text} center style={{ fontSize: 19, marginTop: S.md }}>
        No open matches within 5 km.
      </AppText>
      <AppText color={M.muted} center style={{ marginTop: 4 }}>
        Be the first — create one!
      </AppText>
      <ScalePressable onPress={onCreate} style={styles.emptyCta}>
        <IconPlus color={M.limeInk} size={18} />
        <AppText variant="label" color={M.limeInk} style={{ fontSize: 15, marginLeft: 6 }}>
          Create Match
        </AppText>
      </ScalePressable>
    </View>
  );
}

export default function NearbyScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(true);
  const [sport, setSport] = useState<Sport | null>(null);
  const challenges = useMyChallenges();
  const activeChallenge = useMemo(() => {
    return (challenges.data ?? []).find(
      (c) => c.direction === 'outgoing' && c.status === 'open',
    );
  }, [challenges.data]);

  // Home can deep-link into this tab with a sport pre-selected:
  //   router.push({ pathname: '/(tabs)/matches', params: { sport: 'box_cricket' } })
  // The raw param is untrusted (`string | string[] | undefined`), so it is
  // normalised and validated before it is allowed anywhere near the filter.
  const params = useLocalSearchParams<{ sport?: string | string[] }>();
  const rawSportParam = Array.isArray(params.sport) ? params.sport[0] : params.sport;
  const sportParam = isSport(rawSportParam) ? rawSportParam : null;

  // Param-sync rule: the param seeds the filter on arrival and re-applies only
  // when its VALUE CHANGES (the user can tap a different sport on Home and come
  // back, which a mount-only initialiser would silently ignore). Between changes
  // the param stays quiet, so a manual tap — including clearing the filter back
  // to "all sports" — is never overwritten on the next render. An absent or
  // unrecognised param leaves the current filter exactly as it is.
  const appliedSportParam = useRef<Sport | null>(null);
  useEffect(() => {
    if (sportParam === null) return;
    if (appliedSportParam.current === sportParam) return;
    appliedSportParam.current = sportParam;
    setSport(sportParam);
  }, [sportParam]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const c = await getCurrentCoords();
      if (active) {
        setCoords(c);
        setLocating(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const nearby = useNearbyMatches(coords, sport);
  const openChallenges = useNearbyOpenChallenges(coords, sport);
  const applyToChallenge = useApplyToChallenge();
  const myTeams = useMyTeamsOverview();
  const [challengingId, setChallengingId] = useState<string | null>(null);
  const sportLabel = useSportLabel();

  // A card must never offer to join something you are already on. The nearby
  // RPC returns matches, not memberships, so the only place that answer exists
  // is the list of matches you have joined.
  const joined = useJoinedMatches();
  const joinedIds = useMemo(
    () => new Set((joined.data ?? []).map((row) => row.match.id)),
    [joined.data],
  );

  // Real rows, de-duplicated. Fake rows are appended only in demo mode
  // (EXPO_PUBLIC_DEMO_MATCHES=true, never in production) so a client walkthrough
  // doesn't open on an empty screen. When both are empty, the empty state shows.
  const list = useMemo<Match[]>(() => {
    const real = nearby.data ?? [];
    return dedupeById(showDemoMatches ? [...real, ...DEMO_MATCHES] : real);
  }, [nearby.data]);

  const goCreate = () =>
    router.push({ pathname: '/match/create', params: sport ? { sport } : {} });

  const openMatch = (item: Match) => {
    if (isDemoMatch(item.id)) {
      Alert.alert('Sample match', 'This is placeholder data for the demo and cannot be joined.');
      return;
    }
    if (item.status === 'completed') {
      router.push(`/match/${item.id}/result`);
      return;
    }
    router.push({ pathname: '/match/[id]', params: { id: item.id } });
  };

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
      } else {
        Alert.alert(
          'Choose your Squad',
          'Which of your teams would you like to challenge with?',
          [
            ...ownedMatching.map((t) => ({
              text: t.name,
              onPress: () => send(t.id),
            })),
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      }
    },
    [myTeams.data, applyToChallenge, openChallenges, router],
  );

  // Ask to join straight from a card, without a detour through the detail
  // screen. On success we open the match so the player can watch their request
  // move through the organiser's queue.
  const joinAny = useRequestToJoinAny();
  const joinOpen = useJoinOpenMatch();
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const onJoinPress = async (item: Match): Promise<void> => {
    if (isDemoMatch(item.id)) {
      Alert.alert('Sample match', 'This is placeholder data for the demo and cannot be joined.');
      return;
    }
    if (joiningId) return;
    setJoiningId(item.id);
    try {
      // Two different promises behind one button. A Post a Match card seats you
      // immediately; a team fixture only queues a request for its organiser.
      if (item.match_type === 'open') await joinOpen.mutateAsync(item.id);
      else await joinAny.mutateAsync(item.id);
      router.push({ pathname: '/match/[id]', params: { id: item.id } });
    } catch (e) {
      Alert.alert(
        'Could not join',
        e instanceof AppError ? e.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setJoiningId(null);
    }
  };

  // Which non-list state (if any) to show under the header. When null, the list
  // of match cards renders instead.
  const busy = locating || (coords != null && nearby.isLoading);
  const showCards = !busy && !nearby.isError && list.length > 0;
  const data = showCards ? list : [];

  const renderItem = ({ item }: { item: Match }) => {
    const filled = item.filled_slots;
    const total = item.total_slots;
    const pct = total > 0 ? Math.min(1, filled / total) : 0;
    // Derived, not read from missing_count: that column is written as 0 by the
    // challenge flow, so "0 spots left" was showing on matches that were empty.
    const spotsLeft = Math.max(total - filled, 0);
    const isOpenType = item.match_type === 'open';
    const isFull = spotsLeft === 0;
    const alreadyIn = joinedIds.has(item.id);
    const isOpen = item.status === 'open' && !isFull && !alreadyIn;
    const title = item.match_name;
    return (
      <ScalePressable onPress={() => openMatch(item)} style={styles.card}>
        <View style={styles.cardTop}>
          <Image source={SPORT_IMAGE[item.sport]} style={styles.cardThumb} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.cardTitleRow}>
              <AppText variant="heading" color={M.text} style={{ fontSize: 16, flex: 1 }}>
                {title}
              </AppText>
              <View style={[styles.badge, isOpen ? styles.badgeOpen : null]}>
                <AppText
                  variant="caption"
                  color={isOpen ? M.green : M.muted}
                  style={styles.badgeText}
                >
                  {STATUS_LABEL[item.status]}
                </AppText>
              </View>
            </View>
            <View style={styles.metaRow}>
              <IconClock color={M.muted} size={14} />
              <AppText variant="caption" color={M.muted}>
                {formatWhen(item.scheduled_at)}
              </AppText>
            </View>
          </View>
        </View>

        {item.venue_text || item.area_name ? (
          <View style={styles.metaRow}>
            <IconPin color={M.muted} size={14} />
            <AppText variant="caption" color={M.muted} style={{ flex: 1 }}>
              {item.venue_text || item.area_name}
            </AppText>
          </View>
        ) : null}

        <View style={styles.slotsRow}>
          <AppText variant="label" color={M.text}>
            {filled}/{total} Players
          </AppText>
          <AppText variant="caption" color={isFull ? M.muted : M.green}>
            {isFull ? 'MATCH FULL' : `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`}
          </AppText>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>

        <ScalePressable
          onPress={() => (isOpen ? void onJoinPress(item) : openMatch(item))}
          style={[styles.joinBtn, !isOpen || joiningId != null ? styles.joinBtnDisabled : null]}
        >
          <AppText variant="label" color={M.text}>
            {joiningId === item.id
              ? isOpenType
                ? 'Joining…'
                : 'Requesting…'
              : alreadyIn
                ? "You're already in this match"
                : isFull && item.status === 'open'
                  ? 'Match full'
                  : isOpen
                    ? 'Join Match'
                    : 'View'}
          </AppText>
        </ScalePressable>
      </ScalePressable>
    );
  };

  // Static top-of-screen content. Lives inside the list header so it scrolls
  // with the cards and can never overlap them (single scroll container).
  const ListHeader = (
    <View>
      {/* Brand row */}
      <View style={styles.header}>
        <AppLogo width={92} />
      </View>

      <View style={styles.intro}>
        <AppText variant="title" color={M.text} style={{ fontSize: 26 }}>
          Matches near you
        </AppText>
        <AppText variant="caption" color={M.muted}>
          {sport === null
            ? 'Showing all sports — tap a sport to filter'
            : `Showing ${sportLabel(sport)} only`}
        </AppText>
      </View>

      {/* Sport image cards */}
      <View style={styles.sportRow}>
        {SPORT_CARDS.map(({ value, label }) => {
          const on = sport === value;
          return (
            <Pressable
              key={value}
              style={styles.sportCardWrap}
              onPress={() => setSport(on ? null : value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <MotiView
                animate={{ scale: on ? 1 : 0.97, borderColor: on ? M.green : M.border }}
                transition={{ type: 'spring', damping: 14, stiffness: 180 }}
                style={[styles.sportCard, on ? styles.sportCardOn : null]}
              >
                <ImageBackground
                  source={SPORT_IMAGE[value]}
                  style={styles.sportImage}
                  imageStyle={{ borderRadius: 18 }}
                >
                  <View style={styles.sportShade} />
                  <View style={styles.sportTextWrap}>
                    <AppText variant="label" color={M.text} style={styles.sportLabel}>
                      {label}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      Find matches
                    </AppText>
                  </View>
                </ImageBackground>
              </MotiView>
            </Pressable>
          );
        })}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <ScalePressable onPress={goCreate} style={styles.primaryBtn}>
          <IconPlus color={M.limeInk} size={18} />
          <AppText
            variant="label"
            color={M.limeInk}
            numberOfLines={1}
            style={{ fontSize: 15, lineHeight: 18, marginLeft: 6, flexShrink: 1 }}
          >
            Create Match
          </AppText>
        </ScalePressable>
        <ScalePressable onPress={() => router.push('/match/join')} style={styles.secondaryBtn}>
          <IconSend color={M.text} size={18} />
          <AppText
            variant="label"
            color={M.text}
            numberOfLines={1}
            style={{ fontSize: 15, lineHeight: 18, marginLeft: 6, flexShrink: 1 }}
          >
            Join with code
          </AppText>
        </ScalePressable>
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

      {/* Open Team Challenges (Looking for Opponents) */}
      {openChallenges.data && openChallenges.data.length > 0 ? (
        <View style={styles.challengeSection}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.challengeSectionPill}>
              <View style={styles.challengeSectionDot} />
              <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 11 }}>
                TEAMS LOOKING FOR OPPONENTS ({openChallenges.data.length})
              </AppText>
            </View>
          </View>

          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.challengeList}
            data={openChallenges.data}
            keyExtractor={(item) => item.challenge_id}
            renderItem={({ item }) => {
              const isApplied = item.applied_status === 'interested';
              const isBusy = challengingId === item.challenge_id;
              return (
                <View style={styles.challengeCard}>
                  <View style={styles.challengeCardTop}>
                    <View style={styles.challengeTeamLogo}>
                      <AppText variant="heading" color={M.limeInk} style={{ fontSize: 16 }}>
                        {item.from_team_name.charAt(0).toUpperCase()}
                      </AppText>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="label" color={M.text} numberOfLines={1} style={{ fontSize: 15 }}>
                        {item.from_team_name}
                      </AppText>
                      <AppText variant="caption" color={M.muted}>
                        {item.sport === 'box_cricket' ? '🏏 Cricket' : '🏸 Badminton'} · {item.total_slots} slots
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.challengeCardDetails}>
                    <View style={styles.challengeInfoRow}>
                      <IconClock color={M.green} size={14} />
                      <AppText variant="caption" color={M.text} numberOfLines={1}>
                        {formatWhen(item.scheduled_at)}
                      </AppText>
                    </View>
                    <View style={styles.challengeInfoRow}>
                      <IconPin color={M.green} size={14} />
                      <AppText variant="caption" color={M.muted} numberOfLines={1}>
                        {item.venue_name || item.area_name}
                        {item.distance_m > 0 ? ` (${(item.distance_m / 1000).toFixed(1)} km)` : ''}
                      </AppText>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => onChallengeTeam(item)}
                    disabled={isApplied || isBusy}
                    style={[
                      styles.challengeBtn,
                      isApplied ? styles.challengeBtnApplied : null,
                    ]}
                    accessibilityRole="button"
                  >
                    {isBusy ? (
                      <ActivityIndicator color={M.limeInk} size="small" />
                    ) : (
                      <AppText
                        variant="caption"
                        color={isApplied ? M.muted : M.limeInk}
                        style={{ fontWeight: '700' }}
                      >
                        {isApplied ? '✓ Request Sent' : '⚡ Challenge Team'}
                      </AppText>
                    )}
                  </Pressable>
                </View>
              );
            }}
          />
        </View>
      ) : null}

      {/* Section heading — only when cards are shown below */}
      {showCards && data.length > 0 ? (
        <AppText variant="label" color={M.text} style={styles.listHeading}>
          Nearby matches
        </AppText>
      ) : null}

      {/* Non-list states render here, still under the buttons */}
      {busy ? (
        <SkeletonCards />
      ) : !coords ? (
        <View style={styles.notice}>
          <AppText color={M.muted} center>
            Turn on location to see matches near you. You can still create or join with a code.
          </AppText>
        </View>
      ) : nearby.isError ? (
        <View style={styles.notice}>
          <AppText color={M.muted} center>
            Could not load nearby matches.
          </AppText>
          <ScalePressable onPress={() => void nearby.refetch()} style={styles.retryBtn}>
            <AppText variant="label" color={M.text}>
              Retry
            </AppText>
          </ScalePressable>
        </View>
      ) : list.length === 0 ? (
        <EmptyState onCreate={goCreate} />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <FlatList
        style={styles.list}
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        onRefresh={coords ? () => void nearby.refetch() : undefined}
        refreshing={nearby.isRefetching}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={6}
        windowSize={7}
        ItemSeparatorComponent={() => <View style={{ height: S.md }} />}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: S.xs,
  },
  intro: { gap: 4, marginBottom: S.md },
  sportRow: { flexDirection: 'row', gap: S.md, marginBottom: S.lg },
  sportCardWrap: { flex: 1 },
  sportCard: {
    height: 128,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: M.border,
    backgroundColor: M.card,
    overflow: 'hidden',
  },
  sportCardOn: {
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 10,
  },
  sportImage: { flex: 1, justifyContent: 'flex-end' },
  sportShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sportTextWrap: { paddingHorizontal: S.md, paddingBottom: S.md },
  sportLabel: { fontSize: 17, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: S.md, marginBottom: S.lg },
  primaryBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    flexDirection: 'row',
    backgroundColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  linkRow: { flexDirection: 'row', gap: S.sm, marginBottom: S.lg },
  linkBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: M.border,
    backgroundColor: M.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: M.border,
    backgroundColor: M.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listHeading: { fontSize: 16, marginBottom: S.sm },
  notice: { alignItems: 'center', gap: S.md, paddingVertical: S.xl },
  retryBtn: {
    minHeight: 44,
    paddingHorizontal: S.lg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: M.border,
    backgroundColor: M.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    gap: S.sm + 4,
    padding: S.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
  },
  cardTop: { flexDirection: 'row', gap: S.md, alignItems: 'center' },
  cardThumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: M.cardHi },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: M.cardHi,
  },
  badgeOpen: { backgroundColor: 'rgba(34,197,94,0.14)' },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  slotsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTrack: {
    height: 6,
    borderRadius: R.pill,
    backgroundColor: M.cardHi,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: R.pill, backgroundColor: M.green },
  joinBtn: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  joinBtnDisabled: { opacity: 0.5 },
  emptyCard: {
    alignItems: 'center',
    padding: S.xl,
    marginTop: S.sm,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
  },
  emptyMarkerWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  emptyRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: M.green,
  },
  emptyMarker: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    alignSelf: 'stretch',
    marginTop: S.lg,
    borderRadius: 18,
    backgroundColor: M.green,
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  skeleton: {
    flexDirection: 'row',
    gap: S.md,
    alignItems: 'center',
    padding: S.md,
    borderRadius: 20,
    backgroundColor: M.card,
  },
  skeletonThumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: M.cardHi },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: M.cardHi },
  radarBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    padding: S.md,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: M.green,
    backgroundColor: M.card,
    marginBottom: S.md,
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

  challengeSection: {
    gap: S.sm,
    marginBottom: S.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  challengeSectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: M.green,
  },
  challengeSectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: M.limeInk,
  },
  challengeList: {
    gap: S.sm,
    paddingVertical: 2,
  },
  challengeCard: {
    width: 240,
    padding: S.md,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: M.border,
    backgroundColor: M.card,
    gap: S.sm,
  },
  challengeCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  challengeTeamLogo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeCardDetails: {
    gap: 4,
  },
  challengeInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengeBtn: {
    minHeight: 38,
    borderRadius: R.pill,
    backgroundColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  challengeBtnApplied: {
    backgroundColor: M.cardHi,
    borderWidth: 1,
    borderColor: M.border,
  },
});
