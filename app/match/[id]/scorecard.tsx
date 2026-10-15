/**
 * Kept as a redirect, not deleted: the result screen links to it. The screen itself moved into the
 * Match Center at ./live, which renders it as the "Scorecard" tab.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ScorecardRedirect(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/match/${id ?? ''}/live?tab=card`} />;
}
