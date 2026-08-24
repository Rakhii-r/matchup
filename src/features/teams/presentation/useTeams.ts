import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { teamRepository } from '@features/teams/data/teamRepository';
import type { CreateTeamForm, Team } from '@features/teams/domain/teamSchema';

const teamsKey = (userId: string | undefined) => ['teams', 'mine', userId ?? 'anon'] as const;
const teamKey = (teamId: string) => ['team', teamId] as const;
const membersKey = (teamId: string) => ['team', teamId, 'members'] as const;
const overviewKey = (teamId: string) => ['team', teamId, 'overview'] as const;
const statsKey = (teamId: string) => ['team', teamId, 'stats'] as const;
const fixturesKey = (teamId: string) => ['team', teamId, 'fixtures'] as const;

export function useTeamOverview(teamId: string) { return useQuery({ queryKey: overviewKey(teamId), queryFn: () => teamRepository.getOverview(teamId), enabled: Boolean(teamId) }); }
export function useTeamStats(teamId: string) { return useQuery({ queryKey: statsKey(teamId), queryFn: () => teamRepository.getStats(teamId), enabled: Boolean(teamId) }); }
export function useTeamFixtures(teamId: string) { return useQuery({ queryKey: fixturesKey(teamId), queryFn: () => teamRepository.getFixtures(teamId), enabled: Boolean(teamId) }); }

export function useMyTeams() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: teamsKey(userId),
    queryFn: () => teamRepository.listMine(),
    enabled: Boolean(userId),
  });
}

/**
 * The Teams tab list. One RPC returns every team with its roster size and
 * results already aggregated, so the cost is flat in the number of teams —
 * rendering a card per team and letting each card fetch its own overview and
 * stats cost 1 + 2N round trips instead.
 *
 * Sits under the same `['teams', 'mine', userId]` key as useMyTeams so that
 * every existing invalidation after create / join / leave / rename refreshes
 * it too, with no extra bookkeeping.
 */
export function useMyTeamsOverview() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: [...teamsKey(userId), 'overview'] as const,
    queryFn: () => teamRepository.listMineOverview(),
    enabled: Boolean(userId),
  });
}

export function useTeam(teamId: string) {
  return useQuery({
    queryKey: teamKey(teamId),
    queryFn: () => teamRepository.getById(teamId),
    enabled: teamId.length > 0,
  });
}

export function useTeamMembers(teamId: string) {
  return useQuery({
    queryKey: membersKey(teamId),
    queryFn: () => teamRepository.listMembers(teamId),
    enabled: teamId.length > 0,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (form: CreateTeamForm): Promise<Team> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      return teamRepository.create({ name: form.name, sport: form.sport, ownerId: userId });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKey(userId) });
    },
  });
}

export function useUploadTeamLogo(teamId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (base64: string) => teamRepository.uploadLogo(teamId, base64), onSuccess: () => { void qc.invalidateQueries({ queryKey: teamKey(teamId) }); void qc.invalidateQueries({ queryKey: overviewKey(teamId) }); } });
}

export function useJoinTeamByCode() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (code: string): Promise<Team> => {
      if (!userId) throw new AppError('unauthorized', 'Please sign in again.');
      // Eligibility is enforced inside join_team under a row lock; re-checking
      // here would only duplicate it against a possibly stale client view.
      return teamRepository.joinByCode(code);
    },
    onSuccess: (team) => {
      void qc.invalidateQueries({ queryKey: teamsKey(userId) });
      void qc.invalidateQueries({ queryKey: membersKey(team.id) });
    },
  });
}

/** Owner removing someone, or a member leaving. Same endpoint, RLS decides. */
export function useTeamMemberActions(teamId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (memberId: string) => teamRepository.removeMember(memberId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKey(teamId) });
      void qc.invalidateQueries({ queryKey: teamsKey(userId) });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: (teamId: string) => teamRepository.remove(teamId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKey(userId) });
    },
  });
}

/**
 * Invalidates by prefix. `teamKey(teamId)` is `['team', id]`, which already
 * covers the overview, stats, fixtures and members keys built on top of it, and
 * `['teams']` covers `teamsKey(userId)` for every signed-in id — the previous
 * `teamsKey(undefined)` resolved to `['teams','mine','anon']` and matched no
 * live query, so a renamed team stayed stale in the Teams tab.
 */
export function useUpdateTeam(teamId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { name: string; description: string; homeGround: string }) => teamRepository.update(teamId, input), onSuccess: () => { void qc.invalidateQueries({ queryKey: teamKey(teamId) }); void qc.invalidateQueries({ queryKey: ['teams'] }); } });
}

export function useSetMemberRole(teamId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { userId: string; role: 'member' | 'vice_captain' }) => teamRepository.setMemberRole(teamId, input.userId, input.role), onSuccess: () => void qc.invalidateQueries({ queryKey: teamKey(teamId) }) });
}
