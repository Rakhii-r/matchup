import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@core/auth/authStore';
import { getCurrentCoords, type Coords } from '@core/location/location';
import {
  useMyAvailability,
  useNearbyAvailable,
  useRemoveAvailability,
  useSetAvailable,
} from '@features/availability/presentation/useAvailability';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import { IconBolt, IconGear, IconMenu, IconPin } from '@shared/ui/icons';
import type { Sport } from '@shared/types/database.types';

const SPORT_LABEL: Record<Sport, string> = { box_cricket: 'CRICKET', badminton: 'BADMINTON' };

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function AvailableScreen(): React.ReactNode {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    void getCurrentCoords().then(setCoords);
  }, []);

  const myAvail = useMyAvailability();
  const setAvailable = useSetAvailable();
  const removeAvailability = useRemoveAvailability();
  const nearby = useNearbyAvailable(coords, null);

  const isAvailable = (myAvail.data?.length ?? 0) > 0;
  const busy = setAvailable.isPending || removeAvailability.isPending;
  const primarySport: Sport = profile?.sport_pref?.[0] ?? 'box_cricket';

  const onToggle = (next: boolean): void => {
    if (busy) return;
    if (next) {
      setAvailable.mutate({ sport: primarySport });
    } else {
      (myAvail.data ?? []).forEach((row) => removeAvailability.mutate(row.id));
    }
  };

  // Never show yourself in the nearby board.
  const others = (nearby.data ?? []).filter((r) => r.user_id !== session?.user.id);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconMenu color={M.text} />
        <AppLogo width={84} />
        <IconGear color={M.text} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero + toggle */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <AppText color={M.ctaText} style={styles.heroTitle}>
              Ready to play?{'\n'}Let others near you know you&apos;re game for a match today.
            </AppText>
            <View style={styles.heroBolt}>
              <IconBolt color={M.ctaText} size={22} />
            </View>
          </View>
          <View style={styles.heroToggle}>
            <AppText variant="label" color={M.ctaText} style={{ fontSize: 16 }}>
              {busy ? 'Updating…' : "I'm available to play today!"}
            </AppText>
            <Switch
              value={isAvailable}
              onValueChange={onToggle}
              disabled={busy}
              trackColor={{ false: '#C9CDD2', true: M.green }}
              thumbColor="#FFFFFF"
            />
          </View>
          {setAvailable.isError ? (
            <AppText variant="caption" color={M.danger} style={{ marginTop: S.sm }}>
              Enable location or set your home area in your profile to go available.
            </AppText>
          ) : null}
        </View>

        {/* Nearby board */}
        <View style={styles.sectionRow}>
          <AppText variant="heading" color={M.text}>
            Available Players Nearby
          </AppText>
          <View style={styles.activeRow}>
            <View style={styles.activeDot} />
            <AppText variant="label" color={M.green}>
              {others.length} active
            </AppText>
          </View>
        </View>

        {!coords || nearby.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={M.green} />
          </View>
        ) : nearby.isError ? (
          <AppText color={M.muted} center style={{ marginTop: S.md }}>
            Could not load nearby players.
          </AppText>
        ) : others.length === 0 ? (
          <AppText variant="caption" color={M.faint} center style={{ marginTop: S.md }}>
            No one nearby is available right now. Toggle yourself on so others can find you.
          </AppText>
        ) : (
          others.map((p) => (
            <View key={p.id} style={styles.playerCard}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <AppText variant="label" color="#FFFFFF">
                    {initials(p.profile?.full_name ?? '?')}
                  </AppText>
                </View>
                <View style={styles.onlineDot} />
              </View>

              <View style={{ flex: 1 }}>
                <AppText variant="label" color={M.text} style={{ fontSize: 17 }}>
                  {p.profile?.full_name ?? 'Player'}
                </AppText>
                <View style={styles.metaRow}>
                  <View style={styles.sportBadge}>
                    <AppText variant="caption" color={M.ctaText} style={{ fontWeight: '700', fontSize: 11 }}>
                      {SPORT_LABEL[p.sport]}
                    </AppText>
                  </View>
                </View>
                {p.profile?.area_name ? (
                  <View style={styles.distanceRow}>
                    <IconPin color={M.faint} size={13} />
                    <AppText variant="caption" color={M.muted} style={{ marginLeft: 3 }}>
                      {p.profile.area_name}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },
  hero: { backgroundColor: M.cta, borderRadius: R.lg, padding: S.lg, marginBottom: S.lg },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between' },
  heroTitle: { flex: 1, fontSize: 18, lineHeight: 26, fontWeight: '500', marginRight: S.md },
  heroBolt: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    marginTop: S.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.md,
  },
  activeRow: { flexDirection: 'row', alignItems: 'center' },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: M.green, marginRight: 6 },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: S.xl },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    padding: S.md,
    marginBottom: S.md,
  },
  avatarWrap: { marginRight: S.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: M.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: M.green,
    borderWidth: 2,
    borderColor: M.card,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: 4 },
  sportBadge: { backgroundColor: '#E4E7EB', borderRadius: R.pill, paddingHorizontal: S.sm, paddingVertical: 2 },
  distanceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
});
