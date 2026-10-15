/**
 * Blocked players.
 *
 * Blocking existed with no way back: `ReportBlockBar` inserted a `blocks` row
 * and nothing ever deleted one, so a mis-tap hid a person from your matches,
 * players and availability permanently. `blocks_delete_self` already allowed
 * the owner to remove their own row, so this needed no migration -- only a
 * screen.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { useBlockedUsers, useUnblockUser } from '@features/safety/presentation/useSafety';
import type { BlockedUser } from '@features/safety/data/safetyRepository';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconUser } from '@shared/ui/icons';

export default function BlockedPlayersScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const blocked = useBlockedUsers();
  const unblock = useUnblockUser();

  const onUnblock = (person: BlockedUser): void => {
    Alert.alert(
      `Unblock ${person.fullName}?`,
      'You will see each other in games and availability again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () =>
            unblock.mutate(person.userId, {
              onError: (e: unknown) =>
                Alert.alert(
                  'Could not unblock',
                  e instanceof Error ? e.message : 'Please try again.',
                ),
            }),
        },
      ],
    );
  };

  const renderPerson = ({ item }: { item: BlockedUser }): React.ReactElement => (
    <View style={styles.row}>
      {item.avatarUrl ? (
        <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty]}>
          <IconUser color={M.muted} size={20} />
        </View>
      )}
      <AppText variant="label" color={M.text} style={{ flex: 1 }}>
        {item.fullName}
      </AppText>
      <Pressable
        style={styles.unblock}
        onPress={() => onUnblock(item)}
        disabled={unblock.isPending}
        accessibilityRole="button"
        accessibilityLabel={`Unblock ${item.fullName}`}
      >
        <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
          Unblock
        </AppText>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Blocked Players' }} />
      {blocked.isPending ? (
        <ActivityIndicator style={{ marginTop: S.xl }} color={M.green} />
      ) : blocked.isError ? (
        <AppText color={M.muted} center style={styles.empty}>
          Could not load your blocked list.
        </AppText>
      ) : (
        <FlatList
          data={blocked.data ?? []}
          keyExtractor={(p) => p.userId}
          renderItem={renderPerson}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <AppText color={M.muted} center style={styles.empty}>
              You have not blocked anyone. Blocking someone hides them from your
              games, the player list and availability.
            </AppText>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    list: { padding: S.md, gap: S.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      backgroundColor: M.card,
      borderRadius: R.md,
      padding: S.md,
    },
    avatar: { width: 40, height: 40, borderRadius: 20 },
    avatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: M.border },
    unblock: {
      paddingHorizontal: S.md,
      paddingVertical: S.xs,
      borderRadius: R.sm,
      borderWidth: 1,
      borderColor: M.green,
    },
    empty: { marginTop: S.xl, paddingHorizontal: S.lg },
  });
