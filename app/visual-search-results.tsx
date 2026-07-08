/**
 * Visual Search Results Screen
 * Displays products found by image-based visual search
 *
 * Flow: Camera → Preview → Confirm → This Screen
 * Route params: { imageUri: string }
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography, radius } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { searchByImage, VisualSearchResult } from '@/services/visualSearchService';
import ProductCard from '@/components/ProductCard';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';

type VisualSearchErrorCode =
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'invalid-argument'
  | 'internal'
  | 'unavailable';

function mapErrorToCode(err: any): VisualSearchErrorCode {
  const code = String(err?.code || err?.message || '');
  if (code.includes('unauthenticated')) return 'unauthenticated';
  if (code.includes('resource-exhausted')) return 'resource-exhausted';
  if (code.includes('invalid-argument')) return 'invalid-argument';
  if (code.includes('unavailable') || code.includes('network')) return 'unavailable';
  return 'internal';
}

function mapErrorToUserMessage(err: any): string {
  const code = err?.code || err?.message || '';
  if (code.includes('unauthenticated'))
    return 'Session expirée. Veuillez vous reconnecter et réessayer.';
  if (code.includes('resource-exhausted'))
    return 'Vous avez atteint la limite de recherches. Réessayez dans quelques instants.';
  if (code.includes('invalid-argument'))
    return "L'image n'a pas pu être traitée. Essayez avec une autre photo.";
  if (code.includes('internal'))
    return "L'analyse de l'image a échoué. Essayez avec une autre photo.";
  if (code.includes('unavailable') || code.includes('network'))
    return 'Connexion impossible. Vérifiez votre connexion internet.';
  return 'Une erreur est survenue. Veuillez réessayer.';
}

// ============================================================
// Constants
// ============================================================

const { width: screenWidth } = Dimensions.get('window');

// ============================================================
// Component
// ============================================================

export default function VisualSearchResultsScreen() {
  const params = useLocalSearchParams<{ imageUri: string }>();
  const { imageUri } = params;

  const [results, setResults] = useState<VisualSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Run visual search on mount
  useEffect(() => {
    if (imageUri) {
      performSearch();
    }
  }, [imageUri]);

  const performSearch = async (isRetry = false) => {
    if (!imageUri) return;

    setIsLoading(true);
    setError(null);

    const startedAt = Date.now();
    try {
      const searchResults = await searchByImage(imageUri);
      setResults(searchResults);
      track('visual_search_performed', {
        outcome: searchResults.length === 0 ? 'empty' : 'success',
        results_count: searchResults.length,
        latency_ms: Date.now() - startedAt,
        is_retry: isRetry,
      });
    } catch (err: any) {
      if (__DEV__) console.error('[VisualSearchResults] Search failed:', err);
      setError(mapErrorToUserMessage(err));
      track('visual_search_performed', {
        outcome: 'error',
        results_count: 0,
        error_code: mapErrorToCode(err),
        latency_ms: Date.now() - startedAt,
        is_retry: isRetry,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    performSearch(true);
  };

  const handleNewSearch = () => {
    track('visual_search_abandoned', { action: 'new_search', stage: 'results_empty' });
    router.back();
  };

  const handleTextSearch = () => {
    track('visual_search_abandoned', { action: 'text_fallback', stage: 'results_empty' });
    router.replace({ pathname: '/search', params: { source: 'visual_fallback' } });
  };

  const handleArticlePress = useCallback((articleId: string) => {
    router.push(`/article/${articleId}`);
  }, []);

  // ─── Render Product Card ────────────────────────────────────
  const renderProductCard = useCallback(
    ({ item }: { item: VisualSearchResult }) => (
      <View style={styles.cardWrapper}>
        <ProductCard
          product={{
            id: item.articleId,
            title: item.title,
            price: item.price,
            images: item.imageUrl ? [{ url: item.imageUrl }] : [],
            brand: item.brand,
            size: item.size,
            condition: item.condition,
          }}
          onPress={() => handleArticlePress(item.articleId)}
        />
        {/* Similarity badge overlay */}
        <View style={styles.similarityBadge}>
          <Text style={styles.similarityText}>{item.similarity}%</Text>
        </View>
      </View>
    ),
    [handleArticlePress]
  );

  // ─── Loading State ──────────────────────────────────────────
  const renderLoading = () => (
    <View style={styles.loadingContainer}>
      {/* Source image preview + text */}
      <View style={styles.loadingHeader}>
        {imageUri && (
          <View style={styles.loadingImageContainer}>
            <Image
              source={{ uri: imageUri }}
              style={styles.loadingImage}
              contentFit="cover"
              blurRadius={3}
            />
            <View style={styles.loadingOverlay} />
          </View>
        )}
        <Text style={styles.loadingTitle}>Analyse de l'image...</Text>
        <Text style={styles.loadingSubtitle}>Recherche de produits similaires</Text>
      </View>
      {/* Skeleton product grid */}
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </View>
    </View>
  );

  // ─── Error State ────────────────────────────────────────────
  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="alert-circle-outline" size={56} color={colors.muted} />
      <Text style={styles.emptyTitle}>Impossible d'analyser l'image</Text>
      <Text style={styles.emptySubtitle}>{error}</Text>
      <Pressable style={styles.retryButton} onPress={handleRetry}>
        <Ionicons name="refresh-outline" size={20} color={colors.white} />
        <Text style={styles.retryButtonText}>Réessayer</Text>
      </Pressable>
    </View>
  );

  // ─── Empty State ────────────────────────────────────────────
  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="camera-outline" size={56} color={colors.muted} />
      <Text style={styles.emptyTitle}>Aucun produit similaire trouvé</Text>
      <Text style={styles.emptySubtitle}>
        Essayez avec une photo plus nette ou un angle différent
      </Text>
      <View style={styles.emptyActions}>
        <Pressable style={styles.newSearchButton} onPress={handleNewSearch}>
          <Ionicons name="camera-outline" size={20} color={colors.foreground} />
          <Text style={styles.newSearchButtonText}>Nouvelle recherche</Text>
        </Pressable>
        <Pressable style={styles.textSearchButton} onPress={handleTextSearch}>
          <Ionicons name="search-outline" size={20} color={colors.white} />
          <Text style={styles.textSearchButtonText}>Recherche texte</Text>
        </Pressable>
      </View>
    </View>
  );

  // ─── Results Header ─────────────────────────────────────────
  const renderHeader = useCallback(() => (
    <View style={styles.resultsHeader}>
      {imageUri && (
        <View style={styles.sourceImageContainer}>
          <Image
            source={{ uri: imageUri }}
            style={styles.sourceImage}
            contentFit="cover"
          />
        </View>
      )}
      <View style={styles.resultsInfo}>
        <Text style={styles.resultsCount}>
          {results.length} résultat{results.length !== 1 ? 's' : ''} trouvé{results.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  ), [imageUri, results.length]);

  // ─── Main Render ────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Résultats visuels</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      {isLoading ? (
        renderLoading()
      ) : error ? (
        renderError()
      ) : results.length === 0 ? (
        renderEmpty()
      ) : (
        <View style={styles.gridContainer}>
          <FlashList
            data={results}
            renderItem={renderProductCard}
            keyExtractor={(item) => item.articleId}
            numColumns={2}
            ListHeaderComponent={renderHeader}
            showsVerticalScrollIndicator={false}
            // @ts-expect-error estimatedItemSize valid at runtime
            estimatedItemSize={280}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={() => performSearch(true)}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}

