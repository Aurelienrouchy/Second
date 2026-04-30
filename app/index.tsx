import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';

import { colors } from '@/constants/theme';
import { ONBOARDING_COMPLETED_KEY } from '@/constants/storageKeys';

export default function IndexScreen() {
  const [isReady, setIsReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY).then((value) => {
      setNeedsOnboarding(value !== 'true');
      setIsReady(true);
    });
  }, []);

  if (!isReady) {
    // Minimal loader while checking AsyncStorage (< 50ms)
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (needsOnboarding) {
    return <Redirect href={'/onboarding' as any} />;
  }

  return <Redirect href="/(tabs)" />;
}
