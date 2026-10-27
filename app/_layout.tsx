import { useEffect, useRef, useState, useCallback } from 'react';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';

import { bootstrapAuth } from '@core/auth/AuthProvider';
import { useAuthStore } from '@core/auth/authStore';
import { initAnalytics } from '@core/observability/analytics';
import { initSentry, Sentry } from '@core/observability/sentry';
import { AppProviders } from '@app-providers/AppProviders';
import { useTheme } from '@shared/theme/ThemeContext';
import { OfflineScreen } from '@shared/ui/OfflineScreen';
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
    // app/index.tsx is only a loading placeholder — it must never be a resting place.
    const first = segments[0] as string | undefined;
    const atEntry = first === undefined || first === 'index';

    if (status === 'signed_out' && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (status === 'needs_profile' && !onCreateProfile) {
      router.replace('/(auth)/create-profile');
    } else if (status === 'signed_in' && (inAuthGroup || atEntry)) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  return null;
}

/**
 * Every page shows fresh data when you land on it. Tabs and stack screens stay
 * mounted, so their queries never re-run on their own when you navigate back;
 * this refetches whatever is on screen and older than its staleTime (30s), so
 * hopping between pages quickly does not refire every request.
 */
function RefreshOnNavigate(): null {
  const pathname = usePathname();
  const queryClient = useQueryClient();

  useEffect(() => {
    void queryClient.refetchQueries({ type: 'active', stale: true });
  }, [pathname, queryClient]);

  return null;
}

function ThemedStatusBar(): React.ReactElement {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

function RootLayout(): React.ReactNode {
  const authStatus = useAuthStore((s) => s.status);

  /*
    Brand faces, loaded once at the root.

    Only the weights the type scale actually names are loaded: every extra face
    is a file downloaded on first launch, and React Native cannot synthesise a
    missing weight the way a browser can -- asking for a weight that was not
    loaded silently falls back to the system font, which is how a "mostly
    correct" screen ends up with one stray line in Roboto.

    A failed load is deliberately NOT fatal. `fontsError` still lets the app
    through on the system font: a font CDN having a bad day should not be the
    thing that stops somebody booking a pitch.
  */
  const [fontsLoaded, fontsError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
  });

  const splashVisible = authStatus === 'loading' || !(fontsLoaded || fontsError);
  const [splashHidden, setSplashHidden] = useState(false);
  const nativeSplashHidden = useRef(false);

  // Hide native splash immediately once JS is running — AppSplash takes over.
  useEffect(() => {
    if (!nativeSplashHidden.current) {
      nativeSplashHidden.current = true;
      void SplashScreen.hideAsync();
    }
  }, []);

  const onSplashHidden = useCallback(() => {
    setSplashHidden(true);
  }, []);

  return (
    <AppProviders>
      <ThemedStatusBar />
      <RouteGuard />
      <RefreshOnNavigate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="admin" />
        {/* teams has its own _layout that styles the header for the whole group. */}
        <Stack.Screen name="teams" />
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="match" options={{ presentation: 'modal' }} />
        <Stack.Screen name="chat" options={{ presentation: 'card' }} />
      </Stack>

      {authStatus === 'offline' ? <OfflineScreen onRetry={bootstrapAuth} /> : null}

      {/* AppSplash overlays everything until auth resolves + animation completes */}
      {!splashHidden ? (
        <AppSplash visible={splashVisible} onHidden={onSplashHidden} />
      ) : null}
    </AppProviders>
  );
}

export default sentryEnabled ? Sentry.wrap(RootLayout) : RootLayout;
