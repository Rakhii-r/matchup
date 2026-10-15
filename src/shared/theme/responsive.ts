/**
 * The responsive layer. Deliberately small.
 *
 * Layout in this app is Flexbox, and it stays Flexbox — this file does NOT
 * scale the UI by screen width. Multiplying every size by `width / 375` is the
 * classic shortcut and it is the wrong fix: it makes a 4.7" phone render a
 * miniature of a 6.7" phone, so nothing is ever the right physical size and
 * text stops matching the user's own accessibility setting.
 *
 * What actually varies between devices, and is therefore all this file does:
 *
 *   1. SAFE AREAS. The system bars are a real, measurable size that Flexbox
 *      cannot know about. Every hook here that returns padding exists for this.
 *   2. HOW MUCH ROOM A HORIZONTAL RAIL CARD SHOULD TAKE. A fixed 250 is 78% of
 *      a 320dp phone and 58% of a 430dp one. Expressed as a fraction with
 *      bounds, one rail reads the same on both.
 *   3. WHETHER THERE IS SO MUCH WIDTH THAT A COLUMN SHOULD STOP GROWING —
 *      i.e. tablets, where a full-bleed form line is unreadably long.
 *
 * Everything else — spacing, radii, font sizes — stays constant on purpose.
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { S } from '@shared/theme/mockTheme';

/**
 * Width at which a phone layout stops being the right answer.
 *
 * 600dp is the same threshold Android uses for its "large" resource bucket and
 * is comfortably above every phone in portrait, so it never fires by accident
 * on a large handset.
 */
export const TABLET_MIN_WIDTH = 600;

/**
 * The widest a single reading column should get.
 *
 * Not a device size — a typographic one. Past roughly this width a line of body
 * text is tiring to read, so the column stops growing and centres instead.
 */
export const CONTENT_MAX_WIDTH = 560;

/** Below this, a 320dp-class phone: the tightest layout the app must survive. */
export const COMPACT_MAX_WIDTH = 360;

/**
 * Height of the bottom tab bar's own chrome, EXCLUDING the system inset.
 *
 * Declared here rather than in `(tabs)/_layout.tsx` because two places need to
 * agree on it: the bar sizes itself with it, and every tab screen's scroll
 * content has to reserve it or the last card sits underneath the bar. This
 * build has no `@react-navigation/bottom-tabs` to ask (expo-router 56 uses a
 * different navigation core), so one exported constant IS the source of truth.
 */
export const TAB_BAR_HEIGHT = 66;

/**
 * Gap between the floating tab bar and the bottom of the safe area.
 *
 * The bar is a rounded card that does not touch the screen edge, so scroll
 * content has to clear the bar AND this gap.
 */
export const TAB_BAR_GAP = 10;

/**
 * Cap on the OS font-scaling multiplier.
 *
 * Accessibility text scaling is honoured — it is simply bounded. Android and
 * iOS both allow multipliers past 2x, which no fixed-height row survives, so
 * the choice is between clipped text and slightly-less-than-requested text.
 * 1.3 keeps every label legible and inside its container; body copy, which
 * wraps freely and is the text that actually matters for accessibility, is
 * allowed further at the call site.
 */
export const MAX_FONT_SCALE = 1.3;

export interface Responsive {
  width: number;
  height: number;
  /** Phone in the 320dp class. Tighten gaps, allow more wrapping. */
  isCompact: boolean;
  /** 600dp+. Constrain reading columns, allow two-up layouts. */
  isTablet: boolean;
  /**
   * Width for a card in a horizontal rail: a fraction of the viewport, bounded
   * so it never becomes a sliver on a tablet or eat the whole screen on a small
   * phone. The peek of the next card is what tells the user the rail scrolls,
   * which is why this is a fraction and not a constant.
   */
  railCardWidth: (fraction?: number, min?: number, max?: number) => number;
  /**
   * Height cap for a scrollable region inside a sheet or picker, as a fraction
   * of the viewport. A constant 320 is over half of a small phone's screen and
   * a quarter of a tablet's.
   */
  clampHeight: (fraction: number, min?: number, max?: number) => number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Layout facts about the CURRENT window. Re-reads on rotation and split-screen. */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  return useMemo(
    () => ({
      width,
      height,
      isCompact: width <= COMPACT_MAX_WIDTH,
      isTablet: width >= TABLET_MIN_WIDTH,
      railCardWidth: (fraction = 0.66, min = 200, max = 300) =>
        Math.round(clamp(width * fraction, min, max)),
      clampHeight: (fraction, min = 160, max = 520) =>
        Math.round(clamp(height * fraction, min, max)),
    }),
    [width, height],
  );
}

/**
 * Bottom padding that clears the home indicator / gesture bar / nav buttons.
 *
 * `insets.bottom` is 0 on a device with hardware keys and up to ~34 on a
 * gesture-nav device, so a constant cannot serve both. The extra `S.md` is
 * ordinary breathing room, applied either way, so content never sits flush
 * against the very bottom edge on the phones that report no inset at all.
 */
export function useBottomInset(extra: number = S.md): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + extra;
}

/**
 * Bottom padding for scrollable content on a screen inside the tab bar.
 *
 * Nothing reserves this automatically. Every tab screen used a flat
 * `paddingBottom: S.xl` (32), against a bar that is 62 plus the device inset —
 * so the last card in every list was 30 to 64 points underneath it, worse on
 * exactly the gesture-navigation devices that report the largest inset.
 */
export function useTabContentPadding(extra: number = S.lg): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + insets.bottom + extra;
}

/**
 * The two things every bottom sheet in this app was missing.
 *
 * `paddingBottom` keeps the last row — usually the confirm button — above the
 * gesture bar. `maxHeight` stops a sheet with a long list from running past the
 * top of the screen, which it will do on a small phone with any list that has
 * more than a handful of rows.
 *
 * Spread into the sheet's existing style rather than wrapping it in a new
 * component, so no sheet's JSX has to be restructured to get the fix.
 */
export function useSheetInsets(): { paddingBottom: number; maxHeight: number } {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return useMemo(
    () => ({
      paddingBottom: insets.bottom + S.lg,
      // Leave the top inset plus a thumb's worth of backdrop visible, so the
      // sheet always reads as a sheet and the backdrop stays tappable.
      maxHeight: Math.round(height - insets.top - S.xl * 2),
    }),
    [height, insets.bottom, insets.top],
  );
}
