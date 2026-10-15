import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { typography } from '@shared/theme';
import { MAX_FONT_SCALE } from '@shared/theme/responsive';
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
  /**
   * Raise or remove the font-scaling cap for this one piece of text.
   *
   * The default cap exists because labels sit in rows with a committed height;
   * body copy in a scrolling column has no such constraint and SHOULD be
   * allowed to grow for a user who asked for large text. Pass a bigger number,
   * or 0 to opt out of the cap entirely.
   */
  maxFontSizeMultiplier?: number;
}

export function AppText({
  children,
  variant = 'body',
  muted = false,
  color,
  center = false,
  style,
  numberOfLines,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
}: AppTextProps): ReactNode {
  const { colors } = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      /*
        OS text scaling is honoured, and bounded.

        Both platforms allow well past 2x, which no fixed-height row in this app
        survives — the label is clipped rather than enlarged, which helps nobody.
        Capping keeps the text inside its container AND still noticeably larger
        for a user who asked for that. Callers rendering free-flowing body copy
        raise or drop the cap themselves.
      */
      maxFontSizeMultiplier={maxFontSizeMultiplier === 0 ? undefined : maxFontSizeMultiplier}
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
