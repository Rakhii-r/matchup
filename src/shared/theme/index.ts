/** Design tokens. Single source of truth for colour, spacing and type. */

export type ColorScheme = 'light' | 'dark';

/*
  PALETTE: Stitch "Dynamic Athletic Turf".

  Values come from the token block at the top of stitch/DESIGN.md, NOT from its
  prose -- the two disagree (the prose names #047857/#10B981/#F97316, the tokens
  name #005d42/#047857/#af4b00) and it is the tokens that the exported Tailwind
  config and the rendered mockup actually use.

  The old sixfour24 chartreuse (#98BB01) is gone from both schemes.
*/
export const lightColors = {
  // Primary deep forest emerald green matching the design UI
  primary: '#006341',
  primaryDark: '#00482f',
  // Mint accent for highlights, chips and badges
  accent: '#10B981',
  success: '#006341',
  danger: '#dc2626',
  warning: '#f59e0b',
  background: '#F8FAF9',
  surface: '#ffffff',
  border: '#E2EAE5',
  text: '#0F172A',
  textMuted: '#64748B',
  textInverse: '#ffffff',
  onPhoto: '#FFFFFF',
} as const;

export const darkColors = {
  primary: '#10B981',
  primaryDark: '#059669',
  accent: '#34D399',
  success: '#10B981',
  danger: '#f87171',
  warning: '#fbbf24',
  background: '#0B1310',
  surface: '#131F1A',
  border: '#243B32',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textInverse: '#06281E',
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

// Stitch `rounded`: DEFAULT 0.5rem, md 0.75rem, lg 1rem, xl 1.5rem, full.
// Spacing is deliberately NOT changed to Stitch's scale -- that would reflow
// every screen in the app, which is a layout change, not a rebrand.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/*
  Stitch pairs two faces: Space Grotesk for headings, numerals and labels;
  Hanken Grotesk for body copy. Each entry names the EXACT loaded face rather
  than a family plus a weight, because React Native cannot synthesise a weight
  the way a browser can -- naming a face that was not loaded in app/_layout.tsx
  silently falls back to the system font.

  letterSpacing is in points here, not em: Stitch's -0.025em at 30px is -0.75.
*/
export const typography = {
  title: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.75,
    fontWeight: '700' as const,
  },
  heading: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontWeight: '600' as const,
  },
  body: {
    fontFamily: 'HankenGrotesk_400Regular',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  label: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.14,
    fontWeight: '600' as const,
  },
  caption: {
    fontFamily: 'HankenGrotesk_400Regular',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
  },
} as const;
