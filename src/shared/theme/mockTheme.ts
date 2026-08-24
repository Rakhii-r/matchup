/**
 * Palette for the redesigned screens (Nearby, Create Match, Complete Profile,
 * Available, Venues, Profile).
 *
 * These were originally dark-only, with the tokens frozen as a single `M`
 * object. That is why the theme toggle did nothing: `StyleSheet.create` runs at
 * module load, so a colour read from a constant is captured once and can never
 * change, no matter what the theme context says.
 *
 * The fix is a palette per scheme plus `useMock()`, which returns the active
 * one. A screen becomes themeable by turning its `StyleSheet.create({...})`
 * into `makeStyles(M)` and calling it inside the component.
 *
 * Converted so far: app/(tabs)/index.tsx.
 * Still frozen dark: create-profile, (tabs)/_layout, available, profile,
 * venues, match/create, profile/edit. They import `M` below, which stays
 * exported for exactly that reason.
 */
import { useMemo } from 'react';

import { useTheme } from '@shared/theme/ThemeContext';

export interface MockPalette {
  bg: string;
  card: string;
  cardHi: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  green: string;
  greenDeep: string;
  lime: string;
  chip: string;
  cta: string;
  ctaText: string;
  /** Ink for text sitting on a `lime` fill. Identical in both schemes because
   *  `lime` is a brand fill in both, and contrast is carried by this ink. */
  limeInk: string;
  /** Tinted tile behind a settings/admin glyph. */
  iconChip: string;
  danger: string;
  overlay: string;
}

export const MDark: MockPalette = {
  bg: '#0F0F10',
  card: '#1A1A1D',
  cardHi: '#202124',
  border: '#2A2B2F',
  text: '#FFFFFF',
  muted: '#A1A1AA',
  faint: '#6B7075',
  green: '#98BB01',
  greenDeep: '#2E7D32',
  lime: '#8BC34A',
  chip: '#26272B',
  cta: '#EDEDED',
  ctaText: '#141414',
  limeInk: '#06230F',
  iconChip: '#173A22',
  danger: '#FF7A7A',
  overlay: 'rgba(0,0,0,0.45)',
};

/**
 * Light counterpart. `green` is darkened to #5A7400 for anything that carries
 * text: the brand chartreuse #98BB01 fails WCAG AA against white. The brand
 * colour still appears at full strength as a fill (`lime`), where contrast is
 * carried by near-black text on top rather than by the colour itself.
 */
export const MLight: MockPalette = {
  bg: '#FFFFFF',
  card: '#F4F6F2',
  cardHi: '#EAEEE4',
  border: '#D9E0CE',
  text: '#141600',
  muted: '#5B6675',
  // #8A93A0 scored 2.86:1 on `card` — below even the 3.0 large-text floor, and
  // `faint` carries captions. Darkened to clear 4.5:1 while staying visibly
  // lighter than `muted` (4.82 vs 5.36), so the hierarchy is preserved.
  faint: '#646D7A',
  green: '#5A7400',
  greenDeep: '#2E7D32',
  lime: '#98BB01',
  chip: '#EDF1E6',
  cta: '#141600',
  ctaText: '#FFFFFF',
  limeInk: '#06230F',
  iconChip: '#E4EFE0',
  danger: '#C62828',
  overlay: 'rgba(0,0,0,0.25)',
};

/**
 * The active palette. Memoised on scheme so `makeStyles(M)` only rebuilds a
 * StyleSheet when the theme actually flips, not on every render.
 */
export function useMock(): MockPalette {
  const { isDark } = useTheme();
  return useMemo(() => (isDark ? MDark : MLight), [isDark]);
}

// There is deliberately no static `M` export. Importing it was what made a
// screen ignore the theme toggle. Use `useMock()`.

/** Spacing scale local to these screens (matches the global scale). */
export const S = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** Corner radii used across these cards and pills. */
export const R = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;
