/**
 * SwapZoneSection — Feature Component
 * Self-contained: fetches data via useSwapParties() + useSwapZoneItems(), then
 * renders the Swap Zone content DIRECTLY on a full-width dark section surface.
 *
 * There is no inner "card": the section container itself is the dark surface
 * (imageGradients.dark) and the presentational SwapZoneSection lays its content
 * straight onto it. The Swap Zone is the app's dark editorial counterpoint to
 * the warm-white rest of the home.
 *
 * Single, always-active generalist zone (no time window / theme / countdown),
 * routing to /swap-zone.
 */

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
  const { data, isLoading: isPartyLoading } = useSwapParties();

  // Cloud Function returns the single generalist zone in `party`.
  const zone = data?.party ?? null;

  // Preview of real stock (freshness counter).
  const { newThisWeek, isLoading: isItemsLoading } = useSwapZoneItems(zone?.id);

  // Only build a navigation handler when a zone actually exists. When no zone
  // is active we pass `onPress={undefined}` so the section renders a
  // non-interactive teaser instead of a dead CTA.
  const handlePress = useCallback(() => {
    if (zone) {
      router.push('/swap-zone');
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
        newThisWeek={newThisWeek}
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
  // directly against whatever sits above (header/chips when the upper feed is
  // empty, the pour-toi rail when populated) for a bold, immersive dark break.
  // Below the band we also add NO marginBottom — the NEXT section's
  // SectionHeader (paddingTop 28) is the sole owner of that gap. A marginBottom
  // here would stack onto it (32 + 28 = 60) and over-space "Découvrez".
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
