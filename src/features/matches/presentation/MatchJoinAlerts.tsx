import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@core/api/supabaseClient';
import { useAuthStore } from '@core/auth/authStore';
import { matchRepository } from '@features/matches/data/matchRepository';
import type { MatchPlayer } from '@features/matches/domain/matchSchema';

/**
 * App-wide realtime dialogs for the join approval flow. Supabase Realtime
 * applies the table's RLS policies, so users receive only rows they may read:
 * creators receive requests for their matches and players receive their own.
 */
export function MatchJoinAlerts(): null {
  const userId = useAuthStore((state) => state.session?.user.id);
  const queryClient = useQueryClient();
  const handledEvents = useRef(new Set<string>());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`match-join-alerts:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_players' },
        (payload) => {
          const request = payload.new as MatchPlayer;
          const eventKey = `insert:${request.id}`;
          if (handledEvents.current.has(eventKey)) return;
          handledEvents.current.add(eventKey);

          void (async () => {
            const match = await matchRepository.getById(request.match_id);
            if (!match || match.creator_id !== userId || request.status !== 'interested') return;

            const players = await matchRepository.listPlayers(request.match_id);
            const player = players.find((item) => item.id === request.id);
            const playerName = player?.profile?.full_name ?? 'A player';

            Alert.alert(
              'New join request',
              `${playerName} is interested in joining “${match.match_name}”.`,
              [
                { text: 'Later', style: 'cancel' },
                {
                  text: 'Accept',
                  onPress: () => {
                    void matchRepository
                      .setPlayerStatus(request.id, 'approved')
                      .then(() => {
                        void queryClient.invalidateQueries({ queryKey: ['match', request.match_id] });
                      })
                      .catch(() => Alert.alert('Could not accept player', 'Please try again from the match screen.'));
                  },
                },
              ],
            );
          })().catch(() => {
            // The request remains visible in the match screen if enrichment fails.
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'match_players' },
        (payload) => {
          const membership = payload.new as MatchPlayer;
          if (membership.user_id !== userId || membership.status !== 'approved') return;

          const eventKey = `approved:${membership.id}`;
          if (handledEvents.current.has(eventKey)) return;
          handledEvents.current.add(eventKey);

          void queryClient.invalidateQueries({ queryKey: ['match', membership.match_id] });
          void (async () => {
            const match = await matchRepository.getById(membership.match_id);
            Alert.alert(
              'Join request accepted',
              match
                ? `You have been accepted for “${match.match_name}”.`
                : 'The match creator accepted your join request.',
            );
          })().catch(() => {
            Alert.alert('Join request accepted', 'The match creator accepted your join request.');
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  return null;
}
