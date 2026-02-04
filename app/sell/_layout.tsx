import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SellLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleClose = () => {
    // Navigate back to tabs
    router.replace('/(tabs)');
  };

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
      }}
    >
      <Stack.Screen
        name="capture"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="details"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="pricing"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="preview"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
