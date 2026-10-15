/**
 * The booked slot's remaining time, as a strip for the scoring screens.
 *
 * Built against `@shared/theme` rather than `mockTheme` because the two scoring
 * screens are, and this repo carries both design systems (see the known-debt
 * note in the project docs). The result screen renders the same information
 * inline in mockTheme colours; when the two systems are finally merged, that
 * copy and this one collapse into each other.
 *
 * It states time, never permission. Nothing here disables the keypad: a slot
 * that runs out mid-over must not strand a half-scored innings, so the game in
 * progress is always finishable and only the NEXT game is refused — by
 * `create_rematch` on the server and by the result screen's CTA in the client.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { SlotCountdown } from '@features/matches/presentation/useSlotCountdown';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { IconHourglass } from '@shared/ui/icons';

export function SlotBadge({ slot }: { slot: SlotCountdown }): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // No booked slot on this match — there is nothing to count down to, and an
  // empty strip would be worse than no strip.
  if (!slot.hasSlot) return null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, slot.expired ? styles.badgeEnded : null]}>
        <IconHourglass color={slot.expired ? colors.danger : AMBER} size={16} />
        <AppText
          variant="caption"
          color={slot.expired ? colors.danger : colors.primaryDark}
          style={styles.badgeText}
        >
          {slot.expired
            ? `Slot ended at ${slot.endsAtLabel} · finish this game, no new one can start`
            : `Slot ends in ${slot.minutesLeft}m`}
        </AppText>
      </View>

      {slot.warning !== null ? (
        <View style={styles.warn}>
          <AppText variant="caption" style={styles.warnText}>
            {slot.warning === 30
              ? `About ${slot.minutesLeft} minutes left in the slot.`
              : `Only ${slot.minutesLeft} minutes left — this may be the last game.`}
          </AppText>
          <Pressable
            onPress={slot.dismissWarning}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss slot reminder"
          >
            <AppText variant="caption" color={colors.primary}>
              Got it
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// Time running out is a caution, not a state of the app: amber in both themes.
const AMBER = '#F59E0B';

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs, marginBottom: spacing.sm },
    badge: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: '100%',
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(245, 158, 11, 0.12)',
      borderWidth: 1,
      borderColor: 'rgba(245, 158, 11, 0.3)',
    },
    badgeText: { flexShrink: 1, fontWeight: '600', fontSize: 13 },
    badgeEnded: { borderColor: colors.danger, backgroundColor: colors.surface },
    warn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    warnText: { flex: 1 },
  });
