import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { colors, fonts, spacing, typography } from '@/constants/theme';
import { ArticlesService } from '@/services/articlesService';
import { RecommendationService, SimilarProduct } from '@/services/recommendationService';
import { Article } from '@/types';

import ProductCard from './ProductCard';
import { COMPACT_CARD_WIDTH } from './ProductCard.constants';

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
  size?: string;
  condition: string;
}

/** Whether the result came from AI recs or category fallback */
interface SimilarProductsResult {
  products: DisplayProduct[];
  isAI: boolean;
}

/**
 * Pure fetch function: tries AI recommendations first, falls back to
 * category-based search if AI returns nothing or errors.
 */
async function fetchSimilarProducts(
  currentArticleId: string,
  category: string,
  maxResults: number,
): Promise<SimilarProductsResult> {
  // Try AI-powered recommendations first
  try {
    const aiResults = await RecommendationService.getSimilarProducts(
      currentArticleId,
      maxResults,
      false,
    );

    if (aiResults.length > 0) {
      const products: DisplayProduct[] = aiResults.map((p: SimilarProduct) => ({
        id: p.articleId,
        title: p.title,
        price: p.price,
        imageUrl: ArticlesService.fixStorageUrl(p.imageUrl),
        brand: p.brand,
        size: p.size,
        condition: p.condition,
      }));
      return { products, isAI: true };
    }
  } catch (error) {
    if (__DEV__) console.error('Error loading AI similar products:', error);
  }

  // Fallback to category-based search
  try {
    const results = await ArticlesService.searchArticles(
      '',
      { category, sortBy: 'recent' },
      maxResults + 5,
    );

    const filtered = results.articles
      .filter((article: Article) => article.id !== currentArticleId)
      .slice(0, maxResults);

    const products: DisplayProduct[] = filtered.map((article: Article) => ({
      id: article.id,
      title: article.title,
      price: article.price,
      imageUrl: article.images[0]?.url || '',
      brand: article.brand || null,
      size: article.size,
      condition: article.condition,
    }));
    return { products, isAI: false };
  } catch (error) {
    if (__DEV__) console.error('Error loading fallback products:', error);
    return { products: [], isAI: false };
  }
}

const CARD_WIDTH = COMPACT_CARD_WIDTH;

const SimilarProducts: React.FC<SimilarProductsProps> = ({
  currentArticleId,
  category,
  maxResults = 10,
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['similarProducts', currentArticleId, category],
    queryFn: () => fetchSimilarProducts(currentArticleId, category, maxResults),
    staleTime: 5 * 60 * 1000,  // 5 min
    enabled: !!currentArticleId,
  });

  const products = data?.products ?? [];
  const isAI = data?.isAI ?? true;

  const handleProductPress = useCallback((productId: string) => {
    router.push(`/article/${productId}`);
  }, []);

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
            {isAI ? 'Basé sur cette annonce' : 'De la même catégorie'}
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
                brand: item.brand || undefined,
                size: item.size,
                condition: item.condition,
              }}
              onPress={() => handleProductPress(item.id)}
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
    fontFamily: fonts.displayBold,
    fontSize: 18,
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
    paddingLeft: 0,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  cardContainer: {
    width: CARD_WIDTH,
  },
});

export default React.memo(SimilarProducts);
