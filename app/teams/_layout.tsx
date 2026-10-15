import { Stack } from 'expo-router';

import { useMock } from '@shared/theme/mockTheme';
import { RoundBack, useGoBack } from '@shared/ui/decor';

/**
 * One header for the whole teams group: the round mint back button and a bold
 * left-aligned title. Styled here rather than per screen so every `/teams/*`
 * route gets it, including the ones that only set a `title`.
 */
export default function TeamsLayout(): React.ReactNode {
  const M = useMock();
  // A deep link can open any of these with nothing behind it.
  const goBack = useGoBack('/(tabs)/teams');

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: M.bg },
        headerTintColor: M.text,
        headerShadowVisible: false,
        headerBackVisible: false,
        headerTitleAlign: 'left',
        headerTitleStyle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, color: M.text },
        headerLeft: () => <RoundBack onPress={goBack} style={{ marginRight: 12 }} />,
      }}
    />
  );
}
