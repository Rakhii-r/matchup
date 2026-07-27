import { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { useReports, useModeration } from '@features/admin/presentation/useModeration';
import type { Report } from '@features/admin/data/adminRepository';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

/**
 * Admin report queue. Lists open reports and lets an admin dismiss/action a report and
 * deactivate the reported user. All actions are RLS-authorised server-side.
 */
export default function AdminReportsScreen(): React.ReactNode {
  const { data: reports, isLoading, isError, refetch, isRefetching } = useReports('open');
  const { resolveReport, deactivateUser } = useModeration();

  const renderItem = useCallback(
    ({ item }: { item: Report }) => {
      const busy = resolveReport.isPending || deactivateUser.isPending;
      return (
        <View style={styles.card}>
          <AppText variant="label">{item.reason}</AppText>
          {item.details ? (
            <AppText variant="caption" muted>
              {item.details}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            Reported user: {item.reported_user_id}
          </AppText>
          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <Button
                label="Dismiss"
                variant="secondary"
                disabled={busy}
                onPress={() => resolveReport.mutate({ reportId: item.id, status: 'dismissed' })}
              />
            </View>
            <View style={styles.actionBtn}>
              <Button
                label="Action & deactivate"
                variant="danger"
                disabled={busy}
                onPress={() => {
                  deactivateUser.mutate({ userId: item.reported_user_id, isActive: false });
                  resolveReport.mutate({ reportId: item.id, status: 'actioned' });
                }}
              />
            </View>
          </View>
        </View>
      );
    },
    [resolveReport, deactivateUser],
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Reports' }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <AppText muted>Could not load reports.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void refetch()} />
        </View>
      ) : (
        <FlatList
          data={reports ?? []}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          onRefresh={() => void refetch()}
          refreshing={isRefetching}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <AppText muted>No open reports. All clear.</AppText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingTop: spacing.xxl },
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1 },
});
