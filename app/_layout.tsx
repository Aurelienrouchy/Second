import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import 'react-native-reanimated';

import { QueryClientProvider } from '@tanstack/react-query';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import AuthBottomSheet from '@/components/AuthBottomSheet';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { useAuthListener } from '@/hooks/useAuthListener';
import { useChatListener } from '@/hooks/useChatListener';
import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { useDeepLinking } from '@/hooks/useDeepLinking';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/constants/theme';
import { queryClient } from '@/lib/queryClient';
import { STRIPE_PUBLISHABLE_KEY } from '@/config/stripeConfig';
import { StripeProvider } from '@stripe/stripe-react-native';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
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
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
            <ThemeProvider value={CustomNavigationTheme}>
              <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
                <AppContent />
              </StripeProvider>
            </ThemeProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

/**
 * GlobalListeners — side-effect hooks that subscribe to external state
 * (auth, chat, notifications, deep links).
 *
 * Isolated in its own component so that store-driven re-renders do NOT
 * propagate to the NavigationContainer (Stack).  The warning
 * "Can't perform a React state update on a component that hasn't mounted
 * yet" was caused by useUser() living in the same component as <Stack>,
 * which made auth-hydration re-render the navigator while its internal
 * useLinking getInitialState Promise was still in flight.
 */
const GlobalListeners = React.memo(function GlobalListeners() {
  // ── Auth : Firebase listener + AsyncStorage bootstrap (single source) ──
  useAuthListener();

  // ── Chat list : single global listener (replaces ChatContext + useChats) ──
  useChatListener();

  // ── Push notifications : listeners, channels, badge, token ──
  // Read userId reactively so the notification setup re-runs on sign-in/out.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useNotificationSetup(userId);

  // ── Deep linking : custom URL patterns (Expo Router gère le reste) ──
  useDeepLinking();

  return null;
});

/**
 * AppContent — navigator tree + global overlays.
 *
 * This component owns ONLY the navigator and the overlays rendered
 * alongside it.  All side-effect hooks live in <GlobalListeners> above
 * so that their state changes never re-render the Stack/NavigationContainer.
 */
function AppContent() {
  return (
    <BottomSheetModalProvider>
            <GlobalListeners />
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
                options={{ animation: 'fade_from_bottom' }}
              />
              {/* admin/* routes live under app/admin/_layout.tsx (centralised guard) */}
              <Stack.Screen name="admin" />
              <Stack.Screen name="payment/[transactionId]" />
              <Stack.Screen name="visual-search-results" />
              <Stack.Screen name="search" />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar style="dark" />
            {/* Global auth bottom sheet — driven by authSheetStore. */}
            <AuthBottomSheet />
            {/* Global offline indicator — slides down when connectivity is lost. */}
            <OfflineBanner />
    </BottomSheetModalProvider>
  );
}
