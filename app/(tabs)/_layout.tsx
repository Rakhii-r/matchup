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
 *
 * The bar floats: a rounded card inset from the edges, with a short underline
 * under the active label.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
import { useMock, type MockPalette } from '@shared/theme/mockTheme';
import { TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@shared/theme/responsive';
import { IconBolt, IconBell, IconHome, IconPin, IconUser, IconUsers } from '@shared/ui/icons';

/** Label with the short underline that marks the active tab. */
function TabLabel({
  label,
  focused,
  color,
  styles,
}: {
  label: string;
  focused: boolean;
  color: ColorValue;
  styles: ReturnType<typeof makeStyles>;
}): React.ReactNode {
  return (
    <View style={styles.labelWrap}>
      <Text allowFontScaling={false} style={[styles.label, { color }, focused && styles.labelOn]}>
        {label}
      </Text>
      <View style={[styles.underline, focused && styles.underlineOn]} />
    </View>
  );
}

export default function TabsLayout(): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const insets = useSafeAreaInsets();
  // Same cached query the Teams tab reads, so this costs no extra round trip.
  const teamCount = (useMyTeamsOverview().data ?? []).length;

  /*
    A FLOATING BAR, LIFTED CLEAR OF WHATEVER THE SYSTEM OWNS BELOW IT.

    The bar is a rounded card inset from the screen edges. It is positioned
    absolutely, which means React Navigation no longer reserves space for it:
    every tab screen pads its own scroll content with `useTabContentPadding()`,
    which is derived from the same TAB_BAR_HEIGHT / TAB_BAR_GAP used here, so the
    bar and the space reserved for it cannot drift apart.

    `bottom` carries the measured inset (iPhone home indicator, Android gesture
    navigation). With hardware keys the inset is 0 and the bar simply sits
    TAB_BAR_GAP above the edge.
  */
  const label = (text: string) =>
    function TabBarLabel({ focused, color }: { focused: boolean; color: ColorValue }) {
      return <TabLabel label={text} focused={focused} color={color} styles={styles} />;
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: M.green,
        tabBarInactiveTintColor: M.faint,
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: insets.bottom + TAB_BAR_GAP,
          height: TAB_BAR_HEIGHT,
          paddingBottom: 6,
          paddingTop: 8,
          borderRadius: 28,
          borderTopWidth: 0,
          backgroundColor: M.card,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.1,
          shadowRadius: 16,
          elevation: 12,
        },
        tabBarItemStyle: { paddingHorizontal: 2 },
        // Five labels have to fit across a 320dp phone; TabLabel opts out of
        // font scaling for the same reason.
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarLabel: label('Home'),
          tabBarIcon: ({ color }) => <IconHome color={color as string} size={24} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Games',
          tabBarLabel: label('Games'),
          tabBarIcon: ({ color }) => <IconBolt color={color as string} size={24} />,
        }}
      />
      <Tabs.Screen
        name="venues"
        options={{
          title: 'Venues',
          tabBarLabel: label('Venues'),
          tabBarIcon: ({ color }) => <IconPin color={color as string} size={24} />,
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          tabBarLabel: label('Teams'),
          // The number of squads you are in -- a real count, hidden at zero.
          tabBarBadge: teamCount > 0 ? teamCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: M.green,
            color: M.limeInk,
            fontSize: 10,
            fontWeight: '700',
            lineHeight: 14,
          },
          tabBarIcon: ({ color }) => <IconUsers color={color as string} size={24} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: label('Profile'),
          tabBarIcon: ({ color }) => <IconUser color={color as string} size={24} />,
        }}
      />

      {/* Routable, not in the bar. Activity is reached from Home's bell. */}
      <Tabs.Screen
        name="activity"
        options={{
          href: null,
          title: 'Activity',
          tabBarIcon: ({ color }) => <IconBell color={color as string} size={24} />,
        }}
      />
      <Tabs.Screen name="available" options={{ href: null, title: 'Available' }} />
    </Tabs>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    labelWrap: { alignItems: 'center', gap: 3 },
    label: { fontSize: 11, fontFamily: 'HankenGrotesk_500Medium' },
    labelOn: { fontFamily: 'HankenGrotesk_700Bold' },
    underline: { width: 22, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
    underlineOn: { backgroundColor: M.green },
  });
