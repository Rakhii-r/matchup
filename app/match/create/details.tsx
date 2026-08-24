/**
 * Create Match — Step 3 of 3: Match Details, and the only screen in the wizard
 * that writes.
 *
 * One scrolling screen: the game and venue already chosen (read-only), Team A,
 * the date and times, players per side, game type and how far to search. The
 * old Step 4 team route is folded in here as a modal picker rather than a
 * route, which is why `app/match/create/team.tsx` no longer exists.
 *
 * TWO CREATION ENGINES, and the match type picks one. This screen used to run
 * every submit through `post_open_challenge`, which is why "Post a Match"
 * demanded a team and then dropped the organiser on the opponent radar — it was
 * a Team Vs Team challenge with a different label on it.
 *
 * Team Vs Team (Challenge)
 *   Team A picker (modal, folded in from the old Step 4 route), an
 *   informational Team B row, submit through `usePostOpenChallenge` →
 *   `post_open_challenge`, then the radar at `create/searching`. Team B is
 *   never picked by hand: the opponent is whichever nearby team accepts.
 *
 * Post a Match (Open for all)
 *   No Team A, no Team B, no opponent, no team question of any kind. Submit
 *   through `useCreateOpenMatch` → `create_open_match`, which also seats the
 *   organiser as the host, then straight to the match itself so they can watch
 *   individual players arrive. There is no radar because there is nobody to
 *   search for.
 *
 * Everything above the fold — venue, date, times, squad size, game type,
 * search distance — is identical on both branches and is written once.
 */
import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import {
  buildEndAt,
  buildScheduledAt,
  CreateOpenMatchSchema,
} from '@features/matches/domain/matchSchema';
import { useCreateOpenMatch } from '@features/matches/presentation/useMatches';
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
import { PostOpenChallengeSchema } from '@features/teams/domain/challengeSchema';
import { usePostOpenChallenge } from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import {
  IconCalendar,
  IconClock,
  IconClose,
  IconChevron,
  IconPlus,
  IconSearch,
  IconUsers,
} from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';

/**
 * Squad sizes offered per sport, as players PER SIDE. The sheet total the RPC
 * wants is twice this, because both squads fill it.
 *
 * Keyed by `Sport`, so adding a sport to the enum is a compile error here
 * rather than a silently empty chip row. The list of sports the user can pick
 * still comes from `useActiveSports` — this is only the size options.
 */
const PLAYERS_PER_SIDE: Record<Sport, number[]> = {
  box_cricket: [4, 6, 8, 10],
  badminton: [1, 2],
};

const GAME_TYPES = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'competitive', label: 'Competitive' },
] as const;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUTES = [0, 15, 30, 45];

