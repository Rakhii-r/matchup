/** Design tokens. Single source of truth for colour, spacing and type. */

export type ColorScheme = 'light' | 'dark';

export const lightColors = {
  // sixfour24 brand chartreuse. #98BB01 on white fails WCAG AA for small text,
  // so it is used for fills and never for body copy — text on it is textInverse
  // (near-black), which passes comfortably.
  primary: '#98BB01',
  primaryDark: '#5A7400',
  accent: '#98BB01',
  success: '#2E7D32',
  danger: '#C62828',
  warning: '#ED6C02',
  background: '#FFFFFF',
  surface: '#F4F8FB',
  border: '#D9E2EC',
  text: '#1A2330',
  textMuted: '#5B6675',
  textInverse: '#FFFFFF',
  // Text placed on the auth screens' photographic background. That background
  // carries a dark gradient overlay in BOTH schemes, so this stays white in
  // light mode too — `text` would be near-invisible there.
  onPhoto: '#FFFFFF',
} as const;

// Dark palette aligned to the sixfour24 mockup tokens (see mockTheme.ts) so the shared
// components (Screen/Button/TextField/AppText) match the redesigned dark screens.
export const darkColors = {
  // Brand chartreuse. `success` stays a separate green: a "match completed"
  // badge must not be indistinguishable from a primary button.
  primary: '#98BB01',
  primaryDark: '#5A7400',
  accent: '#AEC902',
  success: '#22C55E',
  danger: '#FF7A7A',
  warning: '#FFA726',
  background: '#0F0F10',
  surface: '#1A1A1D',
  border: '#2A2B2F',
  text: '#FFFFFF',
  textMuted: '#A1A1AA',
  textInverse: '#141600',
  onPhoto: '#FFFFFF',
} as const;

export type AppColors = { readonly [K in keyof typeof lightColors]: string };

// There is deliberately no static `colors` export. It used to alias darkColors,
// which meant every screen importing it rendered dark regardless of the theme
// toggle. Read colours from `useTheme()` instead — it is the only accessor.

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
