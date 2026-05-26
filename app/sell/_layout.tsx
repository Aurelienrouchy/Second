import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';

export default function SellLayout() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  // Gate the entire sell flow behind auth
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      useAuthSheetStore.getState().show(
        'Connectez-vous pour vendre un article',
        () => {
          // On success, user stays on the sell flow
        },
      );
      router.replace('/(tabs)');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="capture" options={{ headerShown: false }} />
      <Stack.Screen name="photos-review" options={{ headerShown: false }} />
      <Stack.Screen name="details" options={{ headerShown: false }} />
      <Stack.Screen name="pricing" options={{ headerShown: false }} />
      <Stack.Screen name="preview" options={{ headerShown: false }} />
    </Stack>
  );
}
