import { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { useUsers } from '@features/admin/presentation/useModeration';
import type { AdminUser } from '@features/admin/data/adminRepository';
import type { Sport } from '@shared/types/database.types';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

const SPORT_LABEL: Record<Sport, string> = {
  box_cricket: 'Box Cricket',
  badminton: 'Badminton',
};

function formatJoined(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Read-only directory of every user, for superadmins. Server access is enforced by the
 * profiles_admin_select RLS policy — a non-superadmin gets an empty list, not this screen.
 */
export default function AdminUsersScreen(): React.ReactNode {
  const { data: users, isLoading, isError, refetch, isRefetching } = useUsers();

  const renderItem = useCallback(({ item }: { item: AdminUser }) => {
    const sports = (item.sport_pref ?? []).map((s) => SPORT_LABEL[s]).join(', ');
    return (
      <View style={styles.card}>
        <View style={styles.rowTop}>
          <AppText variant="label" style={{ flex: 1 }}>
            {item.full_name || 'Unnamed user'}
          </AppText>
          {!item.is_active ? (
            <AppText variant="caption" color={colors.danger}>
              Deactivated
            </AppText>
          ) : null}
        </View>
        {item.area_name ? (
          <AppText variant="caption" muted>
            {item.area_name}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {item.phone ?? 'No phone'}
        </AppText>
        {sports ? (
          <AppText variant="caption" muted>
            {sports}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          Joined {formatJoined(item.created_at)}
        </AppText>
      </View>
    );
  }, []);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'All users' }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <AppText muted>Could not load users.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void refetch()} />
        </View>
      ) : (
        <FlatList
          data={users ?? []}
          keyExtractor={(u) => u.id}
          renderItem={renderItem}
          onRefresh={() => void refetch()}
          refreshing={isRefetching}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListHeaderComponent={
            <AppText variant="caption" muted style={{ marginBottom: spacing.md }}>
              {(users ?? []).length} user{(users ?? []).length === 1 ? '' : 's'}
            </AppText>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <AppText muted>No users yet.</AppText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxl,
  },
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
