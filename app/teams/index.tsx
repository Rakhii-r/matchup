import { Redirect } from 'expo-router';

/**
 * Standalone teams route redirect to the authoritative Teams tab.
 */
export default function TeamsRoute(): React.ReactNode {
  return <Redirect href="/(tabs)/teams" />;
}
