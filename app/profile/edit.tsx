import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Stack, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { getCurrentCoords, type Coords } from '@core/location/location';
import { useUpdateProfile } from '@features/profile/presentation/useUpdateProfile';
import { useActiveSports } from '@features/sports/presentation/useSports';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconBack } from '@shared/ui/icons';

export default function EditProfileScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const { loading, error, submit } = useUpdateProfile();
  const activeSports = useActiveSports();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [areaName, setAreaName] = useState(profile?.area_name ?? '');
  const [sports, setSports] = useState<Sport[]>(profile?.sport_pref ?? []);
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url ?? null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  // Coords captured during THIS visit only. Left null, the submit below sends
  // `undefined` so the stored home_lat/home_lng are preserved rather than wiped.
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locNotice, setLocNotice] = useState<'denied' | 'error' | null>(null);

  const hasStoredCoords = profile?.home_lat != null && profile?.home_lng != null;

  const captureLocation = async (): Promise<void> => {
    if (locBusy) return; // guards a double tap landing before `disabled` re-renders
    setLocBusy(true);
    setLocNotice(null);
    try {
      const next = await getCurrentCoords();
      if (next) {
        setCoords(next);
        return;
      }
      // getCurrentCoords collapses "permission denied" and "lookup failed" into
      // the same null, so ask the permission layer which of the two happened —
      // the two need different advice and neither may fail silently.
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocNotice(status === Location.PermissionStatus.GRANTED ? 'error' : 'denied');
    } finally {
      setLocBusy(false);
    }
  };

  const pickPhoto = async (): Promise<void> => { const permission=await ImagePicker.requestMediaLibraryPermissionsAsync(); if(!permission.granted) return; const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.7,base64:true}); const asset=result.canceled?null:result.assets[0];if(asset?.base64){setAvatarUri(asset.uri);setAvatarBase64(asset.base64);setRemoveAvatar(false);} };

  const toggleSport = (sport: Sport): void => {
    setSports((prev) => (prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport]));
  };

  const onSubmit = async (): Promise<void> => {
    const ok = await submit({
      fullName,
      areaName,
      sportPref: sports,
      avatarBase64,
      removeAvatar,
      // `undefined` when nothing was captured this visit — the repository only
      // writes these columns when they are not undefined, so the saved
      // coordinates survive an edit that never touched location.
      homeLat: coords?.lat,
      homeLng: coords?.lng,
    });
    if (ok) router.back();
  };

  // Phone-OTP is the login identity; email belongs to Supabase Auth, so it is
  // shown read-only here.
  const loginContact = session?.user.phone
    ? `+${session.user.phone}`
    : (session?.user.email ?? 'Not set');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
          <IconBack color={M.text} size={22} />
        </Pressable>
        <AppText variant="heading" color={M.text}>
          Edit profile
        </AppText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.photoArea}><Pressable accessibilityRole="button" accessibilityLabel={avatarUri?'Change profile photo':'Add profile photo'} hitSlop={12} onPress={()=>void pickPhoto()} style={styles.photoPicker}><View style={styles.avatar}>{avatarUri?<Image source={{uri:avatarUri}} style={styles.avatarImage}/>:<AppText variant="heading" color={M.faint}>+</AppText>}</View><AppText variant="label" color={M.green}>{avatarUri?'Change photo':'Add profile photo'}</AppText></Pressable>{avatarUri?<Pressable hitSlop={12} onPress={()=>Alert.alert('Remove profile photo?','This will remove your current profile picture.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{setAvatarUri(null);setAvatarBase64(null);setRemoveAvatar(true);}}])}><AppText variant="caption" color={M.danger}>Remove photo</AppText></Pressable>:null}</View>
        {/* Name */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Name
        </AppText>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          placeholderTextColor={M.faint}
          style={styles.input}
        />

        {/* Area */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Area
        </AppText>
        <TextInput
          value={areaName}
          onChangeText={setAreaName}
          placeholder="e.g. Kukatpally, Hyderabad"
          placeholderTextColor={M.faint}
          style={styles.input}
        />

        {/* Location — device GPS only. There is no Places API key yet; a Places
            autocomplete field is intended to sit here later, alongside (not
            instead of) this button. Distinct from the Area text above: that is a
            label people read, this is what nearby search actually matches on. */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Location
        </AppText>
        <View style={styles.locationBox}>
          {coords ? (
            <AppText variant="caption" color={M.green}>
              Location captured — save your changes to apply it.
            </AppText>
          ) : hasStoredCoords ? (
            <AppText variant="caption" color={M.green}>
              Location set — nearby matches will work.
            </AppText>
          ) : (
            <AppText variant="caption" color={M.danger}>
              No location saved. Nearby matches and players can&apos;t be found until you capture
              your location from this device.
            </AppText>
          )}

          <Pressable
            disabled={locBusy}
            onPress={() => void captureLocation()}
            accessibilityRole="button"
            accessibilityLabel={
              coords || hasStoredCoords ? 'Update my location' : 'Use my current location'
            }
            accessibilityState={{ disabled: locBusy, busy: locBusy }}
            style={({ pressed }) => [
              styles.locationBtn,
              { opacity: locBusy ? 0.6 : pressed ? 0.9 : 1 },
            ]}
          >
            <AppText variant="label" color={M.text}>
              {locBusy
                ? 'Getting location…'
                : coords || hasStoredCoords
                  ? 'Update my location'
                  : 'Use my current location'}
            </AppText>
          </Pressable>

          {locNotice === 'denied' ? (
            <AppText variant="caption" color={M.danger}>
              Location permission is off. Enable location for this app in your device settings,
              then try again.
            </AppText>
          ) : null}
          {locNotice === 'error' ? (
            <AppText variant="caption" color={M.danger}>
              Couldn&apos;t get your location. Move somewhere with a clearer signal and tap try
              again.
            </AppText>
          ) : null}
        </View>

        {/* Sports */}
        <AppText variant="label" color={M.muted} style={styles.fieldLabel}>
          Sports you play
        </AppText>
        <View style={styles.chips}>
          {activeSports.data?.map((s) => {
            const selected = sports.includes(s.sport);
            return (
              <Pressable
                key={s.id}
                onPress={() => toggleSport(s.sport)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={styles.chipWrap}
              >
                <MotiView
                  animate={{
                    backgroundColor: selected ? M.green : M.card,
                    borderColor: selected ? M.green : M.border,
                  }}
                  transition={{ type: 'timing', duration: 160 }}
                  style={styles.chip}
                >
                  <AppText variant="label" color={selected ? M.limeInk : M.text}>
                    {s.name}
                  </AppText>
                </MotiView>
              </Pressable>
            );
          })}
        </View>

        {/* Login (read-only) */}
        <View style={styles.readonly}>
          <AppText variant="label" color={M.muted}>
            Login (phone)
          </AppText>
          <AppText color={M.text} style={{ marginTop: 4 }}>
            {loginContact}
          </AppText>
          <AppText variant="caption" color={M.faint} style={{ marginTop: 4 }}>
            Your login is managed by sign-in and can&apos;t be changed here.
          </AppText>
        </View>

        {error ? (
          <AppText variant="caption" color={M.danger} style={{ marginBottom: S.sm }}>
            {error}
          </AppText>
        ) : null}

        <Pressable
          disabled={loading}
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.cta,
            { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: loading ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
        >
          <AppText variant="label" color={M.limeInk} style={{ fontSize: 16 }}>
            {loading ? 'Saving…' : 'Save changes'}
          </AppText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    paddingBottom: S.md,
    borderBottomWidth: 1,
    borderBottomColor: M.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: S.lg, paddingTop: S.lg, paddingBottom: S.xl },
  photoArea:{alignItems:'center',gap:S.sm,marginBottom:S.lg},
  photoPicker:{alignItems:'center',gap:S.sm,padding:S.sm},
  avatar:{width:96,height:96,borderRadius:48,overflow:'hidden',alignItems:'center',justifyContent:'center',backgroundColor:M.card,borderWidth:1,borderColor:M.border},
  avatarImage:{width:'100%',height:'100%'},
  fieldLabel: { marginBottom: S.sm, fontSize: 14 },
  input: {
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    minHeight: 52,
    color: M.text,
    fontSize: 16,
    marginBottom: S.lg,
  },
  locationBox: {
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
    gap: S.sm,
    marginBottom: S.lg,
  },
  locationBtn: {
    minHeight: 48,
    borderRadius: R.pill,
    borderWidth: 1.5,
    borderColor: M.green,
    backgroundColor: M.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.md,
  },
  chips: { flexDirection: 'row', gap: S.md, marginBottom: S.lg },
  chipWrap: { flex: 1 },
  chip: {
    minHeight: 48,
    borderRadius: R.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readonly: {
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: M.border,
    backgroundColor: M.card,
    marginBottom: S.lg,
  },
  cta: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
});
