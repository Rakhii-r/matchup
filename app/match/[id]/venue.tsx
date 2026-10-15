/**
 * Venue picker for a match.
 *
 * The create wizard captures an AREA and defers the ground: booking a pitch is
 * a spend, creating a match is only an intent, and gating the intent behind the
 * spend kills the flow. This screen is the deferred half.
 *
 * Two ways to finish it, because both are real. A ground booked over the phone
 * only needs TAGGING — tap the card, `set_match_venue`, done. A ground with
 * courts in the directory can be BOOKED here, which reserves the court and
 * attaches it in one step. Booking also moves the match to the slot's time
 * (see book_venue_slot), so BookingModal confirms that before it commits.
 *
 * ORGANISER-ONLY. `set_match_venue` raises NOT_THE_ORGANISER for anyone else,
 * so non-organisers get a stated line here rather than a list that would fail
 * on tap.
 *
 * The list is scoped to the match's own coordinates and search radius, so it
 * shows grounds near the area the organiser already chose — not the whole
 * directory. Ranking is distance, then rating, then name.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { useMatch, useSetMatchVenue } from '@features/matches/presentation/useMatches';
import { useNearbyVenues } from '@features/venues/presentation/useVenues';
import type { NearbyVenue } from '@features/venues/data/venueRepository';
import { CourtSlotPickerSheet } from '@features/venues/presentation/CourtSlotPickerSheet';
import type { CourtSlotPickerVenue } from '@features/venues/presentation/CourtSlotPickerSheet';
import {
  formatCourtLabel,
  formatDateIso,
  formatSlotWindow,
} from '@features/venues/domain/slotUtils';
import type { VenueBooking } from '@features/venues/domain/venueBookingSchema';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export default function MatchVenueScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = id ?? '';
  const router = useRouter();

  const match = useMatch(matchId);
  const myUserId = useAuthStore((s) => s.session?.user.id);
  const setVenue = useSetMatchVenue(matchId);

  const data = match.data;
  /*
    set_match_venue is creator-only (20260827110000). This screen used to gate
    on a wider isCaptain, so the opposing captain could open the picker, tap a
    venue and only then be refused with NOT_THE_ORGANISER. A read model that
    gates a button must mirror the write rule it gates.
  */
  const isCreator = Boolean(data && myUserId && data.creator_id === myUserId);

  // Null until the match row lands, which keeps the query from firing against
  // undefined coordinates on first render.
  const nearbyInput = useMemo(
    () =>
      data && data.match_lat != null && data.match_lng != null
        ? {
            lat: data.match_lat,
            lng: data.match_lng,
            radiusM: data.search_radius_m ?? 25000,
            sport: data.sport,
          }
        : null,
    [data],
  );
  const venues = useNearbyVenues(nearbyInput);

  // The ground whose courts are open in the sheet. Null means the sheet is shut;
  // it is not the same thing as the match's venue, which only `onPick` sets.
  const [bookingVenue, setBookingVenue] = useState<CourtSlotPickerVenue | null>(null);

  // The sheet opens on the day the game is actually on, not on today.
  const matchDateIso = data?.scheduled_at ? formatDateIso(new Date(data.scheduled_at)) : undefined;

  const onPick = (venueId: string | null) => {
    setVenue.mutate(venueId, {
      onSuccess: () => router.back(),
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Could not save the venue. Please try again.';
        Alert.alert('Venue not saved', message);
      },
    });
  };

  /**
   * book_venue_slot has already set matches.venue_id, scheduled_at and end_time
   * inside its own transaction, so there is deliberately no set_match_venue call
   * here -- a second write would only race its own result. Closing the sheet and
   * leaving is what is left to do; useBookSlot invalidates the match.
   */
  const onBooked = (booking: VenueBooking): void => {
    setBookingVenue(null);
    Alert.alert(
      'Court booked',
      `${formatCourtLabel(booking.courtNumber, booking.sportTypes)} is held for ${formatSlotWindow(
        booking.startTime,
        booking.endTime,
      )}, and the ground is now on this game.`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  };


  if (match.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Venue' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Venue' }} />
        <View style={styles.center}>
          <AppText muted>This game could not be found.</AppText>
        </View>
      </Screen>
    );
  }

  if (!isCreator) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Venue' }} />
        <View style={styles.center}>
          <AppText muted>Your game organiser picks the ground.</AppText>
        </View>
      </Screen>
    );
  }

  const renderItem = ({ item }: { item: NearbyVenue }) => {
    const isCurrent = item.id === data.venue_id;
    return (
      <Pressable
        style={[styles.venueCard, isCurrent && styles.venueCardCurrent]}
        disabled={setVenue.isPending}
        onPress={() => onPick(item.id)}
      >
        <View style={styles.venueHead}>
          <AppText variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {item.name}
          </AppText>
          <AppText variant="caption" muted>
            {formatDistance(item.distance_m)}
          </AppText>
        </View>
        {item.address ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {item.address}
          </AppText>
        ) : null}
        {/*
          Every enrichment field is nullable and unpopulated on most rows today.
          Render nothing rather than a fabricated rating or price.
        */}
        <View style={styles.metaRow}>
          {item.rating != null ? (
            <AppText variant="caption" muted>
              ★ {item.rating}
              {item.rating_count > 0 ? ` (${item.rating_count})` : ''}
            </AppText>
          ) : null}
          {item.price_per_hour != null ? (
            <AppText variant="caption" muted>
              ₹{item.price_per_hour}/hr
            </AppText>
          ) : null}
          {isCurrent ? (
            <AppText variant="caption" color={colors.primary}>
              Current venue
            </AppText>
          ) : null}
        </View>
        {/*
          Only grounds that actually have courts on file can be booked. The rest
          are tag-only: tapping the card still attaches them, which is the path
          for a pitch booked over the phone.
        */}
        {item.courts_count > 0 ? (
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Book a court here"
              variant="secondary"
              onPress={() =>
                setBookingVenue({
                  id: item.id,
                  name: item.name,
                  address: item.address,
                  sport_types: item.sport_types ?? undefined,
                  courts_count: item.courts_count,
                  price_per_hour: item.price_per_hour,
                  phone: item.phone,
                  operating_hours_start: item.operating_hours_start,
                  operating_hours_end: item.operating_hours_end,
                  slot_duration_minutes: item.slot_duration_minutes,
                })
              }
            />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Venue' }} />
      <FlatList
        data={venues.data ?? []}
        keyExtractor={(v) => v.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        ListHeaderComponent={
          <AppText variant="caption" muted style={{ marginBottom: spacing.md }}>
            Grounds near {data.area_name ?? 'your area'} that host{' '}
            {data.sport === 'badminton' ? 'badminton' : 'box cricket'}.
          </AppText>
        }
        ListEmptyComponent={
          venues.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <AppText variant="label">No grounds listed here yet</AppText>
              <AppText variant="caption" muted>
                We have no venues on file near {data.area_name ?? 'this area'}. Players will see
                the area instead, which is enough to meet up.
              </AppText>
            </View>
          )
        }
        ListFooterComponent={
          <View style={{ marginTop: spacing.lg }}>
            {data.venue_id ? (
              <Button
                label="Remove venue"
                variant="secondary"
                disabled={setVenue.isPending}
                onPress={() => onPick(null)}
              />
            ) : null}

            {/*
              Adding a ground is admin-only now (owner's call). suggest_venue
              and its 'pending' status stay in the database for the admin
              portal; the player-facing form is gone, so the only way a ground
              reaches this list is an admin approving it.
            */}
            <AppText variant="caption" muted style={{ marginTop: spacing.md }}>
              Can&apos;t find your ground? Grounds are added by the sixfour24 team — tell
              us about it and we&apos;ll add it.
            </AppText>
          </View>
        }
      />

      <CourtSlotPickerSheet
        visible={bookingVenue !== null}
        onClose={() => setBookingVenue(null)}
        venue={bookingVenue}
        initialDate={matchDateIso}
        initialMatchId={matchId}
        matches={[
          {
            id: matchId,
            title: data.match_name,
            sport: data.sport,
            scheduled_at: data.scheduled_at,
          },
        ]}
        onBookingSuccess={onBooked}
      />
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    addBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing.sm,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingTop: spacing.xxl,
    },
    empty: {
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    venueCard: {
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: spacing.sm,
    },
    venueCardCurrent: { borderColor: colors.primary },
    venueHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  });
