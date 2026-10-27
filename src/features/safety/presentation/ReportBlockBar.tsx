import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { REPORT_REASONS } from '@features/safety/domain/reportSchema';
import type { ReportReason } from '@features/safety/domain/reportSchema';
import {
  useBlockUser,
  useBlockedUsers,
  useReportUser,
  useUnblockUser,
} from '@features/safety/presentation/useSafety';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';

interface ReportBlockBarProps {
  targetUserId: string;
  matchId?: string | null;
  targetLabel?: string;
}

/**
 * Compact safety control for any other user. Tapping Report reveals the fixed reason
 * list; Block asks for confirmation first since it hides the two users from each other.
 * Renders nothing when the target is the signed-in user.
 *
 * A blocked user shows "You blocked this player · Unblock". The blocked state
 * is read from the block list, not only from this component's memory, so the
 * Unblock link is still there after leaving and reopening the screen -- before,
 * the only way back was Profile → Blocked players, which testers never found.
 */
export function ReportBlockBar({
  targetUserId,
  matchId = null,
  targetLabel = 'player',
}: ReportBlockBarProps): React.ReactNode {
  const myId = useAuthStore((s) => s.session?.user.id);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const report = useReportUser();
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const blockedList = useBlockedUsers();
  const [showReasons, setShowReasons] = useState(false);
  const [reported, setReported] = useState(false);

  if (!myId || myId === targetUserId) return null;

  const isBlocked = (blockedList.data ?? []).some((b) => b.userId === targetUserId);

  const confirmUnblock = (): void => {
    Alert.alert(
      `Unblock this ${targetLabel}?`,
      'You will see each other in games and availability again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () =>
            unblock.mutate(targetUserId, {
              onError: (e) =>
                Alert.alert(
                  'Could not unblock',
                  e instanceof AppError ? e.message : 'Please try again.',
                ),
            }),
        },
      ],
    );
  };

  if (isBlocked) {
    return (
      <View style={[styles.row, styles.wrap]}>
        <AppText variant="caption" muted>
          You blocked this {targetLabel}.
        </AppText>
        <Pressable
          onPress={confirmUnblock}
          disabled={unblock.isPending}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Unblock this ${targetLabel}`}
        >
          <AppText variant="caption" color={colors.accent} style={styles.link}>
            {unblock.isPending ? 'Unblocking…' : 'Unblock'}
          </AppText>
        </Pressable>
      </View>
    );
  }
  if (reported) {
    return (
      <AppText variant="caption" muted>
        Report sent to moderators.
      </AppText>
    );
  }

  const submitReason = (reason: ReportReason): void => {
    report.mutate(
      { reportedUserId: targetUserId, matchId, reason },
      {
        onSuccess: () => {
          setShowReasons(false);
          setReported(true);
        },
        onError: (e) =>
          Alert.alert('Could not report', e instanceof AppError ? e.message : 'Please try again.'),
      },
    );
  };

  const confirmBlock = (): void => {
    Alert.alert(
      `Block this ${targetLabel}?`,
      'You will no longer see each other in games or availability.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () =>
            // No local flag on success: the mutation refreshes the block list,
            // and isBlocked above switches the bar to its Unblock state.
            block.mutate(targetUserId, {
              onError: (e) =>
                Alert.alert(
                  'Could not block',
                  e instanceof AppError ? e.message : 'Please try again.',
                ),
            }),
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable onPress={() => setShowReasons((v) => !v)} disabled={report.isPending}>
          <AppText variant="caption" color={colors.accent}>
            Report
          </AppText>
        </Pressable>
        <AppText variant="caption" muted>
          ·
        </AppText>
        <Pressable onPress={confirmBlock} disabled={block.isPending}>
          <AppText variant="caption" color={colors.danger}>
            Block
          </AppText>
        </Pressable>
      </View>

      {showReasons ? (
        <View style={styles.reasons}>
          {REPORT_REASONS.map((r) => (
            <Pressable
              key={r}
              style={styles.reasonChip}
              disabled={report.isPending}
              onPress={() => submitReason(r)}
            >
              <AppText variant="caption">{r}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    wrap: { gap: spacing.sm, marginTop: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    link: { fontWeight: '700', textDecorationLine: 'underline' },
    reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    reasonChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
  });
