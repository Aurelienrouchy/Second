/**
 * Home Screen
 * Design System: Luxe Français + Street
 *
 * Clean, editorial design inspired by Depop & Vestiaire Collective
 *
 * Features:
 * - Search bar at top
 * - Category grid with lifestyle photos
 * - Swap Zone section (editorial style)
 * - Personalized feed sections
 * - Product grid with proper skeletons
 */

import { Ionicons } from '@expo/vector-icons';

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

// Design System
import {
  CategoryChip,
  SearchBar,
  SectionHeader,
} from '@/components/ui';
import { animations, colors, spacing, typography } from '@/constants/theme';

// Components
import HorizontalProductSection from '@/components/HorizontalProductSection';
import ProductGrid from '@/components/ProductGrid';
import SwapZoneSection from '@/components/SwapZoneSection';
import VisualSearchCamera from '@/components/VisualSearchCamera';

// Hooks & Contexts
import { useAuth } from '@/contexts/AuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useArticleSearch } from '@/hooks/useArticleSearch';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useNearbyArticles } from '@/hooks/useNearbyArticles';
import { usePersonalizedFeed } from '@/hooks/usePersonalizedFeed';

// Constants
import { AUTH_MESSAGES } from '@/constants/authMessages';

// Data
import { CATEGORIES } from '@/data/categories-v2';

// =============================================================================
// QUICK CATEGORIES
// =============================================================================

const QUICK_CATEGORIES = CATEGORIES.map((cat) => ({
  id: cat.id,
  label: cat.label,
  icon: cat.icon,
}));

// Map category icons to Ionicons
const getCategoryIcon = (icon?: string): keyof typeof Ionicons.glyphMap => {
  const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    woman: 'woman-outline',
    man: 'man-outline',
    happy: 'happy-outline',
    home: 'home-outline',
    'game-controller': 'game-controller-outline',
    paw: 'paw-outline',
  };
  return iconMap[icon || ''] || 'folder-outline';
};

// =============================================================================
// ANIMATED PRESSABLE
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// NOTIFICATION BUTTON
// =============================================================================

interface NotificationButtonProps {
  count?: number;
}

