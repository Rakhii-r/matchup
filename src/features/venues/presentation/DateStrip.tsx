import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getUpcomingDates } from '@features/venues/domain/slotUtils';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';

export interface DateStripProps {
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  daysCount?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * 14-day horizontal scrolling date selector.
 * Displays short weekday (Today, Sat, Sun), day number (05), and month abbreviation (Sep).
 * Highlights the active selection with M.green background and dark contrast text.
 */
export function DateStrip({
  selectedDate,
  onSelectDate,
  daysCount = 14,
  style,
}: DateStripProps): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const dates = useMemo(() => getUpcomingDates(daysCount), [daysCount]);

  return (
    <View style={[styles.container, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {dates.map((item) => {
          const isSelected = item.dateStr === selectedDate;
          return (
            <Pressable
              key={item.dateStr}
              onPress={() => onSelectDate(item.dateStr)}
              accessibilityRole="button"
              accessibilityLabel={`${item.dayLabel}, ${item.monthLabel} ${item.dayNumber}`}
              accessibilityState={{ selected: isSelected }}
              style={({ pressed }) => [
                styles.chip,
                isSelected ? styles.chipSelected : styles.chipInactive,
                pressed && { opacity: 0.85 },
              ]}
            >
              <AppText
                variant="caption"
                color={isSelected ? M.limeInk : M.muted}
                style={[styles.weekdayText, isSelected && styles.textSelectedBold]}
              >
                {item.dayLabel}
              </AppText>
              <AppText
                variant="heading"
                color={isSelected ? M.limeInk : M.text}
                style={[styles.dayNumberText, isSelected && styles.textSelectedBold]}
              >
                {item.dayNumber}
              </AppText>
              <AppText
                variant="caption"
                color={isSelected ? M.limeInk : M.muted}
                style={[styles.monthText, isSelected && styles.textSelectedBold]}
              >
                {item.monthLabel}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    container: {
      marginVertical: S.sm,
    },
    scrollContent: {
      paddingHorizontal: S.md,
      gap: S.sm,
      alignItems: 'center',
    },
    chip: {
      // min, not fixed — same reason as the wizard's date chip: two lines of
      // text that grow with the OS font setting.
      minWidth: 66,
      minHeight: 82,
      borderRadius: R.lg,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    chipInactive: {
      backgroundColor: M.card,
      borderColor: M.border,
    },
    chipSelected: {
      backgroundColor: M.green,
      borderColor: M.green,
    },
    weekdayText: {
      fontSize: 11,
      fontWeight: '600',
      marginBottom: 2,
    },
    dayNumberText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 20,
      fontWeight: '700',
      lineHeight: 24,
    },
    monthText: {
      fontSize: 11,
      fontWeight: '500',
      marginTop: 2,
    },
    textSelectedBold: {
      fontWeight: '700',
    },
  });
