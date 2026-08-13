import { Stack } from 'expo-router';

import { colors } from '@shared/theme';

export default function TeamsLayout(): React.ReactNode {
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
