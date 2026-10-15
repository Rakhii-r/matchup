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
  ScrollView,
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
import { CalendarArt, RoundBack, StadiumBackdrop } from '@shared/ui/decor';
import {
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconCheckCircle,
  IconClock,
  IconGrid,
  IconLive,
  IconPin,
  IconPlus,
  type IconProps,
} from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';

const TOUCH = 44;

type FilterTab = 'upcoming' | 'live' | 'completed' | 'all';

const TABS: { key: FilterTab; label: string; Icon: (p: IconProps) => React.ReactNode }[] = [
  { key: 'upcoming', label: 'Upcoming', Icon: IconCalendar },
  { key: 'live', label: 'Live', Icon: IconLive },
  { key: 'completed', label: 'Completed', Icon: IconCheckCircle },
  { key: 'all', label: 'All Games', Icon: IconGrid },
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

function getMatchCategory(m: Match): 'searching' | 'upcoming' | 'live' | 'completed' | 'cancelled' {
  if (m.status === 'cancelled') return 'cancelled';
  // Its time ran out with no result. Not 'cancelled' (nobody called it off) and
  // not 'live' -- the clock below would otherwise still read it as in progress.
  if (m.status === 'expired') return 'completed';
  if (m.status === 'completed') return 'completed';
  if (m.status === 'open') return 'searching';

  const scheduledMs = Date.parse(m.scheduled_at);
  const nowMs = Date.now();
  const endMs = m.end_time ? Date.parse(m.end_time) : scheduledMs + 3 * 60 * 60 * 1000;

  if (nowMs >= scheduledMs && nowMs <= endMs) return 'live';
  if (scheduledMs > nowMs) return 'upcoming';
  return 'completed';
}

type Category = ReturnType<typeof getMatchCategory>;

const STATUS_LABEL: Record<Category, string> = {
  searching: 'SEARCHING OPPONENTS',
  upcoming: 'UPCOMING',
  live: 'LIVE',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

/** Badge colours from the active palette, so both themes stay legible. */
function statusTone(category: Category, M: MockPalette): { bg: string; color: string } {
  if (category === 'live') return { bg: 'rgba(245, 158, 11, 0.16)', color: '#B45309' };
  if (category === 'cancelled') return { bg: `${M.danger}1F`, color: M.danger };
  if (category === 'completed') return { bg: M.cardHi, color: M.muted };
  return { bg: M.chip, color: M.green };
}

function MatchCard({
  match,
  myRole,
  cancelling,
  onPress,
  onOpenRadar,
  onCancel,
}: {
  match: Match;
  myRole: 'creator' | 'player';
  cancelling?: boolean;
  onPress: () => void;
  onOpenRadar?: (challengeId: string) => void;
  onCancel: (m: Match) => void;
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const category = getMatchCategory(match);
  const badge = { ...statusTone(category, M), label: STATUS_LABEL[category] };
  const isCancelled = match.status === 'cancelled';
  const isCompleted = match.status === 'completed';
  const isSearching = match.status === 'open';

  const handleCardPress = () => {
    if (isSearching && match.challenge_id && onOpenRadar) {
      onOpenRadar(match.challenge_id);
    } else {
      onPress();
    }
  };

  return (
    <Pressable
      onPress={handleCardPress}
      style={({ pressed }) => [
        styles.card,
        isSearching ? { borderColor: M.green } : null,
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
              {match.match_name || 'Game'}
            </AppText>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <AppText variant="caption" color={badge.color} style={{ fontWeight: '800', fontSize: 10 }}>
                {badge.label}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" color={M.muted}>
            {match.sport === 'box_cricket' ? 'Box Cricket' : 'Badminton'} · {match.total_slots} slots
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
        {isSearching && match.challenge_id && onOpenRadar ? (
          <Pressable
            onPress={() => onOpenRadar(match.challenge_id as string)}
            style={[styles.btn, styles.btnPrimary]}
            accessibilityRole="button"
          >
            <IconBolt color={M.limeInk} size={14} />
            <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800' }}>
              View Live Radar
            </AppText>
          </Pressable>
        ) : (
          <Pressable
            onPress={onPress}
            style={[styles.btn, styles.btnPrimary]}
            accessibilityRole="button"
          >
            <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '700' }}>
              {isCompleted ? 'View Scorecard' : isSearching ? 'View Game Details' : 'Open Game'}
            </AppText>
          </Pressable>
        )}

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
  const isOutgoing = challenge.direction === 'outgoing';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          borderColor: M.green,
          backgroundColor: M.chip,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Active challenge search: ${challenge.match_name}. Tap to view live radar.`}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.sportThumb, styles.thumbIcon]}>
          <IconBolt color={M.limeInk} size={22} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.titleRow}>
            <AppText variant="heading" color={M.text} numberOfLines={1} style={{ fontSize: 16, flex: 1 }}>
              {challenge.match_name || 'Team Challenge'}
            </AppText>
            <View style={[styles.badge, { backgroundColor: M.card }]}>
              <AppText variant="caption" color={M.green} style={{ fontWeight: '800', fontSize: 10 }}>
                {isOutgoing ? 'LIVE RADAR SEARCH' : 'GAME OFFER'}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" color={M.green} style={{ fontWeight: '600' }}>
            {isOutgoing
              ? 'Actively scanning nearby teams on Radar…'
              : 'Incoming game challenge awaiting your reply'}
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
        <View style={[styles.btn, styles.btnPrimary]}>
          <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800' }}>
            {isOutgoing ? 'Open Live Radar Scanner' : 'View Offers'}
          </AppText>
          <IconArrowRight color={M.limeInk} size={14} />
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
        'Cancel this game?',
        `Are you sure you want to cancel "${m.match_name}"? All players will be notified.`,
        [
          { text: 'Keep Game', style: 'cancel' },
          {
            text: 'Cancel Game',
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
        <RoundBack onPress={onBack} />
        <View style={styles.headerText}>
          <AppText variant="heading" color={M.text} numberOfLines={1} style={styles.headerTitle}>
            Booked & Scheduled Games
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {upcomingCount} upcoming fixture{upcomingCount === 1 ? '' : 's'}
          </AppText>
        </View>
        <Pressable
          onPress={() => router.push('/match/create')}
          style={styles.createIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Create game"
        >
          <IconPlus color={M.limeInk} size={22} strokeWidth={2.4} />
        </Pressable>
      </View>

      {/* Tabs */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {TABS.map((t) => {
            const isSelected = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.tabChip, isSelected ? styles.tabChipActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <t.Icon color={isSelected ? M.limeInk : M.text} size={18} />
                <AppText
                  variant="caption"
                  color={isSelected ? M.limeInk : M.text}
                  style={{ fontSize: 14, fontWeight: isSelected ? '700' : '500' }}
                >
                  {t.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* List / Empty State */}
      {bookedMatches.isLoading || challenges.isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={M.green} size="large" />
          <AppText color={M.muted}>Loading scheduled games…</AppText>
        </View>
      ) : filteredList.length === 0 && !showOpenChallenges ? (
        <View style={styles.emptyBox}>
          <StadiumBackdrop height={170} net={false} />
          <CalendarArt size={230} />
          <AppText variant="heading" color={M.text} center style={styles.emptyTitle}>
            No {tab !== 'all' ? `${tab} ` : ''}matches found
          </AppText>
          <AppText variant="body" color={M.muted} center style={{ maxWidth: 300 }}>
            {tab === 'upcoming'
              ? 'You have no upcoming games scheduled. Post a game or challenge a team!'
              : 'Games you participate in or organise will appear here.'}
          </AppText>

          <Pressable
            onPress={() => router.push('/match/create')}
            style={styles.emptyCta}
            accessibilityRole="button"
            accessibilityLabel="Create a game"
          >
            <IconPlus color={M.limeInk} size={20} strokeWidth={2.4} />
            <AppText variant="label" color={M.limeInk} style={{ fontSize: 16 }}>
              Create a Game
            </AppText>
            <IconArrowRight color={M.limeInk} size={20} />
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
              onOpenRadar={(challengeId) => {
                router.push({
                  pathname: '/match/create/searching',
                  params: { challengeId },
                });
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
      gap: S.sm,
      paddingHorizontal: S.md,
      paddingVertical: S.sm,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    headerText: { flex: 1, alignItems: 'center', minWidth: 0 },
    headerTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 18 },
    createIconBtn: {
      width: TOUCH,
      height: TOUCH,
      borderRadius: TOUCH / 2,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },

    tabsRow: {
      flexDirection: 'row',
      gap: S.sm,
      paddingHorizontal: S.md,
      paddingVertical: S.sm + 4,
    },
    tabChip: {
      flexDirection: 'row',
      gap: 6,
      minHeight: TOUCH,
      paddingHorizontal: S.md,
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
      borderWidth: 1,
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
    thumbIcon: { backgroundColor: M.green, alignItems: 'center', justifyContent: 'center' },
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
      backgroundColor: M.cardHi,
      padding: S.sm + 2,
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
      flexDirection: 'row',
      gap: 6,
      minHeight: TOUCH,
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
    emptyTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 22 },
    emptyCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm + 4,
      marginTop: S.md,
      minHeight: 58,
      paddingHorizontal: S.xl,
      borderRadius: R.pill,
      backgroundColor: M.green,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 6,
    },
  });
