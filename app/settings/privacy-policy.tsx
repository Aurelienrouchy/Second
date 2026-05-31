/**
 * Privacy Policy (Loi 25 / LPRPDE) — authenticated settings route.
 *
 * Body lives in components/legal/PrivacyPolicyContent so the SAME copy is shared
 * with the public consent-time route (app/legal/privacy-policy.tsx). Loi 25 art. 12.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { PrivacyPolicyContent } from '@/components/legal';
import { ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';

export default function PrivacyPolicyScreen() {
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
