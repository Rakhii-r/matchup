import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { getCurrentCoords, getAreaNameFromCoords } from '@core/location/location';
import { AppError } from '@core/errors/AppError';
import { useSportLabel } from '@features/sports/presentation/useSports';
import { CreateChallengeSchema } from '@features/teams/domain/challengeSchema';
import { useCreateChallenge } from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import { useVenues } from '@features/venues/presentation/useVenues';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { IconCalendar, IconClock, IconPin } from '@shared/ui/icons';
import { Screen } from '@shared/ui/Screen';

const FORMAT_OPTIONS = [
  { label: '4v4', slots: 8 },
  { label: '5v5', slots: 10 },
  { label: '6v6', slots: 12 },
  { label: '7v7', slots: 14 },
  { label: '8v8', slots: 16 },
];

const TIME_OPTIONS = [
  '06:00',
  '07:00',
  '08:00',
  '09:00',
  '10:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
  '21:00',
  '22:00',
  '23:00',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function DirectChallengeScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ teamId?: string }>();
  const sportLabel = useSportLabel();

  const profile = useAuthStore((s) => s.profile);
  const myTeams = useMyTeamsOverview();
  const venuesQuery = useVenues();

  // Selected sender team
  const availableTeams = useMemo(() => myTeams.data ?? [], [myTeams.data]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    params.teamId ?? availableTeams[0]?.id ?? '',
  );

  // Sync default team when loaded
  React.useEffect(() => {
    if (!selectedTeamId && availableTeams.length > 0) {
      setSelectedTeamId(params.teamId ?? availableTeams[0]?.id ?? '');
    }
  }, [availableTeams, params.teamId, selectedTeamId]);

  const activeTeam = useMemo(
    () => availableTeams.find((t) => t.id === selectedTeamId) ?? availableTeams[0],
    [availableTeams, selectedTeamId],
  );

  // Form State
  const [opponentCode, setOpponentCode] = useState('');
  const [matchName, setMatchName] = useState('');
  const [areaName, setAreaName] = useState(profile?.area_name ?? '');
  const [dayOffset, setDayOffset] = useState<number>(0);
  const [timeHHmm, setTimeHHmm] = useState<string>('18:00');
  const [totalSlots, setTotalSlots] = useState<number>(8);
  const [venueId, setVenueId] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [detectingLoc, setDetectingLoc] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter venues by sport and area
  const rawVenues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);
  const filteredVenues = useMemo(() => {
    let list = rawVenues;
    if (activeTeam?.sport) {
      list = list.filter((v) => !v.sport_types || v.sport_types.includes(activeTeam.sport as any));
    }
    if (areaName.trim()) {
      const q = areaName.toLowerCase().trim();
      const matched = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.address && v.address.toLowerCase().includes(q)),
      );
      if (matched.length > 0) return matched;
    }
    return list;
  }, [rawVenues, areaName, activeTeam?.sport]);

  // Auto-set default venue when venues load or area changes
  React.useEffect(() => {
    if (filteredVenues.length > 0) {
      const exists = filteredVenues.some((v) => v.id === venueId);
      if (!exists) {
        setVenueId(filteredVenues[0]?.id ?? '');
      }
    }
  }, [filteredVenues, venueId]);

  // Handle GPS location auto-detect
  const handleDetectLocation = async () => {
    if (detectingLoc) return;
    setDetectingLoc(true);
    try {
      const coords = await getCurrentCoords();
      if (coords) {
        const detected = await getAreaNameFromCoords(coords);
        if (detected) {
          setAreaName(detected);
        }
      }
    } catch {
      // Keep current area on failure
    } finally {
      setDetectingLoc(false);
    }
  };

  // Set default match name when active team changes
  React.useEffect(() => {
    if (activeTeam && !matchName) {
      setMatchName(`${activeTeam.name} vs Rival Match`);
    }
  }, [activeTeam, matchName]);

  /*
    The 14-day strip starts at "Today", so it depends on the clock. Built from a
    date held in state and refreshed on focus rather than read during render:
    frozen at mount, a session left open past midnight labelled yesterday as
    "Today" and offset 0 pointed at a day that had already gone.
  */
  const [stripFrom, setStripFrom] = useState(() => Date.now());
  useFocusEffect(React.useCallback(() => setStripFrom(Date.now()), []));

  const upcomingDays = useMemo(() => {
    const list: Array<{ offset: number; label: string; sub: string }> = [];
    const now = new Date(stripFrom);
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const isToday = i === 0;
      const isTomorrow = i === 1;
      const weekday = WEEKDAYS[d.getDay()] ?? '';
      const month = MONTHS[d.getMonth()] ?? '';
      list.push({
        offset: i,
        label: isToday ? 'Today' : isTomorrow ? 'Tmrw' : weekday,
        sub: `${d.getDate()} ${month}`,
      });
    }
    return list;
  }, [stripFrom]);

  const createChallenge = useCreateChallenge(selectedTeamId || activeTeam?.id || '');

  const handleSendChallenge = async () => {
    if (!selectedTeamId && !activeTeam?.id) {
      Alert.alert('No Team Selected', 'Please create or join a team first.');
      return;
    }

    setFormError(null);
    const codeCleaned = opponentCode.trim().toUpperCase();

    const parsed = CreateChallengeSchema.safeParse({
      opponentCode: codeCleaned,
      matchName: matchName.trim() || `${activeTeam?.name ?? 'Squad'} Challenge`,
      venueId,
      dayOffset,
      timeHHmm,
      totalSlots,
      message: message.trim() || undefined,
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Please check the form details.';
      setFormError(msg);
      Alert.alert('Incomplete Form', msg);
      return;
    }

    setSubmitting(true);
    try {
      await createChallenge.mutateAsync(parsed.data);
      Alert.alert(
        'Challenge Sent! ⚔️',
        `Your direct challenge has been sent to the opponent team. You will be notified when their captain accepts.`,
        [
          {
            text: 'View Challenges',
            onPress: () => router.replace('/teams/challenges'),
          },
        ],
      );
    } catch (err) {
      const errorMsg =
        err instanceof AppError
          ? err.message
          : (err as Error)?.message || 'Could not send the challenge. Please verify the opponent code.';
      setFormError(errorMsg);
      Alert.alert('Challenge Failed', errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Direct Challenge' }} />

      <View style={styles.header}>
        <AppText variant="heading" style={styles.title}>
          Direct Team Challenge ⚔️
        </AppText>
        <AppText muted style={styles.subtitle}>
          Challenge a specific rival squad using their 6-character team invite code.
        </AppText>
      </View>

      {/* 1. Challenging Team Picker */}
      {availableTeams.length > 1 ? (
        <View style={styles.section}>
          <AppText variant="label" style={styles.sectionLabel}>
            YOUR CHALLENGING TEAM
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {availableTeams.map((t) => {
              const active = t.id === selectedTeamId;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setSelectedTeamId(t.id)}
                  style={[styles.teamChip, active && styles.teamChipActive]}
                  accessibilityRole="button"
                >
                  <AppText variant="label" color={active ? colors.primary : colors.text} style={{ fontSize: 13 }}>
                    {t.name}
                  </AppText>
                  <AppText variant="caption" color={colors.textMuted} style={{ fontSize: 11 }}>
                    {sportLabel(t.sport)}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : activeTeam ? (
        <View style={styles.activeTeamBanner}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.textMuted}>
              CHALLENGER SQUAD
            </AppText>
            <AppText variant="label" style={{ fontSize: 16, marginTop: 2 }}>
              {activeTeam.name}
            </AppText>
            <AppText variant="caption" color={colors.primary}>
              {sportLabel(activeTeam.sport)} · {activeTeam.player_count} players
            </AppText>
          </View>
        </View>
      ) : null}

      {/* 2. Opponent Code Input */}
      <View style={styles.section}>
        <AppText variant="label" style={styles.sectionLabel}>
          OPPONENT TEAM CODE *
        </AppText>
        <TextInput
          value={opponentCode}
          onChangeText={(text) => setOpponentCode(text.toUpperCase())}
          placeholder="e.g. X9K2PL"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          maxLength={6}
          style={styles.codeInput}
          autoCorrect={false}
        />
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
          Enter the 6-character team invite code of your opponent squad.
        </AppText>
      </View>

      {/* 3. Match Name */}
      <View style={styles.section}>
        <AppText variant="label" style={styles.sectionLabel}>
          MATCH TITLE
        </AppText>
        <TextInput
          value={matchName}
          onChangeText={setMatchName}
          placeholder="e.g. Weekend Box Cricket Clash"
          placeholderTextColor={colors.textMuted}
          style={styles.textInput}
        />
      </View>

      {/* 4. Format / Slots */}
      <View style={styles.section}>
        <AppText variant="label" style={styles.sectionLabel}>
          MATCH FORMAT (TEAM SIZE)
        </AppText>
        <View style={styles.formatRow}>
          {FORMAT_OPTIONS.map((f) => {
            const active = totalSlots === f.slots;
            return (
              <Pressable
                key={f.label}
                onPress={() => setTotalSlots(f.slots)}
                style={[styles.formatBtn, active && styles.formatBtnActive]}
                accessibilityRole="button"
              >
                <AppText
                  variant="label"
                  color={active ? colors.background : colors.text}
                  style={{ fontWeight: active ? '700' : '500' }}
                >
                  {f.label}
                </AppText>
                <AppText
                  variant="caption"
                  color={active ? colors.background : colors.textMuted}
                  style={{ fontSize: 10 }}
                >
                  {f.slots} total
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 5. Date Selector */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <IconCalendar color={colors.primary} size={16} />
          <AppText variant="label" style={styles.sectionLabel}>
            MATCH DATE
          </AppText>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {upcomingDays.map((d) => {
            const active = dayOffset === d.offset;
            return (
              <Pressable
                key={d.offset}
                onPress={() => setDayOffset(d.offset)}
                style={[styles.dateChip, active && styles.dateChipActive]}
                accessibilityRole="button"
              >
                <AppText
                  variant="label"
                  color={active ? colors.background : colors.text}
                  style={{ fontWeight: active ? '700' : '500', fontSize: 13 }}
                >
                  {d.label}
                </AppText>
                <AppText
                  variant="caption"
                  color={active ? colors.background : colors.textMuted}
                  style={{ fontSize: 11 }}
                >
                  {d.sub}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 6. Time Selector */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <IconClock color={colors.primary} size={16} />
          <AppText variant="label" style={styles.sectionLabel}>
            MATCH TIME
          </AppText>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {TIME_OPTIONS.map((t) => {
            const active = timeHHmm === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTimeHHmm(t)}
                style={[styles.timeChip, active && styles.timeChipActive]}
                accessibilityRole="button"
              >
                <AppText
                  variant="label"
                  color={active ? colors.background : colors.text}
                  style={{ fontWeight: active ? '700' : '500', fontSize: 13 }}
                >
                  {t}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 7. Area / Locality Selector */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <IconPin color={colors.primary} size={16} />
          <AppText variant="label" style={styles.sectionLabel}>
            AREA / LOCALITY
          </AppText>
        </View>
        <View style={styles.areaInputRow}>
          <TextInput
            value={areaName}
            onChangeText={setAreaName}
            placeholder="e.g. Bandra West, Wakad, Pune"
            placeholderTextColor={colors.textMuted}
            style={[styles.textInput, { flex: 1 }]}
          />
          <Pressable
            onPress={handleDetectLocation}
            disabled={detectingLoc}
            style={[styles.gpsBtn, detectingLoc && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Auto-detect current location"
          >
            {detectingLoc ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '700' }}>
                📍 Auto
              </AppText>
            )}
          </Pressable>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
          Specify your match locality to find and filter grounds in this area.
        </AppText>
      </View>

      {/* 8. Venue / Ground Selector */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <IconPin color={colors.primary} size={16} />
          <AppText variant="label" style={styles.sectionLabel}>
            GROUND / VENUE {filteredVenues.length > 0 ? `(${filteredVenues.length})` : ''}
          </AppText>
        </View>
        {venuesQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : filteredVenues.length === 0 ? (
          <View style={{ padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <AppText muted>No grounds found matching &quot;{areaName}&quot;.</AppText>
            <Pressable onPress={() => setAreaName('')} style={{ marginTop: spacing.xs }}>
              <AppText color={colors.primary} variant="caption" style={{ fontWeight: '600' }}>
                Show all available grounds
              </AppText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.venueList}>
            {filteredVenues.map((v) => {
              const active = venueId === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setVenueId(v.id)}
                  style={[styles.venueCard, active && styles.venueCardActive]}
                  accessibilityRole="button"
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText
                      variant="label"
                      color={active ? colors.primary : colors.text}
                      style={{ fontWeight: '700' }}
                    >
                      {v.name}
                    </AppText>
                    {v.address ? (
                      <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
                        {v.address}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={[styles.radioCircle, active && styles.radioCircleActive]}>
                    {active ? <View style={styles.radioDot} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* 8. Optional Note */}
      <View style={styles.section}>
        <AppText variant="label" style={styles.sectionLabel}>
          NOTE FOR OPPONENT CAPTAIN (OPTIONAL)
        </AppText>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="e.g. 10 overs box cricket with tennis ball, loser pays ground fee."
          placeholderTextColor={colors.textMuted}
          maxLength={280}
          multiline
          numberOfLines={3}
          style={[styles.textInput, { minHeight: 70, textAlignVertical: 'top' }]}
        />
      </View>

      {formError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}

      {/* 9. Submit Button */}
      <View style={styles.submitContainer}>
        <Button
          label="Send Direct Challenge ⚔️"
          loading={submitting || createChallenge.isPending}
          disabled={submitting || createChallenge.isPending || !opponentCode.trim()}
          onPress={() => void handleSendChallenge()}
        />
      </View>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    header: {
      marginBottom: spacing.lg,
      gap: spacing.xs,
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
    },
    section: {
      marginBottom: spacing.lg,
      gap: spacing.xs,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 2,
    },
    activeTeamBanner: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.lg,
    },
    chipRow: {
      gap: spacing.sm,
      paddingVertical: 4,
    },
    teamChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 2,
    },
    teamChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    codeInput: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    textInput: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: 14,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    formatRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    formatBtn: {
      flex: 1,
      minWidth: 58,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 2,
    },
    formatBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dateChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      minWidth: 64,
      gap: 2,
    },
    dateChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    timeChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      minWidth: 60,
    },
    timeChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    areaInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    gpsBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    venueList: {
      gap: spacing.sm,
    },
    venueCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    venueCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    radioCircle: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioCircleActive: {
      borderColor: colors.primary,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },
    submitContainer: {
      marginTop: spacing.md,
      marginBottom: spacing.xl,
    },
  });

