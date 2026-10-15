import { z } from 'zod';

/**
 * A chat thread is (match or challenge) PLUS the counterpart -- never the id on
 * its own. An open challenge has many `challenge_candidates`, and the poster is
 * recipient on every applicant's messages, so filtering by challenge_id alone
 * merged every applicant's conversation into one screen.
 *
 * The counterpart can be named two ways and the server accepts either:
 *  - `toTeamId`    the applicant list knows the team it is rendering
 *  - `otherUserId` a push tap knows only the sender
 * Both are ignored for a match, where the two sides are already settled.
 */
export interface ChatThread {
  challengeId?: string | null;
  matchId?: string | null;
  toTeamId?: string | null;
  otherUserId?: string | null;
}

export interface ChatMessage {
  id: string;
  challenge_id: string | null;
  match_id: string | null;
  sender_id: string;
  recipient_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  sender_name: string | null;
  sender_avatar: string | null;
  counterpart_id: string;
  counterpart_name: string | null;
}

/**
 * No `recipientId`. The client used to choose it and got it wrong in every
 * thread that mattered -- see 20260830090000. `send_captain_message` resolves
 * the recipient from the teams itself, and the client no longer holds INSERT
 * on the table at all.
 */
export const SendMessageSchema = z.object({
  challengeId: z.string().uuid().optional().nullable(),
  matchId: z.string().uuid().optional().nullable(),
  toTeamId: z.string().uuid().optional().nullable(),
  otherUserId: z.string().uuid().optional().nullable(),
  content: z.string().trim().min(1, 'Message cannot be empty').max(1000, 'Message is too long'),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

/**
 * One row of the chat inbox: a thread, who it is with, its latest message and
 * how many of their messages are still unread.
 */
export interface ChatConversation {
  /** Stable list key: thread id plus counterpart. */
  key: string;
  matchId: string | null;
  challengeId: string | null;
  counterpartId: string;
  counterpartName: string | null;
  counterpartAvatar: string | null;
  lastMessage: string;
  lastAt: string;
  /** True when the latest message is the caller's own. */
  lastIsMine: boolean;
  unread: number;
}

export interface QuickSuggestion {
  id: string;
  label: string;
  text: string;
}

export const PRE_MATCH_SUGGESTIONS: QuickSuggestion[] = [
  { id: '1', label: 'Turf Preference', text: 'Which turf/venue do you prefer playing at?' },
  { id: '2', label: 'Time Check', text: 'Is the scheduled time good for your team?' },
  { id: '3', label: 'Ball Type', text: 'Are we playing with Tennis ball or Leather ball?' },
  { id: '4', label: 'Squad Ready', text: 'Our squad is ready! How many players do you have?' },
  { id: '5', label: 'Ready to Confirm', text: 'Looks good to us, ready to confirm the game!' },
];

export const POST_MATCH_SUGGESTIONS: QuickSuggestion[] = [
  { id: '1', label: 'Location Directions', text: 'Where is the ground located / entry gate?' },
  { id: '2', label: 'Arrival Time', text: 'We will reach the ground 15 mins before start.' },
  { id: '3', label: 'Toss Ready', text: 'We are at the pitch, let us know when you arrive for toss.' },
  { id: '4', label: 'Great Game', text: 'Great game today! Let us know if you want a rematch.' },
];
