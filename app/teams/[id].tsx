import { useMemo } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { SPORT_LABEL } from '@features/matches/domain/matchSchema';
import { TEAM_ROLE_LABEL } from '@features/teams/domain/teamSchema';
import type { Team, TeamMemberWithProfile } from '@features/teams/domain/teamSchema';
import {
  useDeleteTeam,
  useTeam,
  useTeamMemberActions,
  useTeamMembers,
} from '@features/teams/presentation/useTeams';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

function buildInviteText(team: Team): string {
  return [
    `Join my team "${team.name}" on SIXFOUR 24`,
    SPORT_LABEL[team.sport],
    '',
    `Invite code: ${team.invite_code}`,
    'Open SIXFOUR 24 → Teams → Join with code.',
  ].join('\n');
}

export default function TeamDetailScreen(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = id ?? '';
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.user.id);

  const team = useTeam(teamId);
  const members = useTeamMembers(teamId);
  const removeMember = useTeamMemberActions(teamId);
  const deleteTeam = useDeleteTeam();

  const data = team.data;
  const isOwner = Boolean(data && userId && data.owner_id === userId);

  const myMembership = useMemo(
    () => (members.data ?? []).find((m) => m.user_id === userId) ?? null,
    [members.data, userId],
  );

  const onShare = (): void => {
    if (!data) return;
    const url = `https://wa.me/?text=${encodeURIComponent(buildInviteText(data))}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open WhatsApp', `Invite code: ${data.invite_code}`);
    });
  };

  const onRemove = (member: TeamMemberWithProfile): void => {
    const isMe = member.user_id === userId;
    Alert.alert(
      isMe ? 'Leave team?' : 'Remove player?',
      isMe
        ? 'You will lose access to this team. You can rejoin with the invite code.'
        : `${member.profile?.full_name ?? 'This player'} will be removed from the team.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isMe ? 'Leave' : 'Remove',
          style: 'destructive',
          onPress: () => {
            removeMember.mutate(member.id, {
              onSuccess: () => {
                if (isMe) router.back();
              },
            });
          },
        },
      ],
    );
  };

  const onDeleteTeam = (): void => {
    Alert.alert(
      'Delete this team?',
      'Every member loses access and the invite code stops working. This cannot be undone.',
      [
        { text: 'Keep team', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteTeam.mutate(teamId, { onSuccess: () => router.back() });
          },
        },
      ],
    );
  };

  if (team.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Team' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (team.isError || !data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Team' }} />
        <View style={styles.center}>
          <AppText muted>This team could not be found.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void team.refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: data.name }} />

      <View style={styles.card}>
        <AppText variant="heading">{data.name}</AppText>
        <AppText muted>{SPORT_LABEL[data.sport]}</AppText>
        <View style={styles.codeBox}>
          <AppText variant="caption" muted>
            Invite code
          </AppText>
          <AppText variant="heading">{data.invite_code}</AppText>
          <Button label="Invite on WhatsApp" variant="secondary" onPress={onShare} />
        </View>
      </View>

      {/* Only the owner can issue a challenge — create_challenge enforces it too. */}
      {isOwner ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Button
            label="Challenge another team"
            onPress={() =>
              router.push({ pathname: '/teams/challenge', params: { teamId: data.id } })
            }
          />
        </View>
      ) : null}

      <AppText variant="label" muted style={{ marginBottom: spacing.sm }}>
        SQUAD
      </AppText>

      {members.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        (members.data ?? []).map((m) => {
          const isMe = m.user_id === userId;
          const canRemove = m.role !== 'owner' && (isMe || isOwner);
          return (
            <View key={m.id} style={styles.memberRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="label" numberOfLines={1}>
                  {m.profile?.full_name ?? 'Player'}
                  {isMe ? ' (you)' : ''}
                </AppText>
                <AppText variant="caption" muted>
                  {TEAM_ROLE_LABEL[m.role]}
                  {m.profile?.area_name ? ` · ${m.profile.area_name}` : ''}
                </AppText>
              </View>
              {canRemove ? (
                <Button
                  label={isMe ? 'Leave' : 'Remove'}
                  variant="secondary"
                  disabled={removeMember.isPending}
                  onPress={() => onRemove(m)}
                />
              ) : null}
            </View>
          );
        })
      )}

      {isOwner ? (
        <View style={{ marginTop: spacing.xl }}>
          <Button
            label="Delete team"
            variant="danger"
            loading={deleteTeam.isPending}
            onPress={onDeleteTeam}
          />
        </View>
      ) : null}

      {!isOwner && myMembership === null ? (
        <AppText variant="caption" muted style={{ marginTop: spacing.lg }}>
          You are no longer a member of this team.
        </AppText>
      ) : null}
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
    marginBottom: spacing.lg,
  },
  codeBox: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
