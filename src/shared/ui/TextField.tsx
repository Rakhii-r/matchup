import type { ReactNode } from 'react';
import { View, TextInput, type KeyboardTypeOptions } from 'react-native';

import { radius, spacing, typography } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
  maxLength?: number;
  error?: string;
  editable?: boolean;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoFocus = false,
  maxLength,
  error,
  editable = true,
}: TextFieldProps): ReactNode {
  const { colors } = useTheme();

  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          minHeight: 50,
          fontSize: typography.body.fontSize,
          color: colors.text,
          backgroundColor: colors.surface,
        }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        maxLength={maxLength}
        editable={editable}
        autoCapitalize="none"
      />
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
