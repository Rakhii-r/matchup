/**
 * Create Match — Step 2 of 3: Select Area & Radius.
 *
 * Captures the discovery area locality and search radius for player/team matching.
 * Specific venue selection is deferred until an opponent or squad is confirmed.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { getCurrentCoords, getAreaNameFromCoords } from '@core/location/location';
import { useAuthStore } from '@core/auth/authStore';
import {
  useCreateMatchWizard,
  stepPosition,
} from '@features/matches/presentation/useCreateMatchWizard';
import {
  Chip,
  SectionLabel,
  StepState,
  TOUCH,
  WizardScreen,
} from '@features/matches/presentation/CreateMatchWizardUI';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconPin } from '@shared/ui/icons';

const RADIUS_KM = [1, 3, 5, 10, 25, 50];

export default function SelectAreaStep(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();

  const profile = useAuthStore((s) => s.profile);
  const sport = useCreateMatchWizard((s) => s.sport);
  const areaName = useCreateMatchWizard((s) => s.areaName);
  const areaCoords = useCreateMatchWizard((s) => s.areaCoords);
  const searchRadiusM = useCreateMatchWizard((s) => s.searchRadiusM);
  const setAreaName = useCreateMatchWizard((s) => s.setAreaName);
  const setAreaCoords = useCreateMatchWizard((s) => s.setAreaCoords);
  const setSearchRadiusM = useCreateMatchWizard((s) => s.setSearchRadiusM);

  const sportLabel = useSportLabel();
  const { index, total } = stepPosition('area');

  const [locBusy, setLocBusy] = useState(false);
  const [locNotice, setLocNotice] = useState<'denied' | 'error' | null>(null);

  // If the user already has a saved area/home location in profile, prefill it for convenience
  useEffect(() => {
    if (!areaName && profile?.area_name) {
      setAreaName(profile.area_name);
    }
    if (!areaCoords && profile?.home_lat && profile?.home_lng) {
      setAreaCoords({ lat: profile.home_lat, lng: profile.home_lng });
    }
  }, [profile, areaName, areaCoords, setAreaName, setAreaCoords]);

  const radiusKm = Math.round(searchRadiusM / 1000);

  const captureLocation = async (): Promise<void> => {
    if (locBusy) return;
    setLocBusy(true);
    setLocNotice(null);
    try {
      const coords = await getCurrentCoords();
      if (coords) {
        setAreaCoords(coords);
        const resolvedName = await getAreaNameFromCoords(coords);
        if (resolvedName) {
          setAreaName(resolvedName);
        } else if (!areaName && profile?.area_name) {
          setAreaName(profile.area_name);
        }
        return;
      }
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocNotice(status === Location.PermissionStatus.GRANTED ? 'error' : 'denied');
    } finally {
      setLocBusy(false);
    }
  };

  const onNext = (): void => {
    router.push('/match/create/details');
  };

  const isFormValid = sport !== null && areaName.trim().length >= 2;

  return (
    <WizardScreen
      title="Select Area"
      stepIndex={index}
      totalSteps={total}
      subtitle="Where do you want to play?"
      primaryLabel="Next"
      primaryDisabled={!isFormValid}
      onPrimary={onNext}
    >
      {sport === null ? (
        <StepState
          kind="empty"
          message="Pick a sport before choosing an area."
          actionLabel="Choose a sport"
          onAction={() => router.replace('/match/create')}
        />
      ) : null}

      {sport !== null ? (
        <View style={styles.container}>
          {/* ---------------- Section 1: Locality ---------------- */}
          <SectionLabel>YOUR AREA</SectionLabel>

          <View style={styles.inputWrap}>
            <TextInput
              value={areaName}
              onChangeText={(text) => {
                setAreaName(text);
                if (locNotice) setLocNotice(null);
              }}
              placeholder="e.g. Baner, Pune"
              placeholderTextColor={M.faint}
              autoCapitalize="words"
              style={styles.textInput}
              accessibilityLabel="Play area locality"
            />

            <Pressable
              onPress={captureLocation}
              disabled={locBusy}
              style={styles.locBtn}
              accessibilityRole="button"
              accessibilityLabel="Use current location"
            >
              {locBusy ? (
                <ActivityIndicator color={M.green} size="small" />
              ) : (
                <IconPin color={M.green} size={16} />
              )}
              <AppText variant="caption" color={M.green} style={{ fontWeight: '600' }}>
                Use Current Location
              </AppText>
            </Pressable>

            {areaCoords ? (
              <View style={styles.coordsBadge}>
                <AppText variant="caption" color={M.muted}>
                  GPS attached: {areaCoords.lat.toFixed(4)}, {areaCoords.lng.toFixed(4)}
                </AppText>
              </View>
            ) : null}

            {locNotice === 'denied' ? (
              <AppText variant="caption" color={M.danger} style={styles.notice}>
                Location permission was denied. You can type your area name manually above.
              </AppText>
            ) : locNotice === 'error' ? (
              <AppText variant="caption" color={M.danger} style={styles.notice}>
                Could not read GPS location. You can type your area name manually above.
              </AppText>
            ) : null}
          </View>

          {/* ---------------- Section 2: Search Radius ---------------- */}
          <SectionLabel>SEARCH RADIUS</SectionLabel>

          <View style={styles.radiusWrap}>
            <View style={styles.chipRow}>
              {RADIUS_KM.map((km) => {
                const metres = km * 1000;
                const on = searchRadiusM === metres;
                return (
                  <Chip
                    key={km}
                    label={`${km} km`}
                    on={on}
                    onPress={() => setSearchRadiusM(metres)}
                  />
                );
              })}
            </View>

            <View style={styles.helperCard}>
              <AppText variant="caption" color={M.muted} center>
                Players and teams within {radiusKm} km of {areaName.trim() || 'your area'} will see this {sportLabel(sport)} match.
              </AppText>
            </View>
          </View>
        </View>
      ) : null}
    </WizardScreen>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    container: { gap: S.md },
    inputWrap: {
      gap: S.sm,
      backgroundColor: M.card,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
    },
    textInput: {
      minHeight: TOUCH,
      backgroundColor: M.bg,
      borderRadius: R.md,
      borderWidth: 1.5,
      borderColor: M.border,
      paddingHorizontal: S.md,
      color: M.text,
      fontSize: 15,
    },
    locBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: TOUCH,
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
      backgroundColor: M.cardHi,
      marginTop: 2,
    },
    coordsBadge: {
      paddingVertical: 2,
      paddingHorizontal: S.xs,
      alignItems: 'center',
    },
    notice: { marginTop: S.xs },

    radiusWrap: {
      gap: S.md,
      backgroundColor: M.card,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.sm,
    },
    helperCard: {
      backgroundColor: M.bg,
      padding: S.sm + 2,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
    },
  });
