import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useCreateVenue, useDeleteVenue, useSetVenueStatus, useUpdateVenue, useVenues } from '@features/venues/presentation/useVenues';
import { VenueSchema } from '@features/venues/domain/venueSchema';
import type { Venue } from '@features/venues/domain/venueSchema';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { Sport } from '@shared/types/database.types';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

const SPORTS: Sport[] = ['badminton', 'box_cricket'];

export default function ManageVenuesScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const venues = useVenues();
  const createVenue = useCreateVenue();
  const updateVenue = useUpdateVenue();
  const setVenueStatus = useSetVenueStatus();
  const deleteVenue = useDeleteVenue();
  const sportLabel = useSportLabel();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [phone, setPhone] = useState('');
  const [sports, setSports] = useState<Sport[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleSport = (s: Sport): void =>
    setSports((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const resetForm = (): void => {
    setEditingId(null);
    setName('');
    setAddress('');
    setLat('');
    setLng('');
    setPhone('');
    setSports([]);
    setError(null);
  };

  const startEdit = (v: Venue): void => {
    setEditingId(v.id);
    setName(v.name);
    setAddress(v.address ?? '');
    setLat(String(v.lat));
    setLng(String(v.lng));
    setPhone(v.phone ?? '');
    setSports(v.sport_types);
    setError(null);
  };

  const onSubmit = (): void => {
    setError(null);
    const parsed = VenueSchema.safeParse({
      name,
      address: address.trim() === '' ? undefined : address,
      lat: Number(lat),
      lng: Number(lng),
      sportTypes: sports,
      phone: phone.trim() === '' ? undefined : phone,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    const onError = (e: unknown): void =>
      setError(e instanceof AppError ? e.message : 'Could not save the venue.');

    if (editingId) {
      updateVenue.mutate({ id: editingId, form: parsed.data }, { onSuccess: resetForm, onError });
    } else {
      createVenue.mutate(parsed.data, { onSuccess: resetForm, onError });
    }
  };

  const confirmDelete = (v: Venue): void => {
    Alert.alert('Delete venue?', `Remove "${v.name}" from the directory?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteVenue.mutate(v.id) },
    ]);
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Venue Management' }} />

      <View style={styles.card}>
        <AppText variant="heading">{editingId ? 'Edit venue' : 'Add a venue'}</AppText>
        <TextField label="Name *" value={name} onChangeText={setName} placeholder="e.g. Acro Turf" />
        <TextField
          label="Address"
          value={address}
          onChangeText={setAddress}
          placeholder="e.g. 123 Sports Ave, Indiranagar"
        />
        <View style={styles.inline}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Latitude *"
              value={lat}
              onChangeText={setLat}
              keyboardType="numeric"
              placeholder="12.9716"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Longitude *"
              value={lng}
              onChangeText={setLng}
              keyboardType="numeric"
              placeholder="77.5946"
            />
          </View>
        </View>
        <TextField
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+91..."
        />

        <View style={{ gap: spacing.xs }}>
          <AppText variant="label">Sports supported *</AppText>
          <View style={styles.sportsRow}>
            {SPORTS.map((s) => {
              const on = sports.includes(s);
              return (
                <Pressable
                  key={s}
                  style={[styles.sportChip, on && styles.sportChipOn]}
                  onPress={() => toggleSport(s)}
                >
                  <AppText color={on ? colors.surface : colors.text}>{sportLabel(s)}</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? <AppText color={colors.danger}>{error}</AppText> : null}

        <View style={styles.formActions}>
          <Button
            label={editingId ? 'Save changes' : 'Add venue'}
            loading={createVenue.isPending || updateVenue.isPending}
            onPress={onSubmit}
          />
          {editingId ? (
            <Button label="Cancel" variant="secondary" onPress={resetForm} />
          ) : null}
        </View>
      </View>

      <AppText variant="heading" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Current venues ({(venues.data ?? []).length})
      </AppText>

      {venues.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        (venues.data ?? []).map((v) => (
          <View key={v.id} style={[styles.card, { marginBottom: spacing.md }]}>
            <View style={styles.rowTop}>
              <AppText variant="label" style={{ flex: 1 }}>
                {v.name}
              </AppText>
              <View style={styles.chipRow}>
                <Button label="Edit" variant="secondary" onPress={() => startEdit(v)} />
                <Button label="Delete" variant="danger" onPress={() => confirmDelete(v)} />
              </View>
            </View>
            {v.address ? <AppText muted variant="caption">{v.address}</AppText> : null}
            <AppText muted variant="caption">
              Coordinates: {v.lat.toFixed(4)}, {v.lng.toFixed(4)}
            </AppText>
            {v.phone ? <AppText muted variant="caption">Phone: {v.phone}</AppText> : null}
            <AppText muted variant="caption">
              Sports: {v.sport_types.map((s) => sportLabel(s)).join(', ')}
            </AppText>
            {/*
              Approval queue. `nearby_venues` returns 'approved' rows only, so a
              captain's suggestion is invisible in every picker until it is
              approved here. This list IS the queue — no separate screen.
            */}
            <AppText
              variant="caption"
              color={v.status === 'approved' ? colors.success : colors.warning}
            >
              {v.status === 'approved'
                ? 'Approved — visible in the picker'
                : v.status === 'pending'
                  ? 'Pending review — hidden from the picker'
                  : 'Hidden from the picker'}
              {v.suggested_by ? ' · suggested by a captain' : ''}
            </AppText>
            <View style={styles.chipRow}>
              {v.status !== 'approved' ? (
                <Button
                  label="Approve"
                  loading={setVenueStatus.isPending}
                  onPress={() => setVenueStatus.mutate({ id: v.id, status: 'approved' })}
                />
              ) : (
                <Button
                  label="Hide"
                  variant="secondary"
                  loading={setVenueStatus.isPending}
                  onPress={() => setVenueStatus.mutate({ id: v.id, status: 'hidden' })}
                />
              )}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    inline: { flexDirection: 'row', gap: spacing.sm },
    sportsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    sportChip: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sportChipOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    chipRow: { flexDirection: 'row', gap: spacing.xs },
  });
