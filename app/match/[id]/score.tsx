/**
 * Kept as a redirect, not deleted: older builds link to it. The screen itself moved into the
 * Match Center at ./live, which renders it as the "Live" tab.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ScoreRedirect(): React.ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/match/${id ?? ''}/live?tab=live`} />;
}
