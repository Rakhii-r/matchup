import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { getCurrentCoords } from '@core/location/location';
import {
  SLOT_MINUTES,
  VenueFormSchema,
  parseMapsLink,
  type PartnerVenue,
  type VenueForm,
} from '@features/partner/domain/partnerSchema';
import { useActiveSports } from '@features/sports/presentation/useSports';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { TextField } from '@shared/ui/TextField';
import { IconMinus, IconPin, IconPlus } from '@shared/ui/icons';

interface Props {
  initial?: PartnerVenue;
  /** Cover photo picker; only once the venue exists (storage path needs its id). */
  allowPhoto?: boolean;
  submitLabel: string;
  loading: boolean;
  onSubmit: (form: VenueForm, photoBase64: string | null) => void;
  error: string | null;
}

/**
 * The venue details form shared by "List your venue" and "Edit venue".
 * Location: no map library is installed, so the owner either stands at the
 * venue and uses the phone's location, or pastes a full Google Maps link.
 */
export function VenueFormFields({
  initial,
  allowPhoto = false,
  submitLabel,
  loading,
  onSubmit,
  error,
}: Props): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sports = useActiveSports();

  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [mapsLink, setMapsLink] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [sportTypes, setSportTypes] = useState<string[]>(initial?.sportTypes ?? ['box_cricket']);
  const [courts, setCourts] = useState(initial?.courtsCount ?? 1);
  const [openTime, setOpenTime] = useState(initial?.openTime ?? '06:00');
  const [closeTime, setCloseTime] = useState(initial?.closeTime ?? '23:00');
  const [facilities, setFacilities] = useState((initial?.facilities ?? []).join(', '));
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const grabLocation = async (): Promise<void> => {
    setLocBusy(true);
    setLocNote(null);
    try {
      const c = await getCurrentCoords();
      if (c) setCoords(c);
      else setLocNote('Could not get your location. Turn on location, or paste a Maps link.');
    } finally {
      setLocBusy(false);
    }
  };

  const applyMapsLink = (): void => {
    const c = parseMapsLink(mapsLink);
    if (c) {
      setCoords(c);
      setLocNote(null);
    } else {
      setLocNote(
        'No location found in that link. Open it in Google Maps, tap Share, and copy the full link, or use your current location.',
      );
    }
  };

  const pickPhoto = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.6,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.base64) setPhoto({ uri: asset.uri, base64: asset.base64 });
  };

  const toggleSport = (s: string): void =>
    setSportTypes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = (): void => {
    setFormError(null);
    const parsed = VenueFormSchema.safeParse({
      name,
      address: address.trim() || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
      phone: phone.trim() || undefined,
      sportTypes,
      courtsCount: courts,
      openTime: openTime.trim(),
      closeTime: closeTime.trim(),
      slotMinutes: SLOT_MINUTES,
      facilities: facilities
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }
    onSubmit(parsed.data, photo?.base64 ?? null);
  };

  const shownImage = photo?.uri ?? initial?.imageUrl ?? null;

  return (
    <View style={{ gap: spacing.md }}>
      <TextField label="Venue name *" value={name} onChangeText={setName} placeholder="e.g. Akhil Box" />
      <TextField
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="Street, area, city"
      />
      <TextField
        label="Venue phone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="10-digit number players can call"
      />

      <View style={styles.card}>
        <AppText variant="label">Location *</AppText>
        <AppText variant="caption" muted>
          {coords
            ? `Set: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
            : 'Stand at the venue and use your location, or paste a Google Maps link.'}
        </AppText>
        <Button
          label="Use my current location"
          variant="secondary"
          loading={locBusy}
          icon={(c) => <IconPin color={c} size={18} />}
          onPress={() => void grabLocation()}
        />
        <TextField
          label="Or paste a Google Maps link"
          value={mapsLink}
          onChangeText={setMapsLink}
          placeholder="https://www.google.com/maps/place/..."
        />
        {mapsLink.trim() ? (
          <Button label="Use this link" variant="secondary" onPress={applyMapsLink} />
        ) : null}
        {locNote ? <AppText variant="caption" color={colors.danger}>{locNote}</AppText> : null}
      </View>

      <View style={{ gap: spacing.xs }}>
        <AppText variant="label">Sports *</AppText>
        <View style={styles.chipRow}>
          {(sports.data ?? []).map((s) => {
            const on = sportTypes.includes(s.sport);
            return (
              <Pressable
                key={s.sport}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => toggleSport(s.sport)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <AppText color={on ? colors.surface : colors.text}>{s.name}</AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.row}>
        <AppText variant="label" style={{ flex: 1 }}>
          Courts / boxes
        </AppText>
        <Pressable
          style={styles.stepBtn}
          onPress={() => setCourts((c) => Math.max(1, c - 1))}
          accessibilityLabel="Fewer courts"
        >
          <IconMinus color={colors.text} size={18} />
        </Pressable>
        <AppText variant="heading" style={{ minWidth: 32, textAlign: 'center' }}>
          {courts}
        </AppText>
        <Pressable
          style={styles.stepBtn}
          onPress={() => setCourts((c) => Math.min(20, c + 1))}
          accessibilityLabel="More courts"
        >
          <IconPlus color={colors.text} size={18} />
        </Pressable>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TextField label="Opens (HH:MM)" value={openTime} onChangeText={setOpenTime} placeholder="06:00" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Closes (HH:MM)" value={closeTime} onChangeText={setCloseTime} placeholder="23:00" />
        </View>
      </View>

      <AppText variant="caption" muted>
        Courts are booked in 1-hour slots. Opening and closing times must be on the hour.
      </AppText>

      <TextField
        label="Facilities (comma separated)"
        value={facilities}
        onChangeText={setFacilities}
        placeholder="Parking, Washroom, Drinking water"
      />

      {allowPhoto ? (
        <View style={styles.card}>
          <AppText variant="label">Cover photo</AppText>
          {shownImage ? <Image source={{ uri: shownImage }} style={styles.photo} /> : null}
          <Button
            label={shownImage ? 'Change photo' : 'Add photo'}
            variant="secondary"
            onPress={() => void pickPhoto()}
          />
        </View>
      ) : null}

      {formError || error ? (
        <AppText color={colors.danger}>{formError ?? error}</AppText>
      ) : null}
      <Button label={submitLabel} loading={loading} onPress={submit} />
    </View>
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
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    chip: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    stepBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md },
  });
