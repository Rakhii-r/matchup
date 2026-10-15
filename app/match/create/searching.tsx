/**
 * Finding Opponent — Live Radar screen.
 *
 * It serves two linked roles:
 * 1. Live Radar Scanner (when opened from "Find Opponent (Radar)"):
 *    Displays the animated radar dish scanning nearby teams, lets the user
 *    switch their squad, radius, venue and start time, and broadcast an open
 *    challenge directly with 1 tap without forcing them through the 3-step wizard.
 * 2. Active Challenge Visualiser (when tracking an open fixture):
 *    Every dot on it is a real row from `get_challenge_candidates` — the offer
 *    ledger for this challenge, positioned by distance on the dish.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { useAuthStore } from '@core/auth/authStore';
import { getCurrentCoords } from '@core/location/location';
import { AppError } from '@core/errors/AppError';
import { TOUCH } from '@features/matches/presentation/CreateMatchWizardUI';
import {
  DEFAULT_SLOT_DURATION_MIN,
  addMinutesHHmm,
} from '@features/matches/presentation/useCreateMatchWizard';
import {
  useApplyToChallenge,
  useCancelChallenge,
  useChallenge,
  useChallengeCandidatesFull,
  useDeclineOpenChallenge,
  useMyChallenges,
  useMyOffers,
  useNearbyOpenChallenges,
  usePostOpenChallenge,
} from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import type {
  ChallengeCandidateFull,
  NearbyOpenChallenge,
} from '@features/teams/domain/challengeSchema';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconBack, IconCalendar, IconChevron, IconSearch, IconUsers } from '@shared/ui/icons';

/** One full turn of the sweep. Slow enough to read as a scan, not a spinner. */
const SWEEP_MS = 2600;

const STAGES: { atSeconds: number; label: string }[] = [
  { atSeconds: 0, label: 'Looking for teams' },
  { atSeconds: 4, label: 'Verifying availability' },
  { atSeconds: 9, label: 'Almost there…' },
];

const GOLDEN_ANGLE_DEG = 137.507;

const RADIUS_OPTIONS = [
  { label: '10 km', value: 10000 },
  { label: '25 km', value: 25000 },
  { label: '50 km', value: 50000 },
];

const DEFAULT_PLAYERS_PER_SIDE: Record<string, number> = {
  box_cricket: 6,
  badminton: 2,
};

function blipOffset(
  candidate: { rank?: number; distance_m: number },
  searchRadiusM: number | null,
  radiusPx: number,
): { x: number; y: number } {
  const rank = candidate.rank ?? 1;
  const angle = ((rank * GOLDEN_ANGLE_DEG - 90) * Math.PI) / 180;
  const ratio =
    searchRadiusM && searchRadiusM > 0
      ? Math.min(Math.max(candidate.distance_m / searchRadiusM, 0), 1)
      : 0.5;
  const r = (0.22 + 0.68 * ratio) * radiusPx;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unavailable';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  return metres < 1000 ? `${Math.round(metres)} m away` : `${(metres / 1000).toFixed(1)} km away`;
}

function formatKm(metres: number | null): string | null {
  if (metres === null || !Number.isFinite(metres) || metres <= 0) return null;
  const km = metres / 1000;
  return km >= 10 ? `${Math.round(km)}` : `${Math.round(km * 10) / 10}`.replace(/\.0$/, '');
}

const SIXFOUR_BALL = require('../../../assets/images/sixfour ball.jpg') as number;

/**
 * Sixfour Ball center piece with neon halo ring and breathing glow.
 * Accurately fits and centers the sixfour ball image asset in the radar dish.
 */
function CenterSixfourBall({ size = 58 }: { size?: number }): React.ReactNode {
  const imgW = size * 1.45;
  const imgH = imgW * (1024 / 776);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#050C07',
        borderWidth: 2,
        borderColor: '#10B981',
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 14,
        elevation: 10,
        overflow: 'hidden',
      }}
    >
      <Image
        source={SIXFOUR_BALL}
        style={{
          width: imgW,
          height: imgH,
        }}
        resizeMode="cover"
      />
    </View>
  );
}

/**
 * 3D Glowing Red Cricket Ball with authentic stitched seam.
 */
function CricketBall({ size = 48 }: { size?: number }): React.ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="ballShading" cx="36%" cy="32%" r="65%" fx="32%" fy="28%">
          <Stop offset="0%" stopColor="#FF6B6B" stopOpacity="1" />
          <Stop offset="30%" stopColor="#E53935" stopOpacity="1" />
          <Stop offset="75%" stopColor="#B71C1C" stopOpacity="1" />
          <Stop offset="100%" stopColor="#3E0000" stopOpacity="1" />
        </RadialGradient>
        <RadialGradient id="ballAura" cx="50%" cy="50%" r="50%">
          <Stop offset="65%" stopColor="#10B981" stopOpacity="0.45" />
          <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Ambient Neon Glow behind the ball */}
      <Circle cx="50" cy="50" r="48" fill="url(#ballAura)" />

      {/* Main 3D Leather Sphere */}
      <Circle cx="50" cy="50" r="42" fill="url(#ballShading)" />

      {/* Specular 3D light reflection */}
      <Circle cx="35" cy="30" r="13" fill="#FFFFFF" opacity="0.32" />
      <Circle cx="33" cy="28" r="6" fill="#FFFFFF" opacity="0.65" />

      {/* Dark shadow groove along the seam */}
      <Path
        d="M 23 77 Q 50 50 77 23"
        stroke="#2A0000"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        opacity="0.8"
      />

      {/* White seam track */}
      <Path
        d="M 24 76 Q 50 50 76 24"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.95"
      />

      {/* Real cross-stitches along the seam */}
      {[-24, -18, -12, -6, 0, 6, 12, 18, 24].map((offset, i) => {
        const cx = 50 + offset * 0.95;
        const cy = 50 - offset * 0.95;
        return (
          <Line
            key={i}
            x1={cx - 3.2}
            y1={cy - 3.2}
            x2={cx + 3.2}
            y2={cy + 3.2}
            stroke="#FFFFFF"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.95"
          />
        );
      })}
    </Svg>
  );
}

