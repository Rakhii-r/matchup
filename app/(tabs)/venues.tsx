import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';

import { useVenues } from '@features/venues/presentation/useVenues';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { CourtSlotPickerSheet } from '@features/venues/presentation/CourtSlotPickerSheet';
import { MyBookingsModal } from '@features/venues/presentation/MyBookingsModal';
import { useMyBookings } from '@features/venues/presentation/useVenueBookings';
import type { VenueBooking } from '@features/venues/domain/venueBookingSchema';
import type { Venue } from '@features/venues/domain/venueSchema';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useTabContentPadding } from '@shared/theme/responsive';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import {
  IconCalendar,
  IconClose,
  IconDirections,
  IconPin,
  IconSearch,
  IconSliders,
} from '@shared/ui/icons';
import { venueImage } from '@shared/ui/sportImages';

function openDirections(v: Venue): void {
  const label = encodeURIComponent(v.name);
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}&query_place_id=${label}`);
}

function callVenue(phone: string): void {
  void Linking.openURL(`tel:${phone}`);
}

const SPORT_FILTERS: { value: Sport | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'box_cricket', label: 'Cricket' },
  { value: 'badminton', label: 'Badminton' },
];

export default function VenuesScreen(): React.ReactNode {
  const M = useMock();
  // Reserve the tab bar plus the device's bottom inset, or the last card in
  // this list sits underneath the bar.
  const tabContentPadding = useTabContentPadding();
  const styles = useMemo(() => makeStyles(M), [M]);
  const { data: venues, isLoading, isError, refetch, isRefetching } = useVenues();
  const sportLabel = useSportLabel();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedVenueForBooking, setSelectedVenueForBooking] = useState<Venue | null>(null);
  const [isMyBookingsVisible, setIsMyBookingsVisible] = useState(false);

  const myBookingsQuery = useMyBookings();

  /*
    The badge counts bookings that have not finished yet, which means it depends
    on the clock as well as on the data. Reading the clock during render was
    both impure and, in practice, stale: the memo only recomputed when the query
    returned a NEW array, so a booking that ended while the tab sat open kept
    its place in the count. The cutoff is state now, refreshed whenever the tab
    is focused -- which is also when React Query refetches.
  */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNowMs(Date.now()), []));

  const activeBookingsCount = useMemo(() => {
    if (!myBookingsQuery.data) return 0;
    return myBookingsQuery.data.filter(
      (b) => b.status === 'confirmed' && new Date(b.endTime).getTime() >= nowMs,
    ).length;
  }, [myBookingsQuery.data, nowMs]);

  const handleBookingSuccess = (booking: VenueBooking) => {
    setSelectedVenueForBooking(null);
    Alert.alert(
      'Slot Confirmed! 🎉',
      `Your court booking at ${booking.venueName ?? selectedVenueForBooking?.name ?? 'the ground'} is confirmed!`,
      [
        { text: 'Done', style: 'cancel' },
        {
          text: 'View in My Bookings',
          onPress: () => setIsMyBookingsVisible(true),
        },
      ],
    );
  };

  const filteredVenues = useMemo(() => {
    if (!venues) return [];
    let list = venues;
    if (selectedSport) {
      list = list.filter((v) => v.sport_types.includes(selectedSport));
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((v) => {
      const matchName = v.name?.toLowerCase().includes(q);
      const matchAddress = v.address?.toLowerCase().includes(q);
      const matchSports = v.sport_types?.some((s) =>
        s.toLowerCase().includes(q) || sportLabel(s).toLowerCase().includes(q),
      );
      return matchName || matchAddress || matchSports;
    });
  }, [venues, searchQuery, selectedSport, sportLabel]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <AppLogo variant="icon" width={48} style={{ borderRadius: 12 }} />
        <Pressable
          style={styles.myBookingsHeaderBtn}
          onPress={() => setIsMyBookingsVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="My Ground Bookings"
          hitSlop={8}
        >
          <View style={styles.headerBtnContent}>
            <IconCalendar color={activeBookingsCount > 0 ? M.green : M.text} size={18} />
            <AppText
              variant="caption"
              color={activeBookingsCount > 0 ? M.green : M.text}
              style={{ fontWeight: '700', fontSize: 12 }}
            >
              My Bookings
            </AppText>
          </View>
          {activeBookingsCount > 0 && (
            <View style={styles.badgePill}>
              <AppText variant="caption" color={M.limeInk} style={styles.badgeCountText}>
                {activeBookingsCount}
              </AppText>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabContentPadding }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={M.green} />
        }
      >
        <AppText variant="title" color={M.text} style={{ fontSize: 28, fontWeight: '800' }}>
          Find a Venue
        </AppText>
        <AppText color={M.muted} style={{ marginTop: S.xs, marginBottom: S.lg }}>
          Cricket and badminton courts near you.
        </AppText>

        <View style={styles.searchField}>
          <IconSearch color={M.muted} size={18} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search for arenas, turfs, or areas..."
            placeholderTextColor={M.muted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search for arenas, turfs, or areas"
          />
          {searchQuery.length > 0 ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
            >
              <IconClose color={M.muted} size={16} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setShowFilters((prev) => !prev)}
            hitSlop={8}
            style={[styles.filterBtn, (showFilters || selectedSport !== null) && styles.filterBtnActive]}
            accessibilityRole="button"
            accessibilityLabel="Toggle sport filters"
          >
            <IconSliders color={selectedSport !== null || showFilters ? M.green : M.muted} size={18} />
          </Pressable>
        </View>

        {showFilters || selectedSport !== null ? (
          <View style={styles.filterRow}>
            {SPORT_FILTERS.map((f) => {
              const active = selectedSport === f.value;
              return (
                <Pressable
                  key={f.label}
                  onPress={() => setSelectedSport(f.value)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <AppText
                    variant="caption"
                    color={active ? M.limeInk : M.text}
                    style={{ fontWeight: active ? '700' : '400' }}
                  >
                    {f.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={M.green} />
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <AppText color={M.muted}>Could not load venues.</AppText>
            <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
              <AppText variant="label" color={M.text}>
                Try again
              </AppText>
            </Pressable>
          </View>
        ) : (venues ?? []).length === 0 ? (
          <View style={styles.center}>
            <AppText color={M.muted}>No venues listed yet.</AppText>
          </View>
        ) : filteredVenues.length === 0 ? (
          <View style={styles.center}>
            <AppText color={M.muted}>No venues match your search.</AppText>
            <Pressable
              style={styles.retryBtn}
              onPress={() => {
                setSearchQuery('');
                setSelectedSport(null);
              }}
            >
              <AppText variant="label" color={M.text}>
                Clear filters
              </AppText>
            </Pressable>
          </View>
        ) : (
          filteredVenues.map((v) => (
            <View key={v.id} style={styles.card}>
              <ImageBackground source={venueImage(v)} style={styles.imageWrap}>
                <LinearGradient
                  colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </ImageBackground>

              <View style={styles.cardBody}>
                <AppText variant="heading" color={M.text} style={{ fontSize: 19 }}>
                  {v.name}
                </AppText>

                {v.address ? (
                  <View style={styles.metaRow}>
                    <IconPin color={M.muted} size={14} />
                    <AppText variant="caption" color={M.muted} style={{ marginLeft: 4, flex: 1 }}>
                      {v.address}
                    </AppText>
                  </View>
                ) : null}

                <View style={styles.chips}>
                  {v.sport_types.map((s) => (
                    <View key={s} style={styles.chip}>
                      <AppText variant="caption" color={M.muted}>
                        {sportLabel(s)}
                      </AppText>
                    </View>
                  ))}
                </View>

                <AppText variant="caption" color={M.muted} style={{ marginTop: S.sm }}>
                  {v.confirm_note ?? 'Instant court slot booking available'}
                </AppText>

                <View style={styles.actions}>
                  <Pressable
                    style={styles.bookSlotBtn}
                    onPress={() => setSelectedVenueForBooking(v)}
                    accessibilityRole="button"
                    accessibilityLabel={`Book court at ${v.name}`}
                  >
                    <AppText variant="label" color={M.limeInk} style={{ fontWeight: '700' }}>
                      Book Court
                    </AppText>
                  </Pressable>
                  <Pressable
                    style={[styles.callBtn, !v.phone && styles.bookBtnDisabled]}
                    disabled={!v.phone}
                    onPress={() => v.phone && callVenue(v.phone)}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${v.name}`}
                  >
                    <AppText variant="caption" color={v.phone ? M.text : M.muted}>
                      {v.phone ? 'Call' : 'No phone'}
                    </AppText>
                  </Pressable>
                  <Pressable style={styles.dirBtn} onPress={() => openDirections(v)}>
                    <IconDirections color={M.text} size={20} />
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <CourtSlotPickerSheet
        visible={selectedVenueForBooking !== null}
        venue={selectedVenueForBooking}
        onClose={() => setSelectedVenueForBooking(null)}
        onBookingSuccess={handleBookingSuccess}
      />

      <MyBookingsModal
        visible={isMyBookingsVisible}
        onClose={() => setIsMyBookingsVisible(false)}
        onBrowseVenues={() => setIsMyBookingsVisible(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    minHeight: 48,
    marginBottom: S.md,
  },
  searchInput: {
    flex: 1,
    color: M.text,
    fontSize: 14,
    marginLeft: S.sm,
    marginRight: S.xs,
    paddingVertical: S.sm,
  },
  clearBtn: {
    padding: S.xs,
    marginRight: S.xs,
  },
  filterBtn: {
    padding: S.xs,
    borderRadius: R.sm,
  },
  filterBtnActive: {
    backgroundColor: M.cardHi,
  },
  filterRow: {
    flexDirection: 'row',
    gap: S.sm,
    marginBottom: S.lg,
  },
  filterChip: {
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: M.card,
    borderWidth: 1,
    borderColor: M.border,
  },
  filterChipActive: {
    backgroundColor: M.green,
    borderColor: M.green,
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: S.md, paddingTop: S.xl },
  retryBtn: {
    borderWidth: 1,
    borderColor: M.border,
    borderRadius: R.sm,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
  },
  card: {
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    overflow: 'hidden',
    marginBottom: S.lg,
  },
  imageWrap: { height: 140 },
  cardBody: { padding: S.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: S.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  chip: {
    backgroundColor: M.chip,
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: 4,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md },
  bookSlotBtn: {
    flex: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: M.green,
    borderRadius: R.sm,
    paddingVertical: S.md,
  },
  callBtn: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: M.cardHi,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: M.border,
    paddingVertical: S.md,
  },
  bookBtnDisabled: { opacity: 0.5 },
  dirBtn: {
    width: 48,
    height: 48,
    borderRadius: R.sm,
    borderWidth: 1.5,
    borderColor: M.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myBookingsHeaderBtn: {
    position: 'relative',
    backgroundColor: M.cardHi,
    borderWidth: 1,
    borderColor: M.border,
    borderRadius: R.pill,
    paddingHorizontal: S.sm + 2,
    paddingVertical: 6,
  },
  headerBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgePill: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: M.green,
    borderRadius: R.pill,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeCountText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
