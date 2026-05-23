import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
    // Skeleton placeholder while checking AsyncStorage (< 50ms)
    return (
      <View style={skeletonStyles.container}>
        <View style={skeletonStyles.headerBar} />
        <View style={skeletonStyles.heroBlock} />
        <View style={skeletonStyles.textLineLong} />
        <View style={skeletonStyles.textLineShort} />
      </View>
    );
  }

  if (needsOnboarding) {
    return <Redirect href={'/onboarding' as any} />;
  }

  return <Redirect href="/(tabs)" />;
}

const skeletonStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  headerBar: {
    width: 120,
    height: 24,
    backgroundColor: colors.border,
    borderRadius: 6,
    marginBottom: 24,
  },
  heroBlock: {
    width: '100%',
    height: 180,
    backgroundColor: colors.border,
    borderRadius: 12,
    marginBottom: 16,
  },
  textLineLong: {
    width: '70%',
    height: 16,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginBottom: 8,
  },
  textLineShort: {
    width: '50%',
    height: 16,
    backgroundColor: colors.border,
    borderRadius: 4,
  },
});
