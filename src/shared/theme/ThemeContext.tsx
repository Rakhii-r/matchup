import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { darkColors, lightColors, type AppColors, type ColorScheme } from '@shared/theme';

const STORAGE_KEY = 'matchup:color_scheme_override';

interface ThemeContextValue {
  colors: AppColors;
  scheme: ColorScheme;
  isDark: boolean;
  /** Pass null to revert to system preference. */
  setScheme: (override: ColorScheme | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const rawSystem = useColorScheme();
  const systemScheme: ColorScheme = rawSystem === 'dark' ? 'dark' : 'light';
  const [override, setOverride] = useState<ColorScheme | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') {
          setOverride(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, []);

  const setScheme = useCallback((next: ColorScheme | null) => {
    setOverride(next);
    if (next === null) {
      SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => undefined);
    } else {
      SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => undefined);
    }
  }, []);

  // The app is a dark-only P24 design, so default to dark regardless of the device
  // setting; a manual override (if ever exposed) still wins. systemScheme is retained
  // for that future toggle.
  void systemScheme;
  const scheme: ColorScheme = override ?? 'dark';
  const isDark = scheme === 'dark';
  const resolvedColors: AppColors = isDark ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: resolvedColors, scheme, isDark, setScheme }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDark, scheme, setScheme],
  );

  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
