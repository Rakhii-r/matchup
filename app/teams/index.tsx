import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { SPORT_LABEL } from '@features/matches/domain/matchSchema';
import { useMyTeams } from '@features/teams/presentation/useTeams';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

export default function TeamsScreen(): React.ReactNode {
  const router = useRouter();
  const teams = useMyTeams();

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          title: 'Teams',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      <View style={styles.actions}>
        <Button label="Create team" onPress={() => router.push('/teams/create')} />
        <Button
          label="Join with code"
          variant="secondary"
          onPress={() => router.push('/teams/join')}
        />
        {/* Not gated on owning a team — you can receive a challenge as a member. */}
        <Button
          label="Challenges"
          variant="secondary"
          onPress={() => router.push('/teams/challenges')}
        />
        {/*
          Both open-challenge entry points. Ungated for the same reason as
          Challenges: posting is owner-only and refused server-side by
          post_open_challenge, and the post screen explains that rather than
          hiding the button, so a member is not left wondering where it went.
        */}
        <Button
          label="Find an opponent"
          variant="secondary"
          onPress={() => router.push('/teams/post-open')}
        />
        <Button
          label="Match offers"
          variant="secondary"
          onPress={() => router.push('/teams/offers')}
        />
      </View>

      {teams.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : teams.isError ? (
        <View style={styles.notice}>
          <AppText muted>Could not load your teams.</AppText>
          <Button label="Retry" variant="secondary" onPress={() => void teams.refetch()} />
        </View>
      ) : (teams.data ?? []).length === 0 ? (
        <View style={styles.notice}>
          <AppText variant="label">No teams yet</AppText>
          <AppText variant="caption" muted>
            Create a squad you play with regularly, or join one with an invite code.
          </AppText>
        </View>
      ) : (
        (teams.data ?? []).map((team) => (
          <Pressable
            key={team.id}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => router.push({ pathname: '/teams/[id]', params: { id: team.id } })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label" numberOfLines={1}>
                {team.name}
              </AppText>
              <AppText variant="caption" muted>
                {SPORT_LABEL[team.sport]}
              </AppText>
            </View>
            <AppText variant="caption" muted>
              {team.invite_code}
            </AppText>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginBottom: spacing.lg },
  notice: { gap: spacing.sm, paddingVertical: spacing.lg, alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
