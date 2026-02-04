/**
 * Settings Layout
 * Design System: Luxe Français + Street Energy
 */

import { HeaderBackButton } from '@react-navigation/elements';
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { colors, fonts } from '@/constants/theme';

export default function SettingsLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerTitleStyle: {
          fontFamily: fonts.sansMedium,
          fontSize: 17,
        },
        headerBackTitle: ' ',
        presentation: 'card',
        headerLeft: () => (
          <HeaderBackButton onPress={() => router.back()} tintColor={colors.foreground} />
        ),
      }}
    >
      {/* Main Settings */}
      <Stack.Screen name="index" options={{ title: 'Paramètres' }} />

      {/* Account Section */}
      <Stack.Screen name="profile-details" options={{ title: 'Détails du profil' }} />
      <Stack.Screen name="email" options={{ title: 'Changer l\'email' }} />
      <Stack.Screen name="verify-email" options={{ title: 'Vérifier l\'email' }} />
      <Stack.Screen name="phone" options={{ title: 'Numéro de téléphone' }} />
      <Stack.Screen name="password" options={{ title: 'Changer le mot de passe' }} />
      <Stack.Screen name="address" options={{ title: 'Mon adresse' }} />
      <Stack.Screen name="preferences" options={{ title: 'Préférences' }} />

      {/* Shipping & Payments */}
      <Stack.Screen name="shipping-options" options={{ title: 'Options de livraison' }} />
      <Stack.Screen name="payments" options={{ title: 'Moyens de paiement' }} />

      {/* Notifications & Privacy */}
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="privacy" options={{ title: 'Vie privée' }} />
      <Stack.Screen name="blocked-users" options={{ title: 'Utilisateurs bloqués' }} />

      {/* Data & Account Management */}
      <Stack.Screen name="export-data" options={{ title: 'Exporter mes données' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Supprimer le compte' }} />

      {/* Help & About */}
      <Stack.Screen name="help" options={{ title: 'Aide' }} />
      <Stack.Screen name="about" options={{ title: 'À propos' }} />

      {/* Legal Pages */}
      <Stack.Screen name="terms" options={{ title: 'Conditions Générales' }} />
      <Stack.Screen name="privacy-policy" options={{ title: 'Politique de confidentialité' }} />
      <Stack.Screen name="legal-notice" options={{ title: 'Mentions légales' }} />
    </Stack>
  );
}
