/**
 * Offers — fixtures the matcher put in front of one of my teams.
 *
 * This is the accept side of an open challenge. Losing the race is a normal
 * outcome, not a failure: the RPC row-locks the challenge and the loser gets
 * CHALLENGE_ALREADY_TAKEN, which is shown as information and the list refreshed.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useAcceptOpenChallenge, useMyOffers } from '@features/teams/presentation/useChallenges';
import type { OpenOffer } from '@features/teams/domain/challengeSchema';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unavailable';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  return metres < 1000 ? `${Math.round(metres)} m away` : `${(metres / 1000).toFixed(1)} km away`;
}

export default function OffersScreen(): React.ReactNode {
  const router = useRouter();
  const offers = useMyOffers();
  const accept = useAcceptOpenChallenge();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onAccept = useCallback(
    (offer: OpenOffer) => {
      if (!offer.challenge) return;
      setPendingId(offer.id);
      accept.mutate(
        { challengeId: offer.challenge_id, teamId: offer.team_id },
        {
          onSuccess: (challenge) => {
            setPendingId(null);
            if (challenge.match_id) {
              router.replace(`/match/${challenge.match_id}`);
            } else {
              void offers.refetch();
            }
          },
          onError: (error: unknown) => {
            setPendingId(null);
            const message =
              error instanceof AppError ? error.message : 'Could not accept the fixture.';
            Alert.alert('Fixture', message);
            // Whether we lost the race or hit a validation rule, the list is
            // now stale either way.
            void offers.refetch();
          },
        },
      );
    },
    [accept, offers, router],
  );

  const renderItem = useCallback(
    ({ item }: { item: OpenOffer }) => {
      if (!item.challenge) return null;
      const busy = pendingId === item.id;
      return (
        <View style={styles.card}>
          <AppText style={styles.title}>{item.challenge.match_name}</AppText>
          <AppText style={styles.meta}>{formatWhen(item.challenge.scheduled_at)}</AppText>
          <AppText style={styles.meta}>
            {formatDistance(item.distance_m)} · {item.challenge.total_slots} players
          </AppText>
          <AppText style={styles.meta}>For {item.team?.name ?? 'your team'}</AppText>
          {item.challenge.message ? (
            <AppText style={styles.message}>{item.challenge.message}</AppText>
          ) : null}
          <View style={styles.cta}>
            <Button
              label="Accept fixture"
              onPress={() => onAccept(item)}
              loading={busy}
              disabled={accept.isPending}
            />
          </View>
        </View>
      );
    },
    [accept.isPending, onAccept, pendingId],
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Match offers' }} />
      {offers.isLoading ? (
        <View style={styles.centre}>
          <ActivityIndicator />
        </View>
      ) : offers.isError ? (
        <View style={styles.centre}>
          <AppText style={styles.meta}>Could not load offers.</AppText>
          <View style={styles.cta}>
            <Button label="Try again" onPress={() => void offers.refetch()} />
          </View>
        </View>
      ) : (
        <FlatList
          data={offers.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshing={offers.isRefetching}
          onRefresh={() => void offers.refetch()}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centre}>
              <AppText style={styles.title}>No offers right now</AppText>
              <AppText style={styles.meta}>
                When a nearby team posts a fixture that fits your squad, it appears here.
              </AppText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.md },
  centre: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted },
  message: { fontSize: 14, color: colors.text, marginTop: spacing.xs },
  cta: { marginTop: spacing.sm },
});
