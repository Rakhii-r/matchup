import { Redirect } from 'expo-router';

/**
 * Legacy open challenge route redirected to the authoritative Create Match wizard.
 */
export default function PostOpenRedirect(): React.ReactNode {
  return <Redirect href="/match/create?type=team_vs_team" />;
}
