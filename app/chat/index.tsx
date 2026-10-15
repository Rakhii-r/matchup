/**
 * Captain chats — the inbox.
 *
 * Until this screen existed a conversation could only be reached from the game
 * it belonged to (or a notification), and `is_read` was stored but shown
 * nowhere. One row per thread and counterpart, newest first, with the number of
 * their messages still unread.
 *
 * It lists conversations that have at least one message. Starting a new one
 * still happens from the game: a thread is a match or a challenge plus the
 * other captain, so there is nothing to open before one of those exists.
 */
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import type { ChatConversation } from '@features/chat/domain/chatSchema';
import { useChatInbox } from '@features/chat/presentation/useCaptainChat';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useBottomInset } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { IconTile, PageHeader } from '@shared/ui/decor';
import { IconChevron, IconSend, IconUser } from '@shared/ui/icons';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Time of day for today's messages, the date for anything older. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

export default function ChatInboxScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const bottomInset = useBottomInset();
  const router = useRouter();
  const inbox = useChatInbox();
  const { refetch } = inbox;

  // Coming back from a thread has just cleared its unread count.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const open = (c: ChatConversation): void => {
    router.push({
      pathname: '/chat/[id]',
      params: {
        id: c.matchId ?? c.challengeId ?? '',
        ...(c.matchId ? { matchId: c.matchId } : { challengeId: c.challengeId ?? '' }),
        otherUserId: c.counterpartId,
      },
    });
  };

  const renderItem = ({ item }: { item: ChatConversation }): React.ReactElement => {
    const name = item.counterpartName ?? 'Opponent captain';
    return (
      <Pressable
        style={styles.row}
        onPress={() => open(item)}
        accessibilityRole="button"
        accessibilityLabel={`${name}${item.unread > 0 ? `, ${item.unread} unread` : ''}. Open chat`}
      >
        {item.counterpartAvatar ? (
          <Image source={{ uri: item.counterpartAvatar }} style={styles.avatar} />
        ) : (
          <IconTile size={48}>
            <IconUser color={M.green} size={22} />
          </IconTile>
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText variant="label" color={M.text} numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
            <AppText variant="caption" color={item.unread > 0 ? M.green : M.muted}>
              {formatWhen(item.lastAt)}
            </AppText>
          </View>
          <AppText variant="caption" color={M.muted} numberOfLines={1}>
            {item.matchId ? 'Game confirmed' : 'Before the game is fixed'}
          </AppText>
          <View style={styles.rowTop}>
            <AppText
              variant="caption"
              color={item.unread > 0 ? M.text : M.muted}
              numberOfLines={1}
              style={[styles.preview, item.unread > 0 ? styles.previewUnread : null]}
            >
              {item.lastIsMine ? 'You: ' : ''}
              {item.lastMessage}
            </AppText>
            {item.unread > 0 ? (
              <View style={styles.unread}>
                <AppText variant="caption" color="#FFFFFF" style={styles.unreadText}>
                  {item.unread > 99 ? '99+' : item.unread}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
        <IconChevron color={M.muted} size={16} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerWrap}>
        <PageHeader title="Captain Chats" fallback="/(tabs)/teams" />
      </View>

      {inbox.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={M.green} />
          <AppText variant="caption" color={M.muted}>
            Loading your chats…
          </AppText>
        </View>
      ) : inbox.isError ? (
        <View style={styles.center}>
          <AppText variant="label" color={M.text} center>
            Your chats could not be loaded
          </AppText>
          <AppText variant="caption" color={M.danger} center>
            {inbox.error instanceof AppError
              ? inbox.error.message
              : 'Check your connection and try again.'}
          </AppText>
          <Pressable
            onPress={() => void refetch()}
            style={styles.retry}
            accessibilityRole="button"
          >
            <AppText variant="label" color={M.green}>
              Try again
            </AppText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={inbox.data ?? []}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
          refreshing={inbox.isRefetching}
          onRefresh={() => void refetch()}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconTile size={64}>
                <IconSend color={M.green} size={28} />
              </IconTile>
              <AppText variant="heading" color={M.text} center style={styles.emptyTitle}>
                No chats yet
              </AppText>
              <AppText variant="body" color={M.muted} center style={styles.emptyBody}>
                Chats are between the two captains of a game. Open one from Match Offers while
                you are still agreeing a game, or from the game screen once it is fixed.
              </AppText>
              <Pressable
                onPress={() => router.push('/teams/offers')}
                style={styles.emptyCta}
                accessibilityRole="button"
              >
                <AppText variant="label" color={M.limeInk}>
                  Go to Match Offers
                </AppText>
              </Pressable>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    headerWrap: { paddingHorizontal: S.md },
    list: { paddingHorizontal: S.md, paddingTop: S.sm, gap: S.sm + 2, flexGrow: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.sm, padding: S.xl },
    retry: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: S.lg,
      marginTop: S.sm,
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm + 4,
      padding: S.sm + 4,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    avatar: { width: 48, height: 48, borderRadius: 24 },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
    name: { flex: 1, fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    preview: { flex: 1, fontSize: 13 },
    previewUnread: { fontWeight: '700' },
    unread: {
      minWidth: 22,
      alignItems: 'center',
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: R.pill,
      backgroundColor: M.danger,
    },
    unreadText: { fontWeight: '800', fontSize: 11 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.sm, padding: S.xl },
    emptyTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', marginTop: S.sm },
    emptyBody: { fontSize: 14, lineHeight: 20 },
    emptyCta: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: S.xl,
      marginTop: S.md,
      borderRadius: R.pill,
      backgroundColor: M.green,
    },
  });
