import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { supabase } from '@core/api/supabaseClient';
import { useAuthStore } from '@core/auth/authStore';
import { matchRepository } from '@features/matches/data/matchRepository';
import type { Challenge } from '@features/teams/domain/challengeSchema';

interface NotificationJobRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: {
    route?: string;
    challengeId?: string;
    matchId?: string;
    teamId?: string;
    /** `match_players.id` of the request, on `join_requested` jobs only. */
    playerRowId?: string;
  } | null;
}

/** `/match/<uuid>` -> the uuid. Some jobs carry the match only in their route. */
function matchIdFromRoute(route: string | undefined): string | undefined {
  return route?.match(/^\/match\/([0-9a-f-]{36})$/i)?.[1];
}

/**
 * App-wide in-app popups, driven by the user's own rows in `notification_jobs`.
 *
 * Every event that deserves a popup — a squad applying to your fixture, a join
 * request, your request being approved, a fixture being confirmed — is already
 * written to that queue by the database for push delivery. This used to ALSO
 * listen to `challenge_candidates` and `match_players` directly, which had two
 * costs: the same event raised two popups, and those listeners could not be
 * filtered by user, so Realtime ran every signed-in user's RLS check against
 * every row change on both tables.
 *
 * One exception remains: accepting a DIRECT challenge (`respond_to_challenge`)
 * enqueues nothing for the challenger, so `team_challenges` is still watched,
 * filtered to the challenges this user posted.
 */
export function MatchJoinAlerts(): null {
  const userId = useAuthStore((state) => state.session?.user.id);
  const queryClient = useQueryClient();
  const router = useRouter();
  const handledEvents = useRef(new Set<string>());

  const [instanceId] = useState(() => Math.random().toString(36).slice(2, 10));

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['challenges'] });
    void queryClient.invalidateQueries({ queryKey: ['challenge'] });
    void queryClient.invalidateQueries({ queryKey: ['matches'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['pending_actions'] });
  };

  useEffect(() => {
    if (!userId) return;

    const topic = `match-join-alerts:${userId}:${instanceId}`;
    for (const stale of supabase.getChannels()) {
      if (stale.topic === `realtime:${topic}`) void supabase.removeChannel(stale);
    }

    const channel = supabase
      .channel(topic)
      // 1. Notification Jobs (Instant in-app push/popup for any enqueued notification)
      .on(
        'postgres_changes',
        // Filtered server-side: without it Realtime runs this user's RLS check
        // against every notification written for anyone.
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification_jobs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const job = payload.new as NotificationJobRow;
          if (job.user_id !== userId) return;

          const eventKey = `notif:${job.id}`;
          if (handledEvents.current.has(eventKey)) return;
          handledEvents.current.add(eventKey);

          const route = job.data?.route;
          const challengeId = job.data?.challengeId;
          const matchId = job.data?.matchId;
          const playerRowId = job.data?.playerRowId;

          // A confirmed fixture also arrives through listener 2 below. Whichever
          // lands first shows the popup; the other is dropped.
          if (job.kind === 'challenge_accepted') {
            const confirmedId = matchId ?? matchIdFromRoute(route);
            if (confirmedId) {
              const confirmedKey = `confirmed:${confirmedId}`;
              if (handledEvents.current.has(confirmedKey)) return;
              handledEvents.current.add(confirmedKey);
            }
          }

          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          invalidateAll();

          const buttons: { text: string; style?: 'cancel' | 'default' | 'destructive'; onPress?: () => void }[] = [
            { text: 'Later', style: 'cancel' },
          ];

          // One-tap approval straight from the popup. Older database versions
          // do not send playerRowId; the popup then offers "View Game" only.
          if (job.kind === 'join_requested' && playerRowId) {
            buttons.push({
              text: 'Accept',
              onPress: () => {
                void matchRepository
                  .setPlayerStatus(playerRowId, 'approved')
                  .then(() => {
                    if (matchId) void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
                  })
                  .catch(() => Alert.alert('Could not accept player', 'Please try again from the game screen.'));
              },
            });
          }

          if (job.kind === 'challenge_interest' || challengeId) {
            buttons.push({
              text: 'View Radar ⚡',
              onPress: () => {
                const targetId = challengeId || job.data?.challengeId;
                if (targetId) {
                  router.push({
                    pathname: '/match/create/searching',
                    params: { challengeId: targetId },
                  });
                } else if (route) {
                  router.push(route as never);
                }
              },
            });
          } else if (job.kind === 'challenge_accepted' || matchId) {
            buttons.push({
              text: 'View Game 🎉',
              onPress: () => {
                if (matchId) router.push(`/match/${matchId}`);
                else if (route) router.push(route as never);
              },
            });
          } else if (route) {
            buttons.push({
              text: 'View',
              onPress: () => router.push(route as never),
            });
          }

          Alert.alert(job.title || 'Game Update', job.body || 'You have a new update.', buttons);
        },
      )
      // 2. Team Challenges this user posted (a direct challenge being accepted)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'team_challenges',
          filter: `created_by=eq.${userId}`,
        },
        (payload) => {
          const challenge = payload.new as Challenge;
          if (challenge.status !== 'accepted' || !challenge.match_id) return;

          const eventKey = `confirmed:${challenge.match_id}`;
          if (handledEvents.current.has(eventKey)) return;
          handledEvents.current.add(eventKey);

          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          invalidateAll();

          Alert.alert(
            '🎉 Game Confirmed!',
            `The match fixture “${challenge.match_name}” has been locked in!`,
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'View Game →',
                onPress: () => {
                  if (challenge.match_id) router.push(`/match/${challenge.match_id}`);
                },
              },
            ],
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [instanceId, queryClient, router, userId]);

  return null;
}
