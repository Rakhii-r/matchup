import { supabase } from '@core/api/supabaseClient';
import { AppError, toAppError } from '@core/errors/AppError';
import type { AppErrorCode } from '@core/errors/AppError';
import type {
  ChatConversation,
  ChatMessage,
  ChatThread,
  SendMessageInput,
} from '@features/chat/domain/chatSchema';
import { SendMessageSchema } from '@features/chat/domain/chatSchema';

/**
 * Every read and write goes through an RPC. The client holds only SELECT on
 * `captain_chat_messages` now (realtime needs it); INSERT/UPDATE/DELETE were
 * revoked in 20260830090000, so there is no direct-table path to fall back to.
 */

const CHAT_ERRORS: [string, AppErrorCode, string][] = [
  ['NOT_A_CAPTAIN', 'unauthorized', 'Only the two team captains can use this chat.'],
  ['NOT_A_CANDIDATE', 'unauthorized', 'That team has not applied to this game request.'],
  ['NEED_OPPONENT_TEAM', 'validation', 'Pick which team you want to message.'],
  ['NO_OPPONENT', 'conflict', 'This game does not have two teams yet.'],
  ['NO_THREAD', 'validation', 'This conversation could not be opened.'],
  ['BLOCKED', 'unauthorized', 'You cannot message this captain.'],
  ['RATE_LIMITED', 'conflict', 'Slow down a moment before sending more messages.'],
  ['EMPTY_MESSAGE', 'validation', 'Message cannot be empty.'],
  ['MESSAGE_TOO_LONG', 'validation', 'Message is too long.'],
  ['ACCOUNT_INACTIVE', 'unauthorized', 'Your account is not active.'],
  ['MATCH_NOT_FOUND', 'not_found', 'That game no longer exists.'],
  ['CHALLENGE_NOT_FOUND', 'not_found', 'That game request no longer exists.'],
  ['OPPONENT_NOT_FOUND', 'not_found', 'That team no longer exists.'],
];

function chatError(error: unknown): AppError {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const [token, code, message] of CHAT_ERRORS) {
    if (raw.includes(token)) return new AppError(code, message, error);
  }
  return toAppError(error);
}

/** How many recent messages the inbox is built from. */
const INBOX_SCAN = 200;

function threadArgs(thread: ChatThread) {
  return {
    in_match_id: thread.matchId ?? null,
    in_challenge_id: thread.challengeId ?? null,
    in_to_team_id: thread.toTeamId ?? null,
    in_other_user_id: thread.otherUserId ?? null,
  };
}

/** A thread needs an id AND, on a multi-applicant challenge, a counterpart. */
export function isResolvableThread(thread: ChatThread): boolean {
  return Boolean(thread.matchId || thread.challengeId);
}

export const chatRepository = {
  async getMessages(thread: ChatThread): Promise<ChatMessage[]> {
    if (!isResolvableThread(thread)) return [];

    const { data, error } = await supabase.rpc('get_captain_chat', threadArgs(thread));
    if (error) throw chatError(error);
    return (data ?? []) as ChatMessage[];
  },

  async sendMessage(input: SendMessageInput): Promise<ChatMessage> {
    const validated = SendMessageSchema.parse(input);

    const { data, error } = await supabase.rpc('send_captain_message', {
      ...threadArgs(validated),
      in_content: validated.content,
    });
    if (error) throw chatError(error);

    // send_captain_message returns the raw row, which has no joined sender or
    // counterpart names. The realtime invalidate refetches the thread through
    // get_captain_chat straight after, so the gap is one render at most.
    return data as unknown as ChatMessage;
  },

  /**
   * The caller's conversations, newest first.
   *
   * Read straight off the table rather than through a new RPC: the SELECT
   * policy already limits rows to messages the caller sent or received, which
   * is exactly the inbox. Capped at the most recent INBOX_SCAN messages, so a
   * thread whose last message is older than that drops off the bottom.
   */
  async listConversations(userId: string): Promise<ChatConversation[]> {
    const { data, error } = await supabase
      .from('captain_chat_messages')
      .select('id, challenge_id, match_id, sender_id, recipient_id, content, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(INBOX_SCAN);
    if (error) throw chatError(error);

    const byKey = new Map<string, ChatConversation>();
    for (const row of data ?? []) {
      const mine = row.sender_id === userId;
      const counterpartId = mine ? row.recipient_id : row.sender_id;
      const key = `${row.match_id ?? row.challenge_id ?? 'none'}:${counterpartId}`;
      let conv = byKey.get(key);
      if (!conv) {
        // Rows arrive newest first, so the first one seen is the latest.
        conv = {
          key,
          matchId: row.match_id,
          challengeId: row.challenge_id,
          counterpartId,
          counterpartName: null,
          counterpartAvatar: null,
          lastMessage: row.content,
          lastAt: row.created_at,
          lastIsMine: mine,
          unread: 0,
        };
        byKey.set(key, conv);
      }
      if (!mine && !row.is_read) conv.unread += 1;
    }

    const conversations = [...byKey.values()];
    if (conversations.length === 0) return conversations;

    // Names are decoration: a failure here must not hide the conversations.
    const ids = [...new Set(conversations.map((c) => c.counterpartId))];
    const { data: people } = await supabase
      .from('public_profiles')
      .select('id, full_name, avatar_url')
      .in('id', ids);
    const byId = new Map((people ?? []).map((person) => [person.id, person]));
    for (const conv of conversations) {
      const person = byId.get(conv.counterpartId);
      conv.counterpartName = person?.full_name ?? null;
      conv.counterpartAvatar = person?.avatar_url ?? null;
    }
    return conversations;
  },

  async markAsRead(thread: ChatThread): Promise<number> {
    if (!isResolvableThread(thread)) return 0;

    const { data, error } = await supabase.rpc('mark_chat_read', threadArgs(thread));
    // Non-fatal: failing to clear a badge must never break the screen.
    if (error) return 0;
    return (data as number | null) ?? 0;
  },
};
