/** Full-width dark home band for the exchange catalogue. The zone supplies the
 * total stock; the preview query supplies the real article photos. */

import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

import { colors, imageGradients } from '@/constants/theme';
import { SwapZoneSection as SwapZoneSectionUI } from '@/components/home/SwapZoneSection';
import { useSwapParties } from './useSwapParties';
import { useSwapZoneItems } from './useSwapZoneItems';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const SwapZoneWrapperComponent: React.FC = () => {
  const { data, isLoading: isPartyLoading, isError, refetch } = useSwapParties();

  // Cloud Function returns the single generalist zone in `party`.
  const zone = data?.party ?? null;

  // Recent photos are a preview, not a global count of new articles.
  const { items, isLoading: isItemsLoading, isError: previewsError } = useSwapZoneItems(zone?.id);

  // Only build a navigation handler when a zone actually exists. When no zone
  // is active we pass `onPress={undefined}` so the section renders a
  // explicit unavailable state instead of a dead CTA.
  const handlePress = useCallback(() => {
    if (zone) {
      router.push({ pathname: '/swap-zone', params: { source: 'home' } });
    }
  }, [zone]);

  return (
    <LinearGradient
      colors={imageGradients.swapZone}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.section}
    >
      <SwapZoneSectionUI
        testID="home-swap-zone-entry"
        zone={zone ?? undefined}
        itemsCount={zone?.itemsCount ?? 0}
        items={items}
        isError={isError}
        previewsError={previewsError}
        onRetry={() => { void refetch(); }}
        isLoading={isPartyLoading || isItemsLoading}
        onPress={zone ? handlePress : undefined}
      />
    </LinearGradient>
  );
};

export const SwapZoneWrapper = React.memo(SwapZoneWrapperComponent);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  // Full-bleed dark section band. Inner padding is owned by the content
  // component (no card, no inner padding here). No horizontal margin / no
  // radius — full-bleed is the sanctioned exception.
  //
  // Vertical rhythm: the band is flush — NO margin top or bottom. It butts
  // directly against the new-arrivals rail above for a bold, immersive dark
  // break. Below the band we also add NO marginBottom — the next section's
  // (trending-brands) SectionHeader (paddingTop 28) is the sole owner of that
  // gap. A marginBottom here would stack onto it and over-space the section.
  section: {
    marginTop: 0,
    marginBottom: 0,
    // Lifted white-alpha hairlines top + bottom are the only band chrome; the
    // dark-band-vs-warm-white-feed luminance jump provides the boundary.
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.darkBorderStrong,
  },
});

export default SwapZoneWrapper;
