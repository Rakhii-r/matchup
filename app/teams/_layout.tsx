import { Stack } from 'expo-router';

import { useTheme } from '@shared/theme/ThemeContext';

export default function TeamsLayout(): React.ReactNode {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    />
  );
}
