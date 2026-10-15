import { useMemo, useRef } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';

import { spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';

const OTP_LENGTH = 6;

interface OtpBoxInputProps {
  value: string;
  onChange: (val: string) => void;
  error?: boolean;
}

export function OtpBoxInput({
  value,
  onChange,
  error = false,
}: OtpBoxInputProps): React.ReactNode {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const inputRef = useRef<TextInput>(null);

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(digits);
  };

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      style={styles.wrapper}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        caretHidden
        style={styles.hiddenInput}
      />

      <View style={styles.row}>
        {Array.from({ length: OTP_LENGTH }).map((_, index) => {
          const digit = value[index] ?? '';

          const active = index === value.length;

          const filled = digit !== '';

          const borderColor = error
            ? colors.danger
            : active || filled
            ? colors.success
            : colors.border;

          const bgColor = isDark
            ? filled
              ? '#1E2D3D'
              : '#111827'
            : colors.background;

          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  borderColor,
                  backgroundColor: bgColor,
                },
              ]}
            >
              <AppText
                style={[
                  styles.digit,
                  {
                    color: colors.text,
                  },
                ]}
              >
                {digit}
              </AppText>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  wrapper: {
    width: '100%',
    alignItems: 'center',
  },

  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },

  row: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },

  box: {
    width: 48,
    minHeight: 56,

    borderRadius: 12,

    borderWidth: 2,

    justifyContent: 'center',
    alignItems: 'center',

    backgroundColor: colors.background,
  },

  digit: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});