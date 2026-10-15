import * as Sentry from '@sentry/react-native';

import { env, isProd } from '@core/config/env';
import { registerLogSink } from '@core/logging/logger';

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

  // Outside development the logger prints nothing, so without this sink a
  // logger.error in a release build reached nobody. Errors become events;
  // warnings ride along as breadcrumbs on whatever is reported next.
  registerLogSink((level, message, context) => {
    if (level === 'error') {
      Sentry.captureMessage(message, { level: 'error', extra: context });
    } else if (level === 'warn') {
      Sentry.addBreadcrumb({ level: 'warning', message, data: context });
    }
  });
  return true;
}

export function setSentryUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}

export { Sentry };
