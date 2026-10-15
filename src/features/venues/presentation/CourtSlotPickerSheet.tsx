import React, { useEffect, useMemo, useState } from 'react';
import {
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  computeSlotRange,
  formatCourtLabel,
  formatDateIso,
  formatSlotWindow,
} from '@features/venues/domain/slotUtils';
import type {
  VenueBooking,
  VenueSlot,
} from '@features/venues/domain/venueBookingSchema';
import { BookingModal } from '@features/venues/presentation/BookingModal';
import { CourtPicker } from '@features/venues/presentation/CourtPicker';
import { DateStrip } from '@features/venues/presentation/DateStrip';
import { TimeSlotGrid } from '@features/venues/presentation/TimeSlotGrid';
import { useVenueSlots } from '@features/venues/presentation/useVenueBookings';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { IconBox, IconCalendar, IconClock, IconClose, IconPin, type IconProps } from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';
import type { Sport } from '@shared/types/database.types';
import { LinearGradient } from 'expo-linear-gradient';

const SPORT_NAME: Record<Sport, string> = { box_cricket: 'Box Cricket', badminton: 'Badminton' };

/** The venue's first listed sport, when it is one this build has artwork for. */
function primarySport(sportTypes: string[] | undefined): Sport {
  const first = sportTypes?.[0];
  return first === 'badminton' ? 'badminton' : 'box_cricket';
}

export interface CourtSlotPickerVenue {
  id: string;
  name: string;
  address?: string | null;
  sport_types?: string[];
  courts_count?: number;
  price_per_hour?: number | null;
  phone?: string | null;
  operating_hours_start?: string;
  operating_hours_end?: string;
  slot_duration_minutes?: number;
}

export interface CourtSlotPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  venue: CourtSlotPickerVenue | null;
  initialDate?: string; // YYYY-MM-DD
  initialCourt?: number;
  matches?: Array<{
    id: string;
    title?: string;
    sport?: string;
    scheduled_at?: string;
  }>;
  initialMatchId?: string | null;
  onBookingSuccess?: (booking: VenueBooking) => void;
  timezone?: string;
  style?: StyleProp<ViewStyle>;
}

const DURATION_OPTIONS = [
  { minutes: 60, label: '1 hr' },
  { minutes: 90, label: '1.5 hrs' },
  { minutes: 120, label: '2 hrs' },
  { minutes: 150, label: '2.5 hrs' },
  { minutes: 180, label: '3 hrs' },
];

/**
 * Compound sheet integrating DateStrip, CourtPicker, TimeSlotGrid,
 * and launches the BookingModal on slot selection.
 * Reusable across the Venues directory tab and the Match Ground selection flow.
 */
