import { Tabs } from 'expo-router';

import { M } from '@shared/theme/mockTheme';
import { IconBolt, IconDirections, IconPin, IconUser } from '@shared/ui/icons';

export default function TabsLayout(): React.ReactNode {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: M.green,
        tabBarInactiveTintColor: M.muted,
        tabBarStyle: {
          backgroundColor: M.card,
          borderTopColor: M.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Nearby',
          tabBarIcon: ({ color }) => <IconPin color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="available"
        options={{
          title: 'Available',
          tabBarIcon: ({ color }) => <IconBolt color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="venues"
        options={{
          title: 'Venues',
          tabBarIcon: ({ color }) => <IconDirections color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconUser color={color as string} size={22} />,        }}
      />
    </Tabs>
  );
}
