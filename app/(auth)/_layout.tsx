import { Stack } from 'expo-router';

export default function AuthLayout(): React.ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}
