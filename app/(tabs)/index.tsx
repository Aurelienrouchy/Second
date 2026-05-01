/**
 * Home screen — flat FlashList of sections.
 *
 * Why flat: each home section fires its own CF on mount. With the
 * previous ScrollView, all 6 sections rendered immediately = 6 parallel
 * CF cold-starts on first paint. With FlashList v2 virtualisation, only
 * the sections in the viewport mount → only those CFs fire on first
 * paint. The rest fire as the user scrolls into them.
 *
 * The section components themselves are not lists — they own their own
 * horizontal scroll where needed. This file is just the vertical
 * orchestrator.
 */

import { FlashList } from '@shopify/flash-list';
import { useNavigation } from 'expo-router';
import React, { useCallback, useMemo, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import VisualSearchCamera from '@/components/VisualSearchCamera';
import { colors } from '@/constants/theme';

import { DiscoverGrid } from '@/features/home/discover/DiscoverGrid';
import { FeaturedSellersSection } from '@/features/home/featured-sellers/FeaturedSellersSection';
import { HomeHeader } from '@/features/home/header/HomeHeader';
import { useHomeHeader } from '@/features/home/header/useHomeHeader';
import { NewArrivalsSection } from '@/features/home/new-arrivals/NewArrivalsSection';
import { PriceDropsSection } from '@/features/home/price-drops/PriceDropsSection';
import { SectionErrorBoundary } from '@/features/home/SectionErrorBoundary';
import { SwapZoneWrapper } from '@/features/home/swap-zone/SwapZoneSection';
import { TrendingBrandsSection } from '@/features/home/trending-brands/TrendingBrandsSection';

// =============================================================================
// SECTION REGISTRY
// =============================================================================

type SectionId =
  | 'trending-brands'
  | 'new-arrivals'
  | 'swap-zone'
  | 'price-drops'
  | 'featured-sellers'
  | 'discover';

const SECTIONS: ReadonlyArray<SectionId> = [
  'trending-brands',
  'new-arrivals',
  'swap-zone',
  'price-drops',
  'featured-sellers',
  'discover',
];

const SectionComponent: Record<SectionId, React.ComponentType> = {
  'trending-brands': TrendingBrandsSection,
  'new-arrivals': NewArrivalsSection,
  'swap-zone': SwapZoneWrapper,
  'price-drops': PriceDropsSection,
  'featured-sellers': FeaturedSellersSection,
  'discover': DiscoverGrid,
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function HomeScreen() {
  const {
    showVisualSearch,
    setShowVisualSearch,
    handleSearchBarPress,
    handleCameraPress,
    handleVisualSearchCapture,
    handleCategoryPress,
  } = useHomeHeader();

  const listRef = useRef<FlashList<SectionId>>(null);
  const navigation = useNavigation();

  // Scroll-to-top on tab re-press while already on Home.
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as any, () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return unsubscribe;
  }, [navigation]);

  const renderItem = useCallback(({ item }: { item: SectionId }) => {
    const Section = SectionComponent[item];
    return (
      <SectionErrorBoundary name={item}>
        <Section />
      </SectionErrorBoundary>
    );
  }, []);

  const keyExtractor = useCallback((item: SectionId) => item, []);

  const data = useMemo(() => SECTIONS.slice(), []);

  const closeVisualSearch = useCallback(() => setShowVisualSearch(false), [
    setShowVisualSearch,
  ]);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <HomeHeader
          onSearchPress={handleSearchBarPress}
          onCameraPress={handleCameraPress}
          onCategoryPress={handleCategoryPress}
        />
      </SafeAreaView>

      <FlashList
        ref={listRef}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemType={keyExtractor}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      />

      <Modal
        visible={showVisualSearch}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeVisualSearch}
      >
        <VisualSearchCamera
          onClose={closeVisualSearch}
          onPhotoCapture={handleVisualSearchCapture}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerSafeArea: {
    backgroundColor: colors.cream,
  },
  scrollContent: {
    paddingBottom: 200,
  },
});
