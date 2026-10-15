/**
 * Kept as a redirect, not deleted: 77 push notifications already deep-link to
 * this route, and the rematch flow pushes it straight after a new match is created. The screen itself moved into the
 * Match Center at ./live, which renders it as the "Toss" tab.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function TossRedirect(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/match/${id ?? ''}/live?tab=toss`} />;
}
