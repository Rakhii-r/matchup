import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { typography } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';

type Variant = keyof typeof typography;

interface AppTextProps {
  children: ReactNode;
  variant?: Variant;
  muted?: boolean;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export function AppText({
  children,
  variant = 'body',
  muted = false,
  color,
  center = false,
  style,
  numberOfLines,
}: AppTextProps): ReactNode {
  const { colors } = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        typography[variant],
        { color: color ?? (muted ? colors.textMuted : colors.text) },
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
