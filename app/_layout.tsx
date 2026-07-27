import { useEffect, useRef, useState, useCallback } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { useAuthStore } from '@core/auth/authStore';
import { initAnalytics } from '@core/observability/analytics';
import { initSentry, Sentry } from '@core/observability/sentry';
import { AppProviders } from '@app-providers/AppProviders';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppSplash } from '@shared/ui/splash/AppSplash';

// Keep native splash visible until we are ready to replace it with AppSplash.
void SplashScreen.preventAutoHideAsync();

// Initialise observability as early as possible (no-ops without keys configured).
const sentryEnabled = initSentry();
void initAnalytics();

function RouteGuard(): null {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const inAuthGroup = segments[0] === '(auth)';
    const onCreateProfile = inAuthGroup && segments.at(1) === 'create-profile';

    if (status === 'signed_out' && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (status === 'needs_profile' && !onCreateProfile) {
      router.replace('/(auth)/create-profile');
    } else if (status === 'signed_in' && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  return null;
}

function ThemedStatusBar(): React.ReactElement {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

function RootLayout(): React.ReactNode {
  const authStatus = useAuthStore((s) => s.status);
  // splashVisible: true until auth resolves (loading → anything else)
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashHidden, setSplashHidden] = useState(false);
  const nativeSplashHidden = useRef(false);

  // Hide native splash immediately once JS is running — AppSplash takes over.
  useEffect(() => {
    if (!nativeSplashHidden.current) {
      nativeSplashHidden.current = true;
      void SplashScreen.hideAsync();
    }
  }, []);

  // When auth resolves, start AppSplash fade-out sequence.
  useEffect(() => {
    if (authStatus !== 'loading') {
      setSplashVisible(false);
    }
  }, [authStatus]);

  const onSplashHidden = useCallback(() => {
    setSplashHidden(true);
  }, []);

  return (
    <AppProviders>
      <ThemedStatusBar />
      <RouteGuard />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="match" options={{ presentation: 'modal' }} />
      </Stack>

      {/* AppSplash overlays everything until auth resolves + animation completes */}
      {!splashHidden ? (
        <AppSplash visible={splashVisible} onHidden={onSplashHidden} />
      ) : null}
    </AppProviders>
  );
}

export default sentryEnabled ? Sentry.wrap(RootLayout) : RootLayout;
