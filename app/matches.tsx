import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { useAuthStore } from '@core/auth/authStore';
import { getCurrentCoords } from '@core/location/location';
import type { Coords } from '@core/location/location';
import {
  useJoinedMatches,
  useMyMatches,
  useNearbyMatches,
} from '@features/matches/presentation/useMatches';
import { PLAYER_STATUS_LABEL, SPORT_LABEL } from '@features/matches/domain/matchSchema';
import type { Match } from '@features/matches/domain/matchSchema';
import { colors, radius, spacing } from '@shared/theme';
import { AppText } from '@shared/ui/AppText';
import { Screen } from '@shared/ui/Screen';
import { IconChevron } from '@shared/ui/icons';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A match older than this is treated as finished even if still marked open. */
const ONGOING_WINDOW_MS = 6 * 60 * 60 * 1000;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${hh}:${mm}`;
}

/**
 * Past means the match is over: explicitly finished, or its start time is far
 * enough behind us that it cannot still be running. Mirrors the same window the
 * nearby feed uses so a match never sits in both Upcoming and Past.
 */
function isPast(match: Match, nowMs: number): boolean {
  if (match.status === 'completed') return true;
  const scheduledMs = Date.parse(match.scheduled_at);
  return Number.isFinite(scheduledMs) && scheduledMs <= nowMs - ONGOING_WINDOW_MS;
}

interface RowProps {
  match: Match;
  badge?: string;
  onPress: () => void;
}

function MatchRow({ match, badge, onPress }: RowProps): React.ReactNode {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.row}>
      <View style={styles.rowMain}>
        <AppText variant="label" numberOfLines={1}>
          {match.match_name}
        </AppText>
        <AppText variant="caption" muted>
          {SPORT_LABEL[match.sport]} · {formatWhen(match.scheduled_at)}
        </AppText>
        {match.venue_text ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {match.venue_text}
          </AppText>
        ) : null}
      </View>
      <View style={styles.rowSide}>
        <AppText variant="caption" muted>
          {match.filled_slots}/{match.total_slots}
        </AppText>
        {badge ? (
          <View style={styles.badge}>
            <AppText variant="caption" color={colors.textInverse}>
              {badge}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Collapsible section. The count stays visible while collapsed so the bar is
 * still informative — otherwise closing a section hides whether it has anything.
 */
function Section({
  title,
  count,
  defaultOpen = true,
  loading,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  loading: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${count} matches`}
        accessibilityState={{ expanded: open }}
        style={styles.sectionBar}
      >
        <AppText variant="label" style={styles.sectionTitle}>
          {title}
        </AppText>
        <View style={styles.sectionBarRight}>
          <AppText variant="caption" muted>
            {count}
          </AppText>
          <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
            <IconChevron color={colors.textMuted} size={18} />
          </View>
        </View>
      </Pressable>

      {!open ? null : loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : count === 0 ? (
        <AppText variant="caption" muted>
          Nothing here yet.
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

export default function MatchesScreen(): React.ReactNode {
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const c = await getCurrentCoords();
      if (active) setCoords(c);
    })();
    return () => {
      active = false;
    };
  }, []);

  const mine = useMyMatches();
  const joined = useJoinedMatches();
  const nearby = useNearbyMatches(coords, null);

  const open = (matchId: string) =>
    router.push({ pathname: '/match/[id]', params: { id: matchId } });

  const buckets = useMemo(() => {
    const nowMs = Date.now();
    const created = mine.data ?? [];
    const joinedRows = joined.data ?? [];

    // Matches already accounted for above must not reappear under "available".
    const seen = new Set<string>([
      ...created.map((m) => m.id),
      ...joinedRows.map((r) => r.match.id),
    ]);

    return {
      createdUpcoming: created.filter((m) => !isPast(m, nowMs)),
      joinedUpcoming: joinedRows.filter((r) => !isPast(r.match, nowMs)),
      available: (nearby.data ?? []).filter(
        (m) => !seen.has(m.id) && m.creator_id !== userId,
      ),
      past: [
        ...created.filter((m) => isPast(m, nowMs)).map((m) => ({ match: m, badge: 'Organiser' })),
        ...joinedRows
          .filter((r) => isPast(r.match, nowMs))
          .map((r) => ({ match: r.match, badge: PLAYER_STATUS_LABEL[r.myStatus] })),
      ].sort((a, b) => Date.parse(b.match.scheduled_at) - Date.parse(a.match.scheduled_at)),
    };
  }, [mine.data, joined.data, nearby.data, userId]);

  return (
    <Screen scroll>
      {/* Header styled here, not in app/_layout: RootLayout renders AppProviders,
          so it sits outside ThemeProvider and cannot read theme context. Without
          this the header falls back to the light default over a dark body. */}
      <Stack.Screen
        options={{
          title: 'Matches',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      <Section
        title="MATCHES I ORGANISE"
        count={buckets.createdUpcoming.length}
        loading={mine.isLoading}
      >
        {buckets.createdUpcoming.map((m) => (
          <MatchRow key={m.id} match={m} badge={m.status} onPress={() => open(m.id)} />
        ))}
      </Section>

      <Section
        title="MATCHES I JOINED"
        count={buckets.joinedUpcoming.length}
        loading={joined.isLoading}
      >
        {buckets.joinedUpcoming.map((r) => (
          <MatchRow
            key={r.match.id}
            match={r.match}
            badge={PLAYER_STATUS_LABEL[r.myStatus]}
            onPress={() => open(r.match.id)}
          />
        ))}
      </Section>

      <Section
        title="AVAILABLE NEARBY"
        count={buckets.available.length}
        loading={coords != null && nearby.isLoading}
      >
        {buckets.available.map((m) => (
          <MatchRow key={m.id} match={m} onPress={() => open(m.id)} />
        ))}
      </Section>

      {!coords ? (
        <AppText variant="caption" muted style={styles.note}>
          Turn on location to see matches available near you.
        </AppText>
      ) : null}

      {/* Collapsed by default — history is reference, not the reason you opened this. */}
      <Section title="PAST" count={buckets.past.length} defaultOpen={false} loading={false}>
        {buckets.past.map((r) => (
          <MatchRow
            key={r.match.id}
            match={r.match}
            badge={r.badge}
            onPress={() => open(r.match.id)}
          />
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.md, gap: spacing.sm },
  sectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionBarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowMain: { flex: 1, gap: 2 },
  rowSide: { alignItems: 'flex-end', gap: 4 },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  note: { marginTop: -spacing.md, marginBottom: spacing.lg },
});
