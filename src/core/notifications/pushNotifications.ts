import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { supabase } from '@core/api/supabaseClient';
import { logger } from '@core/logging/logger';

// Type-only. Erased at compile time, so importing this does NOT load the native
// module and cannot throw in Expo Go.
import type * as ExpoNotifications from 'expo-notifications';

/**
 * Push notification plumbing: permission, Expo push token, and the round trip
 * to `public.devices` via the register_device / unregister_device RPCs.
 *
 * ## Why expo-notifications is loaded lazily
 *
 * Since SDK 53, `expo-notifications` THROWS ON IMPORT inside Expo Go, because
 * remote push was removed from the Go client:
 *
 *   "Android Push notifications (remote notifications) functionality provided
 *    by expo-notifications was removed from Expo Go with the release of SDK 53."
 *
 * A top-level `import * as Notifications from 'expo-notifications'` therefore
 * takes down every module that transitively imports it — which, via
 * AppProviders, is the entire app. Loading it inside a function, only after the
 * Expo Go check, keeps the app usable in Go and lets push work in a dev build.
 *
 * The token stored is an EXPO push token, not a raw FCM token. Expo's service
 * relays to FCM/APNs. The database column is still `fcm_token`; see the comment
 * on it in the push_notifications migration.
 *
 * Nothing here throws at the caller. Push is an enhancement: a user who denies
 * the permission, or runs Expo Go, must still get a fully working app.
 */

const ANDROID_CHANNEL_ID = 'default';

/**
 * True inside Expo Go. `executionEnvironment` is 'storeClient' there, and
 * 'standalone' / 'bare' in dev builds and production builds.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Cached module handle so the dynamic import only resolves once. */
let notificationsModule: typeof ExpoNotifications | null = null;
let handlerConfigured = false;

/**
 * Loads expo-notifications, or returns null when it cannot be used. Callers must
 * treat null as "push is unavailable here" and carry on.
 */
export async function loadNotifications(): Promise<typeof ExpoNotifications | null> {
  if (isExpoGo) return null;
  if (notificationsModule) return notificationsModule;

  try {
    const mod = await import('expo-notifications');
    notificationsModule = mod;

    if (!handlerConfigured) {
      // Show the banner even while the app is foregrounded.
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerConfigured = true;
    }

    return mod;
  } catch (cause) {
    logger.warn('expo-notifications unavailable', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

/** The EAS project id, required by getExpoPushTokenAsync since SDK 49. */
function readProjectId(): string | null {
  const fromEas = Constants.expoConfig?.extra?.eas as { projectId?: unknown } | undefined;
  if (typeof fromEas?.projectId === 'string' && fromEas.projectId.length > 0) {
    return fromEas.projectId;
  }
  const legacy = (Constants as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
}

async function ensureAndroidChannel(mod: typeof ExpoNotifications): Promise<void> {
  if (Platform.OS !== 'android') return;
  await mod.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Match updates',
    importance: mod.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: mod.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Asks for permission if undecided. Returns false when previously denied —
 * asking again does nothing, the OS only prompts once.
 */
async function ensurePermission(mod: typeof ExpoNotifications): Promise<boolean> {
  const current = await mod.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;

  const requested = await mod.requestPermissionsAsync();
  return requested.granted;
}

/** The token this session registered, so sign-out knows what to remove. */
let activeToken: string | null = null;

/**
 * Registers this device for push against the signed-in user. Safe to call more
 * than once — register_device upserts on the token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    logger.info('Push skipped: Expo Go cannot receive remote notifications. Use a dev build.');
    return null;
  }

  // Simulators and emulators cannot receive push.
  if (!Device.isDevice) {
    logger.debug('Push skipped: not a physical device');
    return null;
  }

  const projectId = readProjectId();
  if (!projectId) {
    logger.warn(
      'Push skipped: no EAS projectId. Set EXPO_PUBLIC_EAS_PROJECT_ID or run `eas init`.',
    );
    return null;
  }

  const mod = await loadNotifications();
  if (!mod) return null;

  try {
    await ensureAndroidChannel(mod);

    const granted = await ensurePermission(mod);
    if (!granted) {
      logger.info('Push permission not granted');
      return null;
    }

    const { data: token } = await mod.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const { error } = await supabase.rpc('register_device', {
      in_token: token,
      in_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });

    if (error) {
      logger.error('Failed to register device for push', { error: error.message });
      return null;
    }

    activeToken = token;
    logger.info('Device registered for push');
    return token;
  } catch (cause) {
    logger.error('Push registration threw', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

/**
 * Removes this device's token. Must run BEFORE supabase.auth.signOut(), because
 * unregister_device is scoped by auth.uid() and the session is gone afterwards.
 * Without this the next person to use the phone gets the previous user's pushes.
 */
export async function unregisterForPushNotifications(): Promise<void> {
  if (!activeToken) return;
  const token = activeToken;
  activeToken = null;

  try {
    const { error } = await supabase.rpc('unregister_device', { in_token: token });
    if (error) logger.warn('Failed to unregister device', { error: error.message });
  } catch (cause) {
    logger.warn('Unregister threw', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Pulls the in-app route out of a notification payload. The server puts it in
 * `data.route` (see enqueue_notification callers). Treated as untrusted: only
 * app-relative paths are accepted, so a malformed payload cannot send the user
 * to an external URL.
 */
export function routeFromNotification(
  response: ExpoNotifications.NotificationResponse,
): string | null {
  const data = response.notification.request.content.data as Record<string, unknown> | null;
  const route = data?.route;
  if (typeof route !== 'string') return null;
  if (!route.startsWith('/') || route.startsWith('//')) return null;
  return route;
}
