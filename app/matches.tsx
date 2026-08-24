import { Redirect } from 'expo-router';

/**
 * Top-level route redirect to the authoritative Matches tab.
 */
export default function MatchesRoute(): React.ReactNode {
  return <Redirect href="/(tabs)/matches" />;
}
