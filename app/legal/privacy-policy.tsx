/**
 * Privacy Policy (Loi 25 / LPRPDE) — PUBLIC consent-time route.
 *
 * Reachable without authentication (see app/legal/_layout.tsx) so the document
 * is accessible and readable at the moment of consent, before the user checks
 * the "Politique de confidentialité" box on the sign-up / social-consent forms
 * (Loi 25 art. 12). Renders the SAME body as the authenticated settings route.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { PrivacyPolicyContent } from '@/components/legal';
import { ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';

export default function PublicPrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Politique de confidentialité" onBack={() => router.back()} />
      <PrivacyPolicyContent />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
