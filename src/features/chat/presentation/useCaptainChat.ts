import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@core/api/supabaseClient';
import { useAuthStore } from '@core/auth/authStore';
import { chatRepository, isResolvableThread } from '@features/chat/data/chatRepository';
import type { ChatMessage, ChatThread, SendMessageInput } from '@features/chat/domain/chatSchema';

export const chatKeys = {
  all: ['chat'] as const,
  inbox: ['chat', 'inbox'] as const,
  thread: (t: ChatThread) =>
    [
      'chat',
      'thread',
      t.matchId ?? null,
      t.challengeId ?? null,
      t.toTeamId ?? null,
      t.otherUserId ?? null,
    ] as const,
};

export function useChatMessages(thread: ChatThread) {
  return useQuery({
    queryKey: chatKeys.thread(thread),
    queryFn: () => chatRepository.getMessages(thread),
    enabled: isResolvableThread(thread),
    // No refetchInterval. useChatRealtime below invalidates on INSERT, and a
    // 5s poll on top of that was a second request per user per 5s for nothing.
  });
}

/** The caller's conversations with unread counts, for the inbox and its badge. */
export function useChatInbox() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: chatKeys.inbox,
    queryFn: () => chatRepository.listConversations(userId ?? ''),
    enabled: Boolean(userId),
  });
}

export function useSendMessage(thread: ChatThread) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput) => chatRepository.sendMessage(input),
    onSuccess: (newMessage) => {
      qc.setQueryData<ChatMessage[]>(chatKeys.thread(thread), (old = []) =>
        old.some((m) => m.id === newMessage.id) ? old : [...old, newMessage],
      );
      void qc.invalidateQueries({ queryKey: chatKeys.thread(thread) });
      void qc.invalidateQueries({ queryKey: chatKeys.inbox });
    },
  });
}

/**
 * A supabase realtime channel topic must be unique per HOOK INSTANCE, not per
 * entity: realtime-js dedupes in RealtimeClient.channel(topic) and returns the
 * EXISTING channel, and calling .on() on one that has already subscribed throws
 * a render error. A native stack keeps the screen under a pushed route mounted,
 * and removeChannel is async, so a remount races its own teardown. Same pattern
 * as useMatchPlayersRealtime and MatchJoinAlerts -- see the project note on
 * realtime channel topics.
 */
export function useChatRealtime(thread: ChatThread) {
  const qc = useQueryClient();
  const [instanceId] = useState(() => Math.random().toString(36).slice(2, 10));

  const threadId = thread.matchId ?? thread.challengeId ?? null;
  const { matchId, challengeId, toTeamId, otherUserId } = thread;

  useEffect(() => {
    if (!threadId) return;

    const topic = `chat:${threadId}:${instanceId}`;

    // Sweep our own stale topic if a fast remount beat removeChannel.
    for (const ch of supabase.getChannels()) {
      if (ch.topic === `realtime:${topic}`) void supabase.removeChannel(ch);
    }

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'captain_chat_messages' },
        (payload) => {
          const row = payload.new as ChatMessage;
          const mine =
            (matchId && row.match_id === matchId) ||
            (challengeId && row.challenge_id === challengeId);
          if (!mine) return;
          void qc.invalidateQueries({ queryKey: chatKeys.inbox });
          void qc.invalidateQueries({
            queryKey: chatKeys.thread({ matchId, challengeId, toTeamId, otherUserId }),
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadId, instanceId, matchId, challengeId, toTeamId, otherUserId, qc]);
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (thread: ChatThread) => chatRepository.markAsRead(thread),
    // The inbox badge counts unread rows, so it is stale the moment these clear.
    onSuccess: () => void qc.invalidateQueries({ queryKey: chatKeys.inbox }),
  });
}