/**
 * Cyber Cricket Stadium Radar Dish Grid (Concentric pitch crease & boundary rings).
 */
function CricketRadarDishGrid({ size }: { size: number }): React.ReactNode {
  const r = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="radarBg" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#08140B" stopOpacity="1" />
          <Stop offset="70%" stopColor="#050C07" stopOpacity="1" />
          <Stop offset="100%" stopColor="#020503" stopOpacity="1" />
        </RadialGradient>
        <RadialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
          <Stop offset="45%" stopColor="#10B981" stopOpacity="0.12" />
          <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Deep Turf Background with Outer Neon Rim */}
      <Circle
        cx={r}
        cy={r}
        r={r - 2}
        fill="url(#radarBg)"
        stroke="rgba(152, 187, 1, 0.45)"
        strokeWidth="1.5"
      />

      {/* Ambient Center Glow */}
      <Circle cx={r} cy={r} r={r * 0.75} fill="url(#centerGlow)" />

      {/* Pitch Crease Crosshair Axes */}
      <Line
        x1={14}
        y1={r}
        x2={size - 14}
        y2={r}
        stroke="rgba(152, 187, 1, 0.24)"
        strokeWidth="1"
        strokeDasharray="4,4"
      />
      <Line
        x1={r}
        y1={14}
        x2={r}
        y2={size - 14}
        stroke="rgba(152, 187, 1, 0.24)"
        strokeWidth="1"
        strokeDasharray="4,4"
      />

      {/* Diagonal angle scan guides */}
      <Line
        x1={r * 0.28}
        y1={r * 0.28}
        x2={size - r * 0.28}
        y2={size - r * 0.28}
        stroke="rgba(152, 187, 1, 0.12)"
        strokeWidth="0.8"
        strokeDasharray="2,4"
      />
      <Line
        x1={size - r * 0.28}
        y1={r * 0.28}
        x2={r * 0.28}
        y2={size - r * 0.28}
        stroke="rgba(152, 187, 1, 0.12)"
        strokeWidth="0.8"
        strokeDasharray="2,4"
      />

      {/* Concentric Neon Pitch Rings (Crease, Inner Ring, 30-Yard, Boundary) */}
      <Circle cx={r} cy={r} r={r * 0.25} stroke="rgba(152, 187, 1, 0.75)" strokeWidth="1.6" fill="none" />
      <Circle cx={r} cy={r} r={r * 0.45} stroke="rgba(152, 187, 1, 0.45)" strokeWidth="1" strokeDasharray="5,3" fill="none" />
      <Circle cx={r} cy={r} r={r * 0.65} stroke="rgba(152, 187, 1, 0.6)" strokeWidth="1.2" fill="none" />
      <Circle cx={r} cy={r} r={r * 0.85} stroke="rgba(152, 187, 1, 0.4)" strokeWidth="1" strokeDasharray="6,4" fill="none" />
      <Circle cx={r} cy={r} r={r * 0.96} stroke="rgba(152, 187, 1, 0.75)" strokeWidth="1.8" fill="none" />
    </Svg>
  );
}

/**
 * Sweeping Laser Radar Beam with glowing trailing sector.
 * Uses Reanimated withRepeat for ultra-smooth continuous infinite rotation.
 */
function RadarSweepBeam({ size }: { size: number }): React.ReactNode {
  const r = size / 2;
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, {
        duration: SWEEP_MS,
        easing: Easing.linear,
      }),
      -1, // -1 means infinite loop
      false, // restart from 0deg seamlessly on every cycle
    );
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[{ width: size, height: size }, animatedStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <SvgLinearGradient id="sweepTrail" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#10B981" stopOpacity="0" />
              <Stop offset="65%" stopColor="#10B981" stopOpacity="0.22" />
              <Stop offset="100%" stopColor="#4ADE80" stopOpacity="0.45" />
            </SvgLinearGradient>
          </Defs>

          {/* Sweeping Cone / Trailing Sector (approx 35 degrees) */}
          <Path
            d={`M ${r} ${r} L ${r + r * 0.95 * Math.sin(-0.62)} ${r - r * 0.95 * Math.cos(-0.62)} A ${r * 0.95} ${r * 0.95} 0 0 1 ${r} ${r * 0.05} Z`}
            fill="url(#sweepTrail)"
          />

          {/* Main Laser Ray */}
          <Line
            x1={r}
            y1={r}
            x2={r}
            y2={r * 0.04}
            stroke="#4ADE80"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Glowing laser tip beacon */}
          <Circle cx={r} cy={r * 0.04} r="5" fill="#FFFFFF" stroke="#4ADE80" strokeWidth="2" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/**
 * Continuous expanding sonar pulse ring using Reanimated withRepeat.
 */
