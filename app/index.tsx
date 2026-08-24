import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';

/**
 * Entry splash. The route guard in _layout redirects to the right destination once the
 * auth status resolves; until then we show a neutral loading state.
 */
export default function Index(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  });
