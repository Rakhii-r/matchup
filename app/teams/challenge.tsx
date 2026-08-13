import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { SPORT_LABEL } from '@features/matches/domain/matchSchema';
import { CreateChallengeSchema } from '@features/teams/domain/challengeSchema';
import { useCreateChallenge } from '@features/teams/presentation/useChallenges';
import { useTeam } from '@features/teams/presentation/useTeams';
import { useVenues } from '@features/venues/presentation/useVenues';
import type { Sport } from '@shared/types/database.types';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Mirrors app/match/create.tsx so both flows offer the same formats. */
const FORMATS_BY_SPORT: Record<Sport, { label: string; total: number }[]> = {
  box_cricket: [
    { label: '4 v 4', total: 8 },
    { label: '6 v 6', total: 12 },
    { label: '8 v 8', total: 16 },
    { label: '10 v 10', total: 20 },
  ],
  badminton: [
    { label: '1 v 1', total: 2 },
    { label: '2 v 2', total: 4 },
  ],
};

const TIMES = ['06:00', '07:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

function labelForDay(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}): React.ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on ? styles.chipOn : null]}
    >
      <AppText variant="caption" color={on ? colors.textInverse : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function ChallengeScreen(): React.ReactNode {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const fromTeamId = teamId ?? '';
  const router = useRouter();

  const team = useTeam(fromTeamId);
  const venues = useVenues();
  const createChallenge = useCreateChallenge(fromTeamId);

  const [opponentCode, setOpponentCode] = useState('');
  const [matchName, setMatchName] = useState('');
  const [venueId, setVenueId] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState(1);
  const [timeHHmm, setTimeHHmm] = useState('19:00');
  const [totalSlots, setTotalSlots] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sport = team.data?.sport ?? null;
  const formats = sport ? FORMATS_BY_SPORT[sport] : [];

  // Only venues that support this team's sport can host the fixture.
  const eligibleVenues = useMemo(
    () => (venues.data ?? []).filter((v) => (sport ? v.sport_types.includes(sport) : false)),
    [venues.data, sport],
  );

  const onSubmit = async (): Promise<void> => {
    setError(null);
    const parsed = CreateChallengeSchema.safeParse({
      opponentCode,
      matchName,
      venueId: venueId ?? '',
      dayOffset,
      timeHHmm,
      totalSlots: totalSlots ?? 0,
      message: message.trim() ? message.trim() : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    try {
      await createChallenge.mutateAsync(parsed.data);
      router.replace('/teams/challenges');
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not send the challenge.');
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Challenge a team' }} />

      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <AppText variant="heading">Challenge a team</AppText>
        <AppText muted>
          {team.data
            ? `Playing as ${team.data.name} · ${SPORT_LABEL[team.data.sport]}. Ask the other owner for their team's invite code.`
            : 'Ask the other owner for their team’s invite code.'}
        </AppText>
      </View>

      <TextField
        label="Opponent's team code"
        value={opponentCode}
        onChangeText={(t) => setOpponentCode(t.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
      />

      <View style={{ marginTop: spacing.md }}>
        <TextField
          label="Match name"
          value={matchName}
          onChangeText={setMatchName}
          placeholder="Sunday Grudge Match"
          maxLength={80}
        />
      </View>

      <AppText variant="label" style={styles.sectionLabel}>
        Venue
      </AppText>
      {eligibleVenues.length === 0 ? (
        <AppText variant="caption" muted>
          {venues.isLoading ? 'Loading venues…' : 'No venues available for this sport yet.'}
        </AppText>
      ) : (
        <View style={styles.chipWrap}>
          {eligibleVenues.map((v) => (
            <Chip
              key={v.id}
              label={v.name}
              on={venueId === v.id}
              onPress={() => setVenueId(v.id)}
            />
          ))}
        </View>
      )}

      <AppText variant="label" style={styles.sectionLabel}>
        Day
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipRow}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <Chip key={d} label={labelForDay(d)} on={dayOffset === d} onPress={() => setDayOffset(d)} />
          ))}
        </View>
      </ScrollView>

      <AppText variant="label" style={styles.sectionLabel}>
        Time
      </AppText>
      <View style={styles.chipWrap}>
        {TIMES.map((t) => (
          <Chip key={t} label={t} on={timeHHmm === t} onPress={() => setTimeHHmm(t)} />
        ))}
      </View>

      <AppText variant="label" style={styles.sectionLabel}>
        Format
      </AppText>
      <View style={styles.chipWrap}>
        {formats.map((f) => (
          <Chip
            key={f.label}
            label={f.label}
            on={totalSlots === f.total}
            onPress={() => setTotalSlots(f.total)}
          />
        ))}
      </View>

      <View style={{ marginTop: spacing.md }}>
        <TextField
          label="Message (optional)"
          value={message}
          onChangeText={setMessage}
          placeholder="Bring your best XI"
          maxLength={280}
        />
      </View>

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.md }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ marginTop: spacing.lg, marginBottom: spacing.xl }}>
        <Button
          label="Send challenge"
          loading={createChallenge.isPending}
          onPress={() => void onSubmit()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginTop: spacing.lg, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