// ============================================================
// Skeleton
// ============================================================

const CARD_WIDTH = (screenWidth - spacing.md * 3) / 2;

const ProductCardSkeleton = React.memo(function ProductCardSkeleton() {
  return (
    <View style={styles.skeletonCard}>
      <Skeleton width={CARD_WIDTH} height={CARD_WIDTH * 1.25} borderRadius={radius.sm} />
      <View style={styles.skeletonCardBody}>
        <Skeleton width={CARD_WIDTH * 0.6} height={14} borderRadius={radius.xs} />
        <Skeleton width={CARD_WIDTH * 0.4} height={12} borderRadius={radius.xs} style={{ marginTop: 6 }} />
        <Skeleton width={60} height={16} borderRadius={radius.xs} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
});

// ============================================================
// Styles
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ─── Header ─────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: typography.label.fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
  },
  headerSpacer: {
    width: 44,
  },

  // ─── Results Header ─────────────────────────────────────────
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  sourceImageContainer: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.borderLight,
  },
  sourceImage: {
    width: '100%',
    height: '100%',
  },
  resultsInfo: {
    flex: 1,
  },
  resultsCount: {
    fontFamily: typography.label.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.foreground,
  },

  // ─── Grid ───────────────────────────────────────────────────
  gridContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 100,
  },

  // ─── Card Wrapper with Similarity Badge ─────────────────────
  cardWrapper: {
    position: 'relative',
  },
  similarityBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
    zIndex: 10,
  },
  similarityText: {
    color: colors.white,
    fontSize: 11,
    fontFamily: typography.label.fontFamily,
    fontWeight: '600',
  },

  // ─── Loading ────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
  },
  loadingHeader: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  loadingImageContainer: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
    position: 'relative',
  },
  loadingImage: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.whiteTranslucent,
  },
  loadingTitle: {
    fontFamily: typography.label.fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  loadingSubtitle: {
    fontFamily: typography.body.fontFamily,
    fontSize: 15,
    color: colors.muted,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  skeletonCard: {
    width: CARD_WIDTH,
  },
  skeletonCardBody: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },

  // ─── Empty / Error ──────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    fontFamily: typography.label.fontFamily,
    fontSize: 18,
    fontWeight: '600',
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: typography.body.fontFamily,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  newSearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  newSearchButtonText: {
    fontFamily: typography.button.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.foreground,
  },
  textSearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  textSearchButtonText: {
    fontFamily: typography.button.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  retryButtonText: {
    fontFamily: typography.button.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
});
