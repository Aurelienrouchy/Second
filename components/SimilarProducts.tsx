import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { colors, spacing, typography } from '@/constants/theme';
import { ArticlesService } from '@/services/articlesService';
import { RecommendationService, SimilarProduct } from '@/services/recommendationService';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { Article } from '@/types';

import ProductCard, { COMPACT_CARD_WIDTH } from './ProductCard';

interface SimilarProductsProps {
  currentArticleId: string;
  category: string;
  maxResults?: number;
}

// Unified product type for display
interface DisplayProduct {
  id: string;
  title: string;
  price: number;
  imageUrl: string;
  brand: string | null;
  condition: string;
}

const CARD_WIDTH = COMPACT_CARD_WIDTH;

const SimilarProducts: React.FC<SimilarProductsProps> = ({
  currentArticleId,
  category,
  maxResults = 10,
}) => {
  const [products, setProducts] = useState<DisplayProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [useAI, setUseAI] = useState(true);

  const { isFavorite, toggleFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();

  useEffect(() => {
    loadSimilarProducts();
  }, [currentArticleId, category]);

  const loadSimilarProducts = async () => {
    setIsLoading(true);
    try {
      // Try AI-powered recommendations first
      if (useAI) {
        const aiResults = await RecommendationService.getSimilarProducts(
          currentArticleId,
          maxResults,
          false
        );

        if (aiResults.length > 0) {
          // Transform AI results to display format
          const displayProducts: DisplayProduct[] = aiResults.map((p: SimilarProduct) => ({
            id: p.articleId,
            title: p.title,
            price: p.price,
            imageUrl: ArticlesService.fixStorageUrl(p.imageUrl),
            brand: p.brand,
            condition: p.condition,
          }));
          setProducts(displayProducts);
          setIsLoading(false);
          return;
        }
      }

      // Fallback to category-based search
      await loadFallbackProducts();
    } catch (error) {
      console.error('Error loading AI similar products:', error);
      // Fallback on error
      await loadFallbackProducts();
    }
  };

  const loadFallbackProducts = async () => {
    try {
      const results = await ArticlesService.searchArticles(
        '',
        {
          category: category,
          sortBy: 'recent',
        },
        maxResults + 5
      );

      const filtered = results.articles
        .filter((article: Article) => article.id !== currentArticleId)
        .slice(0, maxResults);

      const displayProducts: DisplayProduct[] = filtered.map((article: Article) => ({
        id: article.id,
        title: article.title,
        price: article.price,
        imageUrl: article.images[0]?.url || '',
        brand: article.brand || null,
        condition: article.condition,
      }));

      setProducts(displayProducts);
      setUseAI(false);
    } catch (error) {
      console.error('Error loading fallback products:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProductPress = useCallback((productId: string) => {
    router.push(`/article/${productId}`);
  }, []);

  const handleToggleLike = useCallback((productId: string) => {
    requireAuth(
      () => toggleFavorite(productId),
      AUTH_MESSAGES.like
    );
  }, [requireAuth, toggleFavorite]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>Dans le même style</Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.sectionTitle}>Dans le même style</Text>
          <Text style={styles.sectionSubtitle}>
            {useAI ? 'Basé sur cette annonce' : 'De la même catégorie'}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {products.map((item) => (
          <View key={item.id} style={styles.cardContainer}>
            <ProductCard
              product={{
                id: item.id,
                title: item.title,
                price: item.price,
                images: item.imageUrl ? [{ url: item.imageUrl }] : [],
                sellerName: item.brand || '',
                brand: item.brand || undefined,
                condition: item.condition as any,
                isLiked: isFavorite(item.id),
              }}
              onPress={() => handleProductPress(item.id)}
              onToggleLike={() => handleToggleLike(item.id)}
              compact
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
  },
  sectionSubtitle: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  loadingContainer: {
    height: CARD_WIDTH * (5 / 4) + 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  cardContainer: {
    width: CARD_WIDTH,
  },
});

export default SimilarProducts;
