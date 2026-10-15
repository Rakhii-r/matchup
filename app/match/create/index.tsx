/**
 * Create Match — Step 1 of 3: Select Game + Match Type.
 *
 * Sport and match type share one screen, with a single Next at the bottom that
 * stays dead until both are answered. They used to be two routes (`index` and
 * `type`); the reference frames put them together, and `type.tsx` is gone.
 *
 * Entry point of the wizard, so this is where the store is cleared. Going back
 * here from Step 2 does not remount the screen (it is the root of the nested
 * stack and was never unmounted), so a back navigation keeps every answer;
 * only a fresh entry into the wizard resets.
 *
 * Sports come from the `sports` table via `useActiveSports`, never a hard-coded
 * list — a sport hidden in Sports Management disappears from here on the next
 * refetch. Artwork comes from the one shared map in `@shared/ui/sportImages`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ImageBackground, Pressable, StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  useCreateMatchWizard,
  stepPosition,
  type MatchType,
} from '@features/matches/presentation/useCreateMatchWizard';
import {
  SectionLabel,
  StepState,
  TOUCH,
  WizardScreen,
} from '@features/matches/presentation/CreateMatchWizardUI';
import { useActiveSports, useSportLabel } from '@features/sports/presentation/useSports';
import type { Sport } from '@shared/types/database.types';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconSend, IconUsers } from '@shared/ui/icons';
import { SPORT_IMAGE } from '@shared/ui/sportImages';

/**
 * Exactly two options, side by side, and they are genuinely two different
 * things — not one flow with a label.
 *
 * Team Vs Team books your squad against another squad: it needs a team you own,
 * and the radar finds the opponent. Post a Match books a sheet of individual
 * seats: it needs no team at all and anyone nearby can take one. The captions
 * say which is which, because picking the wrong one here is the difference
 * between being asked for a team on Step 3 and not.
 */
const MATCH_TYPES: {
  value: MatchType;
  title: string;
  tag: string;
  caption: string;
  Icon: typeof IconUsers;
}[] = [
  {
    value: 'team_vs_team',
    title: 'Team Vs Team',
    tag: '(Challenge)',
    caption: 'Challenge or play against another team. We offer it to the closest teams that fit.',
    Icon: IconUsers,
  },
  {
    value: 'post_match',
    title: 'Post a Game',
    tag: '(Open for all)',
    caption: 'Open for individual players to join. No team needed.',
    Icon: IconSend,
  },
];

/**
 * Type guard for the untrusted `?sport=` param the Matches tab passes through.
 * Checked against SPORT_IMAGE, which is a `Record<Sport, …>` and therefore
 * exhaustive over Sport, rather than cast.
 */
function isSport(value: unknown): value is Sport {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPORT_IMAGE, value);
}

