import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@shared/theme';

/**
 * Entry splash. The route guard in _layout redirects to the right destination once the
 * auth status resolves; until then we show a neutral loading state.
 */
export default function Index(): React.ReactNode {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
