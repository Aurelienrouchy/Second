/**
 * Favorites Screen
 * Design System: Luxe Français + Street
 *
 * Features:
 * - Elegant empty state with Bleu Klein accent
 * - Product grid with new design
 * - Smooth animations
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

// Design System
import { colors, spacing } from '@/constants/theme';
import { Button, H1, H2, Body, Caption } from '@/components/ui';

// Components
import ProductGrid from '@/components/ProductGrid';

// Hooks & Contexts
import { useAuth } from '@/contexts/AuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';

// Services & Types
import { FavoritesService } from '@/services/favoritesService';
import { Article, ArticleWithLocation } from '@/types';

// =============================================================================
// EMPTY STATE COMPONENT
// =============================================================================

const EmptyState: React.FC<{ onBrowse: () => void }> = ({ onBrowse }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(100)}
    style={styles.emptyState}
  >
    <View style={styles.emptyIconContainer}>
      <Ionicons name="heart-outline" size={64} color={colors.primary} />
    </View>
    <H2 style={styles.emptyTitle}>Aucun favori</H2>
    <Body color="muted" center style={styles.emptyText}>
      Les articles que vous aimez apparaîtront ici
    </Body>
    <Button
      variant="primary"
      onPress={onBrowse}
      style={styles.browseButton}
    >
      Parcourir les articles
    </Button>
  </Animated.View>
);

// =============================================================================
// LOADING STATE COMPONENT
// =============================================================================

const LoadingState: React.FC = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color={colors.primary} />
    <Caption style={styles.loadingText}>Chargement des favoris...</Caption>
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function FavoritesScreen() {
  const [favoriteArticles, setFavoriteArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const router = useRouter();
  const { favorites, toggleFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();
  const { user } = useAuth();

  // Load favorites
  useEffect(() => {
    requireAuth(loadFavoriteArticles, 'Vous devez être connecté pour voir vos favoris.');
  }, [favorites]);

  const loadFavoriteArticles = useCallback(async () => {
    if (favorites.length === 0) {
      setFavoriteArticles([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const articles = await FavoritesService.getUserFavoriteArticles(user!.id);
      setFavoriteArticles(articles);
    } catch (error) {
      console.error('Error loading favorite articles:', error);
    } finally {
      setIsLoading(false);
    }
  }, [favorites, user]);

  // Handlers
  const handleRemoveFavorite = useCallback((articleId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    toggleFavorite(articleId);
  }, [toggleFavorite]);

  const handleArticlePress = useCallback((article: Article | ArticleWithLocation) => {
    router.push(`/article/${article.id}`);
  }, [router]);

  const handleBrowse = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)');
  }, [router]);

  // All favorites are liked
  const isFavoriteAlways = useCallback(() => true, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <Animated.View
        entering={FadeIn.duration(300)}
        style={styles.header}
      >
        <H1 style={styles.title}>Mes favoris</H1>
        {favoriteArticles.length > 0 && (
          <Caption style={styles.count}>
            {favoriteArticles.length} article{favoriteArticles.length > 1 ? 's' : ''}
          </Caption>
        )}
      </Animated.View>

      {/* Content */}
      {isLoading ? (
        <LoadingState />
      ) : favoriteArticles.length === 0 ? (
        <EmptyState onBrowse={handleBrowse} />
      ) : (
        <ProductGrid
          articles={favoriteArticles}
          isLoading={false}
          onProductPress={handleArticlePress}
          onToggleLike={handleRemoveFavorite}
          isFavorite={isFavoriteAlways}
          emptyMessage="Aucun favori trouvé"
          emptyIcon="heart-outline"
          testID="favorites-grid"
        />
      )}
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

  // Header
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    textAlign: 'center',
  },
  count: {
    marginTop: spacing.xs,
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    marginBottom: spacing.sm,
  },
  emptyText: {
    marginBottom: spacing.lg,
  },
  browseButton: {
    minWidth: 200,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
  },
});
