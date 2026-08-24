import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCallback } from 'react';

import { sportLabel, sportsRepository } from '@features/sports/data/sportsRepository';
import type { Sport } from '@shared/types/database.types';

const activeKey = ['sports', 'active'] as const;
const allKey = ['sports', 'all'] as const;

/** Sports a normal user may pick. Drives Home, Create Match and profile prefs. */
export function useActiveSports() {
  return useQuery({
    queryKey: activeKey,
    queryFn: () => sportsRepository.listActive(),
    staleTime: 60_000,
  });
}

/** Every sport, hidden ones included. Superadmin only — RLS enforces it. */
export function useAllSports() {
  return useQuery({
    queryKey: allKey,
    queryFn: () => sportsRepository.listAll(),
    staleTime: 60_000,
  });
}

export function useSetSportActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      sportsRepository.setActive(id, isActive),
    // Invalidate by the ['sports'] prefix so hiding a sport in admin also drops
    // it from every normal-user surface, not just the admin list.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sports'] }),
  });
}

export function useRenameSport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      sportsRepository.rename(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sports'] }),
  });
}

/**
 * The single accessor for sport display names.
 *
 * Before this existed the repo held five separate hard-coded label maps and two
 * of them disagreed with the database — the same sport rendered as
 * "Box Cricket", "Cricket" and "CRICKET" on different tabs, and renaming a
 * sport in Sports Management changed only some of them. Nothing should define
 * its own map again; call this and uppercase at the call site if a screen wants
 * shouting.
 */
export function useSportLabel(): (sport: Sport) => string {
  const { data } = useActiveSports();
  return useCallback((sport: Sport) => sportLabel(data, sport), [data]);
}
