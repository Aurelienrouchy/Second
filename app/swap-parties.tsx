/**
 * Swap Parties Screen — Legacy route.
 *
 * The Swap Zone is now a single, always-active generalist zone. This route
 * is preserved for existing links but redirects straight to the zone detail.
 * The previous list UI (FilterTabs / ZoneCard) is no longer rendered.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect, router } from 'expo-router';

import { colors, spacing, radius } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSwapParties } from '@/features/home';

export default function SwapPartiesScreen() {
  const { data, isLoading } = useSwapParties();

  const zoneId = data?.party?.id ?? null;

  // Once we know the generalist zone id, redirect straight to it.
  if (zoneId) {
    return <Redirect href={`/swap-party/${zoneId}` as never} />;
  }

  // While resolving the zone id, show a lightweight skeleton.
  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Swap Zone"
        onBack={() => router.back()}
        backgroundColor="#131510"
        titleColor={colors.cream}
        backButtonColor={colors.cream}
        showBorder={false}
      />

      {isLoading && (
        <View style={styles.skeletonCards}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width="100%" height={200} borderRadius={radius.md} style={styles.skeletonDark} />
              <Skeleton width="60%" height={18} borderRadius={radius.sm} style={styles.skeletonDarkSpaced} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#131510',
  },
  skeletonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  skeletonDarkSpaced: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: spacing.sm,
  },
  skeletonCards: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: 10,
  },
  skeletonCard: {
    marginBottom: spacing.sm,
  },
});
