import { useMemo } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { useTeamOverview } from '@features/teams/presentation/useTeams';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

export default function InvitePlayers(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useTeamOverview(id ?? '');
  const sportLabel = useSportLabel();
  const t = q.data;
  // Owner-only gate must wait for the overview, or the owner sees a refusal flash.
  if (q.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Invite players' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }
  if (!t?.i_am_owner) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Invite players' }} />
        <AppText>Only the team owner can invite players.</AppText>
      </Screen>
    );
  }
  const inviteCode = t.invite_code ?? '';
  const text = `Join ${t.name} on SIXFOUR 24\n${sportLabel(t.sport)}\n\nTeam invite code: ${inviteCode}\nOpen Teams → Join with code.`;
  const share = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => Alert.alert('Share this code', inviteCode));
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Invite players' }} />
      <View style={styles.card}>
        <AppText muted center>Team invite code</AppText>
        <Pressable onPress={() => void Clipboard.setStringAsync(inviteCode)}>
          <AppText variant="title" center>{inviteCode || '—'}</AppText>
        </Pressable>
        <AppText muted center>Share this code with players to join {t.name}.</AppText>
      </View>
      <Button label="Share via WhatsApp" onPress={share} disabled={!inviteCode} />
      <View style={{ marginTop: spacing.sm }}>
        <Button label="Copy invite code" variant="secondary" onPress={() => void Clipboard.setStringAsync(inviteCode)} disabled={!inviteCode} />
      </View>
    </Screen>
  );
}
const makeStyles = (colors: AppColors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.lg },
});
