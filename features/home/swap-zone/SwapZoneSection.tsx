/** Full-width Le Troc home section for the exchange catalogue. The zone supplies the
 * total stock; the preview query supplies the real article photos. */

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { colors, components } from '@/constants/theme';
import { SwapZoneSection as SwapZoneSectionUI } from './SwapZoneSectionView';
import { useSwapParties } from './useSwapParties';
import { useSwapZoneItems } from './useSwapZoneItems';
import { useTrocMosaicMotion } from './useTrocMosaicMotion';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const SwapZoneWrapperComponent: React.FC = () => {
  const motionEnabled = useTrocMosaicMotion();
  const {
    data,
    isLoading: isPartyLoading,
    isError,
    refetch,
  } = useSwapParties();

  // Cloud Function returns the single generalist zone in `party`.
  const zone = data?.party ?? null;

  // Recent photos are a preview, not a global count of new articles.
  const {
    items,
    isLoading: isItemsLoading,
    isError: previewsError,
  } = useSwapZoneItems(zone?.id);

  // Only build a navigation handler when a zone actually exists. When no zone
  // is active we pass `onPress={undefined}` so the section renders a
  // explicit unavailable state instead of a dead CTA.
  const handlePress = useCallback(() => {
    if (zone) {
      router.push({ pathname: '/swap-zone', params: { source: 'home' } });
    }
  }, [zone]);

  return (
    <View style={styles.section}>
      <SwapZoneSectionUI
        testID="home-swap-zone-entry"
        zone={zone ?? undefined}
        itemsCount={zone?.itemsCount ?? 0}
        items={items}
        motionEnabled={motionEnabled}
        isError={isError}
        previewsError={previewsError}
        onRetry={() => {
          void refetch();
        }}
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
  section: {
    backgroundColor: colors.background,
    borderTopWidth: components.troc.borderWidth,
    borderBottomWidth: components.troc.borderWidth,
    borderColor: colors.borderStrong,
  },
});

export default SwapZoneWrapper;
