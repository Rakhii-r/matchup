/**
 * Post an open challenge — name a ground and a time, not an opponent.
 *
 * On submit the server ranks nearby teams that play the same sport, whose squad
 * fits the sheet and who are free at that time, then pushes an offer to the
 * closest few. The first to accept gets the fixture.
 *
 * Zero candidates is a normal result, not an error: the challenge stays open
 * and the poster can widen the radius or withdraw it. The screen says so
 * explicitly rather than showing a success message that implies someone was
 * reached.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import {
  PostOpenChallengeSchema,
  RADIUS_OPTIONS,
} from '@features/teams/domain/challengeSchema';
import { usePostOpenChallenge } from '@features/teams/presentation/useChallenges';
import { useMyTeams } from '@features/teams/presentation/useTeams';
import { useVenues } from '@features/venues/presentation/useVenues';
import { useAuthStore } from '@core/auth/authStore';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

const DAY_LABELS = ['Today', 'Tomorrow', 'In 2 days', 'In 3 days', 'In 4 days'];

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Chip({ label, selected, onPress }: ChipProps): React.ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <AppText style={selected ? styles.chipTextOn : styles.chipText}>{label}</AppText>
    </Pressable>
  );
}

export default function PostOpenChallengeScreen(): React.ReactNode {
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.user.id);
  const teams = useMyTeams();
  const venues = useVenues();

  // Only an owner may post; showing teams you cannot post for would produce a
  // NOT_TEAM_OWNER error after the fact.
  const ownedTeams = useMemo(
    () => (teams.data ?? []).filter((t) => t.owner_id === userId),
    [teams.data, userId],
  );

  const [teamId, setTeamId] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [matchName, setMatchName] = useState('');
  const [dayOffset, setDayOffset] = useState(1);
  const [timeHHmm, setTimeHHmm] = useState('19:00');
  const [slots, setSlots] = useState('12');
  const [message, setMessage] = useState('');
  const [radiusM, setRadiusM] = useState(25000);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const selectedTeam = ownedTeams.find((t) => t.id === teamId) ?? null;

  // Only venues that host the selected team's sport can hold the fixture.
  const eligibleVenues = useMemo(() => {
    const all = venues.data ?? [];
    if (!selectedTeam) return all;
    return all.filter(
      (v) => !v.sport_types?.length || v.sport_types.includes(selectedTeam.sport),
    );
  }, [venues.data, selectedTeam]);

  const post = usePostOpenChallenge(teamId ?? '');

  function onSubmit(): void {
    setFieldError(null);
    if (!teamId) {
      setFieldError('Pick which team is playing.');
      return;
    }

    const parsed = PostOpenChallengeSchema.safeParse({
      matchName,
      venueId: venueId ?? '',
      dayOffset,
      timeHHmm,
      totalSlots: Number.parseInt(slots, 10),
      message: message.trim() ? message.trim() : undefined,
      radiusM,
    });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }

    post.mutate(parsed.data, {
      onSuccess: () => {
        Alert.alert(
          'Challenge posted',
          'Nearby teams that fit have been offered this fixture. You will get a notification if one accepts. Nobody may be free — you can widen the search or withdraw it from the challenges screen.',
          [{ text: 'OK', onPress: () => router.replace('/teams/challenges') }],
        );
      },
      onError: (error: unknown) => {
        setFieldError(
          error instanceof AppError ? error.message : 'Could not post the challenge.',
        );
      },
    });
  }

  if (teams.isLoading || venues.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Find an opponent' }} />
        <View style={styles.centre}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (ownedTeams.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Find an opponent' }} />
        <View style={styles.centre}>
          <AppText style={styles.title}>You do not own a team yet</AppText>
          <AppText style={styles.meta}>
            Only a team owner can post a fixture. Create a team first.
          </AppText>
          <View style={styles.cta}>
            <Button label="Create a team" onPress={() => router.push('/teams/create')} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Find an opponent' }} />
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <AppText style={styles.section}>Your team</AppText>
        <View style={styles.chipRow}>
          {ownedTeams.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={t.id === teamId}
              onPress={() => {
                setTeamId(t.id);
                setVenueId(null); // sport may have changed; venue list is filtered by it
              }}
            />
          ))}
        </View>

        <TextField
          label="Match name"
          value={matchName}
          onChangeText={setMatchName}
          placeholder="Saturday evening game"
          maxLength={80}
        />

        <AppText style={styles.section}>Ground</AppText>
        {eligibleVenues.length === 0 ? (
          <AppText style={styles.meta}>No venues listed for this sport yet.</AppText>
        ) : (
          <View style={styles.chipRow}>
            {eligibleVenues.map((v) => (
              <Chip
                key={v.id}
                label={v.name}
                selected={v.id === venueId}
                onPress={() => setVenueId(v.id)}
              />
            ))}
          </View>
        )}

        <AppText style={styles.section}>When</AppText>
        <View style={styles.chipRow}>
          {DAY_LABELS.map((label, i) => (
            <Chip
              key={label}
              label={label}
              selected={i === dayOffset}
              onPress={() => setDayOffset(i)}
            />
          ))}
        </View>
        <TextField
          label="Start time (24h)"
          value={timeHHmm}
          onChangeText={setTimeHHmm}
          placeholder="19:00"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />

        <TextField
          label="Players needed in total"
          value={slots}
          onChangeText={setSlots}
          keyboardType="number-pad"
          maxLength={2}
        />

        <AppText style={styles.section}>Search this far</AppText>
        <View style={styles.chipRow}>
          {RADIUS_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={opt.value === radiusM}
              onPress={() => setRadiusM(opt.value)}
            />
          ))}
        </View>

        <TextField
          label="Message (optional)"
          value={message}
          onChangeText={setMessage}
          placeholder="Bring your own stumps"
          maxLength={280}
        />

        {fieldError ? <AppText style={styles.error}>{fieldError}</AppText> : null}

        <View style={styles.cta}>
          <Button label="Post challenge" onPress={onSubmit} loading={post.isPending} />
        </View>
        <AppText style={styles.meta}>
          Your fixture is offered to the closest few teams that fit. The first to accept plays
          you, and both squads are added to the match.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  centre: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  section: { fontSize: 15, fontWeight: '600', color: colors.text },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  error: { fontSize: 14, color: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { fontSize: 14, color: colors.textInverse, fontWeight: '600' },
  cta: { marginTop: spacing.sm },
});