function labelForDay(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

function to12h(hh: number, mm: number): string {
  const period = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

function fmtHHmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** '19:30' → { h: 19, m: 30 }. Null for the empty string the store starts with. */
function parseHHmm(value: string): { h: number; m: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

/** "1h 30m" between two instants, for the end-time caption. */
function durationLabel(startMs: number, endMs: number): string {
  const mins = Math.round((endMs - startMs) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Hour/minute sheet. `minTotal` is minutes-since-midnight below which cells are
 * dead — used to keep a match scheduled for today out of the past, which is the
 * rule the old form enforced.
 */
function TimeSheet({
  visible,
  title,
  value,
  minTotal,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: { h: number; m: number } | null;
  minTotal: number | null;
  onPick: (next: { h: number; m: number }) => void;
  onClose: () => void;
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const floor = minTotal ?? -1;
  // The hour the minute column assumes before an hour has been picked. Without
  // it every minute would test against hour 0 and read as disabled whenever the
  // floor is a real time of day.
  const fallbackHour = Math.min(23, Math.max(0, Math.ceil((floor + 1) / 60)));
  const hour = value?.h ?? fallbackHour;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityRole="button" />
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <AppText variant="heading" color={M.text}>
            {title}
          </AppText>
          <Pressable
            hitSlop={10}
            onPress={onClose}
            style={styles.sheetClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <IconClose color={M.muted} size={20} />
          </Pressable>
        </View>
        <View style={styles.timeCols}>
          <ScrollView style={styles.timeCol} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => {
              // Dead only when no minute in the hour is still selectable.
              const disabled = h * 60 + 45 <= floor;
              const on = value?.h === h;
              return (
                <Pressable
                  key={h}
                  disabled={disabled}
                  style={[styles.timeCell, on ? styles.timeCellOn : null]}
                  onPress={() => onPick({ h, m: value?.m ?? 0 })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled }}
                >
                  <AppText color={disabled ? M.faint : on ? M.green : M.text}>
                    {String(h).padStart(2, '0')}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView style={styles.timeCol} showsVerticalScrollIndicator={false}>
            {MINUTES.map((m) => {
              const disabled = hour * 60 + m <= floor;
              const on = value?.m === m;
              return (
                <Pressable
                  key={m}
                  disabled={disabled}
                  style={[styles.timeCell, on ? styles.timeCellOn : null]}
                  onPress={() => onPick({ h: hour, m })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled }}
                >
                  <AppText color={disabled ? M.faint : on ? M.green : M.text}>
                    {String(m).padStart(2, '0')}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <Pressable
          style={[styles.sheetCta, { opacity: value ? 1 : 0.45 }]}
          disabled={!value}
          onPress={onClose}
          accessibilityRole="button"
        >
          <AppText variant="label" color={M.limeInk} style={styles.sheetCtaLabel}>
            Done
          </AppText>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function MatchDetailsStep(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();

  const sport = useCreateMatchWizard((s) => s.sport);
  const matchType = useCreateMatchWizard((s) => s.matchType);
  const areaName = useCreateMatchWizard((s) => s.areaName);
  const areaCoords = useCreateMatchWizard((s) => s.areaCoords);
  const searchRadiusM = useCreateMatchWizard((s) => s.searchRadiusM);
  const teamId = useCreateMatchWizard((s) => s.teamId);
  const playersPerSide = useCreateMatchWizard((s) => s.playersPerSide);
  const dayOffset = useCreateMatchWizard((s) => s.dayOffset);
  const timeHHmm = useCreateMatchWizard((s) => s.timeHHmm);
  const endTimeHHmm = useCreateMatchWizard((s) => s.endTimeHHmm);
  const gameType = useCreateMatchWizard((s) => s.gameType);

  const setTeamId = useCreateMatchWizard((s) => s.setTeamId);
  const setPlayersPerSide = useCreateMatchWizard((s) => s.setPlayersPerSide);
  const setDayOffset = useCreateMatchWizard((s) => s.setDayOffset);
  const setTimeHHmm = useCreateMatchWizard((s) => s.setTimeHHmm);
  const setEndTimeHHmm = useCreateMatchWizard((s) => s.setEndTimeHHmm);
  const setGameType = useCreateMatchWizard((s) => s.setGameType);

  const [showTeams, setShowTeams] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which of the two flows this submit belongs to. Everything team-shaped on
  // this screen is gated on it.
  const isOpenMatch = matchType === 'post_match';

  // Team Vs Team: bound to Team A, opponent comes from the radar.
  const post = usePostOpenChallenge(teamId ?? '');
  // Post a Match: no team anywhere in the payload.
  const createOpen = useCreateOpenMatch();
  const submitting = isOpenMatch ? createOpen.isPending : post.isPending;
  const teams = useMyTeamsOverview();
  const sportLabel = useSportLabel();

  const forSport = useMemo(
    () => (teams.data ?? []).filter((t) => t.sport === sport),
    [teams.data, sport],
  );
  // Owner-only: post_open_challenge refuses anyone else with NOT_TEAM_OWNER, so
  // offering a team you merely belong to would only fail after the fact.
  const ownedTeams = useMemo(() => forSport.filter((t) => t.i_am_owner), [forSport]);
  const team = useMemo(
    () => ownedTeams.find((t) => t.id === teamId) ?? null,
    [ownedTeams, teamId],
  );

  // If the organiser owns exactly one team for this sport and has not chosen one yet,
  // select it automatically so they don't have to tap an extra sheet.
  useEffect(() => {
    if (!isOpenMatch && !teamId && ownedTeams.length === 1 && ownedTeams[0]) {
      setTeamId(ownedTeams[0].id);
    }
  }, [isOpenMatch, teamId, ownedTeams, setTeamId]);

  const sizeOptions = sport ? PLAYERS_PER_SIDE[sport] : [];
  const totalSlots = playersPerSide !== null ? playersPerSide * 2 : 0;
  const time = parseHHmm(timeHHmm);
  const endTime = parseHHmm(endTimeHHmm);
  const now = new Date();
  const radiusKm = Math.round(searchRadiusM / 1000);

  const { index, total: totalSteps } = stepPosition('details');

  // The picker allows any end time; an earlier one means the game runs past
  // midnight, and buildEndAt rolls it onto the next day. Showing the duration
  // is what makes that visible instead of surprising.
  const endsAt =
    dayOffset !== null && time ? buildEndAt(dayOffset, timeHHmm, endTimeHHmm || null) : null;
  const startsAt = dayOffset !== null && time ? buildScheduledAt(dayOffset, timeHHmm) : null;

  /**
   * `post_open_challenge` requires a match_name and the reference frames have no
   * name field, so it is composed from the answers the user did give. Clamped to
   * the 80 characters `PostOpenChallengeSchema` allows.
   */
  const derivedName = ((): string => {
    if (!sport) return '';
    if (isOpenMatch) {
      return areaName.trim() ? `${sportLabel(sport)} · ${areaName.trim()}` : `${sportLabel(sport)} match`;
    }
    return team
      ? `${team.name} · ${sportLabel(sport)}`
      : areaName.trim()
        ? `${sportLabel(sport)} · ${areaName.trim()}`
        : `${sportLabel(sport)} match`;
  })().slice(0, 80);

  const validation = ((): { ok: boolean; msg: string } => {
    if (!sport) return { ok: false, msg: 'Pick a sport' };
    if (!matchType) return { ok: false, msg: 'Pick a match type' };
    if (!areaName || areaName.trim().length < 2) return { ok: false, msg: 'Select a play area' };
    // The one question that exists on only one branch.
    if (!isOpenMatch && !teamId) return { ok: false, msg: 'Select Team A' };
    if (playersPerSide === null) return { ok: false, msg: 'Choose the number of players' };
    if (dayOffset === null) return { ok: false, msg: 'Pick a date' };
    if (!time) return { ok: false, msg: 'Pick a start time' };

    const composed = isOpenMatch
      ? CreateOpenMatchSchema.safeParse({
          matchName: derivedName,
          sport,
          areaName,
          dayOffset,
          timeHHmm,
          totalSlots,
          gameType,
          radiusM: searchRadiusM,
          endTimeHHmm: endTimeHHmm || undefined,
          lat: areaCoords?.lat,
          lng: areaCoords?.lng,
        })
      : PostOpenChallengeSchema.safeParse({
          matchName: derivedName,
          areaName,
          dayOffset,
          timeHHmm,
          totalSlots,
          message: `${playersPerSide} v ${playersPerSide}`,
          radiusM: searchRadiusM,
          gameType,
          endTimeHHmm: endTimeHHmm || undefined,
          lat: areaCoords?.lat,
          lng: areaCoords?.lng,
        });
    if (!composed.success) {
      return { ok: false, msg: composed.error.issues[0]?.message ?? 'Check the form' };
    }

    // Guard against a past time when the chosen day is today.
    if (dayOffset === 0) {
      const chosen = new Date();
      chosen.setHours(time.h, time.m, 0, 0);
      if (chosen.getTime() <= now.getTime()) return { ok: false, msg: 'Pick a time later today' };
    }
    return { ok: true, msg: '' };
  })();

  const onSubmit = async (): Promise<void> => {
    if (
      !validation.ok ||
      startsAt === null ||
      dayOffset === null ||
      playersPerSide === null ||
      !sport ||
      !matchType
    ) {
      return;
    }
    setError(null);

    // ------------------------------------------------------------------
    // Post a Match (Open for all): create the match itself, seat the
    // organiser, and go to it. No challenge row, no candidates, no radar.
    // ------------------------------------------------------------------
    if (isOpenMatch) {
      try {
        const match = await createOpen.mutateAsync({
          matchName: derivedName,
          sport,
          areaName,
          scheduledAt: startsAt.toISOString(),
          endTime: buildEndAt(dayOffset, timeHHmm, endTimeHHmm || null)?.toISOString() ?? null,
          totalSlots,
          gameType,
          radiusM: searchRadiusM,
          lat: areaCoords?.lat ?? null,
          lng: areaCoords?.lng ?? null,
        });
        // `replace` so hardware back leaves the wizard rather than re-submitting
        // this step, same as the challenge branch below.
        router.replace({ pathname: '/match/[id]', params: { id: match.id } });
      } catch (e) {
        setError(e instanceof AppError ? e.message : 'Could not post the match. Please try again.');
      }
      return;
    }

    // ------------------------------------------------------------------
    // Team Vs Team (Challenge): unchanged.
    // ------------------------------------------------------------------
    if (!teamId) {
      setError('Select Team A');
      return;
    }

    try {
      const challenge = await post.mutateAsync({
        matchName: derivedName,
        areaName,
        dayOffset,
        timeHHmm,
        totalSlots,
        message: `${playersPerSide} v ${playersPerSide}`,
        radiusM: searchRadiusM,
        gameType,
        endTimeHHmm: endTimeHHmm || undefined,
        lat: areaCoords?.lat ?? undefined,
        lng: areaCoords?.lng ?? undefined,
      });
      // The organiser goes to the radar, which polls the offer ledger for the
      // challenge just posted. `replace` so hardware back leaves the wizard
      // rather than re-submitting this step; the id travels as a param because
      // the radar is a route of its own and can be reopened from a push.
      router.replace({
        pathname: '/match/create/searching',
        params: { challengeId: challenge.id },
      });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not post the match. Please try again.');
    }
  };

  // Going "back" to Step 2. A deep link opens this screen with nothing behind
  // it, where back() is a no-op, so fall back to the area route itself.
  const onChangeArea = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/match/create/area');
  };

  // Time picker restricts to the future when the selected day is today.
  const startFloor = dayOffset === 0 ? now.getHours() * 60 + now.getMinutes() : null;

  return (
    <WizardScreen
      title="Match Details"
      stepIndex={index}
      totalSteps={totalSteps}
      primaryLabel={
        submitting
          ? isOpenMatch
            ? 'Posting…'
            : 'Searching…'
          : isOpenMatch
            ? 'Post Match'
            : 'Find Opponent (Radar)'
      }
      primaryDisabled={!validation.ok || submitting}
      primaryPending={submitting}
      onPrimary={() => void onSubmit()}
      error={error ?? (validation.ok ? null : validation.msg)}
    >
      {!sport || !matchType || !areaName ? (
        <StepState
          kind="empty"
          message="Some earlier answers are missing. Start the wizard from the top."
          actionLabel="Start over"
          onAction={() => router.replace('/match/create')}
        />
      ) : null}

      {/* The promise this screen is keeping, stated before anything else — it
          is also the explanation for why no team is asked for below. */}
      {isOpenMatch ? (
        <View style={styles.openBanner}>
          <AppText variant="label" color={M.green} center>
            Open for all players to join
          </AppText>
        </View>
      ) : null}

      {/* ---------------- Selected game ---------------- */}
      <SectionLabel>SELECTED GAME</SectionLabel>
      {sport ? (
        <View style={styles.readonlyRow}>
          <Image source={SPORT_IMAGE[sport]} style={styles.thumb} />
          <View style={styles.rowText}>
            <AppText variant="label" color={M.text} numberOfLines={1}>
              {sportLabel(sport)}
            </AppText>
            <AppText variant="caption" color={M.muted}>
              {matchType === 'team_vs_team' ? 'Team Vs Team (Challenge)' : 'Post a Match (Open for all)'}
            </AppText>
          </View>
        </View>
      ) : (
        <StepState
          kind="empty"
          message="No game chosen yet."
          actionLabel="Choose a game"
          onAction={() => router.replace('/match/create')}
        />
      )}

      {/* ---------------- Play Area ---------------- */}
      <SectionLabel>PLAY AREA</SectionLabel>
      {areaName ? (
        <View style={styles.readonlyRow}>
          <View style={styles.rowText}>
            <AppText variant="label" color={M.text} numberOfLines={1}>
              {areaName}
            </AppText>
            <AppText variant="caption" color={M.muted} numberOfLines={1}>
              {radiusKm} km discovery radius {areaCoords ? '· GPS attached' : ''}
            </AppText>
          </View>
          <Pressable
            onPress={onChangeArea}
            style={styles.linkBtn}
            accessibilityRole="button"
            accessibilityLabel="Change play area"
          >
            <AppText variant="label" color={M.green}>
              Change
            </AppText>
          </Pressable>
        </View>
      ) : (
        <StepState
          kind="empty"
          message="No play area selected."
          actionLabel="Select area"
          onAction={onChangeArea}
        />
      )}

      {/* ---------------- Teams — Team Vs Team only ----------------
          An open match has no Team A, no Team B and no opponent, so none of
          this renders. Nothing below it depends on `team`. */}
      {!isOpenMatch ? (
        <>
      <SectionLabel>TEAMS</SectionLabel>
      {teams.isLoading ? <StepState kind="loading" message="Loading your teams…" /> : null}
      {teams.isError ? (
        <StepState
          kind="error"
          message="Could not load your teams."
          actionLabel="Try again"
          onAction={() => void teams.refetch()}
        />
      ) : null}
      {!teams.isLoading && !teams.isError && sport && ownedTeams.length === 0 ? (
        <StepState
          kind="empty"
          message={
            forSport.length > 0
              ? `You belong to a ${sportLabel(sport)} team but do not own one. Only a team owner can post a fixture, so create your own to carry on.`
              : `You do not have a ${sportLabel(sport)} team yet. Create one and it will show up here.`
          }
          actionLabel="+ Create team"
          onAction={() => router.push('/teams/create')}
        />
      ) : null}
      {ownedTeams.length > 0 ? (
        <Pressable
          onPress={() => setShowTeams(true)}
          style={styles.pickRow}
          accessibilityRole="button"
          accessibilityLabel={
            team ? `Team A, ${team.name}. Change team` : 'Select Team A, choose your team'
          }
        >
          {team?.logo_url ? (
            <Image source={{ uri: team.logo_url }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoFallback]}>
              <IconUsers color={M.green} size={20} />
            </View>
          )}
          <View style={styles.rowText}>
            <AppText variant="label" color={M.text} numberOfLines={1}>
              {team ? team.name : 'Select Team A'}
            </AppText>
            <AppText variant="caption" color={M.muted}>
              {team
                ? `${team.player_count} ${team.player_count === 1 ? 'player' : 'players'}`
                : 'Choose your team'}
            </AppText>
          </View>
          <IconChevron color={M.muted} size={18} />
        </Pressable>
      ) : null}

      {/* Team B is never chosen here: the radar search finds the opponent, so
          this row is informational and deliberately not pressable. */}
      <View
        style={styles.disabledRow}
        accessible
        accessibilityLabel="Team B, opponent. Found for you by search"
        accessibilityState={{ disabled: true }}
      >
        <View style={[styles.logo, styles.logoFallback]}>
          <IconSearch color={M.faint} size={20} />
        </View>
        <View style={styles.rowText}>
          <AppText variant="label" color={M.muted} numberOfLines={1}>
            Team B — Opponent
          </AppText>
          <AppText variant="caption" color={M.faint}>
            Found for you by search
          </AppText>
        </View>
      </View>
        </>
      ) : null}

      {/* ---------------- Date and time ---------------- */}
      <SectionLabel>DATE</SectionLabel>
      <Pressable
        style={styles.dtField}
        onPress={() => setShowDate(true)}
        accessibilityRole="button"
        accessibilityLabel="Select date"
      >
        <AppText color={dayOffset === null ? M.muted : M.text}>
          {dayOffset === null ? 'Select date' : labelForDay(dayOffset)}
        </AppText>
        <IconCalendar color={M.muted} size={18} />
      </Pressable>

      <SectionLabel>MATCH START TIME</SectionLabel>
      <Pressable
        style={styles.dtField}
        onPress={() => setShowTime(true)}
        accessibilityRole="button"
        accessibilityLabel="Select match start time"
      >
        <AppText color={time === null ? M.muted : M.text}>
          {time === null ? 'Select start time' : to12h(time.h, time.m)}
        </AppText>
        <IconClock color={M.muted} size={18} />
      </Pressable>

      <SectionLabel>MATCH END TIME</SectionLabel>
      <Pressable
        style={styles.dtField}
        onPress={() => setShowEndTime(true)}
        disabled={time === null}
        accessibilityRole="button"
        accessibilityLabel="Select match end time"
        accessibilityState={{ disabled: time === null }}
      >
        <AppText color={endTimeHHmm ? M.text : M.muted}>
          {time === null
            ? 'Pick a start time first'
            : endTime
              ? to12h(endTime.h, endTime.m)
              : 'Leave open'}
        </AppText>
        <IconClock color={M.muted} size={18} />
      </Pressable>
      {endsAt && startsAt ? (
        <View style={styles.endRow}>
          <AppText variant="caption" color={M.muted}>
            {`Runs ${durationLabel(startsAt.getTime(), endsAt.getTime())}`}
          </AppText>
          <Pressable
            onPress={() => setEndTimeHHmm('')}
            style={styles.linkBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear end time"
          >
            <AppText variant="caption" color={M.green}>
              Clear
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {/* ---------------- Squad size ---------------- */}
      <SectionLabel>NUMBER OF PLAYERS</SectionLabel>
      {sizeOptions.length === 0 ? (
        <StepState kind="empty" message="Pick a game first to choose a squad size." />
      ) : (
        <>
          <View style={styles.chipRow}>
            {sizeOptions.map((n) => (
              <Chip
                key={n}
                label={`${n} v ${n}`}
                on={playersPerSide === n}
                onPress={() => setPlayersPerSide(n)}
              />
            ))}
          </View>
          <AppText variant="caption" color={M.faint} style={styles.helper}>
            {playersPerSide === null
              ? isOpenMatch
                ? 'Players per side. Both sides are filled by individual players.'
                : 'Players per side. Both squads together fill the sheet.'
              : isOpenMatch
                ? `${playersPerSide} per side — ${totalSlots} players total, including you.`
                : `${playersPerSide} per side — ${totalSlots} players on the sheet.`}
          </AppText>
        </>
      )}

      {/* ---------------- Game type ---------------- */}
      <SectionLabel>GAME TYPE</SectionLabel>
      <View style={styles.chipRow}>
        {GAME_TYPES.map((g) => (
          <Chip
            key={g.value}
            label={g.label}
            on={gameType === g.value}
            onPress={() => setGameType(g.value)}
          />
        ))}
      </View>

      {/* ---------------- Pickers ---------------- */}
      <Modal
        transparent
        visible={showTeams && !isOpenMatch}
        animationType="slide"
        onRequestClose={() => setShowTeams(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setShowTeams(false)}
          accessibilityRole="button"
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" color={M.text}>
              Select Team A
            </AppText>
            <Pressable
              hitSlop={10}
              onPress={() => setShowTeams(false)}
              style={styles.sheetClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose color={M.muted} size={20} />
            </Pressable>
          </View>
          <ScrollView style={styles.dateList} showsVerticalScrollIndicator={false}>
            {ownedTeams.map((t) => {
              const on = t.id === teamId;
              return (
                <Pressable
                  key={t.id}
                  style={[styles.teamRow, on ? styles.pickerRowOn : null]}
                  onPress={() => {
                    setTeamId(t.id);
                    setShowTeams(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t.name}
                >
                  {t.logo_url ? (
                    <Image source={{ uri: t.logo_url }} style={styles.logo} />
                  ) : (
                    <View style={[styles.logo, styles.logoFallback]}>
                      <IconUsers color={M.green} size={20} />
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <AppText variant="label" color={on ? M.green : M.text} numberOfLines={1}>
                      {t.name}
                    </AppText>
                    <AppText variant="caption" color={M.muted}>
                      {`${t.player_count} ${t.player_count === 1 ? 'player' : 'players'} · ${sportLabel(t.sport)}`}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {/* Always available, not just on the empty state — a user with one
              team may still be posting for a squad they have not made yet. */}
          <Pressable
            onPress={() => {
              setShowTeams(false);
              router.push('/teams/create');
            }}
            style={styles.createRow}
            accessibilityRole="button"
            accessibilityLabel="Create team"
          >
            <IconPlus color={M.green} size={18} />
            <AppText variant="label" color={M.green}>
              Create team
            </AppText>
          </Pressable>
        </View>
      </Modal>

      <Modal
        transparent
        visible={showDate}
        animationType="slide"
        onRequestClose={() => setShowDate(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setShowDate(false)}
          accessibilityRole="button"
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" color={M.text}>
              Select date
            </AppText>
            <Pressable
              hitSlop={10}
              onPress={() => setShowDate(false)}
              style={styles.sheetClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconClose color={M.muted} size={20} />
            </Pressable>
          </View>
          <ScrollView style={styles.dateList} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 14 }, (_, i) => i).map((offset) => {
              const on = dayOffset === offset;
              return (
                <Pressable
                  key={offset}
                  style={[styles.pickerRow, on ? styles.pickerRowOn : null]}
                  onPress={() => {
                    setDayOffset(offset);
                    setShowDate(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <AppText variant="label" color={on ? M.green : M.text}>
                    {labelForDay(offset)}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <TimeSheet
        visible={showTime}
        title="Match start time"
        value={time}
        minTotal={startFloor}
        onPick={(next) => setTimeHHmm(fmtHHmm(next.h, next.m))}
        onClose={() => setShowTime(false)}
      />

      <TimeSheet
        visible={showEndTime}
        title="Match end time"
        value={endTime}
        minTotal={null}
        onPick={(next) => setEndTimeHHmm(fmtHHmm(next.h, next.m))}
        onClose={() => setShowEndTime(false)}
      />
    </WizardScreen>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    rowText: { flex: 1, gap: 2 },
    helper: { marginTop: S.sm },
    openBanner: {
      padding: S.sm + 2,
      marginBottom: S.sm,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.green,
      backgroundColor: M.iconChip,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
    readonlyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      minHeight: 72,
      padding: S.sm + 2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      minHeight: 72,
      padding: S.sm + 2,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    // Informational, not interactive: dimmed and without a pressable surface.
    disabledRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      minHeight: 72,
      marginTop: S.sm,
      padding: S.sm + 2,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: M.border,
      backgroundColor: M.bg,
    },
    thumb: { width: 56, height: 56, borderRadius: R.md, backgroundColor: M.chip },
    logo: { width: 48, height: 48, borderRadius: R.pill, backgroundColor: M.chip },
    logoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: M.iconChip },
    linkBtn: {
      minHeight: TOUCH,
      paddingHorizontal: S.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dtField: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: M.card,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      paddingHorizontal: S.md,
      minHeight: 52,
    },
    endRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: S.sm,
    },
    createRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      minHeight: TOUCH,
      marginTop: S.md,
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
      borderStyle: 'dashed',
    },
    sheetBackdrop: { flex: 1, backgroundColor: M.overlay },
    sheet: {
      backgroundColor: M.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: S.lg,
      borderTopWidth: 1,
      borderColor: M.border,
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: S.md,
    },
    sheetClose: {
      width: TOUCH,
      height: TOUCH,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    dateList: { maxHeight: 320 },
    pickerRow: {
      minHeight: TOUCH,
      justifyContent: 'center',
      paddingVertical: S.sm,
      paddingHorizontal: S.md,
      borderRadius: R.md,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      minHeight: 64,
      paddingVertical: S.sm,
      paddingHorizontal: S.md,
      borderRadius: R.md,
    },
    pickerRowOn: { backgroundColor: M.iconChip },
    timeCols: { flexDirection: 'row', gap: S.md, height: 220 },
    timeCol: {
      flex: 1,
      backgroundColor: M.bg,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
    },
    timeCell: {
      minHeight: TOUCH,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: R.sm,
    },
    timeCellOn: { backgroundColor: M.iconChip },
    sheetCta: {
      marginTop: S.lg,
      minHeight: 50,
      borderRadius: 16,
      backgroundColor: M.green,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetCtaLabel: { fontSize: 15 },
  });
