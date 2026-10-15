/**
 * Match Offers — one screen, two sides of the same open challenge.
 *
 * INCOMING (no params). Fixtures the matcher put in front of a team I belong
 * to. This is the accept side: losing the race is a normal outcome, not a
 * failure — the RPC row-locks the challenge and the loser gets
 * CHALLENGE_ALREADY_TAKEN, which is shown as information and the list refreshed.
 *
 * OUTGOING (`?challengeId=…`). The teams MY posted fixture was offered to,
 * which is where the radar's "View Game Offers" lands. These rows come from
 * `get_challenge_candidates`, not from the table: `teams` is members-only, so a
 * plain select can only ever give the poster a uuid for a team they are not in.
 * That RPC is the only place the poster can read a candidate's name, squad size
 * and record.
 *
 * ACCEPTING ON THE OUTGOING SIDE. The poster can accept any candidate that has
 * applied (status 'interested'); `accept_open_challenge` then checks ownership
 * itself and resolves whose squad the supplied lineup belongs to. A user who
 * owns two squads can still take their own fixture with the other one — it
 * reaches this list as an 'interested' applicant like any other.
 *
 * VIEW DETAILS runs NO query. `/teams/[id]` is gated on `is_team_member`, and
 * the poster is by definition not a member of a team they are matched against,
 * so that route can only ever render "Unable to load team". Everything the
 * owner wants shown — name, played, won, lost, win rate — is already on the
 * candidate row the list is rendering from, so the detail sheet is a pure
 * projection of the row in hand and touches no RLS surface at all.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import {
  useAcceptOpenChallenge,
  useChallenge,
  useApplyToChallenge,
  useChallengeCandidatesFull,
  useDeclineOpenChallenge,
  useMyOffers,
} from '@features/teams/presentation/useChallenges';
import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import type { TeamOverviewRow } from '@features/teams/data/teamRepository';
import type {
  ChallengeCandidateFull,
  OpenOffer,
} from '@features/teams/domain/challengeSchema';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useAuthStore } from '@core/auth/authStore';
import { LineupPickerSheet } from '@features/matches/presentation/LineupPickerSheet';
import { useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { IconClose, IconUsers } from '@shared/ui/icons';
import { PressableScale } from '@shared/ui/PressableScale';

/** Smallest comfortable tap target, same figure as the create-match wizard. */
const TOUCH = 44;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unavailable';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  return metres < 1000 ? `${Math.round(metres)} m away` : `${(metres / 1000).toFixed(1)} km away`;
}

/** "12 played · 7 won · 58%" — or an honest line when nothing has been played. */
function formatRecord(matchesPlayed: number, wins: number, winRate: number): string {
  if (matchesPlayed <= 0) return 'No games played yet';
  return `${matchesPlayed} played · ${wins} won · ${winRate}% win rate`;
}

const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  offered: 'Scanned on Radar',
  interested: '⚡ Requested Game (Wants to Play)',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

/**
 * The team block from the reference card: badge, name, squad size, record.
 * Every figure is passed in from a real row — there is no default record.
 */
function TeamBlock({
  name,
  logoUrl,
  playerCount,
  matchesPlayed,
  wins,
  winRate,
  styles,
  M,
}: {
  name: string;
  logoUrl: string | null;
  playerCount: number;
  matchesPlayed: number;
  wins: number;
  winRate: number;
  styles: ReturnType<typeof makeStyles>;
  M: MockPalette;
}): React.ReactNode {
  return (
    <View style={styles.teamRow}>
      {logoUrl ? (
        <Image source={{ uri: logoUrl }} style={styles.badge} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.badge, styles.badgeFallback]}>
          <AppText variant="label" color={M.limeInk}>
            {name.trim().slice(0, 1).toUpperCase()}
          </AppText>
        </View>
      )}
      <View style={styles.teamText}>
        <AppText variant="label" color={M.text} numberOfLines={1}>
          {name}
        </AppText>
        <View style={styles.playersRow}>
          <IconUsers size={14} color={M.faint} />
          <AppText variant="caption" color={M.muted}>
            {playerCount === 1 ? '1 Player' : `${playerCount} Players`}
          </AppText>
        </View>
        <AppText variant="caption" color={M.faint}>
          {formatRecord(matchesPlayed, wins, winRate)}
        </AppText>
      </View>
    </View>
  );
}

