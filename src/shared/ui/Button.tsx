import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { radius, spacing } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { PressableScale } from '@shared/ui/PressableScale';
import { ShineOverlay } from '@shared/ui/ShineOverlay';

interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  /**
   * A sweep of light with sparkles: once on every tap, and continuously while
   * `loading`. For the one celebratory action on a screen, not for every button.
   */
  shine?: boolean;
  /** Glyph before the label. Receives the label colour so it always matches. */
  icon?: (color: string) => ReactNode;
  /** Glyph pinned to the right edge, e.g. a forward arrow on a full-width action. */
  trailing?: (color: string) => ReactNode;
}

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  shine = false,
  icon,
  trailing,
}: ButtonProps): ReactNode {
  const { colors } = useTheme();
  const [shineBurst, setShineBurst] = useState(0);
  const isDisabled = disabled || loading;
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : 'transparent';
  const fg = variant === 'secondary' ? colors.primary : colors.textInverse;

  const handlePress = (): void => {
    if (shine) setShineBurst((n) => n + 1);
    onPress();
  };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' ? { borderWidth: 1.5, borderColor: colors.primary } : null,
      ]}
    >
      <View style={styles.inner}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? icon(fg) : null}
        <AppText variant="label" color={fg} numberOfLines={1} style={styles.label}>
          {label}
        </AppText>
      </View>
      {trailing && !loading ? <View style={styles.trailing}>{trailing(fg)}</View> : null}
      {shine ? (
        <ShineOverlay burstKey={shineBurst} looping={loading} borderRadius={radius.lg} />
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.lg,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  label: { flexShrink: 1 },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  trailing: { position: 'absolute', right: spacing.md, top: 0, bottom: 0, justifyContent: 'center' },
});
