import type { ReactNode } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
}

/** Standard screen wrapper: safe-area aware, consistent padding and background. */
export function Screen({ children, scroll = false }: ScreenProps): ReactNode {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'left', 'right']}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: spacing.lg }}>{children}</View>
      )}
    </SafeAreaView>
  );
}
