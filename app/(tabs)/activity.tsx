/**
 * Activity — what needs your attention, and what has happened.
 *
 * Two sections from two sources:
 *   Pending actions — derived live from application state (invites awaiting a
 *     reply, challenges, offers, an untossed fixture, a match about to start).
 *   Notifications — the delivered push history.
 *
 * `notification_jobs` has RLS enabled with zero policies because it is a
 * delivery queue: attempts and last_error are operational, not user-facing.
 * `list_my_notifications` exposes only the four columns that belong on screen.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  useNotifications,
  usePendingActions,
} from '@features/dashboard/presentation/useDashboard';
import type { PendingAction } from '@features/dashboard/data/dashboardRepository';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';

const URGENCY_DOT: Record<PendingAction['urgency'], keyof MockPalette> = {
  high: 'danger',
  medium: 'lime',
  low: 'green',
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(Math.round((Date.now() - then) / 60000), 0);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function ActivityScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();

  const actions = usePendingActions();
  const notifications = useNotifications(50);

  const refreshing = actions.isRefetching || notifications.isRefetching;
  const onRefresh = (): void => {
    void actions.refetch();
    void notifications.refetch();
  };

  const loading = actions.isLoading || notifications.isLoading;
  const empty = (actions.data ?? []).length === 0 && (notifications.data ?? []).length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={M.green} />
        }
      >
        <AppText variant="title" color={M.text} style={{ fontSize: 24 }}>
          Activity
        </AppText>

        {loading ? <ActivityIndicator color={M.green} style={{ marginTop: S.lg }} /> : null}

        {!loading && empty ? (
          <View style={styles.card}>
            <AppText variant="label" color={M.text}>
              Nothing needs you right now
            </AppText>
            <AppText variant="caption" color={M.muted}>
              Invites, challenges and match reminders will appear here.
            </AppText>
          </View>
        ) : null}

        {(actions.data ?? []).length > 0 ? (
          <>
            <AppText variant="caption" color={M.muted} style={styles.section}>
              NEEDS YOUR ATTENTION
            </AppText>
            <View style={styles.card}>
              {(actions.data ?? []).map((a, i) => (
                <Pressable
                  key={`${a.kind}-${i}`}
                  style={styles.row}
                  onPress={() => a.route && router.push(a.route as never)}
                  accessibilityRole="button"
                >
                  <View style={[styles.dot, { backgroundColor: M[URGENCY_DOT[a.urgency]] }]} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="label" color={M.text}>
                      {a.title}
                    </AppText>
                    {a.subtitle ? (
                      <AppText variant="caption" color={M.muted}>
                        {a.subtitle}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {(notifications.data ?? []).length > 0 ? (
          <>
            <AppText variant="caption" color={M.muted} style={styles.section}>
              EARLIER
            </AppText>
            <View style={styles.card}>
              {(notifications.data ?? []).map((n) => (
                <Pressable
                  key={n.id}
                  style={styles.row}
                  onPress={() => n.route && router.push(n.route as never)}
                  accessibilityRole="button"
                >
                  <View style={{ flex: 1 }}>
                    <AppText variant="label" color={M.text}>
                      {n.title}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      {n.body}
                    </AppText>
                  </View>
                  <AppText variant="caption" color={M.faint}>
                    {timeAgo(n.created_at)}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    scroll: { padding: S.md, paddingBottom: S.xl, gap: S.sm },
    section: { marginTop: S.md, letterSpacing: 0.5 },
    card: {
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.xs,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.xs },
    dot: { width: 9, height: 9, borderRadius: 5 },
  });
