/**
 * SwapZoneSection — Feature Component
 * Self-contained: fetches data via useSwapParties() + useSwapZoneItems(),
 * includes header. Wraps the presentational SwapZoneSection from components/home/.
 *
 * The Swap Zone is now a single, always-active generalist zone (no time
 * window, no theme, no countdown). This wrapper renders a single permanent
 * card driven by a preview of the zone's real stock, routing to the zone detail.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { colors, spacing } from '@/constants/theme';
import { SwapZoneSection as SwapZoneSectionUI } from '@/components/home/SwapZoneSection';
import { useSwapParties } from './useSwapParties';
import { useSwapZoneItems } from './useSwapZoneItems';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const SwapZoneWrapperComponent: React.FC = () => {
  const { data, isLoading: isPartyLoading } = useSwapParties();

  // Cloud Function returns the single generalist zone in `party`.
  const zone = data?.party ?? null;

  // Preview of real stock (drives the card's attractiveness).
  const {
    items,
    newThisWeek,
    isLoading: isItemsLoading,
  } = useSwapZoneItems(zone?.id);

  // Only build a navigation handler when a zone actually exists. When no zone
  // is active we pass `onPress={undefined}` so the card renders a non-interactive
  // teaser instead of a dead CTA (see presentational SwapZoneSection).
  const handlePress = useCallback(() => {
    if (zone) {
      router.push(`/swap-party/${zone.id}` as any);
    }
  }, [zone]);

  return (
    <View style={styles.swapZoneContainer}>
      {/* Title is now carried by the card itself (presentational SwapZoneSection). */}
      <SwapZoneSectionUI
        zone={zone ?? undefined}
        items={items}
        itemsCount={zone?.itemsCount ?? 0}
        newThisWeek={newThisWeek}
        isLoading={isPartyLoading || isItemsLoading}
        onPress={zone ? handlePress : undefined}
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
