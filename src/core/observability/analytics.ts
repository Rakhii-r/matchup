import PostHog from 'posthog-react-native';

import { env } from '@core/config/env';
import { logger } from '@core/logging/logger';

/**
 * Thin analytics wrapper around PostHog. Funnel events for the Phase 1 loop
 * (signup -> profile -> create -> join -> approve -> attended) flow through here.
 * No-ops cleanly when no key is configured.
 */
let client: PostHog | null = null;

export async function initAnalytics(): Promise<void> {
  if (!env.posthogKey) return;
  try {
    client = new PostHog(env.posthogKey, { host: env.posthogHost });
    await client.ready();
  } catch (error) {
    logger.warn('Analytics init failed', { error: String(error) });
  }
}

/** Canonical Phase 1 funnel event names. Keep this list as the single source of truth. */
export type AnalyticsEvent =
  | 'otp_requested'
  | 'otp_verified'
  | 'profile_created'
  | 'match_created'
  | 'match_browsed'
  | 'join_requested'
  // Taking a seat in a Post a Match fixture. Distinct from 'join_requested',
  // which is a request awaiting an organiser — this one is already confirmed.
  | 'open_match_joined'
  | 'player_needed_sent'
  | 'interest_approved'
  | 'team_locked'
  | 'match_cancelled'
  | 'attendance_marked'
  | 'available_toggled'
  | 'user_reported'
  | 'user_blocked';

export const analytics = {
  identify(userId: string): void {
    client?.identify(userId);
  },
  capture(
    event: AnalyticsEvent,
    properties?: Parameters<PostHog['capture']>[1],
  ): void {
    client?.capture(event, properties);
  },
  reset(): void {
    client?.reset();
  },
};
