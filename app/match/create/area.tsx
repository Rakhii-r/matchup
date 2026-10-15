/**
 * Create Match — Step 2 of 3: Select Area & Radius.
 *
 * Captures the discovery area locality and search radius for player/team matching.
 * Specific venue selection is deferred until an opponent or squad is confirmed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { MapPinArt } from '@shared/ui/decor';
import { IconClose, IconCrosshair, IconInfo, IconNavArrow, IconPin } from '@shared/ui/icons';

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

  /*
    Prefill the area from the saved profile, ONCE.

    This used to depend on `areaName` and `areaCoords` — the very values it
    writes — so setting them re-ran it, and every arrival on this step cost a
    second render just to reach the same answer. The current values are read off
    the store instead of the closure, which keeps them out of the dependency
    list without going stale; the ref stops a late-arriving profile from
    overwriting something the user has since typed.
  */
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !profile) return;
    prefilled.current = true;

    const saved = useCreateMatchWizard.getState();
    if (!saved.areaName && profile.area_name) {
      setAreaName(profile.area_name);
    }
    if (!saved.areaCoords && profile.home_lat && profile.home_lng) {
      setAreaCoords({ lat: profile.home_lat, lng: profile.home_lng });
    }
  }, [profile, setAreaName, setAreaCoords]);

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
          {/* ---------------- Hero ---------------- */}
          <View style={styles.hero}>
            <View style={styles.heroText}>
              <AppText variant="heading" color={M.text} style={styles.heroTitle}>
                Where do you want to play?
              </AppText>
              <AppText variant="caption" color={M.muted} style={styles.heroBody}>
                Select your location and search radius to find nearby players and teams.
              </AppText>
            </View>
            <MapPinArt size={132} />
          </View>

          {/* ---------------- Section 1: Locality ---------------- */}
          <SectionLabel>YOUR AREA</SectionLabel>

          <View style={styles.inputWrap}>
            <View style={styles.inputRow}>
              <View style={styles.inputPin}>
                <IconPin color={M.green} size={20} />
              </View>
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
              {areaName.length > 0 ? (
                <Pressable
                  onPress={() => setAreaName('')}
                  hitSlop={10}
                  style={styles.clearBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Clear area"
                >
                  <IconClose color={M.card} size={12} strokeWidth={3} />
                </Pressable>
              ) : null}
            </View>

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
                <IconCrosshair color={M.green} size={20} />
              )}
              <AppText variant="label" color={M.green} style={{ fontSize: 15 }}>
                Use Current Location
              </AppText>
            </Pressable>

            {areaCoords ? (
              <View style={styles.coordsBadge}>
                <IconNavArrow color={M.green} size={14} />
                <AppText variant="caption" color={M.muted} style={{ fontSize: 13 }}>
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
                    grid
                    label={`${km} km`}
                    on={on}
                    onPress={() => setSearchRadiusM(metres)}
                  />
                );
              })}
            </View>

            <View style={styles.helperCard}>
              <IconInfo color={M.green} size={20} />
              <View style={styles.helperRule} />
              <AppText variant="caption" color={M.muted} style={styles.helperText}>
                Players and teams within{' '}
                <AppText variant="caption" color={M.green} style={styles.helperStrong}>
                  {radiusKm} km
                </AppText>{' '}
                of{' '}
                <AppText variant="caption" color={M.green} style={styles.helperStrong}>
                  {areaName.trim() || 'your area'}
                </AppText>{' '}
                will see this {sportLabel(sport)} match.
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
    container: { gap: S.xs },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      padding: S.md,
      borderRadius: 20,
      backgroundColor: M.chip,
      overflow: 'hidden',
    },
    heroText: { flex: 1, minWidth: 0, gap: S.sm },
    heroTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700', fontSize: 20, lineHeight: 26 },
    heroBody: { fontSize: 13, lineHeight: 19 },

    inputWrap: {
      gap: S.sm + 4,
      backgroundColor: M.card,
      padding: S.md,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      backgroundColor: M.cardHi,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      overflow: 'hidden',
    },
    inputPin: { width: 52, alignItems: 'center', justifyContent: 'center' },
    textInput: {
      flex: 1,
      minHeight: TOUCH + 6,
      alignSelf: 'stretch',
      backgroundColor: M.card,
      borderTopLeftRadius: R.lg,
      borderBottomLeftRadius: R.lg,
      paddingHorizontal: S.md,
      color: M.text,
      fontSize: 16,
    },
    clearBtn: {
      position: 'absolute',
      right: S.sm + 4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: M.faint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    locBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      minHeight: 52,
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
      backgroundColor: M.card,
    },
    coordsBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      paddingVertical: S.sm + 2,
      paddingHorizontal: S.sm,
      borderRadius: R.md,
      backgroundColor: M.cardHi,
    },
    notice: { marginTop: S.xs },

    radiusWrap: {
      gap: S.md,
      backgroundColor: M.card,
      padding: S.md,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.sm + 2,
    },
    helperCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm + 4,
      backgroundColor: M.cardHi,
      padding: S.sm + 4,
      borderRadius: R.md,
    },
    helperRule: { width: 1, alignSelf: 'stretch', backgroundColor: M.border },
    helperText: { flex: 1, fontSize: 13, lineHeight: 19 },
    helperStrong: { fontWeight: '700', fontSize: 13 },
  });
