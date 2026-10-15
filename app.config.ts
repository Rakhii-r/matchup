import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Environment-driven Expo config.
 * Values come from the shell / EAS env; never hardcode secrets here.
 * Anything under `extra` is readable at runtime via expo-constants.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'SIXFOUR 24',
  slug: 'matchup',
  scheme: 'sixfour24',
  version: '1.0.0',
  // EAS Update. `eas update:configure` could not write these because this is a
  // dynamic config, so they are set by hand. The url is derived from the EAS
  // project id above and is public. `appVersion` policy means a build only
  // accepts OTA updates published against the same `version` string, so a
  // native change forces a new build rather than shipping a broken update.
  updates: {
    url: 'https://u.expo.dev/76ce6cc7-30a9-4810-b4f2-3f802e4ed982',
  },
  runtimeVersion: { policy: 'appVersion' },
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
    // FCM config for push. Not a secret — it ships inside every APK and its API
    // key is restricted to this package. It MUST be committed: EAS Build pulls
    // the project from git, so a gitignored file never reaches the builder and
    // the build fails resolving this path.
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0F0F10',
    },
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      // Android 13+ (API 33) requires this before any notification shows.
      'POST_NOTIFICATIONS',
    ],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-status-bar',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/images/sixfour24-logo.png',
        resizeMode: 'contain',
        backgroundColor: '#0F0F10',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'SIXFOUR 24 uses your location to find nearby matches and venues.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'SIXFOUR 24 uses your photos so you can set a profile picture.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/adaptive-icon.png',
        color: '#0F0F10',
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    // Required by getExpoPushTokenAsync. Hardcoded on purpose: this is a public
    // identifier that ships inside every build, not a secret. It was previously
    // read from EXPO_PUBLIC_EAS_PROJECT_ID with a '' fallback, which meant any
    // build missing that variable got an empty id, getExpoPushTokenAsync failed,
    // and push died silently. EAS does not inject this automatically, and
    // `eas init` cannot write it here because this config is dynamic.
    eas: { projectId: '76ce6cc7-30a9-4810-b4f2-3f802e4ed982' },
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '',
    posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    demoMatches: process.env.EXPO_PUBLIC_DEMO_MATCHES ?? 'false',
  },
});
