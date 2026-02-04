import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AuthProvider } from '@/contexts/AuthContext';
import { AuthRequiredProvider } from '@/contexts/AuthRequiredContext';
import { ChatProvider } from '@/contexts/ChatContext';
import { FavoritesProvider } from '@/contexts/FavoritesContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { colors } from '@/constants/theme';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { StripeProvider } from '@stripe/stripe-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE';

/**
 * Custom Navigation Theme
 * Design System: Luxe Français + Street
 */
const CustomNavigationTheme = {
  dark: false,
  colors: {
    primary: colors.primary,        // Bleu Klein
    background: '#FFFFFF',          // Blanc pur
    card: '#FFFFFF',                // Blanc pur
    text: colors.foreground,        // Noir doux
    border: colors.border,
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
      // Hide splash screen once fonts are loaded
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    // Firebase Auth initializes automatically
    console.log('Firebase Auth initialized');
  }, []);

  // Show nothing while fonts load (splash screen visible)
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
          <AuthProvider>
            <LanguageProvider>
              <FavoritesProvider>
                <ChatProvider>
                  <NotificationProvider>
                    <BottomSheetModalProvider>
                      <AuthRequiredProvider>
                        <ThemeProvider value={CustomNavigationTheme}>
                          <Stack
                            screenOptions={{
                              headerShown: false,
                              contentStyle: { backgroundColor: '#FFFFFF' },
                              animation: 'slide_from_right',
                            }}
                          >
                            <Stack.Screen name="index" />
                            <Stack.Screen name="(tabs)" />
                            <Stack.Screen name="article/[id]" />
                            <Stack.Screen name="chat/[id]" />
                            <Stack.Screen
                              name="my-articles"
                              options={{ presentation: 'card' }}
                            />
                            <Stack.Screen
                              name="filters"
                              options={{
                                presentation: 'modal',
                                animation: 'slide_from_bottom',
                              }}
                            />
                            <Stack.Screen name="search-results" />
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
                        </ThemeProvider>
                      </AuthRequiredProvider>
                    </BottomSheetModalProvider>
                  </NotificationProvider>
                </ChatProvider>
              </FavoritesProvider>
            </LanguageProvider>
          </AuthProvider>
        </StripeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
