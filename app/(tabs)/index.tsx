import { useNavigation } from 'expo-router';
import React, { useRef } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Design System
import { colors } from '@/constants/theme';

// Components 
import VisualSearchCamera from '@/components/VisualSearchCamera';

// Feature modules — each section is self-contained
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

  const scrollRef = useRef<ScrollView>(null);
  const navigation = useNavigation();

  // Scroll to top when the Home tab icon is pressed while already on Home
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress' as any, () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Fixed Header — stays pinned under the status bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
          <HomeHeader
            onSearchPress={handleSearchBarPress}
            onCameraPress={handleCameraPress}
            onCategoryPress={handleCategoryPress}
          />
      </SafeAreaView>

      {/* Scrollable Content — fills remaining space below header */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 1. Trending Brands */}
        <SectionErrorBoundary name="TrendingBrands">
          <TrendingBrandsSection />
        </SectionErrorBoundary>

        {/* 2. New Arrivals (Nouveautés) */}
        <SectionErrorBoundary name="NewArrivals">
          <NewArrivalsSection />
        </SectionErrorBoundary>

        {/* 3. Swap Zone */}
        <SectionErrorBoundary name="SwapZone">
          <SwapZoneWrapper />
        </SectionErrorBoundary>

        {/* 4. Price Drops (Baisses de prix) */}
        <SectionErrorBoundary name="PriceDrops">
          <PriceDropsSection />
        </SectionErrorBoundary>

        {/* 5. Featured Sellers (Vendeurs vedettes) */}
        <SectionErrorBoundary name="FeaturedSellers">
          <FeaturedSellersSection />
        </SectionErrorBoundary>

        {/* 6. Discover Grid (Découvrez) */}
        <SectionErrorBoundary name="Discover">
          <DiscoverGrid />
        </SectionErrorBoundary>
      </ScrollView>

      {/* Visual Search Camera Modal */}
      <Modal
        visible={showVisualSearch}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowVisualSearch(false)}
      >
        <VisualSearchCamera
          onClose={() => setShowVisualSearch(false)}
          onPhotoCapture={handleVisualSearchCapture}
        />
      </Modal>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerSafeArea: {
    backgroundColor: colors.cream,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 200,
  },
});

