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
 * every submit through `post_open_challenge`, which is why "Post a Game"
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
  PLAY_WINDOWS,
  windowForTime,
  addMinutesHHmm,
  DEFAULT_SLOT_DURATION_MIN,
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
import { useSetTeamFormat } from '@features/teams/presentation/useRecruit';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useResponsive, useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import {
  IconCalendar,
  IconClose,
  IconChevron,
  IconEdit,
  IconPin,
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

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const HOURLY_SLOTS = [
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
];

const TIME_CATEGORIES = [
  { key: 'all', label: 'All (24h)' },
  { key: 'morning', label: 'Morning (6-12)' },
  { key: 'afternoon', label: 'Afternoon (12-5)' },
  { key: 'evening', label: 'Evening (5-9)' },
  { key: 'night', label: 'Night (9-6)' },
] as const;

function format12h(hhmm: string): string {
  const [hStr = '0', mStr = '00'] = hhmm.split(':');
  const h = Number(hStr);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr} ${ap}`;
}

function getUpcomingDays(count = 7): { offset: number; dayLabel: string; dayNumber: string; monthLabel: string }[] {
  const days: { offset: number; dayLabel: string; dayNumber: string; monthLabel: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WEEKDAY[d.getDay()] ?? '';
    const dayNumber = String(d.getDate()).padStart(2, '0');
    const monthLabel = MONTH[d.getMonth()] ?? '';
    days.push({ offset: i, dayLabel, dayNumber, monthLabel });
  }
  return days;
}

function labelForDay(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** '19:30' → { h: 19, m: 30 }. Null for the empty string the store starts with. */
function parseHHmm(value: string): { h: number; m: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

export default function MatchDetailsStep(): React.ReactNode {
  const M = useMock();
  // Clears the home indicator / gesture bar, and stops a long sheet
  // running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  // A flat 320 is over half a small phone's screen and a quarter of a tablet's.
  const { clampHeight } = useResponsive();
  const pickerListHeight = clampHeight(0.4, 200, 420);
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
  // Falls back to the store's own default, not a second, different one. Only a
  // draft persisted before the setEndTimeHHmm fix can still be null here.
  const slotDurationMin = useCreateMatchWizard(
    (s) => s.slotDurationMin ?? DEFAULT_SLOT_DURATION_MIN,
  );

  const setTeamId = useCreateMatchWizard((s) => s.setTeamId);
  const setPlayersPerSide = useCreateMatchWizard((s) => s.setPlayersPerSide);
  const setDayOffset = useCreateMatchWizard((s) => s.setDayOffset);
  const setTimeHHmm = useCreateMatchWizard((s) => s.setTimeHHmm);
  const setSlotDurationMin = useCreateMatchWizard((s) => s.setSlotDurationMin);

  const reset = useCreateMatchWizard((s) => s.reset);

  const [timeCategory, setTimeCategory] = useState<'all' | 'morning' | 'afternoon' | 'evening' | 'night'>('all');
  const upcomingDays = useMemo(() => getUpcomingDays(7), []);

  const [showTeams, setShowTeams] = useState(false);
  const [errorFor, setErrorFor] = useState<{ answers: string; message: string } | null>(null);

  // Which of the two flows this submit belongs to. Everything team-shaped on
  // this screen is gated on it.
  const isOpenMatch = matchType === 'post_match';

  // Team Vs Team: bound to Team A, opponent comes from the radar.
  const post = usePostOpenChallenge(teamId ?? '');
  // Post a Match: no team anywhere in the payload.
  const createOpen = useCreateOpenMatch();
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

  const setTeamFormat = useSetTeamFormat(teamId ?? '');
  // The format re-declaration is part of the same submit, so the button has to
  // stay busy through it or a second tap fires a second post. Declared after
  // the mutation it reads, not above it.
  const submitting = isOpenMatch
    ? createOpen.isPending
    : post.isPending || setTeamFormat.isPending;

  /*
    THE FORMAT IS THE TEAM'S, and this screen may change it.

    Strict format-to-format matchmaking judges every team by one number --
    `teams.target_size`, its declared players per side -- on both sides of every
    fixture. So a captain who posts a 6 v 6 from a team declared as 4 v 4 would
    be asking for opponents by a yardstick their own team fails; the server
    refuses that insert with FORMAT_MISMATCH rather than quietly allowing the
    asymmetry.

    The override still exists, it is just honest: picking a different size here
    re-declares the team's format first, then posts. That is one extra write on
    the uncommon path and none on the common one.
  */
  const teamFormat = team?.target_size ?? null;
  /*
    A NULL format needs syncing too — that was the bug.

    This condition used to require `teamFormat !== null`, so a team that had
    never declared a format skipped the sync entirely and went straight to
    `post_open_challenge`, where the insert trigger refused it with
    FORMAT_MISMATCH. Every team is created with `target_size` null and nothing
    in the create-team flow sets it, so this hit EVERY newly created team on its
    first fixture: the red "different format from your team" banner on a screen
    where the user had picked no other format.

    Null is not "already matches" — it is "not declared yet", which is precisely
    when the sync is needed. Comparing the two values directly covers both the
    undeclared case and a genuine override.
  */
  const needsFormatSync =
    !isOpenMatch && playersPerSide !== null && teamFormat !== playersPerSide;

  /*
    A submit error describes the answers as they were WHEN IT FAILED.

    `error` was only cleared at the start of the next submit, so a refusal stayed
    on screen while the user changed the very thing it was complaining about —
    which is how a "different format from your team" banner ended up sitting
    under a freshly picked 4 v 4.

    So the message is stored WITH the answers it was raised against, and shown
    only while those still hold. Derived during render rather than cleared by an
    effect: an effect would need a render with the stale banner still up before
    it could take it down.
  */
  const answerSig = [playersPerSide, teamId, dayOffset, timeHHmm, endTimeHHmm, matchType].join('|');
  const error = errorFor && errorFor.answers === answerSig ? errorFor.message : null;
  const setError = (message: string | null): void =>
    setErrorFor(message === null ? null : { answers: answerSig, message });

  // Only meaningful for a team fixture; an open game is filled by individuals.
  const shortBy =
    !isOpenMatch && team && playersPerSide !== null
      ? Math.max(playersPerSide - team.player_count, 0)
      : 0;

  // If the organiser owns exactly one team for this sport and has not chosen one yet,
  // select it automatically so they don't have to tap an extra sheet.
  useEffect(() => {
    if (!isOpenMatch && !teamId && ownedTeams.length === 1 && ownedTeams[0]) {
      setTeamId(ownedTeams[0].id);
    }
  }, [isOpenMatch, teamId, ownedTeams, setTeamId]);

  /*
    The team's own format is the default answer, not an empty chip row.

    A squad that has declared itself 6 v 6 is almost always posting a 6 v 6, and
    leaving the question blank invites the one answer that costs an extra write
    and a re-declaration. Only pre-fills an unanswered form -- an explicit
    choice, including a deliberate override, is never overwritten.
  */
  useEffect(() => {
    if (!isOpenMatch && playersPerSide === null && teamFormat !== null) {
      setPlayersPerSide(teamFormat);
    }
  }, [isOpenMatch, playersPerSide, teamFormat, setPlayersPerSide]);

  const sizeOptions = sport ? PLAYERS_PER_SIDE[sport] : [];
  const totalSlots = playersPerSide !== null ? playersPerSide * 2 : 0;
  const time = parseHHmm(timeHHmm);
  const now = new Date();
  const radiusKm = Math.round(searchRadiusM / 1000);

  const { index, total: totalSteps } = stepPosition('details');

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
    if (!matchType) return { ok: false, msg: 'Pick a game type' };
    if (!areaName || areaName.trim().length < 2) return { ok: false, msg: 'Select a play area' };
    // The one question that exists on only one branch.
    if (!isOpenMatch && !teamId) return { ok: false, msg: 'Select Team A' };
    if (playersPerSide === null) return { ok: false, msg: 'Choose the number of players' };
    /*
      A team fixture needs a real side. Owner's call after seeing a 1-player
      squad post a 4 v 4: this now BLOCKS rather than warns.

      Only for Team Vs Team -- an open game is filled by individual players who
      join, so a short squad there is the normal case, not an error.
    */
    if (shortBy > 0) {
      return {
        ok: false,
        msg: `${team?.name ?? 'Your team'} needs ${shortBy} more player${shortBy === 1 ? '' : 's'} for ${playersPerSide} v ${playersPerSide}`,
      };
    }
    if (dayOffset === null) return { ok: false, msg: 'Pick a date' };
    // One chip sets both ends, so either being empty means no window was
    // picked. The window is mandatory because everything downstream depends on
    // `end_time`: every later round inherits it, create_rematch refuses once it
    // has passed, and expire_stale_matches closes the game on it.
    if (!time || !endTimeHHmm) return { ok: false, msg: 'Pick when you are free' };

    const composed = isOpenMatch
      ? CreateOpenMatchSchema.safeParse({
          matchName: derivedName,
          sport,
          areaName,
          dayOffset,
          timeHHmm,
          totalSlots,
          radiusM: searchRadiusM,
          endTimeHHmm,
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
          endTimeHHmm,
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
      if (chosen.getTime() <= now.getTime())
        return { ok: false, msg: `${format12h(timeHHmm ?? '')} has already started. Pick a later slot.` };
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
          endTime: buildEndAt(dayOffset, timeHHmm, endTimeHHmm)?.toISOString() ?? null,
          totalSlots,
          radiusM: searchRadiusM,
          lat: areaCoords?.lat ?? null,
          lng: areaCoords?.lng ?? null,
        });
        reset();
        // `replace` so hardware back leaves the wizard rather than re-submitting
        // this step, same as the challenge branch below.
        router.replace({ pathname: '/match/[id]', params: { id: match.id } });
      } catch (e) {
        setError(e instanceof AppError ? e.message : 'Could not post the game. Please try again.');
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
      /*
        Re-declare first, post second, and never the other way round.

        The insert trigger on team_challenges compares the fixture's format with
        the posting team's, so posting first would simply fail. Awaited rather
        than fired and forgotten: if the re-declaration is refused (a squad too
        small for the size just picked), the post must not happen at all.
      */
      if (needsFormatSync && playersPerSide !== null) {
        await setTeamFormat.mutateAsync(playersPerSide);
      }

      const challenge = await post.mutateAsync({
        matchName: derivedName,
        areaName,
        dayOffset,
        timeHHmm,
        totalSlots,
        message: `${playersPerSide} v ${playersPerSide}`,
        radiusM: searchRadiusM,
        endTimeHHmm,
        lat: areaCoords?.lat ?? undefined,
        lng: areaCoords?.lng ?? undefined,
      });
      reset();
      // The organiser goes to the radar, which polls the offer ledger for the
      // challenge just posted. `replace` so hardware back leaves the wizard
      // rather than re-submitting this step; the id travels as a param because
      // the radar is a route of its own and can be reopened from a push.
      router.replace({
        pathname: '/match/create/searching',
        params: { challengeId: challenge.id },
      });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not post the game. Please try again.');
    }
  };

  // Going "back" to Step 2. A deep link opens this screen with nothing behind
  // it, where back() is a no-op, so fall back to the area route itself.
  const onChangeArea = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/match/create/area');
  };

  // Time picker restricts to the future when the selected day is today.

  return (
    <WizardScreen
      title="Game Details"
      stepIndex={index}
      totalSteps={totalSteps}
      primaryLabel={
        submitting
          ? isOpenMatch
            ? 'Posting…'
            : 'Searching…'
          : isOpenMatch
            ? 'Post Game'
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
              {matchType === 'team_vs_team' ? 'Team Vs Team (Challenge)' : 'Post a Game (Open for all)'}
            </AppText>
          </View>
        </View>
      ) : (
        <StepState
          kind="empty"
          message="No sport chosen yet."
          actionLabel="Choose a sport"
          onAction={() => router.replace('/match/create')}
        />
      )}

      {/* ---------------- Play Area ---------------- */}
      <SectionLabel>PLAY AREA</SectionLabel>
      {areaName ? (
        <View style={styles.readonlyRow}>
          <View style={[styles.logo, styles.logoFallback]}>
            <IconPin color={M.green} size={20} />
          </View>
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
            <IconEdit color={M.green} size={16} />
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

      {/* ---------------- Date Selection (Playo Style) ---------------- */}
      <SectionLabel>SELECT MATCH DATE</SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dateStripScroll}
      >
        {upcomingDays.map((item) => {
          const isSelected = dayOffset === item.offset;
          return (
            <Pressable
              key={item.offset}
              onPress={() => setDayOffset(item.offset)}
              accessibilityRole="button"
              accessibilityLabel={`${item.dayLabel}, ${item.dayNumber} ${item.monthLabel}`}
              accessibilityState={{ selected: isSelected }}
              style={({ pressed }) => [
                styles.dateChip,
                isSelected && styles.dateChipSelected,
                pressed && { opacity: 0.85 },
              ]}
            >
              <AppText
                variant="caption"
                color={isSelected ? M.limeInk : M.muted}
                style={[styles.dateChipDay, isSelected && { fontWeight: '700' }]}
              >
                {item.dayLabel}
              </AppText>
              <AppText
                variant="heading"
                color={isSelected ? M.limeInk : M.text}
                style={[styles.dateChipNum, isSelected && { fontWeight: '800' }]}
              >
                {item.dayNumber}
              </AppText>
              <AppText
                variant="caption"
                color={isSelected ? M.limeInk : M.muted}
                style={[styles.dateChipMonth, isSelected && { fontWeight: '700' }]}
              >
                {item.monthLabel}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ---------------- Match Duration ---------------- */}
      <SectionLabel>MATCH DURATION</SectionLabel>
      <View style={styles.chipRow}>
        {[60, 90, 120, 180].map((dur) => (
          <Chip
            key={dur}
            label={dur === 60 ? '1 hr' : dur === 90 ? '1.5 hrs' : dur === 120 ? '2 hrs' : '3 hrs'}
            on={slotDurationMin === dur}
            /*
              One setter, not two. `setSlotDurationMin` already recomputes the
              end time from the current start; the extra `setEndTimeHHmm` that
              used to follow it was what nulled the duration and snapped the
              chip back to 1 hr.
            */
            onPress={() => setSlotDurationMin(dur)}
          />
        ))}
      </View>

      {/* ---------------- Available Time Slots (Playo Style) ---------------- */}
      <SectionLabel>AVAILABLE TIME SLOTS</SectionLabel>

      {/* Time of Day Filter Tabs */}
      <View style={styles.timeCategoryRow}>
        {TIME_CATEGORIES.map((cat) => {
          const active = timeCategory === cat.key;
          return (
            <Pressable
              key={cat.key}
              onPress={() => setTimeCategory(cat.key)}
              style={[styles.timeCategoryChip, active && styles.timeCategoryChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <AppText
                variant="caption"
                color={active ? M.green : M.muted}
                style={{ fontWeight: active ? '700' : '500', fontSize: 12 }}
              >
                {cat.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* Hourly Slot Cards Grid */}
      <View style={styles.slotGrid}>
        {HOURLY_SLOTS.filter((s) => {
          const hour = parseInt(s.split(':')[0] ?? '0', 10);
          if (timeCategory === 'morning') return hour >= 6 && hour < 12;
          if (timeCategory === 'afternoon') return hour >= 12 && hour < 17;
          if (timeCategory === 'evening') return hour >= 17 && hour < 21;
          if (timeCategory === 'night') return hour >= 21 || hour < 6;
          return true;
        }).map((s) => {
          const [h = 0, m = 0] = s.split(':').map(Number);
          const dur = slotDurationMin ?? 60;
          const minsNow = now.getHours() * 60 + now.getMinutes();
          // A game cannot be posted to start in the past, so a slot is gone the
          // minute it begins -- the same rule the submit guard applies. Judging
          // it by its END left 10:00 tappable at 10:42 and then refused it.
          const isPast = dayOffset === 0 && h * 60 + m <= minsNow;
          const isSelected = timeHHmm === s;
          const endStr = addMinutesHHmm(s, dur);
          const formattedStart = format12h(s);
          const formattedEnd = format12h(endStr);

          return (
            <Pressable
              key={s}
              disabled={isPast}
              // `setTimeHHmm` derives the end time from the chosen duration, so
              // picking a slot keeps the 2 hr / 3 hr the user already selected.
              onPress={() => setTimeHHmm(s)}
              style={({ pressed }) => [
                styles.slotCard,
                isSelected && styles.slotCardSelected,
                isPast && styles.slotCardPast,
                pressed && !isPast && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${formattedStart} to ${formattedEnd}, ${isPast ? 'Past' : isSelected ? 'Selected' : 'Available'}`}
              accessibilityState={{ selected: isSelected, disabled: isPast }}
            >
              <AppText
                variant="label"
                color={isSelected ? M.green : isPast ? M.muted : M.text}
                style={[styles.slotTimeStart, isSelected && { color: M.green }]}
              >
                {formattedStart}
              </AppText>
              <AppText
                variant="caption"
                color={M.muted}
                style={styles.slotTimeSub}
                numberOfLines={1}
              >
                {`to ${formattedEnd}`}
              </AppText>
              <View
                style={[
                  styles.slotBadge,
                  isSelected
                    ? styles.slotBadgeSelected
                    : isPast
                    ? styles.slotBadgePast
                    : styles.slotBadgeAvailable,
                ]}
              >
                <AppText
                  variant="caption"
                  color={isSelected ? M.limeInk : isPast ? M.faint : M.green}
                  style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase' }}
                >
                  {isSelected ? '⚡ Selected' : isPast ? 'Past' : 'Available'}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Selected Slot Summary Banner */}
      {timeHHmm && endTimeHHmm ? (
        <View style={styles.selectedSlotBanner}>
          <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }} center>
            {`✓ Match Slot: ${labelForDay(dayOffset ?? 0)} · ${format12h(timeHHmm)} – ${format12h(endTimeHHmm)} (${slotDurationMin === 60 ? '1 hr' : slotDurationMin === 90 ? '1.5 hrs' : slotDurationMin === 120 ? '2 hrs' : '3 hrs'})`}
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" color={M.faint} style={{ marginTop: S.xs }}>
          Tap an available slot above to set match time.
        </AppText>
      )}

      {/* ---------------- Squad size ---------------- */}
      <SectionLabel>NUMBER OF PLAYERS</SectionLabel>
      {sizeOptions.length === 0 ? (
        <StepState kind="empty" message="Pick a sport first to choose a squad size." />
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
          {/*
            Short squad BLOCKS a team fixture (the submit guard refuses it too;
            this is the explanation, not the boundary). One way out now: the
            invite code. The Find Players board — strangers asking to join a
            squad — was removed on 3 Sep 2026, so a squad grows by invitation.
          */}
          {shortBy > 0 ? (
            <View style={styles.squadWarn}>
              <AppText variant="label" color={M.danger}>
                {`${playersPerSide} v ${playersPerSide} needs ${playersPerSide} players — ${team?.name ?? 'your team'} has ${team?.player_count ?? 0}`}
              </AppText>
              <AppText variant="caption" color={M.muted}>
                {`Add ${shortBy} more before you can find an opponent.`}
              </AppText>
              <View style={styles.squadWarnRow}>
                <Pressable
                  onPress={() => router.push(`/teams/${teamId}/invite`)}
                  accessibilityRole="button"
                  style={styles.squadWarnBtn}
                >
                  <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                    Invite players by code
                  </AppText>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/*
            Says out loud that this size is a FILTER, not a preference — the one
            thing about strict matching a captain has to understand before they
            wonder where all the teams went.
          */}
          {!isOpenMatch && playersPerSide !== null ? (
            <View style={styles.formatNote}>
              <AppText variant="caption" color={M.green} center>
                {`You will only be shown ${playersPerSide} v ${playersPerSide} teams, and only they can challenge you.`}
              </AppText>
            </View>
          ) : null}

          {/* Setting or changing the team's format. Said before the submit, not
              discovered after it. Two different sentences, because "you have not
              picked a format yet" and "you are changing the one you picked" are
              not the same message. */}
          {needsFormatSync ? (
            <AppText variant="caption" color={M.muted} style={styles.helper}>
              {teamFormat === null
                ? `${team?.name ?? 'Your team'} has no format set yet. Posting this makes it a ${playersPerSide} v ${playersPerSide} side.`
                : `${team?.name ?? 'Your team'} is set to ${teamFormat} v ${teamFormat}. Posting this changes it to ${playersPerSide} v ${playersPerSide} for future games too.`}
            </AppText>
          ) : null}

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
        <View style={[styles.sheet, sheetInsets]}>
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
          <ScrollView
            style={[styles.dateList, { maxHeight: pickerListHeight }]}
            showsVerticalScrollIndicator={false}
          >
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
    </WizardScreen>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    rowText: { flex: 1, gap: 2 },
    squadWarn: {
      gap: 4,
      padding: S.md,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      marginTop: S.sm,
    },
    formatNote: {
      marginTop: S.sm,
      padding: S.sm,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.green,
      backgroundColor: M.iconChip,
    },
    squadWarnRow: { flexDirection: 'row', gap: S.md },
    squadWarnBtn: { alignSelf: 'flex-start', paddingVertical: S.xs },
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
    dateStripScroll: {
      paddingVertical: S.xs,
      gap: S.sm,
      marginBottom: S.sm,
    },
    dateChip: {
      // min, not fixed: the chip holds a weekday abbreviation and a number, and
      // both grow with the OS font setting. At default scale this renders at
      // exactly the old 62x74.
      minWidth: 70,
      minHeight: 84,
      paddingHorizontal: S.xs,
      borderRadius: R.lg,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    dateChipSelected: {
      backgroundColor: M.green,
      borderColor: M.green,
    },
    dateChipDay: {
      fontSize: 11,
      fontWeight: '600',
    },
    dateChipNum: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 20,
      fontWeight: '700',
    },
    dateChipMonth: {
      fontSize: 11,
      fontWeight: '600',
    },
    timeCategoryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: S.sm,
    },
    timeCategoryChip: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: S.sm + 4,
      borderRadius: R.pill,
      backgroundColor: M.card,
      borderWidth: 1,
      borderColor: M.border,
    },
    timeCategoryChipActive: {
      backgroundColor: M.chip,
      borderColor: M.green,
      borderWidth: 1.5,
    },
    slotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.sm,
    },
    slotCard: {
      // Three to a row: a third of the width, less two S.sm gaps shared out.
      flexBasis: '30%',
      flexGrow: 1,
      maxWidth: '32%',
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
      paddingVertical: S.sm + 2,
      paddingHorizontal: S.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 86,
      gap: 4,
    },
    slotCardSelected: {
      backgroundColor: M.chip,
      borderColor: M.green,
      borderWidth: 2,
    },
    slotCardPast: {
      opacity: 0.35,
    },
    slotTimeStart: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      fontWeight: '700',
    },
    slotTimeSub: {
      fontSize: 11,
      fontWeight: '500',
    },
    slotBadge: {
      paddingHorizontal: S.sm,
      paddingVertical: 2,
      borderRadius: R.pill,
      borderWidth: 1,
      marginTop: 2,
    },
    slotBadgeAvailable: {
      borderColor: M.green,
      backgroundColor: 'transparent',
    },
    slotBadgeSelected: {
      borderColor: M.green,
      backgroundColor: M.green,
    },
    slotBadgePast: {
      borderColor: M.border,
      backgroundColor: 'transparent',
    },
    selectedSlotBanner: {
      marginTop: S.sm,
      padding: S.sm + 2,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.green,
      backgroundColor: M.iconChip,
    },
    readonlyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.md,
      minHeight: 76,
      padding: S.sm + 4,
      borderRadius: 20,
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
      flexDirection: 'row',
      gap: 6,
      minHeight: TOUCH,
      paddingHorizontal: S.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
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
    // maxHeight is applied at the call site from clampHeight().
    dateList: {},
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
    // Dead style: nothing renders `timeCols` any more (the wizard asks for a
    // play WINDOW, not two time columns). Kept minus its old `height: 220` so
    // it cannot be revived with a fixed height baked in.
    timeCols: { flexDirection: 'row', gap: S.md },
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
