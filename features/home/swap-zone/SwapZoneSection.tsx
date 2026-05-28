/**
 * SwapZoneSection — Feature Component
 * Self-contained: fetches data via useSwapParties(), includes header.
 * Wraps the UI SwapZoneSection from components/home/.
 *
 * The Swap Zone is now a single, always-active generalist zone (no time
 * window, no theme, no countdown). This wrapper renders a single permanent
 * card that routes directly to the zone detail.
 */

import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { colors, spacing, fonts } from '@/constants/theme';
import { SwapZoneSection as SwapZoneSectionUI } from '@/components/home/SwapZoneSection';
import { useSwapParties } from './useSwapParties';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const SwapZoneWrapperComponent: React.FC = () => {
  const { data, isLoading } = useSwapParties();

  // Cloud Function returns the single generalist zone in `party`.
  const zone = data?.party ?? null;

  const handlePress = useCallback(() => {
    if (zone) {
      router.push(`/swap-party/${zone.id}` as any);
    }
  }, [zone]);

  return (
    <View style={styles.swapZoneContainer}>
      <View style={styles.swapZoneHeader}>
        <Text style={styles.swapZoneTitle}>
          Swap <Text style={styles.swapZoneTitleAccent}>Zone</Text>
        </Text>
      </View>
      <SwapZoneSectionUI
        zone={zone || undefined}
        isLoading={isLoading}
        onPress={handlePress}
      />
    </View>
  );
};

export const SwapZoneWrapper = React.memo(SwapZoneWrapperComponent);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  swapZoneContainer: {
    backgroundColor: colors.charcoal,
    paddingBottom: spacing.md,
    marginTop: spacing.sm,
  },
  swapZoneHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 0,
  },
  swapZoneTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '300',
    color: colors.cream,
  },
  swapZoneTitleAccent: {
    fontStyle: 'italic',
    color: colors.rust,
  },
});

export default SwapZoneWrapper;
