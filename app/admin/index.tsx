import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useReports, useUsers } from '@features/admin/presentation/useModeration';
import { useAllSports } from '@features/sports/presentation/useSports';
import { useVenues } from '@features/venues/presentation/useVenues';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import {
  IconBell,
  IconChevron,
  IconCricket,
  IconPin,
  IconShieldCheck,
  IconUsers,
} from '@shared/ui/icons';
import { Screen } from '@shared/ui/Screen';

interface AdminHubCardProps {
  title: string;
  subtitle: string;
  countLabel?: string;
  badgeColor?: string;
  IconComponent: React.ComponentType<{ color: string; size: number }>;
  iconBg: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: AppColors;
}

function AdminHubCard({
  title,
  subtitle,
  countLabel,
  badgeColor,
  IconComponent,
  iconBg,
  onPress,
  styles,
  colors,
}: AdminHubCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
        <IconComponent color={colors.text} size={24} />
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <AppText variant="label" style={styles.cardTitle}>
            {title}
          </AppText>
          {countLabel ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: badgeColor ? `${badgeColor}20` : colors.surface },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color: badgeColor ?? colors.primary,
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                {countLabel}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" muted style={styles.cardSubtitle}>
          {subtitle}
        </AppText>
      </View>
      <IconChevron color={colors.textMuted} size={18} />
    </Pressable>
  );
}

export default function AdminHubScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const reports = useReports('open');
  const users = useUsers();
  const venues = useVenues();
  const sports = useAllSports();

  const openReportsCount = reports.data?.length ?? 0;
  const usersCount = users.data?.length ?? 0;
  const venuesCount = venues.data?.length ?? 0;
  const activeSportsCount = (sports.data ?? []).filter((s) => s.is_active).length;

  return (
    <Screen scroll>
      <View style={styles.heroBanner}>
        <View style={styles.heroIcon}>
          <IconShieldCheck color={colors.primary} size={28} />
        </View>
        <View style={styles.heroText}>
          <AppText variant="heading" style={styles.heroTitle}>
            Admin Control Center
          </AppText>
          <AppText variant="caption" muted>
            Manage moderation reports, user accounts, venues, and sport settings.
          </AppText>
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="caption" muted style={styles.sectionHeader}>
          MANAGEMENT MODULES
        </AppText>

        <AdminHubCard
          title="Reports & Moderation"
          subtitle="Triage open player reports and deactivate flagged accounts"
          countLabel={
            reports.isLoading ? '...' : `${openReportsCount} open`
          }
          badgeColor={openReportsCount > 0 ? colors.danger : colors.primary}
          IconComponent={IconBell}
          iconBg={openReportsCount > 0 ? `${colors.danger}15` : `${colors.primary}15`}
          onPress={() => router.push('/admin/reports' as never)}
          styles={styles}
          colors={colors}
        />

        <AdminHubCard
          title="User Directory"
          subtitle="View all registered players, phone numbers, areas, and sports"
          countLabel={users.isLoading ? '...' : `${usersCount} users`}
          badgeColor={colors.primary}
          IconComponent={IconUsers}
          iconBg={`${colors.primary}15`}
          onPress={() => router.push('/admin/users' as never)}
          styles={styles}
          colors={colors}
        />

        <AdminHubCard
          title="Venues & Grounds"
          subtitle="Add, edit, or remove sports arenas, turfs, and court locations"
          countLabel={venues.isLoading ? '...' : `${venuesCount} venues`}
          badgeColor="#0EA5E9"
          IconComponent={IconPin}
          iconBg="#0EA5E915"
          onPress={() => router.push('/admin/venues' as never)}
          styles={styles}
          colors={colors}
        />

        <AdminHubCard
          title="Sports Configuration"
          subtitle="Enable or disable supported sports and adjust display names"
          countLabel={sports.isLoading ? '...' : `${activeSportsCount} active`}
          badgeColor="#10B981"
          IconComponent={IconCricket}
          iconBg="#10B98115"
          onPress={() => router.push('/admin/sports' as never)}
          styles={styles}
          colors={colors}
        />
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    heroBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.lg,
    },
    heroIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: `${colors.primary}20`,
      justifyContent: 'center',
      alignItems: 'center',
    },
    heroText: {
      flex: 1,
      gap: 2,
    },
    heroTitle: {
      fontSize: 18,
      fontWeight: '700',
    },
    section: {
      gap: spacing.md,
    },
    sectionHeader: {
      fontWeight: '700',
      letterSpacing: 1,
      marginBottom: spacing.xs,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.md,
    },
    cardPressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
    iconContainer: {
      width: 44,
      height: 44,
      borderRadius: radius.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardContent: {
      flex: 1,
      gap: 4,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    cardSubtitle: {
      fontSize: 13,
      lineHeight: 18,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
  });
