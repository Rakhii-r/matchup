/**
 * "Continue match" — the first thing on Home while a game is in play.
 *
 * Leaving the Match Center mid-innings used to strand the scorer: the game was
 * reachable only by digging through Games → the match → "Resume match". This
 * card lists every started, unfinished match the user organises or is
 * confirmed in, and takes them straight back to it.
 *
 * Refetches whenever Home regains focus. Home is a tab and stays mounted, so
 * without this the card would not appear after Start match and would not
 * disappear after the result until the next pull-to-refresh.
 */
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';

import { useLiveMatches } from '@features/matches/presentation/useMatches';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconArrowRight, IconPin } from '@shared/ui/icons';

/** More than this and the card stops being a shortcut; the Games tab has the rest. */
const MAX_SHOWN = 3;
/** Brand emerald on the white button; the dark palette's lighter green is too faint on white. */
const CTA_INK = '#006341';

export function LiveMatchBanner(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const sportLabel = useSportLabel();
  const live = useLiveMatches();
  const { refetch } = live;

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  // A failed read shows nothing: the rest of Home still works, and the next
  // focus or pull-to-refresh retries.
  const rows = (live.data ?? []).slice(0, MAX_SHOWN);
  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {rows.map(({ match, isOrganiser }) => {
        const place = match.area_name ?? match.venue_text;
        const action = isOrganiser ? 'Continue match' : 'Watch live';
        return (
          <Pressable
            key={match.id}
            onPress={() =>
              router.push(
                isOrganiser ? `/match/${match.id}/live` : `/match/${match.id}/live?tab=live`,
              )
            }
            style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityLabel={`${action}: ${match.match_name}`}
          >
            <LinearGradient
              colors={['#006341', '#00482f']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradient}
            >
              <View style={styles.topRow}>
                <View style={styles.livePill}>
                  <MotiView
                    from={{ opacity: 1 }}
                    animate={{ opacity: 0.25 }}
                    transition={{ type: 'timing', duration: 800, loop: true }}
                    style={styles.liveDot}
                  />
                  <AppText variant="caption" color="#FFFFFF" style={styles.liveText}>
                    LIVE
                  </AppText>
                </View>
                <AppText variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
                  {sportLabel(match.sport)}
                </AppText>
              </View>

              <AppText variant="label" color="#FFFFFF" style={styles.name} numberOfLines={1}>
                {match.match_name}
              </AppText>
              {place ? (
                <View style={styles.placeRow}>
                  <IconPin color="rgba(255,255,255,0.8)" size={12} />
                  <AppText
                    variant="caption"
                    color="rgba(255,255,255,0.8)"
                    numberOfLines={1}
                    style={styles.flex}
                  >
                    {place}
                  </AppText>
                </View>
              ) : null}

              <View style={styles.cta}>
                <AppText variant="label" color={CTA_INK} style={styles.ctaText}>
                  {action}
                </AppText>
                <IconArrowRight color={CTA_INK} size={16} />
              </View>
            </LinearGradient>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    wrap: { gap: S.sm, marginBottom: S.md },
    card: { borderRadius: R.lg, overflow: 'hidden' },
    pressed: { opacity: 0.9 },
    gradient: { padding: S.md, gap: 6 },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: S.sm,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: S.sm + 2,
      paddingVertical: 3,
      borderRadius: R.pill,
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F87171' },
    liveText: { fontWeight: '800', letterSpacing: 1 },
    name: { fontSize: 18, fontFamily: 'SpaceGrotesk_700Bold', fontWeight: '700' },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    flex: { flex: 1 },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: S.sm,
      paddingVertical: S.sm + 2,
      borderRadius: R.md,
      // White in both themes: the card is always dark green, so the button
      // must contrast with the card, not with the page.
      backgroundColor: '#FFFFFF',
    },
    ctaText: { fontWeight: '800' },
  });
