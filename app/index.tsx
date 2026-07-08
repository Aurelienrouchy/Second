import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { ONBOARDING_COMPLETED_KEY } from '@/constants/storageKeys';
import { track } from '@/lib/analytics';

export default function IndexScreen() {
  const [isReady, setIsReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY).then((value) => {
      const needs = value !== 'true';
      setNeedsOnboarding(needs);
      setIsReady(true);
      track('onboarding_gate_resolved', { needs_onboarding: needs });
    });
  }, []);

  if (!isReady) {
    // Plain background view while the (< 50ms) AsyncStorage read resolves.
    // No skeleton/spinner: the startup splash already covered the long
    // loads, so this short gap should not introduce a new visual flash.
    return <View style={styles.background} />;
  }

  if (needsOnboarding) {
    return <Redirect href={'/onboarding' as any} />;
  }

  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
