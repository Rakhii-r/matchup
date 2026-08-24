import { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@core/api/supabaseClient';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Screen } from '@shared/ui/Screen';

export default function PlayerProfile(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const header = (
    <Stack.Screen
      options={{
        title: 'Player profile',
        headerLeft: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => router.back()}
            style={styles.back}
          >
            <AppText style={{ fontSize: 32, lineHeight: 32 }}>‹</AppText>
          </Pressable>
        ),
      }}
    />
  );
  const profile = useQuery({
    queryKey: ['player', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_player_stats', { in_user_id: id });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  if (profile.isLoading)
    return (
      <Screen>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText muted>Loading player...</AppText>
        </View>
      </Screen>
    );
  const p = profile.data;
  if (profile.isError || !p)
    return (
      <Screen>
        {header}
        <View style={styles.center}>
          <AppText>Unable to load player</AppText>
        </View>
      </Screen>
    );
  return (
    <Screen scroll>
      {header}
      <View style={styles.hero}>
        {p.avatar_url ? (
          <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <AppText variant="heading">{(p.full_name ?? 'P')[0]}</AppText>
          </View>
        )}
        <View>
          <AppText variant="heading">{p.full_name ?? 'Player'}</AppText>
          <AppText muted>{p.playing_role?.replace('_', ' ') ?? 'Player'}</AppText>
          {p.area_name ? (
            <AppText variant="caption" muted>
              {p.area_name}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={styles.stats}>
        {[
          ['Matches', p.matches_played],
          ['Wins', p.wins],
          ['Win Rate', p.matches_played ? `${p.win_rate}%` : '—'],
          ['MVP', p.motm],
        ].map(([label, value]) => (
          <View style={styles.stat} key={String(label)}>
            <AppText variant="caption" muted>
              {label}
            </AppText>
            <AppText variant="heading">{value}</AppText>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <AppText variant="label">Match Record</AppText>
        <AppText>Wins: {p.wins}</AppText>
        <AppText>Win rate: {p.matches_played ? `${p.win_rate}%` : '—'}</AppText>
      </View>
    </Screen>
  );
}
const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    back: { width: 40, alignItems: 'flex-start' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.xl,
    },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    stats: { flexDirection: 'row', marginBottom: spacing.lg },
    stat: { flex: 1, alignItems: 'center', gap: 2 },
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
  });
