import { useFonts } from 'expo-font';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { QueryClientProvider } from '@tanstack/react-query';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import AuthBottomSheet from '@/components/AuthBottomSheet';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { useAuthListener } from '@/hooks/useAuthListener';
import { useChatListener } from '@/hooks/useChatListener';
import { useConsentGuard } from '@/hooks/useConsentGuard';
import { useNotificationSetup } from '@/hooks/useNotificationSetup';
import { useDeepLinking } from '@/hooks/useDeepLinking';
import { useSplashScreen } from '@/hooks/useSplashScreen';
import { useAuthStore } from '@/store/authStore';
import { prefetchHome } from '@/features/home';
import { colors } from '@/constants/theme';
import { queryClient } from '@/lib/queryClient';
import { draftService } from '@/services/draftService';
import { STRIPE_PUBLISHABLE_KEY } from '@/config/stripeConfig';
import { StripeProvider } from '@stripe/stripe-react-native';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Prevent the splash screen from auto-hiding. It stays up until the app
// is fully ready (fonts + auth hydration + critical home prefetch) so no
// in-app spinner ever flashes during startup.
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

  const fontsReady = fontsLoaded || !!fontError;

  // A font failure is non-fatal (system fonts take over) but must be
  // surfaced — otherwise a missing/renamed asset silently degrades the DS.
  // Reporter hook point: forward to Sentry/Crashlytics once wired.
  useEffect(() => {
    if (fontError && __DEV__) {
      console.error('[RootLayout] font loading error:', fontError);
    }
  }, [fontError]);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
            <ThemeProvider value={CustomNavigationTheme}>
              <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
                <AppContent fontsReady={fontsReady} />
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
 * Mounted unconditionally (even while the splash gate is still showing
 * `null`) so that `useAuthListener` starts Firebase hydration immediately
 * at startup — the auth hydration flag is part of the readiness gate, so
 * the listener must run while the splash is still up.
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

  // ── Consent guard : route a pendingConsent account to /complete-profile ──
  // (mandatory Loi 25 step). Lives here so its re-renders never hit the Stack.
  useConsentGuard();

  // ── Chat list : single global listener (replaces ChatContext + useChats) ──
  useChatListener();

  // ── Push notifications : listeners, channels, badge, token ──
  // Read userId reactively so the notification setup re-runs on sign-in/out.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useNotificationSetup(userId);

  // ── Deep linking : custom URL patterns (Expo Router gère le reste) ──
  useDeepLinking();

  // ── Sell drafts : prune expired drafts + orphaned local images once at
  // startup so stale FileSystem/Storage artifacts don't accumulate. Fire-
  // and-forget; failures are swallowed (draftService logs in dev). ──
  useEffect(() => {
    void draftService.cleanupExpiredDrafts();
  }, []);

  return null;
});

/**
 * AppContent — navigator tree + global overlays.
 *
 * Owns the startup readiness gate: while the app is not ready
 * (fonts not loaded, auth not hydrated, or the critical home queries not
 * yet prefetched) it renders an empty background view and keeps the
 * native splash screen visible. Once ready, the splash is hidden via the
 * root view's `onLayout` (single, guarded call) and the navigator
 * appears with data already warm in cache.
 *
 * All side-effect hooks live in <GlobalListeners> so that their state
 * changes never re-render the Stack/NavigationContainer.
 */
function AppContent({ fontsReady }: { fontsReady: boolean }) {
  // Auth hydration flag — flipped to false once onAuthStateChanged
  // resolves (single source of truth, see authStore).
  const authHydrated = useAuthStore((s) => !s.isLoading);

  // Critical home data prefetched behind the splash so the Home tab's
  // first paint has data in cache (no spinner flash). Kicked off once
  // and never gates startup on failure (prefetchHome swallows errors).
  const [homePrefetched, setHomePrefetched] = useState(false);
  useEffect(() => {
    let cancelled = false;
    prefetchHome(queryClient).finally(() => {
      if (!cancelled) setHomePrefetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const appReady = fontsReady && authHydrated && homePrefetched;

  const { onLayoutRootView } = useSplashScreen(appReady);

  return (
    <BottomSheetModalProvider>
      {/* GlobalListeners mounts unconditionally so auth hydration runs
          while the splash is still up. */}
      <GlobalListeners />

      {!appReady ? (
        // Splash screen is still visible; render only a background-colored
        // view so the first frame matches the app background.
        <View style={{ flex: 1, backgroundColor: colors.background }} />
      ) : (
        <View
          style={{ flex: 1, backgroundColor: colors.background }}
          onLayout={onLayoutRootView}
        >
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
            {/* Mandatory post-signup consent step (DOB + consents + @pseudo).
                gestureEnabled:false blocks the iOS back-swipe; a BackHandler in
                the screen consumes the Android back. Same lock the auth sheet
                had in socialConsent. */}
            <Stack.Screen
              name="complete-profile"
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
            <Stack.Screen name="shop/[id]" />
            <Stack.Screen name="settings" />
            {/* legal/* — PUBLIC routes (Terms, Privacy) reachable at consent
                time without authentication (Loi 25 art. 12). */}
            <Stack.Screen name="legal" />
            <Stack.Screen
              name="sell"
              options={{ animation: 'fade_from_bottom' }}
            />
            {/* admin/* routes live under app/admin/_layout.tsx (centralised guard) */}
            <Stack.Screen name="admin" />
            <Stack.Screen name="payment/[transactionId]" />
            <Stack.Screen name="review/[transactionId]" />
            <Stack.Screen name="visual-search-results" />
            <Stack.Screen name="search" />
            <Stack.Screen name="+not-found" />
          </Stack>
          <StatusBar style="dark" />
          {/* Global auth bottom sheet — driven by authSheetStore. */}
          <AuthBottomSheet />
          {/* Global offline indicator — slides down when connectivity is lost. */}
          <OfflineBanner />
        </View>
      )}
    </BottomSheetModalProvider>
  );
}
