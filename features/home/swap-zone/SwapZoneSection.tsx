/**
 * SwapZoneSection — Feature Component
 * Self-contained: fetches data via useSwapParties(), includes header + link.
 * Re-uses the original SwapZoneSection component from components/home/
 * but wires it up internally.
 */

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';

import { colors, spacing, fonts } from '@/constants/theme';
import { SwapZoneSection as SwapZoneSectionUI } from '@/components/home/SwapZoneSection';
import { useSwapParties } from './useSwapParties';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const SwapZoneWrapperComponent: React.FC = () => {
  const { data, isLoading } = useSwapParties();

  // Cloud Function returns: { hasActiveParty, party, nextParty }
  const hasActive = data?.hasActiveParty ?? false;
  const activeParty = data?.party ?? null;
  const nextParty = data?.nextParty ?? null;

  const handleActivePress = useCallback(() => {
    if (activeParty) {
      router.push(`/swap-party/${activeParty.id}` as any);
    }
  }, [activeParty]);

  const handleUpcomingPress = useCallback(() => {
    router.push('/swap-parties');
  }, []);

  return (
    <View style={styles.swapZoneContainer}>
      <View style={styles.swapZoneHeader}>
        <Text style={styles.swapZoneTitle}>
          Swap <Text style={styles.swapZoneTitleAccent}>Zone</Text>
        </Text>
      </View>
      {hasActive || nextParty || isLoading ? (
        <SwapZoneSectionUI
          hasActiveParty={hasActive}
          activeParty={activeParty || undefined}
          nextParty={nextParty || undefined}
          isLoading={isLoading}
          onActivePress={handleActivePress}
          onUpcomingPress={handleUpcomingPress}
          onNotifyPress={undefined}
        />
      ) : (
        <Pressable
          style={styles.emptyCard}
          onPress={() => router.push('/swap-parties')}
        >
          <Text style={styles.emptyCardTitle}>
            Pas de Swap Zone active
          </Text>
          <Text style={styles.emptyCardSubtitle}>
            Les Swap Zones permettent d'échanger tes articles avec d'autres membres. Reviens bientôt !
          </Text>
        </Pressable>
      )}
      <Pressable
        style={styles.swapZoneLink}
        onPress={() => router.push('/swap-parties')}
      >
        <Text style={styles.swapZoneLinkText}>
          Voir toutes les Swap Zones →
        </Text>
      </Pressable>
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
  swapZoneLink: {
    marginTop: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  swapZoneLinkText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 1.32,
    textTransform: 'uppercase',
    color: colors.rust,
  },
  emptyCard: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.2)',
    borderStyle: 'dashed',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyCardTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 16,
    color: colors.cream,
    marginBottom: spacing.sm,
  },
  emptyCardSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: 'rgba(245, 240, 232, 0.6)',
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default SwapZoneWrapper;
