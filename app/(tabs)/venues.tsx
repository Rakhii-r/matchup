import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { useVenues } from '@features/venues/presentation/useVenues';
import { SPORT_LABEL } from '@features/venues/domain/venueSchema';
import type { Venue } from '@features/venues/domain/venueSchema';
import type { Sport } from '@shared/types/database.types';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import { IconDirections, IconGear, IconMenu, IconPin, IconSearch, IconSliders } from '@shared/ui/icons';

/* eslint-disable @typescript-eslint/no-require-imports */
const SPORT_IMAGE: Record<Sport, number> = {
  box_cricket: require('../../assets/images/cricket.jpg') as number,
  badminton: require('../../assets/images/badminton.jpg') as number,
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Pick a header image from the venue's first sport; default to cricket. */
function venueImage(sportTypes: Sport[]): number {
  const first = sportTypes[0];
  return first ? SPORT_IMAGE[first] : SPORT_IMAGE.box_cricket;
}

function openDirections(v: Venue): void {
  const label = encodeURIComponent(v.name);
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}&query_place_id=${label}`);
}

function callVenue(phone: string): void {
  void Linking.openURL(`tel:${phone}`);
}

export default function VenuesScreen(): React.ReactNode {
  const { data: venues, isLoading, isError, refetch, isRefetching } = useVenues();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconMenu color={M.text} />
        <AppLogo width={84} />
        <IconGear color={M.text} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={M.green} />
        }
      >
        <AppText variant="title" color={M.text} style={{ fontSize: 28, fontWeight: '800' }}>
          Find a Venue
        </AppText>
        <AppText color={M.muted} style={{ marginTop: S.xs, marginBottom: S.lg }}>
          Cricket and badminton courts near you.
        </AppText>

        <View style={styles.searchField}>
          <IconSearch color={M.muted} size={18} />
          <AppText color={M.muted} style={{ marginLeft: S.sm, flex: 1 }}>
            Search for arenas, turfs, or areas...
          </AppText>
          <IconSliders color={M.muted} size={18} />
        </View>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={M.green} />
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <AppText color={M.muted}>Could not load venues.</AppText>
            <Pressable style={styles.retryBtn} onPress={() => void refetch()}>
              <AppText variant="label" color={M.text}>
                Retry
              </AppText>
            </Pressable>
          </View>
        ) : (venues ?? []).length === 0 ? (
          <View style={styles.center}>
            <AppText color={M.muted}>No venues listed yet.</AppText>
          </View>
        ) : (
          (venues ?? []).map((v) => (
            <View key={v.id} style={styles.card}>
              <ImageBackground source={venueImage(v.sport_types)} style={styles.imageWrap}>
                <LinearGradient
                  colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </ImageBackground>

              <View style={styles.cardBody}>
                <AppText variant="heading" color={M.text} style={{ fontSize: 19 }}>
                  {v.name}
                </AppText>

                {v.address ? (
                  <View style={styles.metaRow}>
                    <IconPin color={M.muted} size={14} />
                    <AppText variant="caption" color={M.muted} style={{ marginLeft: 4, flex: 1 }}>
                      {v.address}
                    </AppText>
                  </View>
                ) : null}

                <View style={styles.chips}>
                  {v.sport_types.map((s) => (
                    <View key={s} style={styles.chip}>
                      <AppText variant="caption" color={M.muted}>
                        {SPORT_LABEL[s]}
                      </AppText>
                    </View>
                  ))}
                </View>

                <AppText variant="caption" color={M.muted} style={{ marginTop: S.sm }}>
                  {v.confirm_note ?? 'Call to confirm availability'}
                </AppText>

                <View style={styles.actions}>
                  <Pressable
                    style={[styles.bookBtn, !v.phone && styles.bookBtnDisabled]}
                    disabled={!v.phone}
                    onPress={() => v.phone && callVenue(v.phone)}
                  >
                    <AppText variant="label" color={M.ctaText}>
                      {v.phone ? 'Call to confirm' : 'No phone listed'}
                    </AppText>
                  </Pressable>
                  <Pressable style={styles.dirBtn} onPress={() => openDirections(v)}>
                    <IconDirections color={M.text} size={20} />
                  </Pressable>
                </View>
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
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    marginBottom: S.lg,
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: S.md, paddingTop: S.xl },
  retryBtn: {
    borderWidth: 1,
    borderColor: M.border,
    borderRadius: R.sm,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
  },
  card: {
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    overflow: 'hidden',
    marginBottom: S.lg,
  },
  imageWrap: { height: 140 },
  cardBody: { padding: S.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: S.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  chip: {
    backgroundColor: M.chip,
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: 4,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md },
  bookBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: M.cta,
    borderRadius: R.sm,
    paddingVertical: S.md,
  },
  bookBtnDisabled: { opacity: 0.5 },
  dirBtn: {
    width: 48,
    height: 48,
    borderRadius: R.sm,
    borderWidth: 1.5,
    borderColor: M.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
