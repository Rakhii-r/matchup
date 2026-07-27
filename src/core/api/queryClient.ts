import { QueryClient } from '@tanstack/react-query';

import { AppError } from '@core/errors/AppError';

/**
 * Shared TanStack Query client. Server state (matches, players, profiles) lives here.
 * Retries use exponential backoff but never retry on auth/permission failures.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (error instanceof AppError) {
          if (['unauthorized', 'forbidden', 'not_found', 'validation'].includes(error.code)) {
            return false;
          }
        }
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});
