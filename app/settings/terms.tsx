/**
 * Terms of Service (CGU) — authenticated settings route.
 *
 * Body lives in components/legal/TermsContent so the SAME copy is shared with
 * the public consent-time route (app/legal/terms.tsx). Loi 25 art. 12.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TermsContent } from '@/components/legal';
import { ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';

export default function TermsScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Conditions d'utilisation" onBack={() => router.back()} />
      <TermsContent />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
