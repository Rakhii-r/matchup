import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import {
  POST_MATCH_SUGGESTIONS,
  PRE_MATCH_SUGGESTIONS,
  type ChatMessage,
} from '@features/chat/domain/chatSchema';
import {
  useChatMessages,
  useChatRealtime,
  useMarkChatRead,
  useSendMessage,
} from '@features/chat/presentation/useCaptainChat';
import { useMatch, useMatchSides } from '@features/matches/presentation/useMatches';
import { useChallenge } from '@features/teams/presentation/useChallenges';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { IconBack, IconPin, IconSend, IconUsers } from '@shared/ui/icons';

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CaptainChatScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    challengeId?: string;
    matchId?: string;
    toTeamId?: string;
    otherUserId?: string;
    teamName?: string;
    captainName?: string;
    sport?: string;
  }>();

  const currentUserId = useAuthStore((s) => s.session?.user.id);

  /*
    WHICH THREAD IS THIS?

    An entry point inside the app says so (`matchId` or `challengeId`). A chat
    notification does not: its link is `/chat/<id>?otherUserId=...`, and that id
    is the match when there is one and the CHALLENGE when there is not. Assuming
    "match" is what opened a dead chat for every message sent before a fixture
    was agreed -- the whole pre-match conversation.

    So a bare id is looked up as a match first, and treated as a challenge when
    no such match exists. A lookup that FAILS is neither: it is reported, not
    guessed around.
  */
  const rawId = params.id ?? '';
  const prefixed = rawId.startsWith('match-');
  const ambiguous = !params.matchId && !params.challengeId && !prefixed && rawId.length > 0;
  const probe = useMatch(ambiguous ? rawId : '');
  const probing = ambiguous && probe.isLoading;
  const probeFailed = ambiguous && probe.isError;

  const resolvedMatchId =
    params.matchId ??
    (prefixed ? rawId.replace('match-', '') : ambiguous && probe.data ? rawId : null);
  const resolvedChallengeId =
    params.challengeId ??
    (ambiguous && !probing && !probeFailed && !probe.data ? rawId : null);

  const match = useMatch(resolvedMatchId ?? '');
  const sides = useMatchSides(resolvedMatchId ?? '');
  const challenge = useChallenge(resolvedChallengeId ?? null);

  const matchData = match.data;
  const challengeData = challenge.data;

  // Determine opponent name and recipient ID
  const isPostMatch = Boolean(matchData && resolvedMatchId);

  const opponentTeamName = useMemo(() => {
    if (params.teamName) return params.teamName;
    if (isPostMatch && matchData) {
      if (matchData.creator_id === currentUserId) {
        return sides.data?.team_b_name ?? 'Opponent Team';
      }
      return sides.data?.team_a_name ?? 'Opponent Team';
    }
    // Before a fixture exists there is no opposing TEAM name to show, and the
    // game's own name is not who you are talking to.
    return 'Opponent captain';
  }, [params.teamName, isPostMatch, matchData, currentUserId, sides.data]);

  /*
    No recipient resolution here any more. This screen used to guess it: on a
    match it passed get_match_sides.team_b_id -- a TEAM id into a column with an
    FK to profiles(id) -- and on a challenge it passed null. Both sides of every
    thread that mattered were unsendable. send_captain_message resolves the
    counterpart from the teams server-side; the client only says WHICH thread.
  */

  // Chat queries and mutations
  const threadParams = useMemo(
    () => ({
      challengeId: resolvedChallengeId,
      matchId: resolvedMatchId,
      toTeamId: params.toTeamId ?? null,
      otherUserId: params.otherUserId ?? null,
    }),
    [resolvedChallengeId, resolvedMatchId, params.toTeamId, params.otherUserId],
  );

  const messagesQuery = useChatMessages(threadParams);
  const sendMessage = useSendMessage(threadParams);
  // `mutate` is referentially stable in react-query; the mutation OBJECT is
  // not, which is what made the original effect re-fire every render.
  const { mutate: markReadMutate } = useMarkChatRead();
  useChatRealtime(threadParams);

  /*
    The server is the authority on who the other captain is, so once a thread
    has loaded its name beats anything the entry point guessed.
  */
  const counterpartName = messagesQuery.data?.[0]?.counterpart_name ?? null;
  const headerName = params.teamName ?? counterpartName ?? opponentTeamName;

  /*
    Sending is gated on the THREAD resolving, not on a client-side recipient.
    If get_captain_chat could not resolve this thread (a poster who opened a
    challenge with several applicants and named none, a non-captain, a match
    with one team) then send_captain_message would refuse for the same reason,
    so the composer says why instead of failing on tap.
  */
  const threadFailed = messagesQuery.isError || probeFailed;
  const threadErrorText = probeFailed
    ? 'Could not open this chat. Check your connection and try again.'
    : messagesQuery.error instanceof Error
      ? messagesQuery.error.message
      : 'This chat is unavailable.';
  const gameName = matchData?.match_name ?? challengeData?.match_name ?? null;
  const canSend = Boolean(resolvedMatchId || resolvedChallengeId) && !threadFailed;

  const [inputContent, setInputContent] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Mark incoming messages read.
  useEffect(() => {
    if (threadParams.challengeId || threadParams.matchId) {
      markReadMutate(threadParams);
    }
  }, [threadParams, markReadMutate]);

  /*
    The box is cleared only once the server has the message. It used to be
    cleared first, with no error handler, so a refused send (rate limit, a
    block, no network) simply deleted what had been typed. A failed send now
    keeps the text -- a tapped suggestion is put INTO the box for the same
    reason -- and says why it failed.
  */
  const onSend = useCallback(
    (textToSend?: string) => {
      const content = (textToSend ?? inputContent).trim();
      if (!content) return;

      setSendError(null);
      sendMessage.mutate(
        {
          ...threadParams,
          content,
        },
        {
          onSuccess: () => {
            if (textToSend === undefined) setInputContent('');
            flatListRef.current?.scrollToEnd({ animated: true });
          },
          onError: (e: unknown) => {
            if (textToSend !== undefined) setInputContent(content);
            setSendError(
              e instanceof AppError
                ? `Not sent. ${e.message}`
                : 'Not sent. Check your connection and try again.',
            );
          },
        },
      );
    },
    [inputContent, threadParams, sendMessage],
  );

  const suggestions = isPostMatch ? POST_MATCH_SUGGESTIONS : PRE_MATCH_SUGGESTIONS;

  const renderMessageItem = ({ item }: { item: ChatMessage }) => {
    const isMine = item.sender_id === currentUserId;
    return (
      <View
        style={[
          styles.messageRow,
          isMine ? styles.messageRowMine : styles.messageRowTheirs,
        ]}
      >
        <View
          style={[
            styles.bubble,
            isMine ? styles.bubbleMine : styles.bubbleTheirs,
          ]}
        >
          <AppText
            style={[styles.messageText, isMine && styles.messageTextMine]}
          >
            {item.content}
          </AppText>
          <View style={styles.timeRow}>
            <AppText
              variant="caption"
              style={[styles.timeText, isMine && styles.timeTextMine]}
            >
              {formatMessageTime(item.created_at)}
            </AppText>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            style={styles.backBtn}
            // A notification opens this screen with nothing behind it.
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconBack size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerInfo}>
            <View style={styles.headerTitleRow}>
              <IconUsers size={16} color={colors.primary} />
              <AppText variant="label" numberOfLines={1} style={styles.headerTitle}>
                {headerName}
              </AppText>
            </View>
            <AppText variant="caption" muted numberOfLines={1}>
              {gameName ? `${gameName} · ` : ''}
              {isPostMatch ? 'Game confirmed' : 'Before the game is fixed'}
            </AppText>
          </View>

          {isPostMatch && resolvedMatchId ? (
            <Pressable
              style={styles.headerActionBtn}
              onPress={() => router.push(`/match/${resolvedMatchId}/venue`)}
            >
              <IconPin size={16} color={colors.primary} />
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>
                Venue
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {/* Banner / Info Bar */}
        <View style={styles.infoBanner}>
          <AppText variant="caption" muted style={{ textAlign: 'center' }}>
            💬 Discuss venue preferences, start times, and team rules before & during the game.
          </AppText>
        </View>

        {/* Message List */}
        {probing || messagesQuery.isLoading ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator color={colors.primary} />
            <AppText muted variant="caption">Loading discussion...</AppText>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messagesQuery.data ?? []}
            keyExtractor={(item) => item.id}
            renderItem={renderMessageItem}
            contentContainerStyle={styles.messageListContent}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <AppText variant="label" style={{ textAlign: 'center' }}>
                  {threadFailed ? 'This chat could not be opened' : 'No messages yet'}
                </AppText>
                <AppText
                  variant="caption"
                  color={threadFailed ? colors.danger : colors.textMuted}
                  style={{ textAlign: 'center', marginTop: 4 }}
                >
                  {threadFailed
                    ? threadErrorText
                    : 'Start the conversation by choosing a question below or typing a message.'}
                </AppText>
                {threadFailed ? (
                  <Pressable
                    onPress={() => void (probeFailed ? probe.refetch() : messagesQuery.refetch())}
                    style={styles.retryBtn}
                    accessibilityRole="button"
                  >
                    <AppText variant="label" color={colors.primary}>
                      Try again
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            }
          />
        )}

        {/* Quick Suggestion Chips */}
        <View style={styles.suggestionsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionsScroll}
          >
            {suggestions.map((sug) => (
              <Pressable
                key={sug.id}
                style={[styles.suggestionChip, !canSend || sendMessage.isPending ? { opacity: 0.5 } : null]}
                disabled={!canSend || sendMessage.isPending}
                onPress={() => onSend(sug.text)}
              >
                <AppText variant="caption" style={styles.suggestionText}>
                  {sug.label}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Why the last message did not go, right above where it was typed. */}
        {sendError ? (
          <View style={styles.sendError} accessibilityLiveRegion="polite">
            <AppText variant="caption" color={colors.danger} style={{ flex: 1 }}>
              {sendError}
            </AppText>
          </View>
        ) : null}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={inputContent}
            onChangeText={(text) => {
              setInputContent(text);
              if (sendError) setSendError(null);
            }}
            placeholder={
              canSend ? 'Type a message to opponent captain…' : threadErrorText
            }
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1000}
            editable={canSend}
          />
          <Pressable
            style={[
              styles.sendBtn,
              (!inputContent.trim() || !canSend || sendMessage.isPending) && styles.sendBtnDisabled,
            ]}
            onPress={() => onSend()}
            disabled={!inputContent.trim() || !canSend || sendMessage.isPending}
          >
            {sendMessage.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <IconSend size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    sendError: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: `${colors.danger}14`,
      borderTopWidth: 1,
      borderTopColor: `${colors.danger}40`,
    },
    retryBtn: {
      alignSelf: 'center',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      marginTop: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: colors.primary,
    },
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing.sm,
    },
    backBtn: {
      padding: spacing.xs,
    },
    headerInfo: {
      flex: 1,
      gap: 2,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    headerTitle: {
      fontWeight: '700',
    },
    headerActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}15`,
    },
    infoBanner: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    centerLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    messageListContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xxl,
      paddingHorizontal: spacing.xl,
    },
    messageRow: {
      flexDirection: 'row',
      marginBottom: spacing.xs,
    },
    messageRowMine: {
      justifyContent: 'flex-end',
    },
    messageRowTheirs: {
      justifyContent: 'flex-start',
    },
    bubble: {
      maxWidth: '82%',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
    },
    bubbleMine: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 2,
    },
    bubbleTheirs: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 2,
    },
    messageText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    messageTextMine: {
      color: '#FFFFFF',
    },
    timeRow: {
      alignSelf: 'flex-end',
      marginTop: 2,
    },
    timeText: {
      fontSize: 10,
      color: colors.textMuted,
    },
    timeTextMine: {
      color: '#FFFFFFCC',
    },
    suggestionsContainer: {
      paddingVertical: spacing.xs,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    suggestionsScroll: {
      paddingHorizontal: spacing.md,
      gap: spacing.xs,
    },
    suggestionChip: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    suggestionText: {
      fontSize: 12,
      color: colors.text,
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    textInput: {
      flex: 1,
      minHeight: 40,
      maxHeight: 100,
      paddingHorizontal: spacing.md,
      paddingTop: Platform.OS === 'ios' ? 10 : 8,
      paddingBottom: Platform.OS === 'ios' ? 10 : 8,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      color: colors.text,
      fontSize: 14,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: {
      opacity: 0.4,
    },
  });
