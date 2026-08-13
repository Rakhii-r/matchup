/**
 * Dark palette used by the redesigned mockup screens (Create Match, Complete
 * Profile, Available, Venues, Profile). These screens are dark-only by design,
 * so the tokens are fixed rather than theme-driven. Single source of truth for
 * their colours and spacing.
 */
export const M = {
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
  danger: '#FF7A7A',
  overlay: 'rgba(0,0,0,0.45)',
} as const;

/** Spacing scale local to the mockup screens (matches the global scale). */
export const S = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** Corner radii used across the mockup cards and pills. */
export const R = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;
