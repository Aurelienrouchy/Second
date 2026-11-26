/**
 * Visual Search Results Screen
 * Displays products found by image-based visual search
 *
 * Flow: Camera → Preview → Confirm → This Screen
 * Route params: { imageUri: string }
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  RefreshControl,
  AppState,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography, radius } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { searchByImage, captureVisualSearchOwner, isVisualSearchImageUri, VisualSearchResult } from '@/features/search/services/visualSearchService';
import ProductCard from '@/components/ProductCard';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { staleTradeOperation } from '@/services/tradeOperation';
import { Skeleton } from '@/components/ui/Skeleton';

type VisualSearchErrorCode =
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'invalid-argument'
  | 'internal'
  | 'unavailable';

function mapErrorToCode(err: unknown): VisualSearchErrorCode {
  const details = err as {code?: unknown; message?: unknown} | null;
  const code = String(details?.code || details?.message || '');
  if (code.includes('unauthenticated')) return 'unauthenticated';
  if (code.includes('resource-exhausted')) return 'resource-exhausted';
  if (code.includes('invalid-argument')) return 'invalid-argument';
  if (code.includes('unavailable') || code.includes('network')) return 'unavailable';
  return 'internal';
}

function mapErrorToUserMessage(err: unknown): string {
  const details = err as {code?: unknown; message?: unknown} | null;
  const code = String(details?.code || details?.message || '');
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
const EMPTY_RESULTS: VisualSearchResult[] = [];

// ============================================================
// Component
// ============================================================

export default function VisualSearchResultsScreen() {
  const params = useLocalSearchParams<{ imageUri?: string | string[] }>();
  const imageUri = typeof params.imageUri === 'string' ? params.imageUri : '';
  const generation = useAuthStore(() => getAuthSessionGeneration());
  const owner = auth.currentUser;
  const activity = useRef({state: AppState.currentState, revision: 0});
  const [activityRevision, setActivityRevision] = useState(0);
  type Visit = {imageUri: string; generation: number; owner: typeof owner; activityRevision: number; active: boolean; locked: boolean; assertOwner: () => void};
  const currentVisit = useRef<Visit | null>(null);
  const automaticPhoto = useRef<string | null>(null);
  const completedSearch = useRef<{visit: Visit; results: VisualSearchResult[]} | null>(null);
  const [snapshot, setSnapshot] = useState<{visit: Visit; results: VisualSearchResult[]; loading: boolean; error: string | null} | null>(null);

  useEffect(() => {
    const completed = completedSearch.current;
    if (completed && (completed.visit.imageUri !== imageUri || completed.visit.owner !== owner ||
        completed.visit.generation !== generation)) {
      completedSearch.current = null;
    }
  }, [imageUri, owner, generation]);

  useEffect(() => {
    const changed = (state: typeof AppState.currentState) => {
      if (state === activity.current.state) return;
      activity.current = {state, revision: activity.current.revision + 1};
      if (currentVisit.current) currentVisit.current.active = false;
      completedSearch.current = null;
      setActivityRevision(activity.current.revision);
    };
    const subscription = AppState.addEventListener('change', changed);
    changed(AppState.currentState);
    return () => subscription.remove();
  }, []);

  const assertVisit = useCallback((visit: Visit) => {
    visit.assertOwner();
    if (!visit.active || currentVisit.current !== visit || visit.imageUri !== imageUri ||
        visit.owner !== auth.currentUser || visit.generation !== getAuthSessionGeneration() ||
        visit.activityRevision !== activity.current.revision || AppState.currentState !== 'active' || activity.current.state !== 'active') {
      throw staleTradeOperation();
    }
  }, [imageUri]);

  const performSearch = useCallback(async (isRetry = false) => {
    const visit = currentVisit.current;
    if (!visit || visit.imageUri !== imageUri || visit.generation !== generation || visit.owner !== owner) return;
    try {assertVisit(visit);} catch {return;}
    if (visit.locked) return;
    visit.locked = true;
    completedSearch.current = null;
    setSnapshot({visit, results: [], loading: true, error: null});
    const startedAt = Date.now();
    try {
      if (!isVisualSearchImageUri(imageUri)) throw Object.assign(new Error('Photo locale invalide.'), {code: 'invalid-argument'});
      const searchResults = await searchByImage(imageUri, undefined, 20, {assertCurrent: () => assertVisit(visit)});
      assertVisit(visit);
      completedSearch.current = {visit, results: searchResults};
      setSnapshot({visit, results: searchResults, loading: false, error: null});
      track('visual_search_performed', {outcome: searchResults.length === 0 ? 'empty' : 'success', results_count: searchResults.length,
        latency_ms: Date.now() - startedAt, is_retry: isRetry});
    } catch (err: unknown) {
      try {assertVisit(visit);} catch {return;}
      if (__DEV__) console.error('[VisualSearchResults] Search failed:', err);
      setSnapshot({visit, results: [], loading: false, error: mapErrorToUserMessage(err)});
      track('visual_search_performed', {outcome: 'error', results_count: 0, error_code: mapErrorToCode(err),
        latency_ms: Date.now() - startedAt, is_retry: isRetry});
    } finally {visit.locked = false;}
  }, [imageUri, generation, owner, assertVisit]);

  useFocusEffect(useCallback(() => {
    if (AppState.currentState !== 'active' || activity.current.state !== 'active') return;
    let assertOwner: () => void;
    try {assertOwner = captureVisualSearchOwner();} catch {return;}
    const visit: Visit = {imageUri, generation, owner, activityRevision, active: true, locked: false, assertOwner};
    currentVisit.current = visit;
    const completed = completedSearch.current;
    let canResume = completed && completed.visit.imageUri === imageUri && completed.visit.owner === owner &&
      completed.visit.generation === generation && completed.visit.activityRevision === activityRevision;
    if (canResume && completed) {
      try {completed.visit.assertOwner();} catch {canResume = false;}
    }
    if (canResume && completed) {
      // Opening an article only changes focus: rebind the completed results to
      // this visit without processing or sending the selected photo again.
      setSnapshot({visit, results: completed.results, loading: false, error: null});
    } else if (automaticPhoto.current !== imageUri) {
      completedSearch.current = null;
      automaticPhoto.current = imageUri;
      void performSearch();
    } else {
      completedSearch.current = null;
      // A new visit/session cannot silently re-send a previously selected photo.
      setSnapshot({visit, results: [], loading: false,
        error: 'La recherche a été interrompue. Réessayez pour analyser cette photo dans le contexte actuel.'});
    }
    return () => {visit.active = false; if (currentVisit.current === visit) currentVisit.current = null;};
  }, [imageUri, generation, owner, activityRevision, performSearch]));

  const displayedVisit = snapshot && snapshot.visit.imageUri === imageUri && snapshot.visit.generation === generation &&
    snapshot.visit.owner === owner && snapshot.visit.activityRevision === activityRevision ? snapshot.visit : null;
  const results = displayedVisit ? snapshot!.results : EMPTY_RESULTS;
  const isLoading = !displayedVisit || snapshot!.loading;
  const error = displayedVisit ? snapshot!.error : null;
  const assertDisplayedVisit = () => {if (!displayedVisit) throw staleTradeOperation(); assertVisit(displayedVisit);};
  const handleRetry = () => {
    try {assertDisplayedVisit();} catch {return;}
    track('error_retry_tapped', {screen: 'visual_search', error_context: 'visual_search'});
    void performSearch(true);
  };
  const handleNewSearch = () => {
    try {assertDisplayedVisit();} catch {return;}
    track('visual_search_abandoned', {action: 'new_search', stage: 'results_empty'});
    router.back();
  };
  const handleTextSearch = () => {
    try {assertDisplayedVisit();} catch {return;}
    track('visual_search_abandoned', {action: 'text_fallback', stage: 'results_empty'});
    router.replace({pathname: '/search', params: {source: 'visual_fallback'}});
  };
  const handleArticlePress = useCallback((item: VisualSearchResult) => {
    try {if (!displayedVisit) return; assertVisit(displayedVisit);} catch {return;}
    if (!results.includes(item)) return;
    track('article_card_tapped', {article_id: item.articleId, source: 'visual_search', price_cents: Math.round(item.price * 100),
      brand: item.brand, condition: item.condition, is_sold: false, similarity_pct: item.similarity});
    router.push(`/article/${item.articleId}`);
  }, [displayedVisit, assertVisit, results]);

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
          onPress={() => handleArticlePress(item)}
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
        <Text style={styles.loadingTitle}>Analyse de l&apos;image...</Text>
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
      <Text style={styles.emptyTitle}>Impossible d&apos;analyser l&apos;image</Text>
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
                onRefresh={handleRetry}
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
