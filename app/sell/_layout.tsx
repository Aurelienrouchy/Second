import { Stack } from 'expo-router';

export default function SellLayout() {
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
