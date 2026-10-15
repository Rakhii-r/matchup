import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { formatCourtLabel, formatSlotWindow } from '@features/venues/domain/slotUtils';
import type { VenueBooking, VenueSlot } from '@features/venues/domain/venueBookingSchema';
import { useBookSlot } from '@features/venues/presentation/useVenueBookings';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import {
  IconCalendar,
  IconClock,
  IconClose,
  IconPin,
  IconShieldCheck,
} from '@shared/ui/icons';

export interface BookingModalProps {
  visible: boolean;
  onClose: () => void;
  venue: {
    id: string;
    name: string;
    address?: string | null;
    sport_types?: string[];
    price_per_hour?: number | null;
    phone?: string | null;
  };
  courtNumber: number;
  selectedDate: string; // YYYY-MM-DD
  slot: VenueSlot | null;
  onBookingSuccess?: (booking: VenueBooking) => void;
  onConflictRecovery?: () => void;
  matches?: Array<{
    id: string;
    title?: string;
    sport?: string;
    scheduled_at?: string;
  }>;
  initialMatchId?: string | null;
  timezone?: string;
  style?: StyleProp<ViewStyle>;
}

function formatDisplayDate(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0] ?? '0', 10);
      const m = parseInt(parts[1] ?? '0', 10);
      const d = parseInt(parts[2] ?? '0', 10);
      const date = new Date(y, m - 1, d);
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
    }
  } catch {
    // fallback to original string
  }
  return dateStr;
}

/**
 * Slide-up confirmation modal for venue court booking.
 * Features details summary, price indicator, optional match linking,
 * and robust double-booking conflict handling ("Slot already taken") with automatic query refetch.
 */
