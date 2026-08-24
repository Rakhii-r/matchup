import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import {
  useCreateVenue,
  useDeleteVenue,
  useUpdateVenue,
  useVenues,
} from '@features/venues/presentation/useVenues';
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
      <Stack.Screen options={{ title: 'Manage venues' }} />

      <View style={styles.card}>
        <AppText variant="label">{editingId ? 'Edit venue' : 'Add a venue'}</AppText>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="Smash Arena" />
        <TextField
          label="Address"
          value={address}
          onChangeText={setAddress}
          placeholder="Kothrud, Pune"
        />
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <TextField
              label="Latitude"
              value={lat}
              onChangeText={setLat}
              keyboardType="numbers-and-punctuation"
              placeholder="18.5074"
            />
          </View>
          <View style={styles.rowItem}>
            <TextField
              label="Longitude"
              value={lng}
              onChangeText={setLng}
              keyboardType="numbers-and-punctuation"
              placeholder="73.8077"
            />
          </View>
        </View>
        <TextField
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+9198XXXXXXXX"
        />
        <AppText variant="caption" muted>
          Sports
        </AppText>
        <View style={styles.chips}>
          {SPORTS.map((s) => (
            <Pressable
              key={s}
              onPress={() => toggleSport(s)}
              style={[styles.chip, sports.includes(s) ? styles.chipOn : null]}
            >
              <AppText
                variant="caption"
                color={sports.includes(s) ? colors.textInverse : colors.text}
              >
                {sportLabel(s)}
              </AppText>
            </Pressable>
          ))}
        </View>
        {error ? (
          <AppText variant="caption" color={colors.danger}>
            {error}
          </AppText>
        ) : null}
        <Button
          label={editingId ? 'Save changes' : 'Add venue'}
          onPress={onSubmit}
          loading={createVenue.isPending || updateVenue.isPending}
        />
        {editingId ? (
          <Button label="Cancel" variant="secondary" onPress={resetForm} />
        ) : null}
      </View>

      <AppText variant="label" muted style={{ marginBottom: spacing.sm }}>
        Current venues
      </AppText>
      {venues.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        (venues.data ?? []).map((v) => (
          <View key={v.id} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="label">{v.name}</AppText>
              {v.address ? (
                <AppText variant="caption" muted>
                  {v.address}
                </AppText>
              ) : null}
            </View>
            <View style={styles.rowActions}>
              <Pressable onPress={() => startEdit(v)}>
                <AppText variant="caption" color={colors.primary}>
                  Edit
                </AppText>
              </Pressable>
              <Pressable onPress={() => confirmDelete(v)} disabled={deleteVenue.isPending}>
                <AppText variant="caption" color={colors.danger}>
                  Delete
                </AppText>
              </Pressable>
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
      marginBottom: spacing.lg,
    },
    row: { flexDirection: 'row', gap: spacing.md },
    rowItem: { flex: 1 },
    chips: { flexDirection: 'row', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: colors.primary,
      backgroundColor: colors.background,
    },
    chipOn: { backgroundColor: colors.primary },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  });
