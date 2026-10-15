import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { formatCourtLabel } from '@features/venues/domain/slotUtils';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';

export interface CourtPickerProps {
  courtsCount?: number;
  selectedCourt: number;
  onSelectCourt: (courtNumber: number) => void;
  sportTypes?: string[];
  venue?: {
    courts_count?: number;
    sport_types?: string[];
  };
  showLabel?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Segmented chip row for toggling between courts/boxes.
 * Computes labels using formatCourtLabel (e.g. "Box 1", "Court 2").
 * If venue has 1 court, renders an informational pill or single selected state.
 */
export function CourtPicker({
  courtsCount,
  selectedCourt,
  onSelectCourt,
  sportTypes,
  venue,
  showLabel = true,
  style,
}: CourtPickerProps): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);

  const totalCourts = Math.max(1, courtsCount ?? venue?.courts_count ?? 1);
  const sports = sportTypes ?? venue?.sport_types ?? [];
  const courtsList = useMemo(
    () => Array.from({ length: totalCourts }, (_, i) => i + 1),
    [totalCourts],
  );

  return (
    <View style={[styles.container, style]}>
      {showLabel && (
        <AppText variant="caption" color={M.muted} style={styles.label}>
          {sports.some((s) => s.includes('cricket')) ? 'SELECT BOX' : 'SELECT COURT'}
        </AppText>
      )}

      {totalCourts === 1 ? (
        <View style={styles.singleCourtWrapper}>
          <View
            style={[styles.chip, styles.chipSelected, styles.singleCourtChip]}
            accessibilityRole="text"
            accessibilityLabel={`${formatCourtLabel(1, sports)}, 1 court available`}
          >
            <AppText variant="label" color={M.green} style={styles.chipTextSelected}>
              {formatCourtLabel(1, sports)}
            </AppText>
          </View>
          <AppText variant="caption" color={M.muted} style={styles.singleNotice}>
            (Single court venue)
          </AppText>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {courtsList.map((courtNum) => {
            const isSelected = courtNum === selectedCourt;
            const label = formatCourtLabel(courtNum, sports);
            return (
              <Pressable
                key={courtNum}
                onPress={() => onSelectCourt(courtNum)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [
                  styles.chip,
                  isSelected ? styles.chipSelected : styles.chipInactive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <AppText
                  variant="label"
                  color={isSelected ? M.green : M.text}
                  style={isSelected ? styles.chipTextSelected : styles.chipTextInactive}
                >
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    container: {
      marginVertical: S.sm,
    },
    label: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      paddingHorizontal: S.md,
      marginBottom: S.xs,
      textTransform: 'uppercase',
    },
    scrollContent: {
      paddingHorizontal: S.md,
      gap: S.sm,
      alignItems: 'center',
    },
    singleCourtWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: S.md,
      gap: S.sm,
    },
    singleCourtChip: {
      alignSelf: 'flex-start',
    },
    singleNotice: {
      fontSize: 12,
      fontStyle: 'italic',
    },
    chip: {
      paddingHorizontal: S.lg,
      borderRadius: R.lg,
      borderWidth: 1.5,
      minHeight: 52,
      minWidth: 120,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chipInactive: {
      backgroundColor: M.card,
      borderColor: M.border,
    },
    chipSelected: {
      backgroundColor: M.chip,
      borderColor: M.green,
    },
    chipTextInactive: {
      fontSize: 15,
      fontWeight: '600',
    },
    chipTextSelected: {
      fontSize: 15,
      fontWeight: '700',
    },
  });
