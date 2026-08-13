import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import { teamRepository } from '@features/teams/data/teamRepository';
import type { CreateTeamForm, Team } from '@features/teams/domain/teamSchema';

const teamsKey = (userId: string | undefined) => ['teams', 'mine', userId ?? 'anon'] as const;
const teamKey = (teamId: string) => ['team', teamId] as const;
const membersKey = (teamId: string) => ['team', teamId, 'members'] as const;

export function useMyTeams() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: teamsKey(userId),
    queryFn: () => teamRepository.listMine(),
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
