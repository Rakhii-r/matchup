import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing } from '@shared/theme';
import { CONTENT_MAX_WIDTH, useBottomInset, useResponsive } from '@shared/theme/responsive';
import { useTheme } from '@shared/theme/ThemeContext';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  /**
   * Set on a screen that sits inside the bottom tab bar. The bar already
   * reserves the bottom inset, so adding it again would double the gap.
   * Stack screens — which is almost every caller — leave this alone.
   */
  insideTabs?: boolean;
  /**
   * Opt out of the keyboard avoidance on a screen with no text input. Costs
   * nothing to leave on, but a screen that manages its own keyboard behaviour
   * (the chat thread) should not have two handlers fighting.
   */
  avoidKeyboard?: boolean;
}

/**
 * Standard screen wrapper: safe-area aware, consistent padding and background.
 *
 * THREE THINGS THIS HANDLES THAT EVERY CALLER USED TO GET WRONG.
 *
 * 1. THE BOTTOM INSET. `edges` used to be `['top','left','right']`, which is
 *    correct for a tab screen — the tab bar owns the bottom — but this wrapper
 *    is used by ~30 STACK screens, where nothing owns it. Their last list row
 *    and their primary button sat under the Android gesture bar / nav buttons /
 *    iOS home indicator. The inset is applied as padding rather than as a
 *    safe-area edge so that a scrolling screen can still draw its background
 *    right to the bottom of the glass while its CONTENT stops short.
 *
 * 2. THE KEYBOARD. Several callers are forms (`teams/create`, `teams/join`,
 *    `match/join`) whose input sits low enough to be covered on a short phone.
 *    `padding` on iOS and `height` on Android is the combination that behaves
 *    with `windowSoftInputMode=adjustResize`, which is Expo's default.
 *
 * 3. LONG LINES ON WIDE SCREENS. On a tablet a full-bleed form row is a
 *    500pt-wide input, which looks broken rather than spacious. The column
 *    stops at CONTENT_MAX_WIDTH and centres. On a phone this is inert: the
 *    viewport is always narrower than the cap, so nothing moves.
 */
export function Screen({
  children,
  scroll = false,
  insideTabs = false,
  avoidKeyboard = true,
}: ScreenProps): ReactNode {
  const { colors } = useTheme();
  const { isTablet } = useResponsive();
  const bottomInset = useBottomInset();

  // A tab screen's bottom is already reserved by the bar itself.
  const paddingBottom = insideTabs ? spacing.lg : bottomInset;

  const column = isTablet
    ? { width: '100%' as const, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' as const }
    : null;

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[
        { padding: spacing.lg, paddingBottom, flexGrow: 1 },
        column,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: spacing.lg, paddingBottom }, column]}>{children}</View>
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'left', 'right']}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}
