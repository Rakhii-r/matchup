import * as Sentry from '@sentry/react-native';

import { env, isProd } from '@core/config/env';

/**
 * Initialise Sentry. Returns true only when a DSN is configured and init actually ran.
 * The caller uses this to decide whether to apply `Sentry.wrap` to the root component:
 * wrapping without a prior `Sentry.init` triggers an "App Start Span" console warning.
 */
export function initSentry(): boolean {
  if (!env.sentryDsn) return false;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.appEnv,
    // Only send events in staging/production to avoid noise during development.
    enabled: isProd || env.appEnv === 'staging',
    tracesSampleRate: isProd ? 0.2 : 1.0,
  });
  return true;
}

export function setSentryUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}

export { Sentry };
