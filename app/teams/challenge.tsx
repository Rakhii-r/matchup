import { Redirect } from 'expo-router';

/**
 * Legacy challenge route redirected to the active Challenges list.
 */
export default function ChallengeRedirect(): React.ReactNode {
  return <Redirect href="/teams/challenges" />;
}
