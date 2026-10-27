import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useSportLabel } from '@features/sports/presentation/useSports';
import {
  formatCourtLabel,
  formatSlotWindow,
  formatSlotWindowWithDuration,
} from '@features/venues/domain/slotUtils';
import { openMapDirections } from '@features/venues/domain/mapDirections';
import type { VenueBooking } from '@features/venues/domain/venueBookingSchema';
import {
  useCancelBooking,
  useMyBookings,
} from '@features/venues/presentation/useVenueBookings';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import {
  IconBadminton,
  IconCalendar,
  IconClock,
  IconClose,
  IconCricket,
  IconDirections,
  IconPin,
} from '@shared/ui/icons';

export interface MyBookingsModalProps {
  visible: boolean;
  onClose: () => void;
  onBrowseVenues?: () => void;
  timezone?: string;
  style?: StyleProp<ViewStyle>;
}

type TabKey = 'upcoming' | 'past';

function formatBookingDate(isoDateString: string): string {
  try {
    const d = new Date(isoDateString);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(d);
    }
  } catch {
    // fallback to original
  }
  return isoDateString.split('T')[0] ?? isoDateString;
}

export function MyBookingsModal({
  visible,
  onClose,
  onBrowseVenues,
  timezone = 'Asia/Kolkata',
}: MyBookingsModalProps): React.ReactNode {
  const M = useMock();
  // Clears the home indicator / gesture bar, and stops a long sheet
  // running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const sportLabel = useSportLabel();

  const [activeTab, setActiveTab] = useState<TabKey>('upcoming');
  const { data: bookings, isLoading, isError, refetch } = useMyBookings();
  const cancelBooking = useCancelBooking();

  const nowMs = Date.now();

  const upcomingBookings = useMemo(() => {
    if (!bookings) return [];
    return bookings.filter((b) => {
      const isConfirmed = b.status === 'confirmed';
      const isFuture = new Date(b.endTime).getTime() >= nowMs;
      return isConfirmed && isFuture;
    });
  }, [bookings, nowMs]);

  const pastBookings = useMemo(() => {
    if (!bookings) return [];
    return bookings.filter((b) => {
      const isCancelled = b.status === 'cancelled';
      const isElapsed = new Date(b.endTime).getTime() < nowMs;
      return isCancelled || isElapsed;
    });
  }, [bookings, nowMs]);

  const displayedBookings = activeTab === 'upcoming' ? upcomingBookings : pastBookings;

  const handleCancelBooking = (booking: VenueBooking) => {
    Alert.alert(
      'Cancel Ground Booking?',
      'Are you sure you want to cancel this booking? The slot will immediately become available for other players.',
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: () => {
            cancelBooking.mutate(booking.id, {
              onSuccess: () => {
                Alert.alert(
                  'Booking Cancelled',
                  'Your court booking has been cancelled and the slot has been released.',
                );
              },
              onError: (err) => {
                Alert.alert('Cancellation Failed', err.message || 'Could not cancel booking.');
              },
            });
          },
        },
      ],
    );
  };

  const handleOpenLinkedMatch = (matchId: string) => {
    onClose();
    router.push(`/match/${matchId}`);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, sheetInsets]}>
          {/* Drag Handle */}
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <AppText variant="heading" color={M.text} style={styles.headerTitle}>
                My Ground Bookings
              </AppText>
              <AppText variant="caption" color={M.muted}>
                Manage your court slots and instant cancellations
              </AppText>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close bookings modal"
              style={styles.closeBtn}
            >
              <IconClose color={M.muted} size={22} />
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={styles.tabsRow}>
            <Pressable
              style={[styles.tabBtn, activeTab === 'upcoming' && styles.tabBtnActive]}
              onPress={() => setActiveTab('upcoming')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'upcoming' }}
            >
              <AppText
                variant="label"
                color={activeTab === 'upcoming' ? M.green : M.muted}
                style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}
              >
                Upcoming ({upcomingBookings.length})
              </AppText>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, activeTab === 'past' && styles.tabBtnActive]}
              onPress={() => setActiveTab('past')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'past' }}
            >
              <AppText
                variant="label"
                color={activeTab === 'past' ? M.green : M.muted}
                style={[styles.tabText, activeTab === 'past' && styles.tabTextActive]}
              >
                Past / Cancelled ({pastBookings.length})
              </AppText>
            </Pressable>
          </View>

          {/* Bookings List */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {isLoading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={M.green} />
                <AppText variant="caption" color={M.muted} style={{ marginTop: S.sm }}>
                  Loading bookings...
                </AppText>
              </View>
            ) : isError ? (
              <View style={styles.centerBox}>
                <AppText variant="caption" color={M.danger}>
                  Could not load your bookings.
                </AppText>
                <Button
                  label="Retry"
                  variant="secondary"
                  onPress={() => void refetch()}
                />
              </View>
            ) : displayedBookings.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <IconCalendar color={M.muted} size={36} />
                </View>
                <AppText variant="heading" color={M.text} style={styles.emptyTitle}>
                  {activeTab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}
                </AppText>
                <AppText variant="caption" color={M.muted} center style={styles.emptySubtitle}>
                  {activeTab === 'upcoming'
                    ? "You haven't booked any ground slots yet. Explore available venues to book a court."
                    : 'Your completed or cancelled ground bookings will be listed here.'}
                </AppText>
                {activeTab === 'upcoming' && (
                  <View style={{ marginTop: S.md }}>
                    <Button
                      label="Browse Venues"
                      variant="primary"
                      onPress={() => {
                        onClose();
                        onBrowseVenues?.();
                      }}
                    />
                  </View>
                )}
              </View>
            ) : (
              displayedBookings.map((booking) => {
                const isConfirmed = booking.status === 'confirmed';
                const isPast = new Date(booking.endTime).getTime() < nowMs;
                const courtLabel = formatCourtLabel(booking.courtNumber, booking.sportTypes);
                const timeWindow =
                  formatSlotWindowWithDuration(booking.startTime, booking.endTime, timezone) ||
                  `${booking.startTime.slice(11, 16)} – ${booking.endTime.slice(11, 16)}`;
                const displayDate = formatBookingDate(booking.startTime);

                return (
                  <View
                    key={booking.id}
                    style={[
                      styles.bookingCard,
                      !isConfirmed && styles.bookingCardCancelled,
                    ]}
                  >
                    {/* Top Row: Venue Name & Status */}
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="heading" color={M.text} style={styles.venueName} numberOfLines={1}>
                          {booking.venueName ?? 'Venue Ground'}
                        </AppText>
                        {booking.venueAddress ? (
                          <View style={styles.metaRow}>
                            <IconPin color={M.muted} size={13} />
                            <AppText variant="caption" color={M.muted} numberOfLines={1}>
                              {booking.venueAddress}
                            </AppText>
                          </View>
                        ) : null}
                      </View>

                      <View
                        style={[
                          styles.statusBadge,
                          isConfirmed
                            ? isPast
                              ? styles.statusBadgePast
                              : styles.statusBadgeConfirmed
                            : styles.statusBadgeCancelled,
                        ]}
                      >
                        <AppText
                          variant="caption"
                          color={
                            isConfirmed
                              ? isPast
                                ? M.muted
                                : M.green
                              : M.danger
                          }
                          style={styles.statusBadgeText}
                        >
                          {isConfirmed ? (isPast ? 'COMPLETED' : 'CONFIRMED') : 'CANCELLED'}
                        </AppText>
                      </View>
                    </View>

                    {/* Middle Row: Court & Date/Time */}
                    <View style={styles.slotInfoBox}>
                      <View style={styles.slotDetailRow}>
                        <View style={styles.detailItem}>
                          <AppText variant="caption" color={M.muted} style={styles.detailLabel}>
                            COURT / BOX
                          </AppText>
                          <AppText variant="label" color={M.text} style={styles.detailValue}>
                            {courtLabel}
                          </AppText>
                        </View>

                        <View style={styles.detailDivider} />

                        <View style={styles.detailItem}>
                          <AppText variant="caption" color={M.muted} style={styles.detailLabel}>
                            DATE
                          </AppText>
                          <View style={styles.iconValRow}>
                            <IconCalendar color={M.muted} size={13} />
                            <AppText variant="label" color={M.text} style={styles.detailValue}>
                              {displayDate}
                            </AppText>
                          </View>
                        </View>

                        <View style={styles.detailDivider} />

                        <View style={styles.detailItem}>
                          <AppText variant="caption" color={M.muted} style={styles.detailLabel}>
                            TIME SLOT
                          </AppText>
                          <View style={styles.iconValRow}>
                            <IconClock color={M.green} size={13} />
                            <AppText variant="label" color={M.green} style={styles.timeValue}>
                              {timeWindow}
                            </AppText>
                          </View>
                        </View>
                      </View>
                    </View>

                    {/* Sports chips if available */}
                    {booking.sportTypes && booking.sportTypes.length > 0 && (
                      <View style={styles.sportsRow}>
                        {booking.sportTypes.map((sport) => {
                          const isCricket = sport.includes('cricket');
                          return (
                            <View key={sport} style={styles.sportChip}>
                              {isCricket ? (
                                <IconCricket color={M.muted} size={13} />
                              ) : (
                                <IconBadminton color={M.muted} size={13} />
                              )}
                              <AppText variant="caption" color={M.muted} style={{ fontSize: 11 }}>
                                {sportLabel(sport as any)}
                              </AppText>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Linked Match Indicator */}
                    {booking.matchId ? (
                      <Pressable
                        style={styles.linkedMatchPill}
                        onPress={() => handleOpenLinkedMatch(booking.matchId!)}
                        accessibilityRole="button"
                        accessibilityLabel="View linked match"
                      >
                        <AppText variant="caption" color={M.limeInk} style={styles.linkedMatchText}>
                          Linked to Match · Tap to view match details →
                        </AppText>
                      </Pressable>
                    ) : null}

                    {/* Actions: Directions & Cancel if upcoming and confirmed */}
                    <View style={styles.cardActionsRow}>
                      <Pressable
                        style={styles.directionsBtn}
                        onPress={() => {
                          void openMapDirections({
                            lat: booking.venueLat,
                            lng: booking.venueLng,
                            address: booking.venueAddress,
                            name: booking.venueName,
                          });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Get Directions"
                      >
                        {/*
                          M.green, not M.limeInk: limeInk is ink for text ON a
                          green fill (white in light mode), and this button is
                          a light card -- it rendered white on white. Same bug
                          on the active tab label above.
                        */}
                        <IconDirections size={16} color={M.green} />
                        <AppText variant="label" color={M.green} style={styles.directionsBtnText}>
                          Get Directions
                        </AppText>
                      </Pressable>

                      {isConfirmed && !isPast && (
                        <View style={styles.cardActions}>
                          <Button
                            label="Cancel Booking"
                            variant="danger"
                            loading={cancelBooking.isPending && cancelBooking.variables === booking.id}
                            onPress={() => handleCancelBooking(booking)}
                          />
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: M.bg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: S.sm,
      paddingBottom: Platform.OS === 'ios' ? 34 : S.lg,
      maxHeight: '92%',
    },
    handleWrap: {
      alignItems: 'center',
      paddingVertical: 6,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: M.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: S.lg,
      paddingBottom: S.sm,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    headerTitleWrap: {
      flex: 1,
      gap: 2,
    },
    headerTitle: {
      fontSize: 19,
      fontWeight: '700',
    },
    closeBtn: {
      padding: S.xs,
    },
    tabsRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: M.border,
      paddingHorizontal: S.lg,
      backgroundColor: M.card,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: S.md,
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabBtnActive: {
      borderBottomColor: M.green,
    },
    tabText: {
      fontSize: 13,
      fontWeight: '600',
    },
    tabTextActive: {
      fontWeight: '700',
    },
    scrollContent: {
      paddingHorizontal: S.lg,
      paddingTop: S.md,
      paddingBottom: S.xl,
      gap: S.md,
    },
    centerBox: {
      padding: S.xl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
    },
    emptyState: {
      paddingVertical: S.xl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
    },
    emptyIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: M.cardHi,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: S.sm,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
    },
    emptySubtitle: {
      maxWidth: 280,
      lineHeight: 18,
    },
    bookingCard: {
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
    },
    bookingCardCancelled: {
      opacity: 0.75,
      borderColor: M.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: S.sm,
    },
    venueName: {
      fontSize: 16,
      fontWeight: '700',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    statusBadge: {
      paddingHorizontal: S.sm,
      paddingVertical: 4,
      borderRadius: R.pill,
      borderWidth: 1,
    },
    statusBadgeConfirmed: {
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
      borderColor: 'rgba(34, 197, 94, 0.4)',
    },
    statusBadgePast: {
      backgroundColor: M.cardHi,
      borderColor: M.border,
    },
    statusBadgeCancelled: {
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
      borderColor: 'rgba(239, 68, 68, 0.4)',
    },
    statusBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    slotInfoBox: {
      backgroundColor: M.cardHi,
      borderRadius: R.sm,
      padding: S.sm,
      borderWidth: 1,
      borderColor: M.border,
    },
    slotDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    detailItem: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    detailLabel: {
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    detailValue: {
      fontSize: 12,
      fontWeight: '600',
    },
    timeValue: {
      fontSize: 11,
      fontWeight: '700',
    },
    iconValRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    detailDivider: {
      width: 1,
      height: 24,
      backgroundColor: M.border,
    },
    sportsRow: {
      flexDirection: 'row',
      gap: S.xs,
      flexWrap: 'wrap',
    },
    sportChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: S.sm,
      paddingVertical: 3,
      borderRadius: R.pill,
      backgroundColor: M.chip,
    },
    linkedMatchPill: {
      backgroundColor: M.green,
      paddingHorizontal: S.sm,
      paddingVertical: 6,
      borderRadius: R.sm,
      alignItems: 'center',
    },
    linkedMatchText: {
      fontWeight: '700',
      fontSize: 12,
    },
    cardActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: S.sm,
      marginTop: S.xs,
    },
    // Same height and width as the Cancel Booking button beside it, so the
    // two actions read as a pair instead of a small chip next to a big slab.
    directionsBtn: {
      flex: 1,
      minHeight: 52, // Button's own minHeight
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: S.md,
      borderRadius: R.md,
      borderWidth: 1.5,
      borderColor: M.green,
    },
    directionsBtnText: {
      fontWeight: '700',
      fontSize: 14,
    },
    cardActions: {
      flex: 1,
    },
  });
