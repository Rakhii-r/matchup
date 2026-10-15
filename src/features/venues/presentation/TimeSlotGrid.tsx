import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  formatSlotWindow,
  getSlotStatus,
  isSlotInSelectedRange,
  type SlotState,
} from '@features/venues/domain/slotUtils';
import type { VenueSlot } from '@features/venues/domain/venueBookingSchema';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconClock } from '@shared/ui/icons';

export { getSlotStatus, type SlotState };

export interface TimeSlotGridProps {
  slots: VenueSlot[];
  selectedSlot: VenueSlot | null;
  onSelectSlot: (slot: VenueSlot) => void;
  durationMinutes?: number;
  isLoading?: boolean;
  columns?: 2 | 3;
  timezone?: string;
  emptyMessage?: string;
  style?: StyleProp<ViewStyle>;
}

function isSameSlot(a: VenueSlot | null, b: VenueSlot | null): boolean {
  if (!a || !b) return false;
  return a.courtNumber === b.courtNumber && a.startTime === b.startTime;
}

/**
 * Grid component displaying computed time slots for a venue and court.
 * Visually differentiates Available (selectable) vs Booked / Occupied (disabled) vs Past.
 */
export function TimeSlotGrid({
  slots,
  selectedSlot,
  onSelectSlot,
  durationMinutes = 60,
  isLoading = false,
  columns = 2,
  timezone = 'Asia/Kolkata',
  emptyMessage = 'No slots available for this date',
  style,
}: TimeSlotGridProps): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const [periodFilter, setPeriodFilter] = React.useState<'all' | 'morning' | 'afternoon' | 'evening' | 'night'>('all');

  const filteredSlots = useMemo(() => {
    if (periodFilter === 'all') return slots;
    return slots.filter((s) => {
      const hour = parseInt(s.timeHhmm.split(':')[0] ?? '0', 10);
      if (periodFilter === 'morning') return hour >= 6 && hour < 12;
      if (periodFilter === 'afternoon') return hour >= 12 && hour < 17;
      if (periodFilter === 'evening') return hour >= 17 && hour < 21;
      if (periodFilter === 'night') return hour >= 21 || hour < 6;
      return true;
    });
  }, [slots, periodFilter]);

  const itemWidthStyle = useMemo(
    () => (columns === 3 ? styles.itemWidthCol3 : styles.itemWidthCol2),
    [columns, styles],
  );

  if (isLoading) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.loadingHeader}>
          <ActivityIndicator size="small" color={M.green} />
          <AppText variant="caption" color={M.muted}>
            Loading court availability...
          </AppText>
        </View>
        <View style={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={[styles.slotCard, itemWidthStyle, styles.skeletonCard]}>
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonBadge} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (slots.length === 0) {
    return (
      <View style={[styles.emptyContainer, style]}>
        <IconClock color={M.muted} size={32} />
        <AppText variant="label" color={M.text} center style={styles.emptyTitle}>
          {emptyMessage}
        </AppText>
        <AppText variant="caption" color={M.muted} center>
          Please select another date or court to view available slots.
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {/* Time of day filters (Playo style) */}
      <View style={styles.periodFilterRow}>
        {(
          [
            { key: 'all', label: 'All (24h)' },
            { key: 'morning', label: 'Morning (6-12)' },
            { key: 'afternoon', label: 'Afternoon (12-5)' },
            { key: 'evening', label: 'Evening (5-9)' },
            { key: 'night', label: 'Night (9-6)' },
          ] as const
        ).map((tab) => {
          const active = periodFilter === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setPeriodFilter(tab.key)}
              style={[styles.periodChip, active && styles.periodChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <AppText
                variant="caption"
                color={active ? M.limeInk : M.muted}
                style={{ fontWeight: active ? '700' : '500', fontSize: 11 }}
              >
                {tab.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.grid}>
        {filteredSlots.length === 0 ? (
          <View style={[styles.emptyContainer, { width: '100%', paddingVertical: S.md }]}>
            <AppText variant="caption" color={M.muted} center>
              No slots in this time window.
            </AppText>
          </View>
        ) : (
          filteredSlots.map((slot) => {
          const status = getSlotStatus(slot);
          const isSelectable = status === 'available';
          const isSelected = isSlotInSelectedRange(slot, selectedSlot, durationMinutes);
          const formattedWindow =
            formatSlotWindow(slot.startTime, slot.endTime, timezone) ||
            `${slot.timeHhmm} – ${slot.endTimeHhmm}`;

          const getBadgeText = () => {
            if (isSelected) return 'Selected';
            switch (status) {
              case 'available':
                return 'Available';
              case 'my_booking':
                return 'Booked by You';
              case 'booked':
                return 'Occupied';
              case 'past':
                return 'Past';
            }
          };

          return (
            <Pressable
              key={`${slot.courtNumber}-${slot.startTime}`}
              disabled={!isSelectable}
              onPress={() => isSelectable && onSelectSlot(slot)}
              accessibilityRole="button"
              accessibilityLabel={`${formattedWindow}, ${getBadgeText()}`}
              accessibilityState={{
                selected: isSelected,
                disabled: !isSelectable,
              }}
              style={({ pressed }) => [
                styles.slotCard,
                itemWidthStyle,
                status === 'available' && styles.slotCardAvailable,
                isSelected && styles.slotCardSelected,
                (status === 'booked' || status === 'my_booking') && styles.slotCardOccupied,
                status === 'past' && styles.slotCardPast,
                pressed && isSelectable && { opacity: 0.85 },
              ]}
            >
              <AppText
                variant="label"
                color={
                  isSelected
                    ? M.green
                    : status === 'available'
                    ? M.text
                    : M.muted
                }
                style={[
                  styles.timeWindowText,
                  isSelected && styles.timeWindowTextSelected,
                  (status === 'booked' || status === 'my_booking') && styles.timeWindowTextStrikethrough,
                ]}
                numberOfLines={1}
              >
                {formattedWindow}
              </AppText>

              <View
                style={[
                  styles.statusBadge,
                  isSelected && styles.badgeSelected,
                  status === 'available' && !isSelected && styles.badgeAvailable,
                  (status === 'booked' || status === 'my_booking') && styles.badgeOccupied,
                  status === 'past' && styles.badgePast,
                ]}
              >
                <AppText
                  variant="caption"
                  color={
                    isSelected
                      ? M.limeInk
                      : status === 'available'
                      ? M.green
                      : status === 'past'
                      ? M.faint
                      : M.danger
                  }
                  style={styles.badgeText}
                >
                  {getBadgeText()}
                </AppText>
              </View>
            </Pressable>
          );
        }))}
      </View>
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    container: {
      paddingVertical: S.sm,
    },
    periodFilterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: S.md,
      marginBottom: S.sm + 2,
    },
    periodChip: {
      paddingHorizontal: S.sm + 2,
      paddingVertical: 5,
      borderRadius: R.pill,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    periodChipActive: {
      backgroundColor: M.cardHi,
      borderColor: M.green,
    },
    loadingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      paddingVertical: S.md,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.sm,
      paddingHorizontal: S.md,
    },
    itemWidthCol2: {
      width: '48.5%',
    },
    itemWidthCol3: {
      width: '31%',
    },
    slotCard: {
      borderRadius: R.md,
      borderWidth: 1,
      paddingVertical: S.sm + 2,
      paddingHorizontal: S.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 68,
      gap: 4,
    },
    slotCardAvailable: {
      backgroundColor: M.card,
      borderColor: M.border,
    },
    slotCardSelected: {
      backgroundColor: M.cardHi,
      borderColor: M.green,
      borderWidth: 2,
    },
    slotCardOccupied: {
      backgroundColor: M.card,
      borderColor: M.border,
      opacity: 0.5,
    },
    slotCardPast: {
      backgroundColor: M.card,
      borderColor: M.border,
      opacity: 0.35,
    },
    skeletonCard: {
      backgroundColor: M.card,
      borderColor: M.border,
      opacity: 0.6,
    },
    skeletonLine: {
      width: '80%',
      height: 14,
      backgroundColor: M.border,
      borderRadius: R.sm,
      marginBottom: 6,
    },
    skeletonBadge: {
      width: '50%',
      height: 12,
      backgroundColor: M.border,
      borderRadius: R.pill,
    },
    timeWindowText: {
      fontSize: 12,
      fontWeight: '600',
    },
    timeWindowTextSelected: {
      fontWeight: '700',
    },
    timeWindowTextStrikethrough: {
      textDecorationLine: 'line-through',
    },
    statusBadge: {
      paddingHorizontal: S.sm,
      paddingVertical: 2,
      borderRadius: R.pill,
      borderWidth: 1,
    },
    badgeAvailable: {
      backgroundColor: 'transparent',
      borderColor: M.green,
    },
    badgeSelected: {
      backgroundColor: M.green,
      borderColor: M.green,
    },
    badgeOccupied: {
      backgroundColor: 'transparent',
      borderColor: M.danger,
    },
    badgePast: {
      backgroundColor: 'transparent',
      borderColor: M.border,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    emptyContainer: {
      paddingVertical: S.xl,
      paddingHorizontal: S.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: {
      marginTop: S.sm,
      fontSize: 15,
      fontWeight: '600',
    },
  });
