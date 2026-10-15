import { AppState } from 'react-native';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';

import { AppError } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';

/**
 * Tell TanStack Query when the app is in the foreground. React Native has no
 * window focus event, so without this `refetchOnWindowFocus` never fires and
 * `refetchInterval` keeps counting as if the app were always on screen.
 */
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

/**
 * Tell TanStack Query when the device has a network, so queries that failed
 * offline refetch by themselves the moment it returns.
 *
 * expo-network is imported lazily. It is a native module, and an OTA update can
 * deliver this file to a binary that was built before the dependency existed;
 * a top-level import would throw on launch there. Without the module the app
 * simply behaves as it did before: always assumed online.
 */
onlineManager.setEventListener((setOnline) => {
  let subscription: { remove: () => void } | undefined;
  let cancelled = false;

  import('expo-network')
    .then(async (Network) => {
      // `isConnected` can be undefined while the OS is still deciding; only a
      // definite "no" counts as offline.
      const initial = await Network.getNetworkStateAsync();
      if (cancelled) return;
      setOnline(initial.isConnected !== false);
      subscription = Network.addNetworkStateListener((state) => {
        setOnline(state.isConnected !== false);
      });
    })
    .catch((cause: unknown) => {
      logger.warn('Network state unavailable', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });

  return () => {
    cancelled = true;
    subscription?.remove();
  };
});

/** Retrying these cannot succeed, or (rate limits) makes the problem worse. */
const NO_RETRY = ['unauthorized', 'forbidden', 'not_found', 'validation', 'conflict', 'rate_limited'];

/**
 * Shared TanStack Query client. Server state (matches, players, profiles) lives here.
 * Retries use exponential backoff with jitter, so a fleet of phones recovering
 * from the same outage does not retry in step.
 *
 * `networkMode: 'always'` keeps the offline behaviour every screen was written
 * for: a request made offline FAILS and shows its error state. The default mode
 * would pause it instead, leaving a spinner with no explanation — and a paused
 * mutation fires whenever the network returns, which could book a slot minutes
 * after the user gave up on the button.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      networkMode: 'always',
      retry: (failureCount, error) => {
        if (error instanceof AppError && NO_RETRY.includes(error.code)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => {
        const base = Math.min(1000 * 2 ** attempt, 8000);
        return base / 2 + Math.random() * (base / 2);
      },
      // Realtime does not replay what it missed while the socket was down in
      // the background, so stale queries catch up when the app returns.
      refetchOnWindowFocus: true,
      // Explicit: it defaults to off under networkMode 'always'.
      refetchOnReconnect: true,
    },
    mutations: { retry: 0, networkMode: 'always' },
  },
});