function RadarPulseRing({ size, delay = 0 }: { size: number; delay?: number }): React.ReactNode {
  const scale = useSharedValue(0.18);
  const opacity = useSharedValue(0.85);

  useEffect(() => {
    const timeout = setTimeout(() => {
      scale.value = withRepeat(
        withTiming(1.04, { duration: SWEEP_MS, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withTiming(0, { duration: SWEEP_MS, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    }, delay);
    return () => clearTimeout(timeout);
  }, [scale, opacity, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: 999,
          borderWidth: 1.8,
          borderColor: '#10B981',
          shadowColor: '#10B981',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.7,
          shadowRadius: 10,
        },
        animatedStyle,
      ]}
      pointerEvents="none"
    />
  );
}

export default function SearchingScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ challengeId?: string; teamId?: string }>();

  const [localChallengeId, setLocalChallengeId] = useState<string | null>(null);

  // Check user challenges to find any active outgoing scan
  const myChallenges = useMyChallenges();
  const activeExistingChallenge = useMemo(() => {
    return (myChallenges.data ?? []).find(
      (c) => c.direction === 'outgoing' && c.status === 'open',
    );
  }, [myChallenges.data]);

  const rawId = params.challengeId;
  const challengeId =
    typeof rawId === 'string' && rawId.length > 0
      ? rawId
      : localChallengeId ?? activeExistingChallenge?.id ?? null;

  // Active challenge state & candidate polling
  const challenge = useChallenge(challengeId);
  const isOpen = challenge.data?.status === 'open';
  const candidates = useChallengeCandidatesFull(challengeId, isOpen);
  const cancel = useCancelChallenge();
  const declineOpen = useDeclineOpenChallenge();

  // Teams and venues for broadcast
  const myTeams = useMyTeamsOverview();
  const ownedTeams = useMemo(
    () => (myTeams.data ?? []).filter((t) => t.i_am_owner),
    [myTeams.data],
  );

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(params.teamId ?? null);
  const currentTeam = useMemo(() => {
    if (selectedTeamId) {
      const found = ownedTeams.find((t) => t.id === selectedTeamId);
      if (found) return found;
    }
    if (params.teamId) {
      const found = ownedTeams.find((t) => t.id === params.teamId);
      if (found) return found;
    }
    return ownedTeams[0] ?? null;
  }, [ownedTeams, selectedTeamId, params.teamId]);

  const [selectedRadiusM, setSelectedRadiusM] = useState<number>(25000);
  const profile = useAuthStore((s) => s.profile);
  const [dayOffset, setDayOffset] = useState<number>(0);
  const [timeHHmm, setTimeHHmm] = useState<string>(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const hh = String(nextHour.getHours()).padStart(2, '0');
    return `${hh}:00`;
  });

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(() => {
    if (profile?.home_lat && profile?.home_lng) {
      return { lat: profile.home_lat, lng: profile.home_lng };
    }
    return null;
  });

  useEffect(() => {
    void getCurrentCoords().then((loc) => {
      if (loc) setCoords(loc);
    });
  }, []);

  const nearbyOpenChallenges = useNearbyOpenChallenges(coords, currentTeam?.sport);
  const myOffers = useMyOffers();
  const applyToChallenge = useApplyToChallenge();
  const [requestingChallengeId, setRequestingChallengeId] = useState<string | null>(null);
  const [showBroadcastBox, setShowBroadcastBox] = useState(false);

  const postOpen = usePostOpenChallenge(currentTeam?.id ?? '');

  const myTeamIds = useMemo(
    () => new Set((myTeams.data ?? []).map((t) => t.id)),
    [myTeams.data],
  );

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    return (candidates.data ?? []).filter((row) => !myTeamIds.has(row.team_id));
  }, [candidates.data, myTeamIds]);

  const openMatches = useMemo(() => {
    return (nearbyOpenChallenges.data ?? []).filter(
      (m) => !myTeamIds.has(m.from_team_id),
    );
  }, [nearbyOpenChallenges.data, myTeamIds]);

  const blipRows = useMemo(() => {
    if (challengeId) {
      return rows.map((r) => ({
        id: r.candidate_id,
        distance_m: r.distance_m,
        rank: r.rank,
      }));
    }
    return openMatches.map((m, idx) => ({
      id: m.challenge_id,
      distance_m: m.distance_m,
      rank: idx + 1,
    }));
  }, [challengeId, rows, openMatches]);

  const radiusM = challenge.data?.search_radius_m ?? selectedRadiusM;
  const radiusKm = formatKm(radiusM);

  const dishSize = Math.min(width - S.lg * 2, 300);
  const radiusPx = dishSize / 2;

  const onCancel = useCallback(() => {
    if (!challengeId) return;
    Alert.alert(
      'Cancel search?',
      'The fixture will be withdrawn and the teams it was offered to will no longer see it.',
      [
        { text: 'Keep searching', style: 'cancel' },
        {
          text: 'Cancel search',
          style: 'destructive',
          onPress: () => {
            cancel.mutate(challengeId, {
              onSuccess: () => {
                setLocalChallengeId(null);
                router.replace('/(tabs)/teams');
              },
              onError: (e: unknown) =>
                Alert.alert(
                  'Cancel search',
                  e instanceof AppError ? e.message : 'Could not withdraw the fixture.',
                ),
            });
          },
        },
      ],
    );
  }, [cancel, challengeId, router]);

  const onBroadcastChallenge = useCallback(async () => {
    if (!currentTeam) {
      Alert.alert('Team needed', 'Please create or pick a squad to search for opponents.');
      return;
    }

    const perSide = DEFAULT_PLAYERS_PER_SIDE[currentTeam.sport] ?? 6;
    const totalSlots = perSide * 2;
    const curCoords = await getCurrentCoords();
    const areaName = (profile?.area_name || currentTeam.home_ground || 'Local Area').trim();

    postOpen.mutate(
      {
        matchName: `${currentTeam.name} Match`,
        areaName,
        dayOffset,
        timeHHmm,
        // The booked slot bounds the session; the schema requires an end time.
        endTimeHHmm: addMinutesHHmm(timeHHmm, DEFAULT_SLOT_DURATION_MIN),
        totalSlots,
        radiusM: selectedRadiusM,
        lat: curCoords?.lat ?? profile?.home_lat ?? undefined,
        lng: curCoords?.lng ?? profile?.home_lng ?? undefined,
      },
      {
        onSuccess: (newChallenge) => {
          setLocalChallengeId(newChallenge.id);
          setElapsed(0);
        },
        onError: (e: unknown) => {
          const msg = e instanceof AppError ? e.message : 'Could not start radar search.';
          Alert.alert('Radar broadcast error', msg);
        },
      },
    );
  }, [currentTeam, profile, dayOffset, timeHHmm, selectedRadiusM, postOpen]);

  const found = challengeId ? rows.length : openMatches.length;
  const interestedApplicants = useMemo(() => {
    return rows.filter((r) => r.status === 'interested');
  }, [rows]);

  /*
    Accepting seats a lineup in the same transaction (`accept_open_challenge`
    takes one), and the lineup picker lives on the poster's Match Offers list.
    Sending the captain there keeps one accept path instead of two that drift.
  */
  const onAcceptApplicant = useCallback(
    (_applicant: ChallengeCandidateFull) => {
      if (!challengeId) return;
      router.push({ pathname: '/teams/offers', params: { challengeId } });
    },
    [challengeId, router],
  );

  const onDeclineApplicant = useCallback(
    (applicant: ChallengeCandidateFull) => {
      if (!challengeId) return;
      declineOpen.mutate(
        { challengeId, teamId: applicant.team_id },
        {
          onSuccess: () => {
            void candidates.refetch();
          },
          onError: (e: unknown) => {
            const msg = e instanceof AppError ? e.message : 'Could not decline this request.';
            Alert.alert('Decline Error', msg);
          },
        },
      );
    },
    [challengeId, declineOpen, candidates],
  );

  const onSendMatchRequest = useCallback(
    (item: NearbyOpenChallenge) => {
      // Find a squad owned by the user that matches this fixture's sport
      const matchingTeam =
        ownedTeams.find((t) => t.id === currentTeam?.id && t.sport === item.sport) ??
        ownedTeams.find((t) => t.sport === item.sport);

      if (!matchingTeam) {
        const sportName = item.sport === 'box_cricket' ? 'Box Cricket' : item.sport;
        Alert.alert(
          'Matching Squad Needed',
          `This match fixture requires a ${sportName} squad. Please create or pick a ${sportName} team to send this request.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Create Team', onPress: () => router.push('/teams/create') },
          ],
        );
        return;
      }

      if (matchingTeam.id === item.from_team_id) {
        Alert.alert(
          'Your Own Match',
          'This open challenge was created by your team. You cannot send a match request to yourself.',
        );
        return;
      }

      if (matchingTeam.id !== currentTeam?.id) {
        setSelectedTeamId(matchingTeam.id);
      }

      setRequestingChallengeId(item.challenge_id);
      applyToChallenge.mutate(
        { challengeId: item.challenge_id, teamId: matchingTeam.id },
        {
          onSuccess: () => {
            setRequestingChallengeId(null);
            Alert.alert(
              'Request Sent! ⚡',
              `Your match request to play against ${item.from_team_name} was sent! Their captain has been notified to review and accept.`,
            );
            void nearbyOpenChallenges.refetch();
            void myOffers.refetch();
          },
          onError: (e: unknown) => {
            setRequestingChallengeId(null);
            const msg =
              e instanceof AppError
                ? e.message
                : (e as { message?: string })?.message || 'Could not send the match request.';
            Alert.alert('Match Request', msg);
          },
        },
      );
    },
    [applyToChallenge, currentTeam, ownedTeams, myOffers, nearbyOpenChallenges, router],
  );

  const onDeclineMatch = useCallback(
    (item: NearbyOpenChallenge) => {
      if (!currentTeam) return;
      const isInterested = item.applied_status === 'interested';
      Alert.alert(
        isInterested ? 'Withdraw request?' : 'Decline match offer?',
        isInterested
          ? `Cancel your match request to ${item.from_team_name}?`
          : `Decline this fixture from ${item.from_team_name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: isInterested ? 'Withdraw' : 'Decline',
            style: 'destructive',
            onPress: () => {
              declineOpen.mutate(
                { challengeId: item.challenge_id, teamId: currentTeam.id },
                {
                  onSuccess: () => {
                    void nearbyOpenChallenges.refetch();
                    void myOffers.refetch();
                  },
                  onError: (e: unknown) => {
                    const msg = e instanceof AppError ? e.message : 'Could not decline this match.';
                    Alert.alert('Decline Match', msg);
                  },
                },
              );
            },
          },
        ],
      );
    },
    [currentTeam, declineOpen, myOffers, nearbyOpenChallenges],
  );

  const stageIndex = STAGES.reduce((acc, s, i) => (elapsed >= s.atSeconds ? i : acc), 0);
  const searchedAndFoundNobody = elapsed >= 10 && found === 0 && !candidates.isLoading && !nearbyOpenChallenges.isLoading;
  const settled = Boolean(challenge.data && challenge.data.status !== 'open');

  const onBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/teams');
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <IconBack color={M.text} />
      </Pressable>
      <View style={styles.headerText}>
        <AppText variant="heading" color={M.text}>
          {challengeId ? 'Finding Opponent' : 'Opponent Radar'}
        </AppText>
      </View>
      <View style={styles.backBtn} />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Squad Selection (when in scanner mode) */}
        {!challengeId && ownedTeams.length > 0 ? (
          <View style={styles.squadPickerWrap}>
            <AppText variant="caption" color={M.muted}>
              SEARCHING WITH SQUAD:
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.squadRow}>
              {ownedTeams.map((t) => {
                const isSelected = currentTeam?.id === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setSelectedTeamId(t.id)}
                    style={[styles.squadChip, isSelected ? styles.squadChipActive : null]}
                    accessibilityRole="button"
                  >
                    <AppText
                      variant="caption"
                      color={isSelected ? M.limeInk : M.text}
                      style={{ fontWeight: isSelected ? '700' : '500' }}
                    >
                      {t.name} ({t.sport === 'box_cricket' ? 'Cricket' : t.sport})
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <AppText variant="body" color={M.muted} center style={styles.lede}>
          {challengeId
            ? radiusKm
              ? `Scanning for opponents within ${radiusKm} km…`
              : 'Scanning for opponent teams…'
            : `Live Radar scanning nearby teams within ${formatKm(selectedRadiusM)} km`}
        </AppText>

        {/* ---------------- The Cricket Stadium Radar Dish ---------------- */}
        <View style={styles.dishWrap}>
          <View
            style={[styles.dish, { width: dishSize, height: dishSize }]}
            accessibilityRole="image"
            accessibilityLabel={`Radar dish scanning ${found} teams`}
          >
            {/* SVG Stadium Grid & Concentric Pitch Crease Rings */}
            <CricketRadarDishGrid size={dishSize} />

            {/* Pulsing Sonar Waves (Staggered, continuous) */}
            {settled ? null : (
              <>
                <RadarPulseRing size={dishSize} delay={0} />
                <RadarPulseRing size={dishSize} delay={SWEEP_MS / 2} />
              </>
            )}

            {/* 360° Rotating Laser Sweep */}
            {settled ? null : <RadarSweepBeam size={dishSize} />}

            {/* Centerpiece 3D Cricket Ball with breathing pulse */}
            <MotiView
              animate={{ scale: settled ? 1 : [1, 1.06, 1] }}
              transition={{
                type: 'timing',
                duration: 1800,
                loop: true,
                easing: Easing.inOut(Easing.ease),
              }}
              style={styles.ballWrap}
              pointerEvents="none"
            >
              <CenterSixfourBall size={58} />
            </MotiView>

            {/* Candidate & Open Match Radar Blips */}
            {blipRows.map((blip) => {
              const { x, y } = blipOffset(blip, radiusM, radiusPx);
              return (
                <MotiView
                  key={blip.id}
                  from={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', damping: 14 }}
                  style={[
                    styles.blipWrap,
                    { left: radiusPx + x - BLIP / 2, top: radiusPx + y - BLIP / 2 },
                  ]}
                >
                  <MotiView
                    from={{ scale: 0.8, opacity: 0.85 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{
                      type: 'timing',
                      duration: 1200,
                      loop: true,
                    }}
                    style={styles.blipPing}
                  />
                  <View style={styles.blipDot} />
                </MotiView>
              );
            })}
          </View>
        </View>

        {/* Radius selector (when in scanner mode) */}
        {!challengeId ? (
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((opt) => {
              const isSelected = selectedRadiusM === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSelectedRadiusM(opt.value)}
                  style={[styles.radiusChip, isSelected ? styles.radiusChipActive : null]}
                  accessibilityRole="button"
                >
                  <AppText
                    variant="caption"
                    color={isSelected ? M.limeInk : M.muted}
                    style={{ fontWeight: isSelected ? '700' : '500' }}
                  >
                    {opt.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* ---------------- Count & Status ---------------- */}
        <View style={styles.countRow}>
          {candidates.isLoading || nearbyOpenChallenges.isLoading ? (
            <ActivityIndicator color={M.green} />
          ) : (
            <IconUsers color={found > 0 ? M.green : M.faint} />
          )}
          <AppText variant="label" color={found > 0 ? M.text : M.muted}>
            {candidates.isLoading || nearbyOpenChallenges.isLoading
              ? 'Checking who was reached…'
              : challengeId
                ? found === 1
                  ? '1 team found'
                  : `${found} teams found`
                : found === 1
                  ? '1 open match offer found'
                  : `${found} open match offers found`}
          </AppText>
        </View>

        {/* ---------------- Incoming Match Requests Section (Host Mode) ---------------- */}
        {challengeId && interestedApplicants.length > 0 ? (
          <View style={styles.applicantSection}>
            <View style={styles.applicantHeaderRow}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 11 }}>
                  MATCH REQUESTS ({interestedApplicants.length})
                </AppText>
              </View>
              <AppText variant="caption" color={M.muted}>
                Opponent teams waiting for your approval
              </AppText>
            </View>

            {interestedApplicants.map((applicant) => (
              <View key={applicant.candidate_id} style={styles.applicantCard}>
                <View style={styles.applicantTopRow}>
                  <View style={styles.applicantBadge}>
                    <IconUsers color={M.limeInk} size={18} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="heading" color={M.text} style={{ fontSize: 16 }}>
                      {applicant.team_name}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      {applicant.matches_played > 0
                        ? `${applicant.matches_played} played · ${applicant.wins} won (${applicant.win_rate}%)`
                        : 'New Squad · Ready to play'}
                      {applicant.distance_m > 0 ? ` · ${(applicant.distance_m / 1000).toFixed(1)} km away` : ''}
                    </AppText>
                  </View>
                </View>

                <View style={styles.applicantActionRow}>
                  <Pressable
                    onPress={() => router.push(`/teams/${applicant.team_id}`)}
                    style={[styles.btn, styles.btnGhost]}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${applicant.team_name} team profile`}
                  >
                    <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                      View Team
                    </AppText>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/chat/[id]',
                        params: {
                          id: challengeId,
                          challengeId,
                          toTeamId: applicant.team_id,
                          teamName: applicant.team_name,
                        },
                      })
                    }
                    style={[styles.btn, styles.btnGhost]}
                    accessibilityRole="button"
                    accessibilityLabel={`Message the captain of ${applicant.team_name}`}
                  >
                    <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                      Message
                    </AppText>
                  </Pressable>

                  <Pressable
                    onPress={() => onDeclineApplicant(applicant)}
                    disabled={declineOpen.isPending}
                    style={styles.applicantDeclineBtn}
                    accessibilityRole="button"
                  >
                    <AppText variant="caption" color={M.danger} style={{ fontWeight: '600' }}>
                      Decline
                    </AppText>
                  </Pressable>

                  <Pressable
                    onPress={() => onAcceptApplicant(applicant)}
                    disabled={declineOpen.isPending}
                    style={styles.applicantAcceptBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Accept ${applicant.team_name} and pick your lineup`}
                  >
                    <AppText variant="label" color={M.limeInk} style={{ fontWeight: '800' }}>
                      ✓ Accept & Fix Match
                    </AppText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* ---------------- Open Match Offers Section (Radar Scanner Mode) ---------------- */}
        {!challengeId ? (
          <View style={styles.matchOffersSection}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 11 }}>
                  MATCH OFFERS FOUND ({openMatches.length})
                </AppText>
              </View>
              <Pressable
                onPress={() => router.push('/teams/offers')}
                accessibilityRole="button"
                accessibilityLabel="View all match offers"
              >
                <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                  View All Offers ({myOffers.data?.length ?? 0}) →
                </AppText>
              </Pressable>
            </View>

            {nearbyOpenChallenges.isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={M.green} />
                <AppText variant="caption" color={M.muted}>
                  Scanning for opponent fixtures nearby…
                </AppText>
              </View>
            ) : openMatches.length > 0 ? (
              openMatches.map((item) => {
                const isInterested = item.applied_status === 'interested';
                const isBusy = requestingChallengeId === item.challenge_id;

                return (
                  <View key={item.challenge_id} style={styles.matchOfferCard}>
                    <View style={styles.matchOfferTopRow}>
                      {item.from_team_logo ? (
                        <Image
                          source={{ uri: item.from_team_logo }}
                          style={styles.teamBadge}
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <View style={styles.teamBadgeFallback}>
                          <AppText variant="label" color={M.limeInk}>
                            {item.from_team_name.trim().slice(0, 1).toUpperCase()}
                          </AppText>
                        </View>
                      )}

                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="heading" color={M.text} style={{ fontSize: 16 }}>
                          {item.from_team_name}
                        </AppText>
                        <AppText variant="caption" color={M.muted}>
                          {item.sport === 'box_cricket' ? 'Box Cricket' : item.sport} · {item.total_slots / 2} v {item.total_slots / 2}
                        </AppText>
                      </View>
                    </View>

                    <View style={styles.matchInfoBlock}>
                      <AppText variant="label" color={M.text}>
                        {item.match_name}
                      </AppText>
                      <AppText variant="caption" color={M.muted}>
                        {formatWhen(item.scheduled_at)}
                      </AppText>
                      <AppText variant="caption" color={M.muted}>
                        {formatDistance(item.distance_m)} · {item.venue_name || item.area_name}
                      </AppText>
                      {item.message ? (
                        <AppText variant="body" color={M.text} style={{ marginTop: 2 }}>
                          {item.message}
                        </AppText>
                      ) : null}
                    </View>

                    {isInterested ? (
                      <View style={styles.requestSentBanner}>
                        <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                          ⚡ Match Request Sent · Waiting for {item.from_team_name} captain to accept
                        </AppText>
                      </View>
                    ) : null}

                    <View style={styles.matchOfferActionRow}>
                      <Pressable
                        onPress={() => router.push(`/teams/${item.from_team_id}`)}
                        style={[styles.btn, styles.btnGhost]}
                        accessibilityRole="button"
                      >
                        <AppText variant="label" color={M.green}>
                          View Details
                        </AppText>
                      </Pressable>

                      {!isInterested ? (
                        <Pressable
                          onPress={() => onSendMatchRequest(item)}
                          disabled={applyToChallenge.isPending || isBusy}
                          accessibilityRole="button"
                          style={[
                            styles.btn,
                            styles.btnPrimary,
                            { opacity: applyToChallenge.isPending || isBusy ? 0.45 : 1 },
                          ]}
                        >
                          {isBusy ? <ActivityIndicator color={M.limeInk} size="small" /> : null}
                          <AppText variant="label" color={M.limeInk} style={{ fontWeight: '700' }}>
                            Send Request
                          </AppText>
                        </Pressable>
                      ) : null}
                    </View>

                    <Pressable
                      onPress={() => onDeclineMatch(item)}
                      disabled={declineOpen.isPending || isBusy}
                      style={styles.matchOfferDeclineBtn}
                      accessibilityRole="button"
                    >
                      <AppText variant="caption" color={M.danger}>
                        {isInterested ? 'Withdraw Request' : 'Decline'}
                      </AppText>
                    </Pressable>
                  </View>
                );
              })
            ) : (
              <View style={styles.noMatchesFoundBox}>
                <AppText variant="label" color={M.text} center>
                  No open match offers nearby
                </AppText>
                <AppText variant="caption" color={M.muted} center>
                  No teams are currently hosting an open match within {formatKm(selectedRadiusM)} km. Broadcast your own challenge below to let opponents find you!
                </AppText>
              </View>
            )}
          </View>
        ) : null}

        {/* ---------------- Stage checklist (for active challenge) ---------------- */}
        {challengeId && !settled && !searchedAndFoundNobody ? (
          <View style={styles.checklist}>
            {STAGES.map((stage, i) => {
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <View key={stage.label} style={styles.checkRow}>
                  <View
                    style={[
                      styles.checkDot,
                      done || active ? styles.checkDotOn : styles.checkDotOff,
                    ]}
                  />
                  <AppText variant="body" color={done || active ? M.text : M.faint}>
                    {stage.label}
                  </AppText>
                  {active ? <ActivityIndicator color={M.green} size="small" /> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* ---------------- Empty state (when challenge active & nobody found) ---------------- */}
        {challengeId && searchedAndFoundNobody && !settled ? (
          <View style={styles.stateBox}>
            <IconSearch color={M.faint} />
            <AppText variant="body" color={M.text} center>
              {radiusKm
                ? `No teams were found within ${radiusKm} km.`
                : 'No teams were found in that area.'}
            </AppText>
            <AppText variant="caption" color={M.muted} center>
              Nobody nearby plays this sport at that time yet. Try a wider area or different time.
            </AppText>
          </View>
        ) : null}

        {/* ---------------- Quick Broadcast Config Box (when in scanner mode) ---------------- */}
        {!challengeId ? (
          <View style={styles.broadcastBox}>
            <Pressable
              onPress={() => setShowBroadcastBox((prev) => !prev)}
              style={styles.broadcastHeaderToggle}
              accessibilityRole="button"
            >
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="label" color={M.text}>
                  ⚡ BROADCAST YOUR OWN CHALLENGE
                </AppText>
                <AppText variant="caption" color={M.muted}>
                  Send instant match offers to all teams in range
                </AppText>
              </View>
              <AppText variant="label" color={M.green}>
                {showBroadcastBox || openMatches.length === 0 ? '▲' : '▼ Expand'}
              </AppText>
            </Pressable>

            {showBroadcastBox || openMatches.length === 0 ? (
              ownedTeams.length === 0 ? (
                <View style={styles.noTeamBox}>
                  <AppText variant="caption" color={M.muted} center>
                    You need a team to search for opponents.
                  </AppText>
                  <Pressable
                    onPress={() => router.push('/teams/create')}
                    style={styles.createTeamBtn}
                    accessibilityRole="button"
                  >
                    <AppText variant="label" color={M.limeInk}>
                      + Create Team
                    </AppText>
                  </Pressable>
                </View>
              ) : (
                <>
                  {/* Day / Time quick toggle */}
                  <View style={styles.timeRow}>
                    <Pressable
                      onPress={() => setDayOffset(0)}
                      style={[styles.timeChip, dayOffset === 0 ? styles.timeChipActive : null]}
                    >
                      <AppText
                        variant="caption"
                        color={dayOffset === 0 ? M.limeInk : M.muted}
                        style={{ fontWeight: dayOffset === 0 ? '700' : '500' }}
                      >
                        Today
                      </AppText>
                    </Pressable>
                    <Pressable
                      onPress={() => setDayOffset(1)}
                      style={[styles.timeChip, dayOffset === 1 ? styles.timeChipActive : null]}
                    >
                      <AppText
                        variant="caption"
                        color={dayOffset === 1 ? M.limeInk : M.muted}
                        style={{ fontWeight: dayOffset === 1 ? '700' : '500' }}
                      >
                        Tomorrow
                      </AppText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const times = ['07:00', '09:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
                        Alert.alert(
                          'Select Match Time',
                          'Choose a start time for your team challenge:',
                          [
                            ...times.map((t) => ({
                              text: t,
                              onPress: () => setTimeHHmm(t),
                            })),
                            { text: 'Cancel', style: 'cancel' },
                          ],
                        );
                      }}
                      style={styles.timeInput}
                      accessibilityRole="button"
                      accessibilityLabel={`Selected start time: ${timeHHmm}. Tap to change.`}
                    >
                      <IconCalendar color={M.green} size={14} />
                      <AppText variant="caption" color={M.text} style={{ fontWeight: '700' }}>
                        {timeHHmm}
                      </AppText>
                    </Pressable>
                  </View>

                  {/* Broadcast CTA */}
                  <Pressable
                    onPress={onBroadcastChallenge}
                    disabled={postOpen.isPending}
                    style={({ pressed }) => [
                      styles.cta,
                      { transform: [{ scale: pressed ? 0.98 : 1 }] },
                    ]}
                    accessibilityRole="button"
                  >
                    {postOpen.isPending ? (
                      <ActivityIndicator color={M.limeInk} />
                    ) : (
                      <AppText variant="label" color={M.limeInk} style={styles.ctaLabel}>
                        ⚡ Start Radar Broadcast
                      </AppText>
                    )}
                  </Pressable>

                  {/* Full wizard secondary button */}
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/match/create',
                        params: {
                          type: 'team_vs_team',
                          teamId: currentTeam?.id,
                          sport: currentTeam?.sport,
                        },
                      })
                    }
                    style={styles.wizardBtn}
                    accessibilityRole="button"
                  >
                    <AppText variant="caption" color={M.green}>
                      Customise in full wizard →
                    </AppText>
                  </Pressable>
                </>
              )
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* ---------------- Footer (when active challenge is running) ---------------- */}
      {challengeId ? (
        <View style={styles.footer}>
          {found > 0 ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/teams/offers', params: { challengeId } })
              }
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cta,
                { transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <AppText variant="label" color={M.limeInk} style={styles.ctaLabel}>
                View Match Offers ({found})
              </AppText>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onCancel}
            disabled={cancel.isPending || settled}
            accessibilityRole="button"
            accessibilityState={{ disabled: cancel.isPending || settled }}
            style={[styles.cancelBtn, { opacity: cancel.isPending || settled ? 0.45 : 1 }]}
          >
            {cancel.isPending ? <ActivityIndicator color={M.danger} /> : null}
            <AppText variant="label" color={M.danger}>
              Cancel Search
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const BLIP = 14;

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.lg,
      paddingVertical: S.sm,
    },
    backBtn: {
      width: TOUCH,
      height: TOUCH,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -S.sm,
    },
    headerText: { flex: 1, alignItems: 'center' },
    scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl, gap: S.md },
    lede: { marginTop: S.xs },

    squadPickerWrap: { gap: S.xs, marginTop: S.xs },
    squadRow: { gap: S.sm, paddingVertical: 4 },
    squadChip: {
      paddingHorizontal: S.md,
      paddingVertical: S.xs,
      borderRadius: R.pill,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    squadChipActive: {
      backgroundColor: M.green,
      borderColor: M.green,
    },

    radiusRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: S.sm,
      marginTop: S.xs,
    },
    radiusChip: {
      paddingHorizontal: S.md,
      paddingVertical: S.xs,
      borderRadius: R.pill,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    radiusChipActive: {
      backgroundColor: M.green,
      borderColor: M.green,
    },

    dishWrap: { alignItems: 'center', marginTop: S.sm },
    dish: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.pill,
      overflow: 'hidden',
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 8,
    },
    pulseRing: {
      position: 'absolute',
      borderRadius: R.pill,
      borderWidth: 1.8,
      borderColor: M.green,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.7,
      shadowRadius: 10,
    },
    ballWrap: {
      position: 'absolute',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.75,
      shadowRadius: 14,
      elevation: 8,
    },
    blipWrap: {
      position: 'absolute',
      width: BLIP,
      height: BLIP,
      alignItems: 'center',
      justifyContent: 'center',
    },
    blipPing: {
      position: 'absolute',
      width: BLIP * 2,
      height: BLIP * 2,
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
    },
    blipDot: {
      width: BLIP,
      height: BLIP,
      borderRadius: R.pill,
      backgroundColor: M.lime,
      borderWidth: 2,
      borderColor: M.bg,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.9,
      shadowRadius: 6,
      elevation: 4,
    },

    countRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      marginTop: S.sm,
    },

    checklist: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
    },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    checkDot: { width: 10, height: 10, borderRadius: R.pill },
    checkDotOn: { backgroundColor: M.green },
    checkDotOff: { backgroundColor: M.border },

    broadcastBox: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
      marginTop: S.sm,
    },
    broadcastHeader: { gap: 2, marginBottom: S.xs },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
    },
    timeChip: {
      flex: 1,
      paddingVertical: S.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: M.bg,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
    },
    timeChipActive: {
      backgroundColor: M.green,
      borderColor: M.green,
    },
    timeInput: {
      flex: 1.2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: S.sm,
      backgroundColor: M.bg,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
    },
    wizardBtn: {
      alignItems: 'center',
      paddingVertical: S.xs,
    },
    noTeamBox: {
      padding: S.md,
      gap: S.sm,
      alignItems: 'center',
    },
    createTeamBtn: {
      paddingHorizontal: S.lg,
      paddingVertical: S.sm,
      borderRadius: R.pill,
      backgroundColor: M.green,
    },

    stateBox: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.lg,
      alignItems: 'center',
      gap: S.md,
    },

    applicantSection: {
      gap: S.sm,
      marginTop: S.sm,
    },
    applicantHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: M.green,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: R.pill,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: M.limeInk,
    },
    applicantCard: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.green,
      padding: S.md,
      gap: S.md,
    },
    applicantTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
    },
    applicantBadge: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applicantActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
    },
    applicantDeclineBtn: {
      paddingHorizontal: S.md,
      paddingVertical: S.sm,
      borderRadius: R.pill,
      borderWidth: 1,
      borderColor: M.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applicantAcceptBtn: {
      flex: 1,
      minHeight: 40,
      backgroundColor: M.green,
      borderRadius: R.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },

    matchOffersSection: {
      gap: S.sm,
      marginTop: S.sm,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
    },
    loadingBox: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.lg,
      alignItems: 'center',
      gap: S.sm,
    },
    matchOfferCard: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
    },
    matchOfferTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
    },
    teamBadge: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: M.card,
    },
    teamBadgeFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },
    matchInfoBlock: {
      gap: 2,
      paddingVertical: 2,
    },
    requestSentBanner: {
      backgroundColor: 'rgba(152, 187, 1, 0.12)',
      borderRadius: R.md,
      paddingHorizontal: S.sm,
      paddingVertical: S.xs,
      borderWidth: 1,
      borderColor: 'rgba(152, 187, 1, 0.3)',
    },
    matchOfferActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      marginTop: 2,
    },
    matchOfferDeclineBtn: {
      alignItems: 'center',
      paddingVertical: 4,
      marginTop: 2,
    },
    btn: {
      minHeight: 38,
      paddingHorizontal: S.md,
      borderRadius: R.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnGhost: {
      borderWidth: 1,
      borderColor: M.green,
    },
    btnPrimary: {
      flex: 1,
      backgroundColor: M.green,
    },
    noMatchesFoundBox: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.lg,
      alignItems: 'center',
      gap: S.xs,
    },
    broadcastHeaderToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    footer: {
      paddingHorizontal: S.lg,
      paddingTop: S.sm,
      paddingBottom: S.lg,
      backgroundColor: M.bg,
      borderTopWidth: 1,
      borderTopColor: M.border,
      gap: S.sm,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
      backgroundColor: M.green,
      borderRadius: R.pill,
    },
    ctaLabel: { fontSize: 16 },
    cancelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      minHeight: TOUCH,
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.danger,
    },
  });
