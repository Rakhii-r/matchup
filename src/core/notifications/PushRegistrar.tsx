import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import {
  isExpoGo,
  loadNotifications,
  registerForPushNotifications,
  routeFromNotification,
} from '@core/notifications/pushNotifications';

// Type-only import: erased at compile time, never loads the native module.
import type * as ExpoNotifications from 'expo-notifications';

/** Derived from the listener's own return type — the subscription type is not
 *  exported under a stable name across expo-modules-core versions. */
type NotificationSubscription = ReturnType<
  typeof ExpoNotifications.addNotificationReceivedListener
>;

/**
 * Registers the device once the user is fully signed in, and routes taps on a
 * notification to the screen it refers to.
 *
 * expo-notifications is loaded lazily inside the effect, never at module scope.
 * Importing it at the top would throw in Expo Go (SDK 53+ removed remote push
 * from the Go client) and take the whole app down with it — this component is
 * mounted by AppProviders, which every route depends on.
 *
 * Registration waits for `signed_in` rather than merely having a session:
 * register_device requires an active profile row, so firing it during the
 * create-profile step would fail the RPC's is_active check.
 */
export function PushRegistrar(): null {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.session?.user.id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'signed_in' || !userId) return;
    // Re-register only when the account changes, not on every render.
    if (registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPushNotifications();
  }, [status, userId]);

  // Clear the guard on sign-out so the next user registers their own device row.
  useEffect(() => {
    if (status === 'signed_out') registeredFor.current = null;
  }, [status]);

  useEffect(() => {
    // Nothing to listen for in Expo Go — the module cannot even be loaded.
    if (isExpoGo) return;

    let active = true;
    let tapSub: NotificationSubscription | undefined;
    let receiveSub: NotificationSubscription | undefined;

    void (async () => {
      const mod = await loadNotifications();
      if (!mod || !active) return;

      // A notification that opened the app from cold start is not delivered to
      // the listener below, so it has to be read once explicitly.
      const initial = await mod.getLastNotificationResponseAsync();
      if (active && initial) {
        const route = routeFromNotification(initial);
        if (route) router.push(route as never);
      }
      if (!active) return;

      tapSub = mod.addNotificationResponseReceivedListener((response) => {
        const route = routeFromNotification(response);
        if (route) router.push(route as never);
      });

      // A push arriving while the app is open means server state just changed.
      // Refetching keeps the visible screen consistent with the notification.
      receiveSub = mod.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data as Record<string, unknown> | null;
        const matchId = data?.matchId;
        if (typeof matchId === 'string') {
          void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
        }
        void queryClient.invalidateQueries({ queryKey: ['matches'] });
        void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      });
    })();

    return () => {
      active = false;
      tapSub?.remove();
      receiveSub?.remove();
    };
  }, [router, queryClient]);

  return null;
}
