/** Design tokens. Single source of truth for colour, spacing and type. */

export type ColorScheme = 'light' | 'dark';

export const lightColors = {
  primary: '#1F4E79',
  primaryDark: '#163A5A',
  accent: '#2E75B6',
  success: '#2E7D32',
  danger: '#C62828',
  warning: '#ED6C02',
  background: '#FFFFFF',
  surface: '#F4F8FB',
  border: '#D9E2EC',
  text: '#1A2330',
  textMuted: '#5B6675',
  textInverse: '#FFFFFF',
} as const;

// Dark palette aligned to the P24 mockup tokens (see mockTheme.ts) so the shared
// components (Screen/Button/TextField/AppText) match the redesigned dark screens.
export const darkColors = {
  primary: '#22C55E',
  primaryDark: '#16A34A',
  accent: '#22C55E',
  success: '#22C55E',
  danger: '#FF7A7A',
  warning: '#FFA726',
  background: '#0F0F10',
  surface: '#1A1A1D',
  border: '#2A2B2F',
  text: '#FFFFFF',
  textMuted: '#A1A1AA',
  textInverse: '#06230F',
} as const;

export type AppColors = { readonly [K in keyof typeof lightColors]: string };

/**
 * Static token set used by screens that import `colors` directly (admin, match, etc.).
 * Points at the dark P24 palette so those screens match the redesigned dark app.
 * @deprecated Prefer useTheme().colors in new components.
 */
export const colors = darkColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
} as const;