export default function SelectGameStep(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const params = useLocalSearchParams<{
    sport?: string;
    type?: string;
    teamId?: string;
    resume?: string;
    fresh?: string;
  }>();

  const sports = useActiveSports();
  const sportLabel = useSportLabel();

  const sport = useCreateMatchWizard((s) => s.sport);
  const matchType = useCreateMatchWizard((s) => s.matchType);
  const setSport = useCreateMatchWizard((s) => s.setSport);
  const setMatchType = useCreateMatchWizard((s) => s.setMatchType);
  const setTeamId = useCreateMatchWizard((s) => s.setTeamId);
  const reset = useCreateMatchWizard((s) => s.reset);

  const preselectedSport = isSport(params.sport) ? params.sport : null;
  const preselectedType =
    params.type === 'team_vs_team' || params.type === 'post_match' ? params.type : null;

  const initializedRef = useRef(false);

  // If explicit resume is passed, keep whatever draft was saved.
  // Otherwise, if new params or fresh create is requested, apply them on mount only.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (params.resume === 'true') {
      return;
    }
    if (params.fresh === 'true' || (!preselectedSport && !preselectedType && !params.teamId)) {
      reset();
    }
    if (preselectedSport) setSport(preselectedSport);
    if (preselectedType) setMatchType(preselectedType);
    if (params.teamId) setTeamId(params.teamId);
  }, [reset, setSport, setMatchType, setTeamId, preselectedSport, preselectedType, params.teamId, params.resume, params.fresh]);

  const { index, total } = stepPosition('sport');
  const rows = sports.data ?? [];

  /*
    A team's sport is a CONSTRAINT, not a preference.

    Every caller that passes teamId also passes that team's sport (the team
    screen's Find Opponent / Post Another Game, and the radar). Arriving that
    way, the grid still rendered every active sport, so a Box Cricket team could
    be sent to look for a badminton opponent.

    Deliberately keyed on teamId rather than on the sport param: the Games tab
    passes ?sport= as a filter the user is free to change. And it releases if
    they switch to Post a Game, because that flow has no team to be bound by.
  */
  const sportLockedByTeam = Boolean(params.teamId) && matchType === 'team_vs_team';
  const visibleRows = sportLockedByTeam ? rows.filter((r) => r.sport === sport) : rows;

  return (
    <WizardScreen
      title="Create Game"
      stepIndex={index}
      totalSteps={total}
      subtitle={
        sportLockedByTeam
          ? 'Your team sets the sport. Choose how you want to fill it.'
          : 'Pick the sport and how you want to fill it.'
      }
      primaryLabel="Next"
      primaryDisabled={sport === null || matchType === null}
      onPrimary={() => router.push('/match/create/area')}
    >
      <SectionLabel>{sportLockedByTeam ? 'SPORT' : 'SELECT GAME'}</SectionLabel>
      {sportLockedByTeam ? (
        <AppText variant="caption" color={M.faint} style={{ marginBottom: S.xs }}>
          Set by your team — a team plays only its own sport.
        </AppText>
      ) : null}

      {sports.isLoading ? <StepState kind="loading" message="Loading sports…" /> : null}

      {sports.isError ? (
        <StepState
          kind="error"
          message="Could not load the sport list."
          actionLabel="Try again"
          onAction={() => void sports.refetch()}
        />
      ) : null}

      {!sports.isLoading && !sports.isError && rows.length === 0 ? (
        <StepState
          kind="empty"
          message="No sports are available right now. Please check back later."
        />
      ) : null}

      {visibleRows.length > 0 ? (
        <View style={styles.grid}>
          {visibleRows.map((row) => {
            const on = sport === row.sport;
            return (
              <Pressable
                key={row.id}
                onPress={() => setSport(row.sport)}
                style={styles.tileWrap}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={sportLabel(row.sport)}
              >
                <MotiView
                  pointerEvents="none"
                  animate={{ scale: on ? 1 : 0.96, borderColor: on ? M.green : M.border }}
                  transition={{ type: 'spring', damping: 14, stiffness: 180 }}
                  style={[styles.tile, on ? styles.tileOn : null]}
                >
                  <ImageBackground
                    source={SPORT_IMAGE[row.sport]}
                    style={styles.tileImage}
                    imageStyle={styles.tileImageRadius}
                  >
                    <View style={styles.shade} />
                    <AppText variant="label" color="#FFFFFF" style={styles.tileLabel}>
                      {sportLabel(row.sport)}
                    </AppText>
                  </ImageBackground>
                </MotiView>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <SectionLabel>MATCH TYPE</SectionLabel>
      <View style={styles.typeRow}>
        {MATCH_TYPES.map(({ value, title, tag, caption, Icon }) => {
          const on = matchType === value;
          return (
            <Pressable
              key={value}
              onPress={() => setMatchType(value)}
              style={styles.typeWrap}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${title} ${tag}. ${caption}`}
            >
              <MotiView
                pointerEvents="none"
                animate={{
                  borderColor: on ? M.green : M.border,
                  backgroundColor: on ? M.cardHi : M.card,
                }}
                transition={{ type: 'timing', duration: 160 }}
                style={styles.typeCard}
              >
                <View style={styles.iconChip}>
                  <Icon color={on ? M.green : M.muted} size={20} />
                </View>
                <AppText variant="label" color={M.text} style={styles.typeTitle}>
                  {title}
                </AppText>
                <AppText variant="caption" color={on ? M.green : M.muted}>
                  {tag}
                </AppText>
                <AppText variant="caption" color={M.faint} style={styles.typeCaption}>
                  {caption}
                </AppText>
              </MotiView>
            </Pressable>
          );
        })}
      </View>

      {/* Says out loud what the choice just committed to, so the absence of any
          team question on Step 3 reads as intended rather than as a bug. */}
      {matchType !== null ? (
        <View style={matchType === 'post_match' ? styles.noteOpen : styles.note}>
          <AppText
            variant="caption"
            color={matchType === 'post_match' ? M.green : M.muted}
            center
          >
            {matchType === 'post_match'
              ? 'Open for all players to join — you will not pick a team.'
              : 'You will pick your team next. We find the opponent for you.'}
          </AppText>
        </View>
      ) : null}
    </WizardScreen>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.md },
    // Two per row with one gap between them, so the tile is comfortably wider
    // than the 44pt minimum on every phone.
    tileWrap: { width: '47%', flexGrow: 1 },
    tile: {
      height: 128,
      borderRadius: 18,
      backgroundColor: M.card,
      borderWidth: 2,
      borderColor: M.border,
      overflow: 'hidden',
    },
    tileOn: {
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.55,
      shadowRadius: 12,
      elevation: 10,
    },
    tileImage: { flex: 1, justifyContent: 'flex-end' },
    tileImageRadius: { borderRadius: R.md },
    shade: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // Fixed, not the theme overlay: the label on top is always white.
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
    tileLabel: { paddingHorizontal: S.md, paddingBottom: S.sm + 2, fontSize: 16, fontWeight: '700' },
    // The two type cards sit side by side, one row, equal width.
    typeRow: { flexDirection: 'row', gap: S.md },
    typeWrap: { flex: 1 },
    typeCard: {
      flex: 1,
      gap: S.xs,
      minHeight: 150,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    iconChip: {
      width: TOUCH,
      height: TOUCH,
      borderRadius: R.md,
      backgroundColor: M.iconChip,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: S.xs,
    },
    typeTitle: { fontSize: 15 },
    typeCaption: { marginTop: S.xs },
    note: {
      marginTop: S.md,
      padding: S.sm + 2,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.card,
    },
    noteOpen: {
      marginTop: S.md,
      padding: S.sm + 2,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.green,
      backgroundColor: M.iconChip,
    },
  });
