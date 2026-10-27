import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Pull-to-refresh for a screen that does not know (or should not have to
 * list) every query it renders: refetches every query currently on screen.
 * `refreshing` tracks this pull only, so a background refetch elsewhere does
 * not leave the spinner hanging.
 */
export function useRefreshAll(): { refreshing: boolean; onRefresh: () => void } {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback((): void => {
    setRefreshing(true);
    void queryClient
      .refetchQueries({ type: 'active' })
      .finally(() => setRefreshing(false));
  }, [queryClient]);

  return { refreshing, onRefresh };
}
