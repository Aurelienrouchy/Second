import { Redirect } from 'expo-router';

export default function IndexScreen() {
  // Redirection immédiate vers le feed - pas de loading
  return <Redirect href="/(tabs)" />;
}
