import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminRepository } from '@features/admin/data/adminRepository';
import type { ReportStatus } from '@shared/types/database.types';

const reportsKey = (status: ReportStatus | 'all') => ['admin', 'reports', status] as const;

/** Query the report queue for a given status. */
export function useReports(status: ReportStatus | 'all' = 'open') {
  return useQuery({
    queryKey: reportsKey(status),
    queryFn: () => adminRepository.listReports(status),
  });
}

/** All users, for the admin users list. Superadmin-only via RLS. */
export function useUsers() {
  return useQuery({
    queryKey: ['admin', 'users'] as const,
    queryFn: () => adminRepository.listUsers(),
  });
}

/**
 * Moderation actions. Each mutation invalidates the reports queue so the UI reflects
 * the new state after a successful, RLS-authorised write.
 */
export function useModeration() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] });

  const resolveReport = useMutation({
    mutationFn: ({ reportId, status }: { reportId: string; status: ReportStatus }) =>
      adminRepository.updateReportStatus(reportId, status),
    onSuccess: invalidate,
  });

  const deactivateUser = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminRepository.setUserActive(userId, isActive),
    onSuccess: invalidate,
  });

  return { resolveReport, deactivateUser };
}