const NotificationButton: React.FC<NotificationButtonProps> = ({ count = 0 }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/notifications' as any);
  }, []);

  return (
    <AnimatedPressable
      style={[styles.notificationButton, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      accessibilityLabel="Notifications"
    >
      <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function HomeScreen() {
  const { user } = useAuth();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();
  const { notificationCount } = useNotifications();

  // Visual search state
  const [showVisualSearch, setShowVisualSearch] = useState(false);

  // Article search hook
  const {
    articles,
    isLoading,
    isPaginating,
    search,
    loadMore,
    error,
  } = useArticleSearch({
    excludeUserId: user?.id,
  });

  // Debug logging
  console.log('📱 HomeScreen:', { articlesCount: articles.length, isLoading, error });

  // Personalized feed
  const {
    articles: personalizedArticles,
    isLoading: isLoadingPersonalized,
    styleTags,
    hasProfile,
  } = usePersonalizedFeed({
    user,
    limit: 10,
  });

  // Nearby articles
  const {
    articles: nearbyArticles,
    isLoading: isLoadingNearby,
    location: userLocation,
  } = useNearbyArticles({
    excludeUserId: user?.id,
    maxDistance: 25,
    limit: 10,
  });

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  const handleProductSelect = useCallback((product: any) => {
    router.push(`/article/${product.id}`);
  }, []);

  const handleToggleLike = useCallback((productId: string) => {
    requireAuth(
      () => toggleFavorite(productId),
      AUTH_MESSAGES.like
    );
  }, [requireAuth, toggleFavorite]);

  const handleRefresh = useCallback(() => {
    search(true);
  }, [search]);

  const handleLoadMore = useCallback(() => {
    if (!isPaginating && !isLoading) {
      loadMore();
    }
  }, [isPaginating, isLoading, loadMore]);

  const handleSearchBarPress = useCallback(() => {
    router.push('/search');
  }, []);

  const handleCameraPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowVisualSearch(true);
  }, []);

  const handleVisualSearchCapture = useCallback((imageUri: string) => {
    setShowVisualSearch(false);
    router.push({
      pathname: '/visual-search-results',
      params: { imageUri },
    });
  }, []);

  const handleCategoryPress = useCallback((categoryId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/search',
      params: { categoryPath: JSON.stringify([categoryId]) },
    });
  }, []);

  // ==========================================================================
  // RENDER FUNCTIONS
  // ==========================================================================

  const handleProductSelectArticle = useCallback((article: any) => {
    router.push(`/article/${article.id}`);
  }, []);

  // ==========================================================================
  // LIST HEADER
  // ==========================================================================

  const renderListHeader = useCallback(() => (
    <View style={styles.listHeader}>
      {/* Quick Categories */}
      <Animated.View
        entering={FadeInDown.duration(400).delay(100)}
        style={styles.categoriesContainer}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesContent}
        >
          {QUICK_CATEGORIES.map((category) => (
            <CategoryChip
              key={category.id}
              label={category.label}
              icon={getCategoryIcon(category.icon)}
              onPress={() => handleCategoryPress(category.id)}
              testID={`category-${category.id}`}
            />
          ))}
        </ScrollView>
      </Animated.View>

      {/* Swap Zone Section */}
      <SwapZoneSection testID="swap-zone-section" />

      {/* Pour Toi - Personalized Feed */}
      {hasProfile && (
        <Animated.View entering={FadeInDown.duration(400).delay(200)}>
          <HorizontalProductSection
            title="Pour Toi"
            subtitle={styleTags.length > 0 ? 'Basé sur ton style' : 'Sélection personnalisée'}
            articles={personalizedArticles}
            isLoading={isLoadingPersonalized}
            onSeeAll={() => {
              router.push({
                pathname: '/search-results',
                params: {
                  filters: JSON.stringify({
                    brands: user?.styleProfile?.recommendedBrands || user?.preferences?.favoriteBrands,
                    sizes: user?.preferences?.sizes,
                  }),
                },
              });
            }}
            emptyMessage="Aucune suggestion pour le moment"
            emptyIcon="sparkles-outline"
            testID="pour-toi-section"
          />
        </Animated.View>
      )}

      {/* Près de toi - Nearby Articles */}
      {userLocation && (
        <Animated.View entering={FadeInDown.duration(400).delay(300)}>
          <HorizontalProductSection
            title="Près de toi"
            subtitle="Articles à proximité"
            articles={nearbyArticles}
            isLoading={isLoadingNearby}
            showDistance
            onSeeAll={() => {
              router.push('/search-results?nearby=true');
            }}
            emptyMessage="Aucun article à proximité"
            emptyIcon="location-outline"
            testID="pres-de-toi-section"
          />
        </Animated.View>
      )}

      {/* Nouveautés Section Title */}
      <Animated.View entering={FadeInDown.duration(400).delay(400)}>
        <SectionHeader title="Nouveautés" />
      </Animated.View>
    </View>
  ), [
    hasProfile,
    styleTags,
    personalizedArticles,
    isLoadingPersonalized,
    user,
    userLocation,
    nearbyArticles,
    isLoadingNearby,
    handleCategoryPress,
  ]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with Search Bar + Notification */}
      <Animated.View
        entering={FadeIn.duration(300)}
        style={styles.header}
      >
        <SearchBar
          placeholder="Rechercher des articles..."
          onPress={handleSearchBarPress}
          onCameraPress={handleCameraPress}
          testID="search-bar"
        />
        <NotificationButton count={notificationCount} />
      </Animated.View>

      {/* Product Grid */}
      <ProductGrid
        articles={articles}
        isLoading={isLoading}
        isPaginating={isPaginating}
        onRefresh={handleRefresh}
        onLoadMore={handleLoadMore}
        onProductPress={handleProductSelectArticle}
        onToggleLike={handleToggleLike}
        isFavorite={isFavorite}
        extraData={favorites}
        ListHeaderComponent={renderListHeader}
        testID="home-grid"
      />

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
    </SafeAreaView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  notificationButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.borderLight,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: colors.white,
  },

  // List Header
  listHeader: {
    backgroundColor: colors.background,
  },

  // Categories
  categoriesContainer: {
    // marginLeft: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  categoriesContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },

});