/** One figure in the sheet's stat strip. */
function Stat({
  label,
  value,
  styles,
  M,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  M: MockPalette;
}): React.ReactNode {
  return (
    <View style={styles.stat}>
      <AppText variant="label" color={M.text}>
        {value}
      </AppText>
      <AppText variant="caption" color={M.faint}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Candidate details, rendered STRAIGHT FROM THE ROW — no fetch, no query key,
 * no RLS surface. `get_challenge_candidates` already carries every field the
 * owner asked for, so opening this sheet costs nothing and cannot fail the way
 * `/teams/[id]` did.
 *
 * Deliberately nothing else here: no roster, no fixtures, no captain. Those all
 * need `get_team_overview`, which is exactly the members-only call that made
 * View Details show "Unable to load team".
 */
function CandidateSheet({
  candidate,
  onClose,
  styles,
  M,
}: {
  candidate: ChallengeCandidateFull | null;
  onClose: () => void;
  styles: ReturnType<typeof makeStyles>;
  M: MockPalette;
}): React.ReactNode {
  // Clears the home indicator / gesture bar, and stops a tall candidate
  // card running off the top of a small screen.
  const sheetInsets = useSheetInsets();
  return (
    <Modal
      transparent
      visible={candidate !== null}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.sheetBackdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close team details"
      />
      {candidate ? (
        <View style={[styles.sheet, sheetInsets]}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" color={M.text}>
              Team details
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

          <View style={styles.sheetTeam}>
            {candidate.logo_url ? (
              <Image
                source={{ uri: candidate.logo_url }}
                style={styles.sheetBadge}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.sheetBadge, styles.badgeFallback]}>
                <AppText variant="heading" color={M.limeInk}>
                  {candidate.team_name.trim().slice(0, 1).toUpperCase()}
                </AppText>
              </View>
            )}
            <View style={styles.teamText}>
              <AppText variant="label" color={M.text} numberOfLines={2}>
                {candidate.team_name}
              </AppText>
              <View style={styles.playersRow}>
                <IconUsers size={14} color={M.faint} />
                <AppText variant="caption" color={M.muted}>
                  {candidate.player_count === 1
                    ? '1 Player'
                    : `${candidate.player_count} Players`}
                </AppText>
              </View>
              <AppText variant="caption" color={M.faint}>
                {formatDistance(candidate.distance_m)}
              </AppText>
            </View>
          </View>

          {/* A row of zeroes reads as a broken screen, so say it plainly. */}
          {candidate.matches_played === 0 ? (
            <AppText variant="body" color={M.muted} style={styles.sheetEmpty}>
              No games played yet
            </AppText>
          ) : (
            <View style={styles.statRow}>
              <Stat
                label="Played"
                value={String(candidate.matches_played)}
                styles={styles}
                M={M}
              />
              <Stat label="Won" value={String(candidate.wins)} styles={styles} M={M} />
              <Stat label="Lost" value={String(candidate.losses)} styles={styles} M={M} />
              {/* Ties only when there are any — most sports never draw. */}
              {candidate.ties > 0 ? (
                <Stat label="Tied" value={String(candidate.ties)} styles={styles} M={M} />
              ) : null}
              <Stat
                label="Win rate"
                value={`${candidate.win_rate}%`}
                styles={styles}
                M={M}
              />
            </View>
          )}

          <Pressable
            onPress={onClose}
            style={[styles.btn, styles.btnPrimary, styles.sheetCta]}
            accessibilityRole="button"
          >
            <AppText variant="label" color={M.limeInk}>
              Close
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

export default function OffersScreen(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();
  const { challengeId: rawId } = useLocalSearchParams<{ challengeId?: string }>();
  const challengeId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;

  // Both queries are declared unconditionally — hooks cannot sit behind the
  // mode check — and each is disabled in the mode it does not serve.
  const offers = useMyOffers();
  // The poster's own candidate list keeps polling here for the same reason it
  // does on the radar: a team can accept while this screen is open.
  const candidates = useChallengeCandidatesFull(challengeId);
  // total_slots is the only place the fixture's format lives.
  const challenge = useChallenge(challengeId);
  const myUserId = useAuthStore((st) => st.profile?.id ?? null);
  const myTeams = useMyTeamsOverview();
  const accept = useAcceptOpenChallenge();
  const applyToChallenge = useApplyToChallenge();
  const decline = useDeclineOpenChallenge();
  const [pendingId, setPendingId] = useState<string | null>(null);
  /**
   * Which candidate button is spinning. Both Accept and Reject are disabled
   * whenever either mutation is in flight, so a double tap cannot fire twice;
   * this only decides where the spinner is drawn.
   */
  const [candidateAction, setCandidateAction] = useState<{
    id: string;
    kind: 'accept' | 'reject';
  } | null>(null);
  /** The row the detail sheet is showing. Held, not fetched. */
  const [detail, setDetail] = useState<ChallengeCandidateFull | null>(null);
  /** The candidate being accepted, held until its captain has named a squad. */
  const [pendingAccept, setPendingAccept] = useState<ChallengeCandidateFull | null>(null);

  const outgoing = challengeId !== null;
  const candidateBusy = accept.isPending || decline.isPending || applyToChallenge.isPending;

  /** My teams by id, so an incoming card can show that squad's real record. */
  const myTeamById = useMemo(() => {
    const map = new Map<string, TeamOverviewRow>();
    for (const team of myTeams.data ?? []) map.set(team.id, team);
    return map;
  }, [myTeams.data]);

  /*
    WHOSE squad the picker names — mirrors accept_open_challenge exactly.

    On this list the caller is the poster, so the RPC seats the lineup against
    `from_team_id`, their OWN team — not the applicant, whose roster the host
    cannot even read (team_members is members-only, so the picker would render
    an empty list they could never satisfy).

    The one exception is the applicant being a second squad the caller owns:
    there the RPC's applicant-owner branch wins, and so does this. Getting the
    two out of step is how a captain picks one roster and the server seats
    another.
  */
  const lineupTeam = useMemo(() => {
    if (!pendingAccept) return null;
    const mine = myTeamById.get(pendingAccept.team_id);
    if (mine?.i_am_owner) return { id: mine.id, name: mine.name };
    const hostTeamId = challenge.data?.from_team_id ?? null;
    const host = hostTeamId ? myTeamById.get(hostTeamId) : null;
    return host ? { id: host.id, name: host.name } : null;
  }, [pendingAccept, myTeamById, challenge.data?.from_team_id]);

  /**
   * Filter out any teams the user owns or belongs to from candidate offers.
   *
   * `myTeamById` is the whole test: it is built from `get_my_teams_overview`,
   * which returns every team the user belongs to, owned or not. The
   * `!item.i_own_team` clause that used to sit beside it was both redundant and
   * inert — see renderCandidate.
   */
  const filteredCandidates = useMemo(() => {
    return (candidates.data ?? []).filter((item) => !myTeamById.has(item.team_id));
  }, [candidates.data, myTeamById]);

  /** Deduplicate incoming offers by challenge_id so the user sees at most ONE card per fixture. */
  const dedupedIncomingOffers = useMemo(() => {
    const raw = offers.data ?? [];
    const map = new Map<string, OpenOffer>();
    for (const item of raw) {
      if (!item.challenge_id) continue;
      if (!item.challenge || item.challenge.status !== 'open') continue;
      const existing = map.get(item.challenge_id);
      if (!existing) {
        map.set(item.challenge_id, item);
      } else if (existing.status !== 'interested' && item.status === 'interested') {
        map.set(item.challenge_id, item);
      }
    }
    return Array.from(map.values());
  }, [offers.data]);

  const onSendRequest = useCallback(
    (offer: OpenOffer) => {
      if (!offer.challenge) return;

      /*
        Last client-side gate before apply_to_open_challenge.

        The RPC and the challenge_candidates trigger both refuse a cross-format
        request, so this changes no outcome — it changes the message. "Teams can
        only play the same format" is actionable; a generic failure alert after a
        round trip is not. The offer row itself carries the fixture's format, and
        the team's comes from the same read model the card renders.
      */
      const fixtureFormat = Math.max(Math.floor(offer.challenge.total_slots / 2), 1);
      const myTeam = myTeamById.get(offer.team_id);
      if (myTeam && myTeam.target_size !== fixtureFormat) {
        Alert.alert(
          `${fixtureFormat} v ${fixtureFormat} only`,
          `This fixture is ${fixtureFormat} v ${fixtureFormat}. ${myTeam.name} plays ${
            myTeam.target_size !== null
              ? `${myTeam.target_size} v ${myTeam.target_size}`
              : 'no declared format'
          }, and teams can only play others of the same format.`,
        );
        return;
      }

      setPendingId(offer.id);
      applyToChallenge.mutate(
        { challengeId: offer.challenge_id, teamId: offer.team_id },
        {
          onSuccess: () => {
            setPendingId(null);
            Alert.alert(
              'Request Sent! ⚡',
              'Your game request was sent! The opponent team captain has been notified to accept.',
            );
            void offers.refetch();
          },
          onError: (error: unknown) => {
            setPendingId(null);
            const message =
              error instanceof AppError ? error.message : 'Could not send the game request.';
            Alert.alert('Game Request', message);
            void offers.refetch();
          },
        },
      );
    },
    [applyToChallenge, offers, myTeamById],
  );

  /**
   * Accept an applicant. `accept_open_challenge` checks the accepting team's
   * owner, and NOT_TEAM_OWNER comes back as readable copy from the repository
   * if the row the list rendered is stale.
   */
  // Step one: name the squad. `accept_open_challenge` confirms the fixture and
  // seats the lineup in one transaction, so both answers are collected first.
  const onAcceptCandidate = useCallback((item: ChallengeCandidateFull) => {
    setPendingAccept(item);
  }, []);

  const onConfirmLineup = useCallback(
    (userIds: string[]) => {
      const item = pendingAccept;
      if (challengeId === null || !item) return;
      setCandidateAction({ id: item.candidate_id, kind: 'accept' });
      accept.mutate(
        { challengeId, teamId: item.team_id, lineup: userIds },
        {
          onSuccess: (challenge) => {
            setCandidateAction(null);
            setPendingAccept(null);
            // The RPC calls finalise_challenge, so the row comes back with the
            // new match. Replace rather than push: going "back" to a candidate
            // list that is now settled is a dead end.
            if (challenge.match_id) router.replace(`/match/${challenge.match_id}`);
            else router.replace('/(tabs)/matches');
          },
          onError: (error: unknown) => {
            setCandidateAction(null);
            Alert.alert(
              'Fixture',
              error instanceof AppError ? error.message : 'Could not accept the fixture.',
            );
            // Lost the race or hit a rule — the list is stale either way.
            void candidates.refetch();
          },
        },
      );
    },
    [accept, candidates, challengeId, router, pendingAccept],
  );

  const onRejectCandidate = useCallback(
    (item: ChallengeCandidateFull) => {
      if (challengeId === null) return;
      Alert.alert(
        'Reject this offer?',
        `${item.team_name} will no longer be able to take this fixture.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reject',
            style: 'destructive',
            onPress: () => {
              setCandidateAction({ id: item.candidate_id, kind: 'reject' });
              decline.mutate(
                { challengeId, teamId: item.team_id },
                {
                  onSuccess: () => {
                    setCandidateAction(null);
                    void candidates.refetch();
                  },
                  onError: (error: unknown) => {
                    setCandidateAction(null);
                    Alert.alert(
                      'Fixture',
                      error instanceof AppError
                        ? error.message
                        : 'Could not reject this offer.',
                    );
                    void candidates.refetch();
                  },
                },
              );
            },
          },
        ],
      );
    },
    [candidates, challengeId, decline],
  );

  const closeDetail = useCallback(() => setDetail(null), []);

  const renderIncoming = useCallback(
    ({ item }: { item: OpenOffer }) => {
      if (!item.challenge || item.challenge.status !== 'open') return null;
      const busy = pendingId === item.id;
      const team = myTeamById.get(item.team_id);
      const isInterested = item.status === 'interested';

      return (
        <View style={styles.card}>
          <AppText variant="label" color={M.text}>
            {item.challenge.match_name}
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {formatWhen(item.challenge.scheduled_at)}
          </AppText>
          {/* The format, not the sheet total. It is the field that decides
              whether this offer is even legal for the squad below, so it reads
              as "4 v 4" rather than "8 players". */}
          <AppText variant="caption" color={M.muted}>
            {`${formatDistance(item.distance_m)} · ${Math.max(Math.floor(item.challenge.total_slots / 2), 1)} v ${Math.max(Math.floor(item.challenge.total_slots / 2), 1)}`}
          </AppText>

          {team ? (
            <TeamBlock
              name={team.name}
              logoUrl={team.logo_url}
              playerCount={team.player_count}
              matchesPlayed={team.matches_played}
              wins={team.wins}
              winRate={team.win_rate}
              styles={styles}
              M={M}
            />
          ) : (
            // The overview call is the only source for squad size and record.
            // While it is in flight, say so rather than printing zeroes.
            <View style={styles.teamRow}>
              {myTeams.isLoading ? <ActivityIndicator color={M.green} /> : null}
              <AppText variant="caption" color={M.muted}>
                {myTeams.isError
                  ? 'Could not load your squad’s details.'
                  : myTeams.isLoading
                    ? 'Loading your squad…'
                    : `Offered to ${item.team?.name ?? 'your team'}`}
              </AppText>
            </View>
          )}

          {item.challenge.message ? (
            <AppText variant="body" color={M.text} style={styles.message}>
              {item.challenge.message}
            </AppText>
          ) : null}

          {isInterested ? (
            <View style={{ paddingVertical: 4 }}>
              <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
                ⚡ Game Request Sent · Waiting for opponent captain to accept
              </AppText>
            </View>
          ) : null}

          <View style={styles.ctaRow}>
            <Pressable
              onPress={() => {
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    // No `teamName`: this side only knows the GAME's name, and
                    // a game is not who you are talking to. The chat screen
                    // names the other captain itself.
                    id: item.challenge_id,
                    challengeId: item.challenge_id,
                  },
                });
              }}
              style={[styles.btn, styles.btnGhost]}
              accessibilityRole="button"
            >
              <AppText variant="label" color={M.green}>
                💬 Chat
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                const targetTeamId = item.challenge?.from_team_id || item.team_id;
                router.push(`/teams/${targetTeamId}`);
              }}
              style={[styles.btn, styles.btnGhost]}
              accessibilityRole="button"
            >
              <AppText variant="label" color={M.green}>
                Details
              </AppText>
            </Pressable>
            {!isInterested ? (
              <Pressable
                onPress={() => onSendRequest(item)}
                disabled={applyToChallenge.isPending || busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: applyToChallenge.isPending || busy, busy }}
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  { opacity: applyToChallenge.isPending || busy ? 0.45 : 1 },
                ]}
              >
                {busy ? <ActivityIndicator color={M.limeInk} /> : null}
                <AppText variant="label" color={M.limeInk}>
                  Send Request
                </AppText>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            disabled={busy || decline.isPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || decline.isPending }}
            style={[styles.declineBtn, { opacity: busy || decline.isPending ? 0.45 : 1 }]}
            onPress={() =>
              Alert.alert(
                isInterested ? 'Withdraw request?' : 'Decline offer?',
                isInterested
                  ? 'Your game request will be cancelled.'
                  : 'This offer will no longer be available to your team.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: isInterested ? 'Withdraw' : 'Decline',
                    style: 'destructive',
                    onPress: () =>
                      decline.mutate(
                        { challengeId: item.challenge_id, teamId: item.team_id },
                        {
                          onSuccess: () => {
                            void offers.refetch();
                          },
                        },
                      ),
                  },
                ],
              )
            }
          >
            <AppText variant="caption" color={M.danger}>
              {isInterested ? 'Withdraw Request' : 'Decline'}
            </AppText>
          </Pressable>
        </View>
      );
    },
    [
      M,
      applyToChallenge.isPending,
      decline,
      myTeamById,
      myTeams.isError,
      myTeams.isLoading,
      offers,
      onSendRequest,
      pendingId,
      router,
      styles,
    ],
  );

  const renderCandidate = useCallback(
    ({ item }: { item: ChallengeCandidateFull }) => {
      /*
        The host can accept any interested applicant.

        There used to be a second clause here — `item.i_own_team && status ===
        'offered'` — for taking a fixture the radar offered to another squad you
        own. It was dead twice over: `get_challenge_candidates` stopped
        returning `i_own_team` in August, AND `rank_challenge_candidates`
        excludes teams the poster owns, so such a row cannot exist. Removed
        rather than repaired.

        Accepting with a second squad you own is still possible — it just
        arrives as 'interested', through apply_to_open_challenge, and is covered
        by the clause below.
      */
      const canAct = outgoing && item.status === 'interested';
      const accepting =
        candidateAction?.id === item.candidate_id && candidateAction.kind === 'accept';
      const rejecting =
        candidateAction?.id === item.candidate_id && candidateAction.kind === 'reject';

      return (
        <View style={styles.card}>
          <TeamBlock
            name={item.team_name}
            logoUrl={item.logo_url}
            playerCount={item.player_count}
            matchesPlayed={item.matches_played}
            wins={item.wins}
            winRate={item.win_rate}
            styles={styles}
            M={M}
          />
          <AppText variant="caption" color={item.status === 'interested' ? M.green : M.muted}>
            {formatDistance(item.distance_m)} ·{' '}
            {CANDIDATE_STATUS_LABEL[item.status] ?? item.status}
          </AppText>

          <View style={styles.ctaRow}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: challengeId ?? '',
                    challengeId: challengeId ?? '',
                    toTeamId: item.team_id,
                    teamName: item.team_name,
                  },
                })
              }
              style={[styles.btn, styles.btnGhost]}
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${item.team_name} captain`}
            >
              <AppText variant="label" color={M.green}>
                💬 Chat
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => router.push(`/teams/${item.team_id}`)}
              style={[styles.btn, styles.btnGhost]}
              accessibilityRole="button"
              accessibilityLabel={`View team profile for ${item.team_name}`}
            >
              <AppText variant="label" color={M.green}>
                View Team
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => setDetail(item)}
              style={[styles.btn, styles.btnGhost]}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${item.team_name}`}
            >
              <AppText variant="label" color={M.muted}>
                Details
              </AppText>
            </Pressable>
          </View>

          {canAct ? (
            <View style={styles.ctaRow}>
              <PressableScale
                onPress={() => onAcceptCandidate(item)}
                disabled={candidateBusy}
                accessibilityRole="button"
                accessibilityState={{ disabled: candidateBusy, busy: accepting }}
                style={[styles.btn, styles.btnPrimary, { opacity: candidateBusy ? 0.45 : 1 }]}
              >
                {accepting ? <ActivityIndicator color={M.limeInk} /> : null}
                <AppText variant="label" color={M.limeInk}>
                  {outgoing ? '✓ Accept Request' : 'Accept Offer'}
                </AppText>
              </PressableScale>
              <Pressable
                onPress={() => onRejectCandidate(item)}
                disabled={candidateBusy}
                accessibilityRole="button"
                accessibilityState={{ disabled: candidateBusy, busy: rejecting }}
                style={[styles.btn, styles.btnDanger, { opacity: candidateBusy ? 0.45 : 1 }]}
              >
                {rejecting ? <ActivityIndicator color={M.danger} /> : null}
                <AppText variant="label" color={M.danger}>
                  Decline
                </AppText>
              </Pressable>
            </View>
          ) : item.status === 'offered' ? (
            <AppText variant="caption" color={M.faint}>
              Scanned on Radar · Waiting for opponent team to challenge.
            </AppText>
          ) : null}
        </View>
      );
    },
    [M, candidateAction, candidateBusy, onAcceptCandidate, onRejectCandidate, outgoing, styles],
  );

  // Split rather than a union of the two query objects: they resolve to
  // different row types, and only these three facts are shared.
  const isLoading = outgoing ? candidates.isLoading : offers.isLoading;
  const isError = outgoing ? candidates.isError : offers.isError;
  const onRetry = useCallback(() => {
    if (outgoing) void candidates.refetch();
    else void offers.refetch();
  }, [candidates, offers, outgoing]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Game offers' }} />

      {isLoading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={M.green} />
        </View>
      ) : isError ? (
        <View style={styles.centre}>
          <AppText variant="body" color={M.danger} center>
            {outgoing ? 'Could not load the teams this fixture reached.' : 'Could not load offers.'}
          </AppText>
          <Pressable onPress={onRetry} style={styles.secondaryBtn} accessibilityRole="button">
            <AppText variant="label" color={M.green}>
              Try again
            </AppText>
          </Pressable>
        </View>
      ) : outgoing ? (
        <FlatList
          data={filteredCandidates}
          keyExtractor={(item) => item.candidate_id}
          renderItem={renderCandidate}
          refreshing={candidates.isRefetching}
          onRefresh={() => void candidates.refetch()}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={{ gap: S.sm, marginBottom: S.xs }}>
              <Pressable
                onPress={() => {
                  if (challengeId) {
                    router.replace({
                      pathname: '/match/create/searching',
                      params: { challengeId },
                    });
                  }
                }}
                style={styles.radarButton}
                accessibilityRole="button"
                accessibilityLabel="Switch to Live Radar View"
              >
                <View style={styles.radarPill}>
                  <View style={styles.radarDot} />
                  <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 10 }}>
                    LIVE RADAR
                  </AppText>
                </View>
                <AppText variant="label" color={M.text} style={{ flex: 1, fontSize: 14 }}>
                  Switch to Radar Dish View
                </AppText>
                <AppText color={M.green}>›</AppText>
              </Pressable>
              <AppText variant="caption" color={M.muted}>
                Teams your fixture was offered to. The first to accept gets the game.
              </AppText>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centre}>
              <AppText variant="label" color={M.text} center>
                No teams reached yet
              </AppText>
              <AppText variant="caption" color={M.muted} center>
                Nobody nearby matched this fixture. Withdraw it and post again with a
                wider search radius.
              </AppText>
            </View>
          }
        />
      ) : (
        <FlatList
          data={dedupedIncomingOffers}
          keyExtractor={(item) => item.challenge_id}
          renderItem={renderIncoming}
          refreshing={offers.isRefetching}
          onRefresh={() => void offers.refetch()}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centre}>
              <AppText variant="label" color={M.text} center>
                No offers right now
              </AppText>
              <AppText variant="caption" color={M.muted} center>
                When a nearby team posts a fixture that fits your squad, it appears here.
              </AppText>
            </View>
          }
        />
      )}

      {/* Pure projection of the row already in memory — no query is issued. */}
      <CandidateSheet candidate={detail} onClose={closeDetail} styles={styles} M={M} />

      {/*
        Naming the squad of the team being accepted.

        This list is the poster's, so the caller is usually the host and
        `accept_open_challenge` seats the lineup against `from_team_id`. When
        the applicant is a second squad the caller also owns, the RPC's
        applicant-owner branch wins and seats it against that team instead —
        which is the team this picker was opened for either way.
      */}
      {pendingAccept && myUserId && lineupTeam ? (
        <LineupPickerSheet
          visible
          onClose={() => setPendingAccept(null)}
          teamId={lineupTeam.id}
          teamName={lineupTeam.name}
          captainId={myUserId}
          format={Math.max(Math.floor((challenge.data?.total_slots ?? 0) / 2), 1)}
          busy={accept.isPending}
          confirmLabel="Confirm fixture"
          onConfirm={onConfirmLineup}
        />
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    list: { padding: S.md, gap: S.md },
    centre: { padding: S.xl, alignItems: 'center', gap: S.sm },
    card: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.md,
      gap: S.xs,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      marginTop: S.sm,
      paddingTop: S.sm,
      borderTopWidth: 1,
      borderTopColor: M.border,
    },
    teamText: { flex: 1, gap: 2 },
    playersRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
    badge: { width: 44, height: 44, borderRadius: R.pill, backgroundColor: M.chip },
    badgeFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: M.lime },
    message: { marginTop: S.xs },
    ctaRow: { flexDirection: 'row', gap: S.sm, marginTop: S.sm },
    btn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.xs,
      minHeight: TOUCH,
      borderRadius: R.pill,
      paddingHorizontal: S.md,
    },
    btnGhost: { borderWidth: 1.5, borderColor: M.green },
    btnPrimary: { backgroundColor: M.green },
    btnDanger: { borderWidth: 1.5, borderColor: M.danger },
    sheetBackdrop: { flex: 1, backgroundColor: M.overlay },
    sheet: {
      backgroundColor: M.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: S.lg,
      borderTopWidth: 1,
      borderColor: M.border,
      gap: S.sm,
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetClose: {
      width: TOUCH,
      height: TOUCH,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    sheetTeam: { flexDirection: 'row', alignItems: 'center', gap: S.md },
    sheetBadge: { width: 64, height: 64, borderRadius: R.pill, backgroundColor: M.chip },
    sheetEmpty: { marginTop: S.sm },
    statRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: S.sm,
      paddingTop: S.md,
      borderTopWidth: 1,
      borderTopColor: M.border,
    },
    stat: { flexGrow: 1, flexBasis: 72, alignItems: 'center', gap: 2 },
    sheetCta: { marginTop: S.md },
    declineBtn: {
      minHeight: TOUCH,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: S.xs,
    },
    secondaryBtn: {
      minHeight: TOUCH,
      paddingHorizontal: S.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
    },
    radarButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      padding: S.md,
      borderRadius: R.lg,
      borderWidth: 1.5,
      borderColor: M.green,
      backgroundColor: M.card,
    },
    radarPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: R.pill,
      backgroundColor: M.green,
    },
    radarDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: M.limeInk,
    },
  });
