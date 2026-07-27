import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { radius, spacing } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';

interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: ButtonProps): ReactNode {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : 'transparent';
  const fg = variant === 'secondary' ? colors.primary : colors.textInverse;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' ? { borderWidth: 1.5, borderColor: colors.primary } : null,
      ]}
    >
      <View style={styles.inner}>
        {loading ? <ActivityIndicator color={fg} /> : null}
        <AppText variant="label" color={fg}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
