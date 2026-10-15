import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { useModeration, useReports } from '@features/admin/presentation/useModeration';
import type { Report } from '@features/admin/data/adminRepository';
import type { ReportStatus } from '@shared/types/database.types';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

const STATUS_FILTERS: { key: ReportStatus | 'all'; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

export default function AdminReportsScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('open');
  const { data: reports, isLoading, isError, refetch, isRefetching } = useReports(filter);
  const { resolveReport, deactivateUser } = useModeration();

  const handleDeactivate = useCallback(
    (item: Report) => {
      Alert.alert(
        'Action & Deactivate User',
        `Are you sure you want to deactivate user "${item.reported_user_id}"? They will lose access to matches.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Deactivate',
            style: 'destructive',
            onPress: () => {
              deactivateUser.mutate({ userId: item.reported_user_id, isActive: false });
              resolveReport.mutate({ reportId: item.id, status: 'actioned' });
            },
          },
        ],
      );
    },
    [deactivateUser, resolveReport],
  );

  const renderItem = useCallback(
    ({ item }: { item: Report }) => {
      const busy = resolveReport.isPending || deactivateUser.isPending;
      const isOpen = item.status === 'open';

      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <AppText variant="label" style={{ flex: 1 }}>
              {item.reason}
            </AppText>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    item.status === 'open'
                      ? `${colors.danger}20`
                      : item.status === 'actioned'
                      ? `${colors.primary}20`
                      : `${colors.textMuted}20`,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color:
                    item.status === 'open'
                      ? colors.danger
                      : item.status === 'actioned'
                      ? colors.primary
                      : colors.textMuted,
                  fontWeight: '700',
                }}
              >
                {item.status.toUpperCase()}
              </AppText>
            </View>
          </View>

          {item.details ? (
            <AppText variant="caption" muted style={{ marginTop: 2 }}>
              {item.details}
            </AppText>
          ) : null}

          <View style={styles.metaRow}>
            <AppText variant="caption" muted>
              Reported User: {item.reported_user_id.slice(0, 8)}...
            </AppText>
            <AppText variant="caption" muted>
              {new Date(item.created_at).toLocaleDateString()}
            </AppText>
          </View>

          {isOpen ? (
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
                  label="Deactivate"
                  variant="danger"
                  disabled={busy}
                  onPress={() => handleDeactivate(item)}
                />
              </View>
            </View>
          ) : null}
        </View>
      );
    },
    [colors, resolveReport, deactivateUser, styles, handleDeactivate],
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Reports & Moderation' }} />

      <View style={styles.filterTabs}>
        {STATUS_FILTERS.map((f) => {
          const isSelected = filter === f.key;
          return (
            <Pressable
              key={f.key}
              style={[styles.filterTab, isSelected && styles.filterTabActive]}
              onPress={() => setFilter(f.key)}
            >
              <AppText
                variant="label"
                style={{
                  color: isSelected ? colors.primary : colors.textMuted,
                  fontSize: 13,
                  fontWeight: isSelected ? '700' : '500',
                }}
              >
                {f.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

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
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <AppText muted>No {filter !== 'all' ? filter : ''} reports found.</AppText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    filterTabs: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginBottom: spacing.md,
      backgroundColor: colors.surface,
      padding: 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterTab: {
      flex: 1,
      paddingVertical: spacing.xs,
      alignItems: 'center',
      borderRadius: radius.sm,
    },
    filterTabActive: {
      backgroundColor: colors.background,
    },
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
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
      paddingTop: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    actionBtn: {
      flex: 1,
    },
  });