export function CourtSlotPickerSheet({
  visible,
  onClose,
  venue,
  initialDate,
  initialCourt = 1,
  matches,
  initialMatchId = null,
  onBookingSuccess,
  timezone = 'Asia/Kolkata',
}: CourtSlotPickerSheetProps): React.ReactNode {
  const M = useMock();
  // Clears the home indicator / gesture bar, and stops a long sheet
  // running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  const styles = useMemo(() => makeStyles(M), [M]);

  // Lazily, so "today" is not computed during render. It is re-derived every
  // time the sheet opens (below) because the sheet stays MOUNTED between opens:
  // a value frozen at first mount shows yesterday to anyone who left the app
  // open overnight.
  const [selectedDate, setSelectedDate] = useState<string>(
    () => initialDate ?? formatDateIso(new Date()),
  );
  const [selectedCourt, setSelectedCourt] = useState<number>(initialCourt);
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [selectedSlot, setSelectedSlot] = useState<VenueSlot | null>(null);
  const [modalSlot, setModalSlot] = useState<VenueSlot | null>(null);
  const [isBookingModalVisible, setIsBookingModalVisible] = useState(false);

  // Sync initial props on show
  useEffect(() => {
    if (visible) {
      setSelectedDate(initialDate ?? formatDateIso(new Date()));
      if (initialCourt) setSelectedCourt(initialCourt);
      setSelectedSlot(null);
      setModalSlot(null);
      setIsBookingModalVisible(false);
    }
  }, [visible, initialDate, initialCourt]);

  // Fetch slots for selected date & venue
  const slotsQuery = useVenueSlots(venue?.id, selectedDate, timezone);

  // Filter slots for active court
  const courtSlots = useMemo(() => {
    if (!slotsQuery.data) return [];
    return slotsQuery.data.filter((s) => s.courtNumber === selectedCourt);
  }, [slotsQuery.data, selectedCourt]);

  // Synchronize selectedSlot with refetched slot data (e.g. after a conflict occurs).
  // If the slot is no longer available, automatically clear selectedSlot so it is not highlighted.
  useEffect(() => {
    if (selectedSlot && courtSlots.length > 0) {
      const current = courtSlots.find(
        (s) => s.courtNumber === selectedSlot.courtNumber && s.startTime === selectedSlot.startTime,
      );
      if (!current || !current.isAvailable) {
        setSelectedSlot(null);
      }
    }
  }, [courtSlots, selectedSlot]);

  // Continuous slot calculation for requested duration
  const rangeCalc = useMemo(() => {
    if (!selectedSlot) return null;
    return computeSlotRange(selectedSlot, durationMinutes, courtSlots, timezone);
  }, [selectedSlot, durationMinutes, courtSlots, timezone]);

  if (!venue) {
    return null;
  }

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    setSelectedSlot(null);
  };

  const handleSelectCourt = (courtNumber: number) => {
    setSelectedCourt(courtNumber);
    setSelectedSlot(null);
  };

  const handleSelectSlot = (slot: VenueSlot) => {
    setSelectedSlot(slot);
  };

  const handleOpenBookingModal = () => {
    if (!selectedSlot || !rangeCalc || !rangeCalc.isValid) return;
    const bookingSlot: VenueSlot = {
      ...selectedSlot,
      endTime: rangeCalc.endTime,
      endTimeHhmm: rangeCalc.endTimeHhmm,
    };
    setModalSlot(bookingSlot);
    setIsBookingModalVisible(true);
  };

  const handleBookingConfirmed = (booking: VenueBooking) => {
    setIsBookingModalVisible(false);
    setModalSlot(null);
    setSelectedSlot(null);
    onBookingSuccess?.(booking);
    onClose();
  };

  const handleConflictRecovery = () => {
    // Clear selectedSlot so the taken slot does not remain highlighted or selected
    setSelectedSlot(null);
    setModalSlot(null);
    setIsBookingModalVisible(false);
  };

  const handleCloseBookingModal = () => {
    setIsBookingModalVisible(false);
    setModalSlot(null);
  };

  const courtLabel = formatCourtLabel(selectedCourt, venue.sport_types);
  const sport = primarySport(venue.sport_types);

  const sectionHead = (
    Icon: (p: IconProps) => React.ReactNode,
    title: string,
    right?: React.ReactNode,
  ): React.ReactNode => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Icon color={M.text} size={18} />
        <AppText variant="label" color={M.text} style={styles.sectionTitle}>
          {title}
        </AppText>
      </View>
      {right}
    </View>
  );
  const durationHours = durationMinutes / 60;
  const durationLabel = durationHours === 1 ? '1 hr' : `${durationHours} hrs`;
  const slotWindow = selectedSlot && rangeCalc
    ? `${formatSlotWindow(selectedSlot.startTime, rangeCalc.endTime, timezone) || `${selectedSlot.timeHhmm} – ${rangeCalc.endTimeHhmm}`} (${durationLabel})`
    : null;
  const totalPrice = venue.price_per_hour ? Math.round(durationHours * venue.price_per_hour) : null;

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={[styles.sheet, sheetInsets]}>
            {/* Drag Handle Indicator */}
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>

            {/* Sheet Header: venue photo with the name over it */}
            <ImageBackground
              source={SPORT_IMAGE[sport]}
              style={styles.hero}
              imageStyle={styles.heroImage}
            >
              <LinearGradient
                colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.78)']}
                style={[StyleSheet.absoluteFill, styles.heroImage]}
              />
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close picker"
                style={styles.closeBtn}
              >
                <IconClose color="#0F172A" size={20} strokeWidth={2.4} />
              </Pressable>
              <View style={styles.heroBottom}>
                <View style={styles.headerTitleWrap}>
                  <AppText variant="heading" color="#FFFFFF" style={styles.venueName} numberOfLines={1}>
                    {venue.name}
                  </AppText>
                  {venue.address ? (
                    <View style={styles.addressRow}>
                      <IconPin color="#FFFFFF" size={15} />
                      <AppText variant="caption" color="#FFFFFF" numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>
                        {venue.address}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <View style={styles.sportPill}>
                  <IconBox color="#006341" size={14} />
                  <AppText variant="caption" color="#006341" style={{ fontWeight: '700' }}>
                    {SPORT_NAME[sport]}
                  </AppText>
                </View>
              </View>
            </ImageBackground>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* 1. Date Selector (14-day horizontal strip) */}
              {sectionHead(IconCalendar, 'Select Date')}
              <DateStrip
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
              />

              {/* 2. Court / Box Selector */}
              <CourtPicker
                courtsCount={venue.courts_count ?? 1}
                selectedCourt={selectedCourt}
                onSelectCourt={handleSelectCourt}
                sportTypes={venue.sport_types}
              />

              {/* 3. Duration Selector */}
              {sectionHead(IconClock, 'Select Duration')}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.durationScroll}
              >
                {DURATION_OPTIONS.map((opt) => {
                  const on = durationMinutes === opt.minutes;
                  return (
                    <Pressable
                      key={opt.minutes}
                      onPress={() => setDurationMinutes(opt.minutes)}
                      style={[styles.durationChip, on && styles.durationChipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <AppText
                        variant="label"
                        color={on ? M.limeInk : M.text}
                        style={{ fontWeight: on ? '700' : '500', fontSize: 14 }}
                      >
                        {opt.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* 4. Slot Availability Grid */}
              {sectionHead(
                IconClock,
                'Available Time Slots',
                <AppText variant="caption" color={M.muted}>
                  {courtLabel}
                </AppText>,
              )}

              {selectedSlot && rangeCalc && !rangeCalc.isValid && (
                <View style={styles.conflictAlert}>
                  <AppText variant="caption" color={M.danger}>
                    {`Cannot book ${durationLabel} starting at ${selectedSlot.timeHhmm}. Continuous slot is occupied.`}
                  </AppText>
                </View>
              )}

              {slotsQuery.isError ? (
                <View style={styles.errorContainer}>
                  <AppText variant="caption" color={M.danger} center>
                    Unable to load slots. Please check your network.
                  </AppText>
                  <Button
                    label="Retry"
                    onPress={() => void slotsQuery.refetch()}
                    variant="secondary"
                  />
                </View>
              ) : (
                <TimeSlotGrid
                  slots={courtSlots}
                  selectedSlot={selectedSlot}
                  onSelectSlot={handleSelectSlot}
                  durationMinutes={durationMinutes}
                  isLoading={slotsQuery.isLoading}
                  timezone={timezone}
                />
              )}
            </ScrollView>

            {/* Sheet Footer Action */}
            <View style={styles.footer}>
              {selectedSlot ? (
                <View style={styles.selectionSummary}>
                  <View style={styles.selectionPill}>
                    <View style={{ gap: 2 }}>
                      <AppText variant="label" color={M.text} style={styles.summaryCourt}>
                        {courtLabel}
                      </AppText>
                      <AppText variant="caption" color={M.green} style={styles.summaryTime}>
                        {slotWindow}
                      </AppText>
                    </View>
                    {totalPrice !== null && (
                      <View style={styles.pricePill}>
                        <AppText variant="label" color={M.green} style={{ fontWeight: '700' }}>
                          {`₹${totalPrice}`}
                        </AppText>
                      </View>
                    )}
                  </View>
                  <Button
                    label={
                      rangeCalc?.isValid
                        ? `Book Slot · ${totalPrice ? `₹${totalPrice}` : 'Pay at venue'}`
                        : 'Time Slot Unavailable'
                    }
                    onPress={handleOpenBookingModal}
                    disabled={!rangeCalc?.isValid}
                    variant="primary"
                  />
                </View>
              ) : (
                <Button
                  label="Select a Time Slot"
                  onPress={() => {}}
                  disabled={true}
                  variant="primary"
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirmation & Conflict Modal */}
      {modalSlot && (
        <BookingModal
          visible={isBookingModalVisible}
          onClose={handleCloseBookingModal}
          onConflictRecovery={handleConflictRecovery}
          venue={venue}
          courtNumber={selectedCourt}
          selectedDate={selectedDate}
          slot={modalSlot}
          matches={matches}
          initialMatchId={initialMatchId}
          timezone={timezone}
          onBookingSuccess={handleBookingConfirmed}
        />
      )}
    </>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
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
      marginBottom: S.xs,
    },
    hero: {
      height: 170,
      marginHorizontal: S.md,
      marginBottom: S.xs,
      justifyContent: 'flex-end',
    },
    heroImage: { borderRadius: 20 },
    heroBottom: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: S.sm,
      padding: S.md,
    },
    headerTitleWrap: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    venueName: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '700',
    },
    addressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    sportPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: R.pill,
      backgroundColor: '#FFFFFF',
    },
    closeBtn: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollContent: {
      paddingBottom: S.md,
      paddingTop: S.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.md,
      marginTop: S.md,
      marginBottom: S.xs,
    },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    sectionTitle: {
      fontFamily: 'SpaceGrotesk_600SemiBold',
      fontSize: 16,
      fontWeight: '600',
    },
    errorContainer: {
      padding: S.xl,
      gap: S.md,
      alignItems: 'center',
    },
    footer: {
      paddingHorizontal: S.lg,
      paddingTop: S.sm,
      borderTopWidth: 1,
      borderTopColor: M.border,
    },
    selectionSummary: {
      gap: S.sm,
    },
    selectionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.sm,
    },
    summaryCourt: {
      fontSize: 14,
      fontWeight: '700',
    },
    summaryTime: {
      fontSize: 13,
      fontWeight: '600',
    },
    pricePill: {
      paddingHorizontal: S.sm,
      paddingVertical: 4,
      borderRadius: R.sm,
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
      borderWidth: 1,
      borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    durationScroll: {
      paddingHorizontal: S.md,
      gap: S.sm,
      paddingVertical: 4,
      marginBottom: S.xs,
    },
    durationChip: {
      minHeight: 44,
      minWidth: 76,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: S.md,
      borderRadius: R.pill,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    durationChipOn: {
      backgroundColor: M.green,
      borderColor: M.green,
    },
    conflictAlert: {
      marginHorizontal: S.md,
      marginBottom: S.sm,
      padding: S.sm,
      borderRadius: R.sm,
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(239, 68, 68, 0.3)',
    },
  });