export function BookingModal({
  visible,
  onClose,
  venue,
  courtNumber,
  selectedDate,
  slot,
  onBookingSuccess,
  onConflictRecovery,
  matches,
  initialMatchId = null,
  timezone = 'Asia/Kolkata',
}: BookingModalProps): React.ReactNode {
  const M = useMock();
  // Clears the home indicator / gesture bar, and stops a long sheet
  // running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  const styles = useMemo(() => makeStyles(M), [M]);
  const qc = useQueryClient();
  const bookSlot = useBookSlot();

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(initialMatchId);
  const [notes, setNotes] = useState('');
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Reset errors when modal opens or slot changes
  useEffect(() => {
    if (visible) {
      setConflictError(null);
      setGeneralError(null);
      setSelectedMatchId(initialMatchId ?? null);
      setNotes('');
    }
  }, [visible, slot, initialMatchId]);

  if (!slot) {
    return null;
  }

  const courtName = formatCourtLabel(courtNumber, venue.sport_types);
  // Not a hook: this sits below the `!slot` return above, and a hook there
  // changes the hook count between renders — React throws when the slot goes
  // from null to set while the modal stays mounted.
  const durationMin = (() => {
    const s = new Date(slot.startTime).getTime();
    const e = new Date(slot.endTime).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return 60;
    return Math.round((e - s) / (60 * 1000));
  })();

  const durationHours = durationMin / 60;
  const durationLabel = durationHours === 1 ? '1 hr' : `${durationHours} hrs`;

  const timeWindow = `${
    formatSlotWindow(slot.startTime, slot.endTime, timezone) ||
    `${slot.timeHhmm} – ${slot.endTimeHhmm}`
  } (${durationLabel})`;
  const displayDate = formatDisplayDate(selectedDate);

  const priceText = venue.price_per_hour
    ? `₹${Math.round(durationHours * venue.price_per_hour)} · ₹${venue.price_per_hour}/hr`
    : 'Pay at venue';

  /**
   * BOOKING A SLOT FOR A MATCH MOVES THE MATCH.
   *
   * `book_venue_slot`, given an `in_match_id`, does not merely attach the venue:
   *
   *     update public.matches
   *        set venue_id = in_venue_id,
   *            scheduled_at = in_start_time,
   *            end_time     = in_end_time, ...
   *
   * So a 12:00 game becomes a 14:00 game for everyone who joined it, and until
   * now that happened without a word. The court is the real constraint, so the
   * reschedule is right -- it just cannot be silent. Asked here rather than in
   * either caller because this modal is the one place both the venues tab and
   * the match ground picker pass through.
   */
  const submitBooking = () => {
    bookSlot.mutate(
      {
        venueId: venue.id,
        courtNumber,
        startTime: slot.startTime,
        endTime: slot.endTime,
        matchId: selectedMatchId ?? undefined,
        notes: notes.trim() ? notes.trim() : undefined,
      },
      {
        onSuccess: (booking) => {
          onBookingSuccess?.(booking);
          onClose();
        },
        onError: (err) => {
          const msg = err.message || '';
          const isConflict =
            msg.includes('Slot already taken') ||
            msg.toLowerCase().includes('already taken') ||
            msg.toLowerCase().includes('conflict') ||
            msg.includes('23P01') ||
            msg.includes('SLOT_ALREADY_TAKEN');

          if (isConflict) {
            setConflictError(
              'Slot already taken. Another player just booked this court and slot. Please pick another slot.',
            );
            // Invalidate slots immediately so the freshly occupied slot becomes disabled
            void qc.invalidateQueries({
              queryKey: ['venue-slots', venue.id],
            });
          } else {
            setGeneralError(msg || 'Failed to complete booking. Please try again.');
          }
        },
      },
    );
  };

  const linkedMatch = selectedMatchId
    ? matches?.find((m) => m.id === selectedMatchId) ?? null
    : null;

  const handleConfirm = () => {
    setConflictError(null);
    setGeneralError(null);

    const was = linkedMatch?.scheduled_at ? new Date(linkedMatch.scheduled_at) : null;
    const now = new Date(slot.startTime);
    if (was && was.getTime() !== now.getTime()) {
      const t = (d: Date) =>
        d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit' });
      Alert.alert(
        'This moves your game',
        `${linkedMatch?.title ?? 'The game'} is set for ${t(was)}. Booking this court moves it to ${t(now)}, and everyone who joined will see the new time.`,
        [
          { text: 'Pick another slot', style: 'cancel' },
          { text: 'Book and move it', onPress: submitBooking },
        ],
      );
      return;
    }

    submitBooking();
  };

  const handleClose = () => {
    if (conflictError) {
      onConflictRecovery?.();
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, sheetInsets]}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <AppText variant="heading" color={M.text} style={styles.sheetTitle}>
                Confirm Booking
              </AppText>
              <AppText variant="caption" color={M.muted}>
                Review details before reserving
              </AppText>
            </View>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
              style={styles.closeBtn}
            >
              <IconClose color={M.muted} size={22} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Conflict Banner (Double-booking handling) */}
            {conflictError && (
              <View style={styles.conflictBanner}>
                <View style={styles.conflictHeader}>
                  <IconShieldCheck color={M.danger} size={20} />
                  <AppText variant="label" color={M.danger} style={styles.conflictTitle}>
                    Slot Already Taken
                  </AppText>
                </View>
                <AppText variant="caption" color={M.danger} style={styles.conflictBody}>
                  {conflictError}
                </AppText>
                <Pressable
                  onPress={handleClose}
                  style={styles.conflictActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Choose another slot"
                >
                  <AppText variant="caption" color={M.text} style={styles.conflictActionText}>
                    ← Pick Another Slot
                  </AppText>
                </Pressable>
              </View>
            )}

            {/* General Error Banner */}
            {generalError && !conflictError && (
              <View style={styles.errorBanner}>
                <AppText variant="caption" color={M.danger}>
                  {generalError}
                </AppText>
              </View>
            )}

            {/* Booking Details Card */}
            <View style={styles.card}>
              {/* Venue Name & Address */}
              <View style={styles.detailRow}>
                <IconPin color={M.green} size={20} />
                <View style={styles.detailTextWrap}>
                  <AppText variant="label" color={M.text} style={styles.primaryValue}>
                    {venue.name}
                  </AppText>
                  {venue.address ? (
                    <AppText variant="caption" color={M.muted} numberOfLines={2}>
                      {venue.address}
                    </AppText>
                  ) : null}
                </View>
              </View>

              <View style={styles.divider} />

              {/* Court & Date */}
              <View style={styles.metaGrid}>
                <View style={styles.metaItem}>
                  <AppText variant="caption" color={M.muted} style={styles.metaLabel}>
                    COURT / BOX
                  </AppText>
                  <AppText variant="label" color={M.text} style={styles.metaValue}>
                    {courtName}
                  </AppText>
                </View>

                <View style={styles.metaItem}>
                  <AppText variant="caption" color={M.muted} style={styles.metaLabel}>
                    PRICE
                  </AppText>
                  <AppText variant="label" color={M.green} style={styles.metaValue}>
                    {priceText}
                  </AppText>
                </View>
              </View>

              <View style={styles.divider} />

              {/* Date & Time Window */}
              <View style={styles.detailRow}>
                <IconCalendar color={M.muted} size={18} />
                <AppText variant="body" color={M.text} style={styles.secondaryValue}>
                  {displayDate}
                </AppText>
              </View>

              <View style={styles.detailRow}>
                <IconClock color={M.muted} size={18} />
                <AppText variant="label" color={M.text} style={styles.secondaryValue}>
                  {timeWindow}
                </AppText>
              </View>
            </View>

            {/* Match Linking Picker (Optional) */}
            {matches && matches.length > 0 && (
              <View style={styles.section}>
                <AppText variant="caption" color={M.muted} style={styles.sectionTitle}>
                  LINK TO UPCOMING MATCH (OPTIONAL)
                </AppText>
                <View style={styles.matchPicker}>
                  <Pressable
                    onPress={() => setSelectedMatchId(null)}
                    style={[
                      styles.matchChip,
                      selectedMatchId === null && styles.matchChipActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Direct personal booking without linked match"
                  >
                    <AppText
                      variant="caption"
                      color={selectedMatchId === null ? M.limeInk : M.muted}
                      style={selectedMatchId === null ? styles.bold : undefined}
                    >
                      Personal Booking (No Match)
                    </AppText>
                  </Pressable>

                  {matches.map((m) => {
                    const isSelected = selectedMatchId === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => setSelectedMatchId(m.id)}
                        style={[styles.matchChip, isSelected && styles.matchChipActive]}
                        accessibilityRole="button"
                        accessibilityLabel={`Link to match ${m.title || 'Scheduled Match'}`}
                      >
                        <AppText
                          variant="caption"
                          color={isSelected ? M.limeInk : M.muted}
                          style={isSelected ? styles.bold : undefined}
                        >
                          {m.title || 'Scheduled Match'} ({m.sport ?? 'Game'})
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Notes Input */}
            <View style={styles.section}>
              <AppText variant="caption" color={M.muted} style={styles.sectionTitle}>
                NOTES FOR VENUE (OPTIONAL)
              </AppText>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Bringing own cricket gear"
                placeholderTextColor={M.faint}
                maxLength={280}
                style={styles.notesInput}
              />
            </View>
          </ScrollView>

          {/* Action CTA Button */}
          <View style={styles.footer}>
            {conflictError ? (
              <Button
                label="Pick Another Slot"
                onPress={handleClose}
                variant="secondary"
              />
            ) : (
              <Button
                label={bookSlot.isPending ? 'Confirming Booking...' : 'Confirm Booking'}
                onPress={handleConfirm}
                loading={bookSlot.isPending}
                disabled={bookSlot.isPending}
                variant="primary"
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
      paddingHorizontal: S.lg,
      paddingTop: S.lg,
      paddingBottom: Platform.OS === 'ios' ? 38 : S.lg,
      maxHeight: '88%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: S.md,
    },
    sheetTitle: {
      fontSize: 20,
      fontWeight: '700',
    },
    closeBtn: {
      padding: S.xs,
    },
    scrollContent: {
      paddingBottom: S.md,
      gap: S.md,
    },
    card: {
      backgroundColor: M.card,
      borderColor: M.border,
      borderWidth: 1,
      borderRadius: R.md,
      padding: S.md,
      gap: S.sm,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
    },
    detailTextWrap: {
      flex: 1,
      gap: 2,
    },
    primaryValue: {
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryValue: {
      fontSize: 14,
    },
    divider: {
      height: 1,
      backgroundColor: M.border,
      marginVertical: S.xs,
    },
    metaGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    metaItem: {
      gap: 2,
    },
    metaLabel: {
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.5,
    },
    metaValue: {
      fontSize: 15,
      fontWeight: '700',
    },
    section: {
      gap: S.xs,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    matchPicker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.sm,
      marginTop: 2,
    },
    matchChip: {
      paddingHorizontal: S.md,
      paddingVertical: 7,
      borderRadius: R.pill,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    matchChipActive: {
      backgroundColor: M.green,
      borderColor: M.green,
    },
    bold: {
      fontWeight: '700',
    },
    notesInput: {
      backgroundColor: M.card,
      borderColor: M.border,
      borderWidth: 1,
      borderRadius: R.md,
      paddingHorizontal: S.md,
      paddingVertical: S.sm,
      color: M.text,
      fontSize: 14,
    },
    conflictBanner: {
      backgroundColor: 'rgba(255, 69, 58, 0.12)',
      borderColor: M.danger,
      borderWidth: 1,
      borderRadius: R.md,
      padding: S.md,
      gap: S.xs,
    },
    conflictHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.xs,
    },
    conflictTitle: {
      fontWeight: '700',
      fontSize: 14,
    },
    conflictBody: {
      fontSize: 13,
      lineHeight: 18,
    },
    conflictActionBtn: {
      alignSelf: 'flex-start',
      marginTop: S.xs,
      paddingVertical: 4,
      paddingHorizontal: S.sm,
      backgroundColor: M.card,
      borderRadius: R.sm,
    },
    conflictActionText: {
      fontSize: 12,
      fontWeight: '600',
    },
    errorBanner: {
      backgroundColor: 'rgba(255, 69, 58, 0.12)',
      borderColor: M.danger,
      borderWidth: 1,
      borderRadius: R.md,
      padding: S.md,
    },
    footer: {
      paddingTop: S.sm,
    },
  });
