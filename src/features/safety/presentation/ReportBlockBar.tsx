import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { REPORT_REASONS } from '@features/safety/domain/reportSchema';
import type { ReportReason } from '@features/safety/domain/reportSchema';
import { useBlockUser, useReportUser } from '@features/safety/presentation/useSafety';
import { colors, radius, spacing } from '@shared/theme';
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
 */
export function ReportBlockBar({
  targetUserId,
  matchId = null,
  targetLabel = 'player',
}: ReportBlockBarProps): React.ReactNode {
  const myId = useAuthStore((s) => s.session?.user.id);
  const report = useReportUser();
  const block = useBlockUser();
  const [showReasons, setShowReasons] = useState(false);
  const [done, setDone] = useState<'reported' | 'blocked' | null>(null);

  if (!myId || myId === targetUserId) return null;
  if (done) {
    return (
      <AppText variant="caption" muted>
        {done === 'reported' ? 'Report sent to moderators.' : `You blocked this ${targetLabel}.`}
      </AppText>
    );
  }

  const submitReason = (reason: ReportReason): void => {
    report.mutate(
      { reportedUserId: targetUserId, matchId, reason },
      {
        onSuccess: () => {
          setShowReasons(false);
          setDone('reported');
        },
        onError: (e) =>
          Alert.alert('Could not report', e instanceof AppError ? e.message : 'Please try again.'),
      },
    );
  };

  const confirmBlock = (): void => {
    Alert.alert(
      `Block this ${targetLabel}?`,
      'You will no longer see each other in matches or availability.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () =>
            block.mutate(targetUserId, {
              onSuccess: () => setDone('blocked'),
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

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
