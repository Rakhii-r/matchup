/**
 * Court lights on the scoreboard, for everyone on the match.
 *
 * Shown only when the match's court has a light device and its booking is live.
 * The booker gets an on/off button; everyone else sees the status. Display
 * only: whether a ball fires is decided in the database on every ball. Built
 * against `@shared/theme`, like SlotBadge, because the scoring screen is.
 */
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppError } from '@core/errors/AppError';
import type { MatchLights } from '@features/lights/domain/lightsSchema';
import { useMatchLights, useSetBookingLights } from '@features/lights/presentation/useLights';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { IconBolt } from '@shared/ui/icons';

function statusText(s: MatchLights, until: string): { text: string; on: boolean } {
  if (!s.wanted) return { text: `Court ${s.court_number} lights off · turned off by booker`, on: false };
  if (!s.paid) return { text: `Court ${s.court_number} has lights · pay at the counter to switch on`, on: false };
  if (!s.device_enabled) return { text: `Court ${s.court_number} lights switched off by the ground`, on: false };
  return { text: `Court ${s.court_number} lights ON until ${until} · 4, 6 and wickets blink`, on: true };
}

export function LightsChip({ matchId }: { matchId: string }): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lights = useMatchLights(matchId);
  const toggle = useSetBookingLights(matchId);

  // No device on this court, no live booking, or the read failed: show nothing.
  // A failed read must not claim the lights are off when they may be on.
  const s = lights.data;
  if (!s) return null;

  const until = new Date(s.until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const { text, on } = statusText(s, until);

  const onToggle = () =>
    toggle.mutate(
      { bookingId: s.booking_id, wanted: !s.wanted },
      {
        onError: (e) =>
          Alert.alert(
            'Could not switch lights',
            e instanceof AppError ? e.message : 'Something went wrong. Try again.',
          ),
      },
    );

  return (
    <View style={[styles.chip, on ? styles.chipOn : null]}>
      <IconBolt color={on ? colors.primary : colors.textMuted} size={16} />
      <AppText variant="caption" color={colors.text} style={styles.text}>
        {text}
      </AppText>
      {s.i_am_booker ? (
        <Pressable
          onPress={onToggle}
          disabled={toggle.isPending}
          style={[styles.btn, s.wanted ? styles.btnOff : styles.btnOn]}
          accessibilityRole="button"
          accessibilityLabel={s.wanted ? 'Turn court lights off' : 'Turn court lights on'}
          hitSlop={6}
        >
          <AppText
            variant="caption"
            color={s.wanted ? colors.text : colors.textInverse}
            style={{ fontWeight: '700' }}
          >
            {toggle.isPending ? '…' : s.wanted ? 'Turn off' : 'Turn on'}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: 8,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipOn: { borderColor: colors.primary },
    text: { flex: 1, fontWeight: '600', fontSize: 13 },
    btn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    btnOff: { borderColor: colors.border, backgroundColor: colors.background },
    btnOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  });
