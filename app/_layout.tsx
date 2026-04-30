import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { QueryClientProvider } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { AuthRequiredProvider } from '@/contexts/AuthRequiredContext';
import { useAuthListener } from '@/hooks/useAuthListener';
import { useChatListener } from '@/hooks/useChatListener';
import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { useDeepLinking } from '@/hooks/useDeepLinking';
import { colors } from '@/constants/theme';
import { queryClient } from '@/lib/queryClient';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
// Helcim payment is handled via WebView (HelcimPay.js) — no native provider needed
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();



/**
 * Custom Navigation Theme — Seconde UI Kit
 * Editorial Luxe — Cream, Charcoal, Rust
 */
const CustomNavigationTheme = {
  dark: false,
  colors: {
    primary: colors.primary,        // Rust / Terracotta
    background: colors.background,  // Warm white
    card: colors.surface,           // Pure white
    text: colors.foreground,        // Deep charcoal
    border: colors.borderLight,
    notification: colors.primary,
  },
  fonts: {
    regular: {
      fontFamily: 'Satoshi-Regular',
      fontWeight: 'normal' as const,
    },
    medium: {
      fontFamily: 'Satoshi-Medium',
      fontWeight: '500' as const,
    },
    bold: {
      fontFamily: 'Satoshi-Bold',
      fontWeight: 'bold' as const,
    },
    heavy: {
      fontFamily: 'Satoshi-Bold',
      fontWeight: '900' as const,
    },
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Legacy font
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),

    // Design System Fonts - Cormorant Garamond (Serif)
    'Cormorant-Garamond': require('../assets/fonts/CormorantGaramond-Regular.ttf'),
    'Cormorant-Garamond-Medium': require('../assets/fonts/CormorantGaramond-Medium.ttf'),
    'Cormorant-Garamond-SemiBold': require('../assets/fonts/CormorantGaramond-SemiBold.ttf'),
    'Cormorant-Garamond-Bold': require('../assets/fonts/CormorantGaramond-Bold.ttf'),

    // Design System Fonts - Satoshi (Sans)
    'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.otf'),
    'Satoshi-Medium': require('../assets/fonts/Satoshi-Medium.otf'),
    'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Show nothing while fonts load (splash screen visible)
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
          <ThemeProvider value={CustomNavigationTheme}>
            <AppContent />
          </ThemeProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * AppContent — lives inside AuthProvider so hooks can access useAuth.
 *
 * Notifications : Zustand store + useNotificationSetup (plus de Context)
 * Deep linking  : useDeepLinking + Expo Router (file-based routing automatique)
 */
function AppContent() {
  // ── Auth : Firebase listener + AsyncStorage bootstrap (single source) ──
  useAuthListener();

  // ── Chat list : single global listener (replaces ChatContext + useChats) ──
  useChatListener();

  const { user } = useAuth();

  // ── Push notifications : listeners, channels, badge, token ──
  useNotificationSetup(user?.id ?? null);

  // ── Deep linking : custom URL patterns (Expo Router gère le reste) ──
  useDeepLinking();

  return (
    <BottomSheetModalProvider>
      <AuthRequiredProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen
                name="onboarding"
                options={{ animation: 'fade', gestureEnabled: false }}
              />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="article/[id]" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen
                name="my-articles"
                options={{ presentation: 'card' }}
              />
              <Stack.Screen
                name="my-orders"
                options={{ presentation: 'card' }}
              />
              <Stack.Screen
                name="filters"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                }}
              />

              <Stack.Screen name="shop/[id]" />
              <Stack.Screen name="settings" />
              <Stack.Screen
                name="sell"
                options={{ animation: 'slide_from_bottom' }}
              />
              <Stack.Screen name="admin/shops" />
              <Stack.Screen name="admin/shop-detail/[id]" />
              <Stack.Screen name="payment/[transactionId]" />
              <Stack.Screen name="visual-search-results" />
              <Stack.Screen name="search" />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar style="dark" />
      </AuthRequiredProvider>
    </BottomSheetModalProvider>
  );
}
