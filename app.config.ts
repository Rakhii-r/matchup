import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Environment-driven Expo config.
 * Values come from the shell / EAS env; never hardcode secrets here.
 * Anything under `extra` is readable at runtime via expo-constants.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'P24',
  slug: 'matchup',
  scheme: 'matchup',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.asrdigi.matchup',
  },
  android: {
    package: 'com.asrdigi.matchup',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0F0F10',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/images/logo-p24.png',
        resizeMode: 'contain',
        backgroundColor: '#0F0F10',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'P24 uses your location to find nearby matches and venues.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'P24 uses your photos so you can set a profile picture.',
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
    posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    demoMatches: process.env.EXPO_PUBLIC_DEMO_MATCHES ?? 'false',
  },
});
