import { Stack } from 'expo-router';

export default function MatchLayout(): React.ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}
