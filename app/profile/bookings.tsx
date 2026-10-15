import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import {
  useCancelBooking,
  useMyBookings,
} from '@features/venues/presentation/useVenueBookings';
import {
  formatBookingDateClean,
  formatCourtLabel,
  formatSlotWindowWithDuration,
} from '@features/venues/domain/slotUtils';
import { openMapDirections } from '@features/venues/domain/mapDirections';
import type { VenueBooking } from '@features/venues/domain/venueBookingSchema';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import {
  IconBack,
  IconCalendar,
  IconClock,
  IconDirections,
  IconPin,
} from '@shared/ui/icons';

export default function MyBookingsScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();

  const { data: bookings, isLoading, isError, refetch, isRefetching } = useMyBookings();
  const cancelBooking = useCancelBooking();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const onCancelPress = (booking: VenueBooking) => {
    const courtLabel = formatCourtLabel(booking.courtNumber, booking.sportTypes);
    const dateLabel =
      formatBookingDateClean(booking.startTime) ||
      new Date(booking.startTime).toLocaleDateString();
    Alert.alert(
      'Cancel Court Booking',
      `Are you sure you want to cancel your booking for ${courtLabel} on ${dateLabel}? This will immediately free the slot for others.`,
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: () => {
            setCancellingId(booking.id);
            cancelBooking.mutate(booking.id, {
              onSuccess: () => {
                setCancellingId(null);
                Alert.alert('Booking Cancelled', 'Your court slot has been successfully cancelled and released.');
              },
              onError: (err) => {
                setCancellingId(null);
                Alert.alert('Cancellation Failed', err.message || 'Could not cancel booking.');
              },
            });
          },
        },
      ],
    );
  };

  const renderBookingItem = ({ item }: { item: VenueBooking }) => {
    const isCancelled = item.status === 'cancelled';
    const isPast = new Date(item.endTime).getTime() < Date.now();
    const isBusy = cancellingId === item.id;

    const courtLabel = formatCourtLabel(item.courtNumber, item.sportTypes);
    const dateFormatted =
      formatBookingDateClean(item.startTime) ||
      new Date(item.startTime).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    const timeFormatted =
      formatSlotWindowWithDuration(item.startTime, item.endTime) ||
      `${new Date(item.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} - ${new Date(item.endTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

    const handleDirections = () => {
      void openMapDirections({
        lat: item.venueLat,
        lng: item.venueLng,
        address: item.venueAddress,
        name: item.venueName,
      });
    };

    return (
      <View style={[styles.card, isCancelled && styles.cardCancelled]}>
        {/* Header: Venue Name & Status */}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <AppText variant="label" color={M.text} style={styles.venueName} numberOfLines={1}>
              {item.venueName ?? 'Venue Booking'}
            </AppText>
            <View style={styles.courtBadgeRow}>
              <View style={styles.courtBadge}>
                <AppText variant="caption" color={M.green} style={styles.courtBadgeText}>
                  {courtLabel}
                </AppText>
              </View>
              {item.matchId ? (
                <AppText variant="caption" color={M.green} style={{ fontWeight: '600', fontSize: 11 }}>
                  Linked to Match Fixture
                </AppText>
              ) : null}
            </View>
          </View>
          <View
            style={[
              styles.statusBadge,
              isCancelled
                ? styles.statusBadgeCancelled
                : isPast
                  ? styles.statusBadgePast
                  : styles.statusBadgeActive,
            ]}
          >
            <AppText
              variant="caption"
              color={isCancelled ? M.muted : isPast ? M.muted : M.limeInk}
              style={{ fontWeight: '700', fontSize: 11 }}
            >
              {isCancelled ? 'CANCELLED' : isPast ? 'COMPLETED' : 'CONFIRMED'}
            </AppText>
          </View>
        </View>

        {/* Address */}
        {item.venueAddress ? (
          <View style={styles.metaRow}>
            <IconPin color={M.muted} size={14} />
            <AppText variant="caption" color={M.muted} style={styles.metaText} numberOfLines={1}>
              {item.venueAddress}
            </AppText>
          </View>
        ) : null}

        {/* Date */}
        <View style={styles.metaRow}>
          <IconCalendar color={M.muted} size={15} />
          <AppText variant="caption" color={M.text} style={styles.metaText}>
            {dateFormatted}
          </AppText>
        </View>

        {/* Time with duration */}
        <View style={styles.metaRow}>
          <IconClock color={M.muted} size={15} />
          <AppText variant="caption" color={M.text} style={styles.metaText}>
            {timeFormatted}
          </AppText>
        </View>

        {item.notes ? (
          <AppText variant="caption" color={M.muted} style={{ marginTop: S.xs }}>
            Note: {item.notes}
          </AppText>
        ) : null}

        {/* Actions Row: Get Directions & Cancel */}
        <View style={styles.actionsRow}>
          <Pressable
            style={styles.directionsBtn}
            onPress={handleDirections}
            accessibilityRole="button"
            accessibilityLabel="Get Directions"
          >
            <IconDirections size={16} color={M.limeInk} />
            <AppText variant="caption" color={M.limeInk} style={styles.directionsBtnText}>
              Get Directions
            </AppText>
          </Pressable>

          {!isCancelled && !isPast ? (
            <Pressable
              style={styles.cancelBtn}
              disabled={isBusy}
              onPress={() => onCancelPress(item)}
              accessibilityRole="button"
            >
              {isBusy ? (
                <ActivityIndicator color={M.danger} size="small" />
              ) : (
                <AppText variant="label" color={M.danger}>
                  Cancel Booking
                </AppText>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          hitSlop={8}
          style={styles.backBtn}
          accessibilityRole="button"
        >
          <IconBack color={M.text} />
        </Pressable>
        <AppText variant="heading" color={M.text} style={styles.headerTitle}>
          My Court Bookings
        </AppText>
        <View style={{ width: 36 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={M.green} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <AppText color={M.muted}>Could not load your bookings.</AppText>
          <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
            <AppText variant="label" color={M.text}>
              Try Again
            </AppText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={bookings ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderBookingItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={M.green} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <AppText variant="label" color={M.text} style={{ fontSize: 18 }}>
                No Bookings Yet
              </AppText>
              <AppText variant="caption" color={M.muted} style={{ textAlign: 'center', marginTop: S.xs }}>
                When you reserve a turf or badminton court slot, it will appear here.
              </AppText>
              <Pressable
                style={styles.exploreBtn}
                onPress={() => router.push('/(tabs)/venues')}
                accessibilityRole="button"
              >
                <AppText variant="label" color={M.limeInk} style={{ fontWeight: '700' }}>
                  Explore Venues
                </AppText>
              </Pressable>
            </View>
          }
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
      paddingHorizontal: S.md,
      paddingVertical: S.md,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    list: { padding: S.lg, paddingBottom: S.xl },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl, gap: S.md },
    card: {
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      marginBottom: S.md,
      gap: S.xs,
    },
    cardCancelled: {
      opacity: 0.6,
      borderColor: M.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: S.xs,
    },
    venueName: { fontSize: 16, fontWeight: '700' },
    courtBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.xs,
      marginTop: 3,
    },
    courtBadge: {
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: 'rgba(34, 197, 94, 0.3)',
      alignSelf: 'flex-start',
    },
    courtBadgeText: {
      fontWeight: '700',
      fontSize: 11,
    },
    statusBadge: {
      paddingHorizontal: S.sm,
      paddingVertical: 3,
      borderRadius: R.sm,
    },
    statusBadgeActive: { backgroundColor: M.green },
    statusBadgeCancelled: { backgroundColor: M.cardHi },
    statusBadgePast: { backgroundColor: M.cardHi },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: 2 },
    metaText: { fontSize: 13 },
    actionsRow: {
      marginTop: S.sm,
      paddingTop: S.sm,
      borderTopWidth: 1,
      borderTopColor: M.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    directionsBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: M.cardHi,
      paddingVertical: 6,
      paddingHorizontal: S.sm,
      borderRadius: R.sm,
      borderWidth: 1,
      borderColor: M.border,
    },
    directionsBtnText: {
      fontWeight: '700',
      fontSize: 12,
    },
    cancelBtn: {
      paddingVertical: S.xs,
      paddingHorizontal: S.md,
      borderRadius: R.sm,
      borderWidth: 1,
      borderColor: M.danger,
    },
    retryBtn: {
      borderWidth: 1,
      borderColor: M.border,
      borderRadius: R.sm,
      paddingHorizontal: S.lg,
      paddingVertical: S.sm,
    },
    exploreBtn: {
      backgroundColor: M.green,
      paddingHorizontal: S.lg,
      paddingVertical: S.md,
      borderRadius: R.md,
      marginTop: S.sm,
    },
  });
