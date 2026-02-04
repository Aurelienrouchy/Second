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
import { ActivityIndicator, TouchableOpacity } from 'react-native';

import { colors, spacing, typography, radius, shadows } from '@/constants/theme';
import { searchByImage, VisualSearchResult } from '@/services/visualSearchService';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import ProductCard from '@/components/ProductCard';

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

  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();

  const [results, setResults] = useState<VisualSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Run visual search on mount
  useEffect(() => {
    if (imageUri) {
      performSearch();
    }
  }, [imageUri]);

  const performSearch = async () => {
    if (!imageUri) return;

    setIsLoading(true);
    setError(null);

    try {
      const searchResults = await searchByImage(imageUri);
      setResults(searchResults);
    } catch (err: any) {
      console.error('[VisualSearchResults] Search failed:', err);
      setError(err.message || "Impossible d'analyser l'image");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    performSearch();
  };

  const handleNewSearch = () => {
    router.back();
  };

  const handleTextSearch = () => {
    router.replace('/search');
  };

  const handleArticlePress = useCallback((articleId: string) => {
    router.push(`/article/${articleId}`);
  }, []);

  const handleToggleLike = useCallback((articleId: string) => {
    requireAuth(
      () => toggleFavorite(articleId),
      AUTH_MESSAGES.like
    );
  }, [requireAuth, toggleFavorite]);

  // Use ref to avoid re-creating renderProduct when isFavorite changes
  const isFavoriteRef = React.useRef(isFavorite);
  isFavoriteRef.current = isFavorite;

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
            sellerName: item.brand || '',
            brand: item.brand,
            condition: item.condition as any,
            isLiked: isFavoriteRef.current(item.articleId),
          }}
          onPress={() => handleArticlePress(item.articleId)}
          onToggleLike={() => handleToggleLike(item.articleId)}
        />
        {/* Similarity badge overlay */}
        <View style={styles.similarityBadge}>
          <Text style={styles.similarityText}>{item.similarity}%</Text>
        </View>
      </View>
    ),
    [handleArticlePress, handleToggleLike]
  );

  // ─── Loading State ──────────────────────────────────────────
  const renderLoading = () => (
    <View style={styles.loadingContainer}>
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
      <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      <Text style={styles.loadingTitle}>Analyse de l'image...</Text>
      <Text style={styles.loadingSubtitle}>Recherche de produits similaires</Text>
    </View>
  );

  // ─── Error State ────────────────────────────────────────────
  const renderError = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="alert-circle-outline" size={56} color={colors.muted} />
      <Text style={styles.emptyTitle}>Impossible d'analyser l'image</Text>
      <Text style={styles.emptySubtitle}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
        <Ionicons name="refresh-outline" size={20} color={colors.white} />
        <Text style={styles.retryButtonText}>Réessayer</Text>
      </TouchableOpacity>
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
        <TouchableOpacity style={styles.newSearchButton} onPress={handleNewSearch}>
          <Ionicons name="camera-outline" size={20} color={colors.foreground} />
          <Text style={styles.newSearchButtonText}>Nouvelle recherche</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.textSearchButton} onPress={handleTextSearch}>
          <Ionicons name="search-outline" size={20} color={colors.white} />
          <Text style={styles.textSearchButtonText}>Recherche texte</Text>
        </TouchableOpacity>
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
            estimatedItemSize={280}
            ListHeaderComponent={renderHeader}
            showsVerticalScrollIndicator={false}
            extraData={favorites}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={performSearch}
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
    zIndex: 10,
  },
  similarityText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: typography.label.fontFamily,
    fontWeight: '600',
  },

  // ─── Loading ────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingImageContainer: {
    width: 160,
    height: 160,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    position: 'relative',
  },
  loadingImage: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  spinner: {
    marginBottom: spacing.md,
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
