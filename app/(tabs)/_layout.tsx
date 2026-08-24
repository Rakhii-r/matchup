/**
 * Bottom navigation: Home · Matches · Venues · Teams · Profile.
 *
 * Venues was previously a route with no way to reach it — hidden from the bar
 * and not pushed from anywhere. It is now a first-class tab.
 *
 * Activity leaves the bar and lives behind Home's notification bell, which is
 * where the reference design puts it. The route is untouched, so every push
 * notification `route` payload that points at it still resolves.
 *
 * Available keeps its route but stays out of the bar: five tabs is the
 * practical limit on a phone, and it is reachable from Home's quick actions.
 * Deleting the file would remove a working screen, which is not the same thing
 * as removing a tab.
 *
 * Colours come from useMock() so the bar follows the theme toggle.
 */
import { Tabs } from 'expo-router';

import { useMock } from '@shared/theme/mockTheme';
import { IconBolt, IconBell, IconHome, IconPin, IconUser, IconUsers } from '@shared/ui/icons';

export default function TabsLayout(): React.ReactNode {
  const M = useMock();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: M.green,
        tabBarInactiveTintColor: M.faint,
        tabBarStyle: {
          backgroundColor: M.card,
          borderTopColor: M.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconHome color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarIcon: ({ color }) => <IconBolt color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="venues"
        options={{
          title: 'Venues',
          tabBarIcon: ({ color }) => <IconPin color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          tabBarIcon: ({ color }) => <IconUsers color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconUser color={color as string} size={22} />,
        }}
      />

      {/* Routable, not in the bar. Activity is reached from Home's bell. */}
      <Tabs.Screen
        name="activity"
        options={{
          href: null,
          title: 'Activity',
          tabBarIcon: ({ color }) => <IconBell color={color as string} size={22} />,
        }}
      />
      <Tabs.Screen name="available" options={{ href: null, title: 'Available' }} />
    </Tabs>
  );
}
