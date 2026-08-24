import { useMemo } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { TEAM_ROLE_LABEL } from '@features/teams/domain/teamSchema';
import { useSetMemberRole, useTeamMemberActions, useTeamMembers, useTeamOverview } from '@features/teams/presentation/useTeams';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

export default function ManageTeam(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = id ?? '';
  const router = useRouter();
  const overview = useTeamOverview(teamId);
  const members = useTeamMembers(teamId);
  const remove = useTeamMemberActions(teamId);
  const role = useSetMemberRole(teamId);
  const team = overview.data;
  // Owner-only gate must wait for the overview, or the owner sees a refusal flash.
  if (overview.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Manage team' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }
  if (!team?.i_am_owner) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Manage team' }} />
        <View style={styles.center}>
          <AppText>Only the team owner can manage this team.</AppText>
          <Button label="Back to team" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  const confirmRemove = (m: any) => Alert.alert('Remove member?', `${m.profile?.full_name ?? 'This player'} will be removed from ${team.name}.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(m.id) }]);
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Manage team' }} />
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <Button label="Edit team details" onPress={() => router.push(`/teams/${teamId}/edit`)} />
        <Button label="Invite players" variant="secondary" onPress={() => router.push(`/teams/${teamId}/invite`)} />
      </View>
      <AppText variant="label" style={{ marginBottom: spacing.sm }}>Manage members</AppText>
      {members.data?.map(m => (
        <View style={styles.row} key={m.id}>
          <View style={{ flex: 1 }}>
            <AppText variant="label">{m.profile?.full_name ?? 'Player'}</AppText>
            <AppText muted variant="caption">{TEAM_ROLE_LABEL[m.role]}</AppText>
          </View>
          {m.role !== 'owner' ? (
            <View style={{ gap: spacing.xs }}>
              <Button label={m.role === 'vice_captain' ? 'Remove vice captain' : 'Make vice captain'} variant="secondary" onPress={() => role.mutate({ userId: m.user_id, role: m.role === 'vice_captain' ? 'member' : 'vice_captain' })} />
              <Button label="Remove member" variant="danger" onPress={() => confirmRemove(m)} />
            </View>
          ) : null}
        </View>
      ))}
      <View style={styles.notice}>
        <AppText variant="label">Leave team</AppText>
        <AppText muted>Owner cannot leave the team. Transfer ownership first.</AppText>
      </View>
    </Screen>
  );
}
const makeStyles = (colors: AppColors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.sm },
  notice: { marginTop: spacing.lg, gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
});
