import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@core/api/queryClient';
import { AuthProvider } from '@core/auth/AuthProvider';
import { PushRegistrar } from '@core/notifications/PushRegistrar';
import { ThemeProvider } from '@shared/theme/ThemeContext';
import { MatchJoinAlerts } from '@features/matches/presentation/MatchJoinAlerts';

/** Composition root for app-wide providers. Wraps the router in _layout.tsx. */
export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <MatchJoinAlerts />
              <PushRegistrar />
              {children}
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
