import { useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import type { NearbyOpenChallenge } from '@features/teams/domain/challengeSchema';
import { useTeamOverview, useTeamStats } from '@features/teams/presentation/useTeams';
import { useSportLabel } from '@features/sports/presentation/useSports';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { PressableScale } from '@shared/ui/PressableScale';
import {
  IconClock,
  IconClose,
  IconPin,
  IconStar,
  IconUsers,
} from '@shared/ui/icons';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = d.getHours() < 12 ? 'AM' : 'PM';
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]} · ${hh}:${mm} ${ap}`;
}

export function MatchOfferDetailModal({
  visible,
  onClose,
  offer,
  onSendRequest,
  requesting = false,
  isMine = false,
  onViewRadar,
}: {
  visible: boolean;
  onClose: () => void;
  offer: NearbyOpenChallenge | null;
  onSendRequest: (offer: NearbyOpenChallenge) => void;
  requesting?: boolean;
  isMine?: boolean;
  onViewRadar?: (challengeId: string) => void;
}): React.ReactNode {
  const M = useMock();
  // Clears the home indicator / gesture bar, and stops a long sheet
  // running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const sportLabel = useSportLabel();

  const teamId = offer?.from_team_id ?? '';
  const overview = useTeamOverview(teamId);
  const stats = useTeamStats(teamId);

  if (!offer) return null;

  const isApplied = offer.applied_status === 'interested';
  const team = overview.data;
  const stat = stats.data;

  const matchesPlayed = stat?.matches_played ?? 0;
  const wins = stat?.wins ?? 0;
  const losses = stat?.losses ?? 0;
  const ties = stat?.ties ?? 0;
  const winRate = stat?.win_rate ?? (matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0);
  const points = wins * 2 + ties;

  const perSide = Math.floor(offer.total_slots / 2);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, sheetInsets]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.pillRow}>
                <View style={[styles.pill, { backgroundColor: isMine ? M.card : '#202028' }]}>
                  <AppText variant="caption" color={isMine ? M.green : '#6cf8bb'} style={{ fontWeight: '800', fontSize: 10 }}>
                    {isMine ? '⚡ YOUR SEARCH' : '⚡ OPPONENT WANTED'}
                  </AppText>
                </View>
                {offer.distance_m > 0 ? (
                  <AppText variant="caption" color={M.muted}>
                    {(offer.distance_m / 1000).toFixed(1)} km away
                  </AppText>
                ) : null}
              </View>
              <AppText variant="heading" color={M.text} style={{ fontSize: 20 }}>
                {offer.from_team_name}
              </AppText>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close modal">
              <IconClose color={M.muted} size={22} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: S.md, paddingBottom: S.md }}>
            {/* Match Details Section */}
            <View style={styles.sectionCard}>
              <AppText variant="caption" color={M.muted} style={styles.sectionTitle}>
                MATCH FIXTURE DETAILS
              </AppText>

              <View style={styles.infoRow}>
                <IconClock color={M.green} size={16} />
                <View style={{ flex: 1 }}>
                  <AppText variant="label" color={M.text}>
                    {formatWhen(offer.scheduled_at)}
                  </AppText>
                  <AppText variant="caption" color={M.muted}>
                    Scheduled Time
                  </AppText>
                </View>
              </View>

              <View style={styles.infoRow}>
                <IconPin color={M.green} size={16} />
                <View style={{ flex: 1 }}>
                  <AppText variant="label" color={M.text}>
                    {offer.venue_name || offer.area_name || 'Local Ground'}
                  </AppText>
                  <AppText variant="caption" color={M.muted}>
                    Venue & Location
                  </AppText>
                </View>
              </View>

              <View style={styles.infoRow}>
                <IconUsers color={M.green} size={16} />
                <View style={{ flex: 1 }}>
                  <AppText variant="label" color={M.text}>
                    {perSide} vs {perSide} ({offer.total_slots} players total)
                  </AppText>
                  <AppText variant="caption" color={M.muted}>
                    Sport: {sportLabel(offer.sport as Sport)}
                  </AppText>
                </View>
              </View>
            </View>

            {/* Team Profile & Stats Section */}
            <View style={styles.sectionCard}>
              <View style={styles.teamHeaderRow}>
                {team?.logo_url ? (
                  <Image source={{ uri: team.logo_url }} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoFallback]}>
                    <AppText variant="heading" color={M.green}>
                      {offer.from_team_name.slice(0, 1).toUpperCase()}
                    </AppText>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <AppText variant="label" color={M.text} style={{ fontSize: 16 }} numberOfLines={1}>
                    {offer.from_team_name}
                  </AppText>
                  <AppText variant="caption" color={M.muted} numberOfLines={1}>
                    Captain: {team?.captain_name || 'Squad Leader'} · {team?.player_count || 0} players
                  </AppText>
                  {team?.home_ground ? (
                    <AppText variant="caption" color={M.muted} numberOfLines={1}>
                      📍 Home: {team.home_ground}
                    </AppText>
                  ) : null}
                </View>
              </View>

              {overview.isLoading || stats.isLoading ? (
                <ActivityIndicator color={M.green} style={{ paddingVertical: S.md }} />
              ) : (
                <>
                  <AppText variant="caption" color={M.muted} style={[styles.sectionTitle, { marginTop: S.xs }]}>
                    TEAM TRACK RECORD & STATS
                  </AppText>

                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <AppText variant="caption" color={M.muted}>
                        Played
                      </AppText>
                      <AppText variant="heading" color={M.text} style={{ fontSize: 18 }}>
                        {matchesPlayed}
                      </AppText>
                    </View>

                    <View style={styles.statBox}>
                      <AppText variant="caption" color={M.green}>
                        Wins (W)
                      </AppText>
                      <AppText variant="heading" color={M.green} style={{ fontSize: 18 }}>
                        {wins}
                      </AppText>
                    </View>

                    <View style={styles.statBox}>
                      <AppText variant="caption" color={M.danger}>
                        Losses (L)
                      </AppText>
                      <AppText variant="heading" color={M.danger} style={{ fontSize: 18 }}>
                        {losses}
                      </AppText>
                    </View>

                    <View style={styles.statBox}>
                      <AppText variant="caption" color={M.muted}>
                        Ties (T)
                      </AppText>
                      <AppText variant="heading" color={M.muted} style={{ fontSize: 18 }}>
                        {ties}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.statsGridSecondary}>
                    <View style={styles.statBoxWide}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <IconStar color={M.green} size={14} />
                        <AppText variant="caption" color={M.muted}>
                          Team Points
                        </AppText>
                      </View>
                      <AppText variant="label" color={M.text} style={{ fontSize: 16 }}>
                        {points} pts
                      </AppText>
                    </View>

                    <View style={styles.statBoxWide}>
                      <AppText variant="caption" color={M.muted}>
                        Win Rate
                      </AppText>
                      <AppText variant="label" color={M.green} style={{ fontSize: 16 }}>
                        {winRate}%
                      </AppText>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => {
                      onClose();
                      router.push(`/teams/${offer.from_team_id}`);
                    }}
                    style={styles.viewSquadBtn}
                    accessibilityRole="button"
                  >
                    <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                      View Full Squad Roster & Profile →
                    </AppText>
                  </Pressable>
                </>
              )}
            </View>
          </ScrollView>

          {/* Bottom Action CTA */}
          <View style={styles.footer}>
            {isMine ? (
              <Pressable
                onPress={() => {
                  onClose();
                  if (onViewRadar) onViewRadar(offer.challenge_id);
                  else {
                    router.push({
                      pathname: '/match/create/searching',
                      params: { challengeId: offer.challenge_id },
                    });
                  }
                }}
                style={styles.ctaBtn}
                accessibilityRole="button"
              >
                <AppText variant="label" color={M.ctaText} style={{ fontWeight: '800', fontSize: 15 }}>
                  ⚡ Open Live Radar Scanner →
                </AppText>
              </Pressable>
            ) : isApplied ? (
              <View style={[styles.ctaBtn, { backgroundColor: M.cardHi, borderColor: M.border, borderWidth: 1 }]}>
                <AppText variant="label" color={M.green} style={{ fontWeight: '700', fontSize: 15 }}>
                  ✓ Game Request Sent — Awaiting Captain's Reply
                </AppText>
              </View>
            ) : (
              <PressableScale
                onPress={() => {
                  onSendRequest(offer);
                }}
                disabled={requesting}
                style={[styles.ctaBtn, { backgroundColor: '#6cf8bb' }]}
                accessibilityRole="button"
              >
                {requesting ? (
                  <ActivityIndicator color="#000000" size="small" />
                ) : (
                  <AppText variant="label" color="#000000" style={{ fontWeight: '800', fontSize: 16 }}>
                    ⚡ Send Game Request to Play
                  </AppText>
                )}
              </PressableScale>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
    },
    sheet: {
      backgroundColor: M.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: '90%',
      paddingBottom: S.xl,
      borderTopWidth: 1,
      borderColor: M.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: S.lg,
      paddingTop: S.lg,
      paddingBottom: S.sm,
      borderBottomWidth: 1,
      borderBottomColor: M.border,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: M.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: M.border,
    },
    pillRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      marginBottom: 4,
    },
    pill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: R.pill,
    },
    body: {
      paddingHorizontal: S.lg,
      paddingTop: S.md,
    },
    sectionCard: {
      backgroundColor: M.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.sm,
    },
    sectionTitle: {
      letterSpacing: 0.5,
      fontWeight: '700',
      fontSize: 11,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      paddingVertical: 2,
    },
    teamHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      paddingBottom: S.xs,
    },
    logo: {
      width: 50,
      height: 50,
      borderRadius: 25,
    },
    logoFallback: {
      backgroundColor: M.cardHi,
      borderWidth: 1,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statsGrid: {
      flexDirection: 'row',
      gap: S.xs,
    },
    statBox: {
      flex: 1,
      backgroundColor: M.bg,
      borderRadius: R.md,
      padding: S.sm,
      alignItems: 'center',
      gap: 2,
      borderWidth: 1,
      borderColor: M.border,
    },
    statsGridSecondary: {
      flexDirection: 'row',
      gap: S.xs,
    },
    statBoxWide: {
      flex: 1,
      backgroundColor: M.bg,
      borderRadius: R.md,
      padding: S.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: M.border,
    },
    viewSquadBtn: {
      alignItems: 'center',
      paddingVertical: S.xs,
    },
    footer: {
      paddingHorizontal: S.lg,
      paddingTop: S.md,
    },
    ctaBtn: {
      minHeight: 52,
      borderRadius: R.pill,
      backgroundColor: M.lime,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: S.lg,
    },
  });
