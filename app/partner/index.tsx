import { useMemo } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { PartnerVenue } from '@features/partner/domain/partnerSchema';
import { useMyPartnerVenues } from '@features/partner/presentation/usePartner';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

const STATUS_TEXT: Record<PartnerVenue['status'], string> = {
  approved: 'Live: players can see and book it',
  pending: 'Waiting for approval: hidden from players',
  hidden: 'Hidden by the SIXFOUR 24 team',
};

/** Venue Partner home: the venues the caller owns or staffs. */
export default function PartnerHomeScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const venues = useMyPartnerVenues();

  return (
    <Screen scroll>
      {venues.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : venues.isError ? (
        <View style={{ gap: spacing.sm }}>
          <AppText color={colors.danger}>Could not load your venues.</AppText>
          <Button label="Try again" variant="secondary" onPress={() => void venues.refetch()} />
        </View>
      ) : (venues.data ?? []).length === 0 ? (
        <AppText muted>You have not listed a venue yet.</AppText>
      ) : (
        (venues.data ?? []).map((v) => (
          <View key={v.id} style={styles.card}>
            {v.imageUrl ? <Image source={{ uri: v.imageUrl }} style={styles.photo} /> : null}
            <AppText variant="heading">{v.name}</AppText>
            {v.address ? <AppText muted variant="caption">{v.address}</AppText> : null}
            <AppText
              variant="caption"
              color={v.status === 'approved' ? colors.success : colors.warning}
            >
              {STATUS_TEXT[v.status]}
            </AppText>
            <AppText muted variant="caption">
              {v.courtsCount} {v.courtsCount === 1 ? 'court' : 'courts'} · {v.openTime}–{v.closeTime} ·{' '}
              {v.role === 'owner' ? 'Owner' : 'Staff'}
            </AppText>
            {v.role === 'owner' ? (
              <Button
                label="Edit venue details"
                variant="secondary"
                onPress={() => router.push(`/partner/${v.id}/edit` as never)}
              />
            ) : null}
          </View>
        ))
      )}

      <View style={{ marginTop: spacing.lg }}>
        <Button label="List a new venue" onPress={() => router.push('/partner/register' as never)} />
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    card: {
      gap: spacing.xs,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, marginBottom: spacing.xs },
  });
