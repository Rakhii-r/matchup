import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useRouter } from 'expo-router';

import { getCurrentCoords } from '@core/location/location';
import type { Coords } from '@core/location/location';
import { useMyMatches, useNearbyMatches } from '@features/matches/presentation/useMatches';
import { SPORT_LABEL } from '@features/matches/domain/matchSchema';
import type { Match } from '@features/matches/domain/matchSchema';
import type { MatchStatus, Sport } from '@shared/types/database.types';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import { IconClock, IconGear, IconPin, IconPlus, IconSend } from '@shared/ui/icons';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${hh}:${mm}`;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const SPORT_IMAGE: Record<Sport, number> = {
  box_cricket: require('../../assets/images/cricket.jpg') as number,
  badminton: require('../../assets/images/badminton.jpg') as number,
};
/* eslint-enable @typescript-eslint/no-require-imports */

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
}: {
  onPress: () => void;
  style?: object;
  children: React.ReactNode;
}): React.ReactNode {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  return (
    <Pressable
      onPress={onPress}
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
  const opacity = useRef(new Animated.Value(0.35)).current;
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
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyMarkerWrap}>
        <Animated.View
          style={[styles.emptyRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
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
        <IconPlus color="#06230F" size={18} />
        <AppText variant="label" color="#06230F" style={{ fontSize: 15, marginLeft: 6 }}>
          Create Match
        </AppText>
      </ScalePressable>
    </View>
  );
}

export default function NearbyScreen(): React.ReactNode {
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(true);
  const [sport, setSport] = useState<Sport | null>(null);

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
  const myMatches = useMyMatches();

  // Real rows only, de-duplicated. When there are none, the empty state shows.
  const list = useMemo<Match[]>(() => dedupeById(nearby.data ?? []), [nearby.data]);

  const goCreate = () =>
    router.push({ pathname: '/match/create', params: sport ? { sport } : {} });

  const openMatch = (item: Match) => {
    router.push({ pathname: '/match/[id]', params: { id: item.id } });
  };

  // Which non-list state (if any) to show under the header. When null, the list
  // of match cards renders instead.
  const busy = locating || (coords != null && nearby.isLoading);
  const showCards = !busy && !nearby.isError && !(coords != null && list.length === 0);
  const data = showCards ? list : [];

  const renderItem = ({ item }: { item: Match }) => {
    const filled = item.filled_slots;
    const total = item.total_slots;
    const pct = total > 0 ? Math.min(1, filled / total) : 0;
    const isOpen = item.status === 'open';
    const title = item.notes?.trim() ? item.notes.trim() : SPORT_LABEL[item.sport];
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

        {item.venue_text ? (
          <View style={styles.metaRow}>
            <IconPin color={M.muted} size={14} />
            <AppText variant="caption" color={M.muted} style={{ flex: 1 }}>
              {item.venue_text}
            </AppText>
          </View>
        ) : null}

        <View style={styles.slotsRow}>
          <AppText variant="label" color={M.text}>
            {filled}/{total} Players
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {item.missing_count} {item.missing_count === 1 ? 'spot' : 'spots'} left
          </AppText>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>

        <ScalePressable onPress={() => openMatch(item)} style={styles.joinBtn}>
          <AppText variant="label" color={M.text}>
            Join Match
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
        <ScalePressable onPress={() => router.push('/profile/edit')} style={styles.gearBtn}>
          <IconGear color={M.text} size={20} />
        </ScalePressable>
      </View>

      <View style={styles.intro}>
        <AppText variant="title" color={M.text} style={{ fontSize: 26 }}>
          Matches near you
        </AppText>
        <AppText variant="caption" color={M.muted}>
          {sport === null
            ? 'Showing all sports — tap a sport to filter'
            : `Showing ${SPORT_LABEL[sport]} only`}
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
          <IconPlus color="#06230F" size={18} />
          <AppText
            variant="label"
            color="#06230F"
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

      {/* My matches — matches you created, so you can always get back to them */}
      {(myMatches.data?.length ?? 0) > 0 ? (
        <View style={{ marginBottom: S.lg }}>
          <AppText variant="label" color={M.text} style={styles.listHeading}>
            My matches
          </AppText>
          {(myMatches.data ?? []).map((m) => (
            <ScalePressable key={m.id} onPress={() => openMatch(m)} style={styles.mineRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="label" color={M.text}>
                  {m.notes?.trim() ? m.notes.trim() : SPORT_LABEL[m.sport]}
                </AppText>
                <AppText variant="caption" color={M.muted}>
                  {formatWhen(m.scheduled_at)} · {STATUS_LABEL[m.status]}
                </AppText>
              </View>
              <AppText variant="caption" color={M.muted}>
                {m.filled_slots}/{m.total_slots}
              </AppText>
            </ScalePressable>
          ))}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: S.xs,
  },
  gearBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
    alignItems: 'center',
    justifyContent: 'center',
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
  mineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
    marginBottom: S.sm,
  },
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
});
