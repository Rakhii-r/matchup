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
 * REBRANDED (Sep 2026) from sixfour24 chartreuse to the Stitch "Dynamic
 * Athletic Turf" emerald. Because every screen reads these through `useMock()`
 * rather than a frozen constant, changing the values here re-skins the whole
 * app at once -- which is the entire reason the frozen `M` export was removed.
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
  /**
   * Ink for text sitting on a `lime` fill. It DIFFERS by scheme now: emerald is
   * a dark fill in light mode (white ink) and a pale mint in dark mode
   * (near-black ink). Under the old chartreuse both schemes shared one ink,
   * which is what the previous note here described.
   */
  limeInk: string;
  /** Tinted tile behind a settings/admin glyph. */
  iconChip: string;
  danger: string;
  overlay: string;
}

/*
  Emerald dark, derived from the Stitch light tokens (Stitch shipped light only).
  Follows the same Material tonal logic those tokens use: the pale mint becomes
  the fill and the ink on it becomes near-black.
*/
export const MDark: MockPalette = {
  bg: '#0B1310',
  card: '#131F1A',
  cardHi: '#1C2D26',
  border: '#243B32',
  text: '#F1F5F9',
  muted: '#94A3B8',
  faint: '#64748B',
  green: '#10B981',
  greenDeep: '#059669',
  lime: '#10B981',
  chip: '#1E332B',
  cta: '#10B981',
  ctaText: '#06281E',
  limeInk: '#06281E',
  iconChip: '#1A382C',
  danger: '#f87171',
  overlay: 'rgba(0,0,0,0.6)',
};

/**
 * Light counterpart with crisp emerald sports aesthetic.
 */
export const MLight: MockPalette = {
  bg: '#F8FAF9',
  card: '#ffffff',
  cardHi: '#F1F5F3',
  border: '#E2EAE5',
  text: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  green: '#006341',
  greenDeep: '#00482f',
  lime: '#006341',
  chip: '#E8F5EF',
  cta: '#006341',
  ctaText: '#ffffff',
  limeInk: '#ffffff',
  iconChip: '#E8F5EF',
  danger: '#dc2626',
  overlay: 'rgba(0,0,0,0.3)',
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

/** Corner radii, matching Stitch's `rounded` scale. */
export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;
