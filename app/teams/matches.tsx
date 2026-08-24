/**
 * Booked & Scheduled Matches screen.
 * Shows all upcoming, live, and completed matches booked or joined by the user / their teams.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import { useAllMyBookedMatches, useCancelMatch } from '@features/matches/presentation/useMatches';
import { useMyChallenges } from '@features/teams/presentation/useChallenges';
import type { ChallengeListItem } from '@features/teams/domain/challengeSchema';
import type { Match } from '@features/matches/domain/matchSchema';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import {
  IconBack,
  IconCalendar,
  IconClock,
  IconPin,
  IconPlus,
} from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';

const TOUCH = 44;

type FilterTab = 'upcoming' | 'live' | 'completed' | 'all';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'live', label: 'Live' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All Matches' },
];

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

function getMatchCategory(m: Match): 'upcoming' | 'live' | 'completed' | 'cancelled' {
  if (m.status === 'cancelled') return 'cancelled';
  if (m.status === 'completed') return 'completed';

  const scheduledMs = Date.parse(m.scheduled_at);
  const nowMs = Date.now();
  const endMs = m.end_time ? Date.parse(m.end_time) : scheduledMs + 3 * 60 * 60 * 1000;

  if (nowMs >= scheduledMs && nowMs <= endMs) return 'live';
  if (scheduledMs > nowMs) return 'upcoming';
  return 'completed';
}

const DEFAULT_BADGE = { label: 'UPCOMING', bg: 'rgba(34, 197, 94, 0.14)', color: '#22C55E' };

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  upcoming: DEFAULT_BADGE,
  live: { label: '⚡ LIVE', bg: 'rgba(234, 179, 8, 0.20)', color: '#EAB308' },
  completed: { label: 'COMPLETED', bg: 'rgba(255, 255, 255, 0.10)', color: '#9CA3AF' },
  cancelled: { label: 'CANCELLED', bg: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' },
};

function MatchCard({
  match,
  myRole,
  cancelling,
  onPress,
  onCancel,
}: {
  match: Match;
  myRole: 'creator' | 'player';
  cancelling?: boolean;
  onPress: () => void;
  onCancel: (m: Match) => void;
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const category = getMatchCategory(match);
  const badge = STATUS_BADGE[category] ?? DEFAULT_BADGE;
  const isCancelled = match.status === 'cancelled';
  const isCompleted = match.status === 'completed';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { transform: [{ scale: pressed ? 0.99 : 1 }] },
        isCancelled ? styles.cardCancelled : null,
      ]}
      accessibilityRole="button"
    >
      <View style={styles.cardHeader}>
        <Image source={SPORT_IMAGE[match.sport]} style={styles.sportThumb} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.titleRow}>
            <AppText variant="heading" color={M.text} numberOfLines={1} style={{ fontSize: 16, flex: 1 }}>
              {match.match_name || 'Match'}
            </AppText>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <AppText variant="caption" color={badge.color} style={{ fontWeight: '800', fontSize: 10 }}>
                {badge.label}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" color={M.muted}>
            {match.sport === 'box_cricket' ? '🏏 Box Cricket' : '🏸 Badminton'} · {match.total_slots} slots
            {myRole === 'creator' ? ' · (Organiser)' : ''}
          </AppText>
        </View>
      </View>

      <View style={styles.cardDetails}>
        <View style={styles.detailRow}>
          <IconClock color={M.green} size={14} />
          <AppText variant="caption" color={M.text}>
            {formatWhen(match.scheduled_at)}
          </AppText>
        </View>
        <View style={styles.detailRow}>
          <IconPin color={M.green} size={14} />
          <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ flex: 1 }}>
            {match.venue_text || match.area_name || 'Local Ground'}
          </AppText>
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          onPress={onPress}
          style={[styles.btn, styles.btnPrimary]}
          accessibilityRole="button"
        >
          <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '700' }}>
            {isCompleted ? 'View Scorecard' : 'Open Match →'}
          </AppText>
        </Pressable>

        {myRole === 'creator' && !isCancelled && !isCompleted ? (
          <Pressable
            onPress={() => onCancel(match)}
            disabled={cancelling}
            style={[styles.btn, styles.btnDanger]}
            accessibilityRole="button"
          >
            {cancelling ? (
              <ActivityIndicator color={M.danger} size="small" />
            ) : (
              <AppText variant="caption" color={M.danger} style={{ fontWeight: '600' }}>
                Cancel
              </AppText>
            )}
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function ChallengeSearchingCard({
  challenge,
  M,
  styles,
  onPress,
}: {
  challenge: ChallengeListItem;
  M: MockPalette;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}): React.ReactNode {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { borderColor: '#E8FF59', borderWidth: 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Active challenge: ${challenge.match_name}. Tap to view live radar.`}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.sportThumb, { backgroundColor: '#202028', alignItems: 'center', justifyContent: 'center' }]}>
          <AppText style={{ fontSize: 18 }}>⚡</AppText>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.titleRow}>
            <AppText variant="heading" color={M.text} numberOfLines={1} style={{ fontSize: 16, flex: 1 }}>
              {challenge.match_name || 'Team Challenge'}
            </AppText>
            <View style={[styles.badge, { backgroundColor: '#202028' }]}>
              <AppText variant="caption" color="#E8FF59" style={{ fontWeight: '800', fontSize: 10 }}>
                {challenge.direction === 'outgoing' ? '⚡ LIVE RADAR' : '⚡ MATCH OFFER'}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" color={M.muted}>
            {challenge.direction === 'outgoing'
              ? 'Searching for opponents nearby…'
              : 'Incoming match challenge awaiting your reply'}
          </AppText>
        </View>
      </View>

      <View style={styles.cardDetails}>
        <View style={styles.detailRow}>
          <IconClock color={M.green} size={14} />
          <AppText variant="caption" color={M.text}>
            {formatWhen(challenge.scheduled_at)}
          </AppText>
        </View>
        {challenge.venue_name ? (
          <View style={styles.detailRow}>
            <IconPin color={M.green} size={14} />
            <AppText variant="caption" color={M.muted} numberOfLines={1} style={{ flex: 1 }}>
              {challenge.venue_name}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={[styles.actionRow, { marginTop: S.xs }]}>
        <View style={{ flex: 1 }} />
        <View style={[styles.btn, styles.btnPrimary, { backgroundColor: '#E8FF59' }]}>
          <AppText variant="caption" color="#000" style={{ fontWeight: '800' }}>
            {challenge.direction === 'outgoing' ? 'View Live Radar →' : 'View Offers →'}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

export default function BookedMatchesScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const bookedMatches = useAllMyBookedMatches();
  const challenges = useMyChallenges();
  const [tab, setTab] = useState<FilterTab>('upcoming');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const rawList = useMemo(() => bookedMatches.data ?? [], [bookedMatches.data]);

  const activeChallenges = useMemo(() => {
    return (challenges.data ?? []).filter(
      (c) => c.status === 'open' || c.status === 'pending',
    );
  }, [challenges.data]);

  const filteredList = useMemo(() => {
    return rawList.filter((item) => {
      const category = getMatchCategory(item.match);
      if (tab === 'upcoming') return category === 'upcoming';
      if (tab === 'live') return category === 'live';
      if (tab === 'completed') return category === 'completed';
      return true; // 'all'
    });
  }, [rawList, tab]);

  const showOpenChallenges = (tab === 'upcoming' || tab === 'all') && activeChallenges.length > 0;
  const upcomingCount = useMemo(() => {
    return (
      rawList.filter((i) => getMatchCategory(i.match) === 'upcoming').length +
      activeChallenges.length
    );
  }, [rawList, activeChallenges.length]);

  const cancelMatch = useCancelMatch();

  const onCancelMatch = useCallback(
    (m: Match) => {
      Alert.alert(
        'Cancel this match?',
        `Are you sure you want to cancel "${m.match_name}"? All players will be notified.`,
        [
          { text: 'Keep Match', style: 'cancel' },
          {
            text: 'Cancel Match',
            style: 'destructive',
            onPress: () => {
              setCancellingId(m.id);
              cancelMatch.mutate(m.id, {
                onSettled: () => {
                  void bookedMatches.refetch();
                  setCancellingId(null);
                },
              });
            },
          },
        ],
      );
    },
    [bookedMatches, cancelMatch],
  );

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/teams');
  };

  const onOpenChallenge = (c: ChallengeListItem) => {
    if (c.direction === 'outgoing') {
      router.push({
        pathname: '/match/create/searching',
        params: { challengeId: c.id },
      });
    } else {
      router.push('/teams/offers');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
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
            Booked & Scheduled Matches
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {upcomingCount} upcoming fixture{upcomingCount === 1 ? '' : 's'}
          </AppText>
        </View>
        <Pressable
          onPress={() => router.push('/match/create')}
          style={styles.createIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Create match"
        >
          <IconPlus color={M.limeInk} size={20} />
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {TABS.map((t) => {
          const isSelected = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabChip, isSelected ? styles.tabChipActive : null]}
              accessibilityRole="button"
            >
              <AppText
                variant="caption"
                color={isSelected ? M.limeInk : M.muted}
                style={{ fontWeight: isSelected ? '700' : '500' }}
              >
                {t.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* List / Empty State */}
      {bookedMatches.isLoading || challenges.isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={M.green} size="large" />
          <AppText color={M.muted}>Loading scheduled matches…</AppText>
        </View>
      ) : filteredList.length === 0 && !showOpenChallenges ? (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIconCircle}>
            <IconCalendar color={M.green} size={32} />
          </View>
          <AppText variant="heading" color={M.text} center style={{ fontSize: 18 }}>
            No {tab !== 'all' ? tab : ''} matches found
          </AppText>
          <AppText variant="body" color={M.muted} center style={{ maxWidth: 280 }}>
            {tab === 'upcoming'
              ? 'You have no upcoming matches scheduled. Post a match or challenge a team!'
              : 'Matches you participate in or organise will appear here.'}
          </AppText>

          <Pressable
            onPress={() => router.push('/match/create')}
            style={styles.emptyCta}
            accessibilityRole="button"
          >
            <AppText variant="label" color={M.limeInk}>
              + Create a Match
            </AppText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.match.id}
          contentContainerStyle={styles.list}
          refreshing={bookedMatches.isRefetching || challenges.isRefetching}
          onRefresh={() => {
            void bookedMatches.refetch();
            void challenges.refetch();
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            showOpenChallenges ? (
              <View style={{ gap: S.sm, marginBottom: filteredList.length > 0 ? S.sm : 0 }}>
                {activeChallenges.map((c) => (
                  <ChallengeSearchingCard
                    key={c.id}
                    challenge={c}
                    M={M}
                    styles={styles}
                    onPress={() => onOpenChallenge(c)}
                  />
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <MatchCard
              match={item.match}
              myRole={item.myRole}
              cancelling={cancellingId === item.match.id}
              onPress={() => {
                if (item.match.status === 'completed') router.push(`/match/${item.match.id}/result`);
                else router.push(`/match/${item.match.id}`);
              }}
              onCancel={onCancelMatch}
            />
          )}
        />
      )}
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
      paddingVertical: S.sm,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    backBtn: {
      width: TOUCH,
      height: TOUCH,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -S.sm,
    },
    headerText: { flex: 1, alignItems: 'center' },
    createIconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },

    tabsRow: {
      flexDirection: 'row',
      gap: S.xs,
      paddingHorizontal: S.lg,
      paddingVertical: S.sm,
    },
    tabChip: {
      flex: 1,
      paddingVertical: S.xs + 2,
      borderRadius: R.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    tabChipActive: {
      backgroundColor: M.green,
      borderColor: M.green,
    },

    list: {
      paddingHorizontal: S.lg,
      paddingTop: S.sm,
      paddingBottom: S.xl,
      gap: S.md,
    },

    card: {
      backgroundColor: M.card,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: M.border,
      padding: S.md,
      gap: S.md,
    },
    cardCancelled: {
      opacity: 0.6,
      borderColor: M.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
    },
    sportThumb: {
      width: 50,
      height: 50,
      borderRadius: 14,
      backgroundColor: M.cardHi,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: S.sm,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: R.pill,
    },

    cardDetails: {
      gap: 6,
      backgroundColor: M.bg,
      padding: S.sm,
      borderRadius: R.md,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },

    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
    },
    btn: {
      paddingVertical: 10,
      paddingHorizontal: S.md,
      borderRadius: R.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPrimary: {
      flex: 1,
      backgroundColor: M.green,
    },
    btnDanger: {
      borderWidth: 1,
      borderColor: M.danger,
      backgroundColor: 'transparent',
    },

    centerBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.md,
    },
    emptyBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: S.xl,
      gap: S.md,
    },
    emptyIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: M.card,
      borderWidth: 1.5,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: S.xs,
    },
    emptyCta: {
      marginTop: S.sm,
      paddingHorizontal: S.xl,
      paddingVertical: S.sm + 2,
      borderRadius: R.pill,
      backgroundColor: M.green,
    },
  });
