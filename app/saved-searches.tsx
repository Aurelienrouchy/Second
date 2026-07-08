/**
 * Saved Searches Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Lists the user's saved searches with filter summaries,
 * notification indicators, and new items badges.
 * Tap a card to navigate back to /search with restored params.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ScreenHeader, Skeleton } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { getColorName } from '@/data/colors';
import { getConditionLabel } from '@/data/conditions';
import { getLeafCategoryLabel } from '@/data/categories-v2';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { track } from '@/lib/analytics';
import { SavedSearchService } from '@/services/savedSearchService';
import type { SavedSearch } from '@/services/savedSearchService';
import type { SearchFilters } from '@/types';
import { formatPrice } from '@/utils/formatPrice';

/** Active filter dimension names for a saved-search snapshot. */
function filterKeysOf(f: Partial<SearchFilters> & { categoryIds?: string[] }): string[] {
  const keys: string[] = [];
  if ((f.categoryIds?.length ?? 0) > 0) keys.push('category');
  if ((f.colors?.length ?? 0) > 0) keys.push('colors');
  if ((f.sizes?.length ?? 0) > 0) keys.push('sizes');
  if ((f.materials?.length ?? 0) > 0) keys.push('materials');
  if ((f.brands?.length ?? 0) > 0) keys.push('brands');
  if (f.condition) keys.push('condition');
  if (f.minPrice !== undefined || f.maxPrice !== undefined) keys.push('price');
  if (f.sortBy && f.sortBy !== 'recent') keys.push('sort');
  return keys;
}

// =============================================================================
// FILTER SUMMARY HELPERS
// =============================================================================

function buildFilterTags(
  searchQuery: string,
  filters: Partial<SearchFilters>,
): string[] {
  const tags: string[] = [];

  if (searchQuery) {
    tags.push(`"${searchQuery}"`);
  }

  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const label = getLeafCategoryLabel(filters.categoryIds);
    if (label) tags.push(label);
  }

  if (filters.brands && filters.brands.length > 0) {
    tags.push(...filters.brands.slice(0, 2));
    if (filters.brands.length > 2) {
      tags.push(`+${filters.brands.length - 2}`);
    }
  }

  if (filters.colors && filters.colors.length > 0) {
    tags.push(...filters.colors.slice(0, 2).map(getColorName));
    if (filters.colors.length > 2) {
      tags.push(`+${filters.colors.length - 2}`);
    }
  }

  if (filters.sizes && filters.sizes.length > 0) {
    tags.push(filters.sizes.slice(0, 2).map((s) => s.value).join(', '));
    if (filters.sizes.length > 2) {
      tags.push(`+${filters.sizes.length - 2}`);
    }
  }

  if (filters.condition) {
    tags.push(getConditionLabel(filters.condition));
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const min = filters.minPrice ?? 0;
    const max = filters.maxPrice;
    if (max !== undefined) {
      tags.push(`${formatPrice(min)} - ${formatPrice(max)}`);
    } else {
      tags.push(`${formatPrice(min)}+`);
    }
  }

  return tags;
}

// =============================================================================
// FILTER TAG CHIP
// =============================================================================

const FilterTag = React.memo(function FilterTag({ label }: { label: string }) {
  return (
    <View style={styles.filterTag}>
      <Text style={styles.filterTagText}>{label}</Text>
    </View>
  );
});

// =============================================================================
// SAVED SEARCH CARD
// =============================================================================

interface SavedSearchCardProps {
  item: SavedSearch;
  index: number;
  onPress: () => void;
  onDelete: () => void;
  onToggleNotify: () => void;
}

const SavedSearchCard = React.memo(function SavedSearchCard({
  item,
  index,
  onPress,
  onDelete,
  onToggleNotify,
}: SavedSearchCardProps) {
  const tags = buildFilterTags(item.query, item.filters);
  const hasNewItems = (item.newItemsCount ?? 0) > 0;

  return (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 60)}>
      <Pressable style={styles.card} onPress={onPress}>
        {/* Top row: name + actions */}
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.name}
            </Text>
            {hasNewItems && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>{item.newItemsCount}</Text>
              </View>
            )}
          </View>

          <View style={styles.cardActions}>
            {/* Notification toggle */}
            <Pressable
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation?.();
                onToggleNotify();
              }}
              hitSlop={8}
            >
              <Ionicons
                name={item.notifyNewItems ? 'notifications' : 'notifications-outline'}
                size={18}
                color={item.notifyNewItems ? colors.primary : colors.muted}
              />
            </Pressable>

            {/* Delete */}
            <Pressable
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation?.();
                onDelete();
              }}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>

        {/* Filter tags */}
        {tags.length > 0 && (
          <View style={styles.tagsRow}>
            {tags.map((tag, i) => (
              <FilterTag key={`${tag}-${i}`} label={tag} />
            ))}
          </View>
        )}

        {/* Footer: new items indicator */}
        {hasNewItems && (
          <Text style={styles.newItemsText}>
            {item.newItemsCount === 1
              ? '1 nouvel article'
              : `${item.newItemsCount} nouveaux articles`}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
});

// =============================================================================
// SKELETON LOADER
// =============================================================================

function LoadingSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonHeader}>
            <Skeleton width="60%" height={18} />
            <Skeleton width={60} height={18} />
          </View>
          <View style={styles.skeletonTags}>
            <Skeleton width={80} height={24} borderRadius={radius.xs} />
            <Skeleton width={60} height={24} borderRadius={radius.xs} />
            <Skeleton width={50} height={24} borderRadius={radius.xs} />
          </View>
        </View>
      ))}
    </View>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState() {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
      <Ionicons name="bookmark-outline" size={48} color={colors.muted} />
      <Text style={styles.emptyTitle}>Aucune recherche sauvegardée</Text>
      <Text style={styles.emptySubtitle}>
        Sauvegardez une recherche depuis l&apos;écran de recherche pour la retrouver ici
      </Text>
    </Animated.View>
  );
}

// =============================================================================
// ERROR STATE
// =============================================================================

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
      <Text style={styles.emptyTitle}>Une erreur est survenue</Text>
      <Text style={styles.emptySubtitle}>
        Impossible de charger vos recherches sauvegardées. Vérifiez votre connexion.
      </Text>
      <Pressable style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryButtonText}>Réessayer</Text>
      </Pressable>
    </Animated.View>
  );
}

// =============================================================================
// MAIN SCREEN
// =============================================================================

export default function SavedSearches() {
  const { user, isLoggedIn, showAuthSheet } = useAuthRequired();
  const userId = user?.id;

  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Gate behind auth
  useEffect(() => {
    if (!isLoggedIn) {
      showAuthSheet('Connectez-vous pour voir vos recherches sauvegardées.');
    }
  }, [isLoggedIn, showAuthSheet]);

  // Load saved searches
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const load = async () => {
      try {
        setIsLoading(true);
        setHasError(false);
        const results = await SavedSearchService.getSavedSearches(userId);
        if (!cancelled) {
          setSearches(results);
        }
      } catch (error) {
        if (__DEV__) console.error('Failed to load saved searches:', error);
        if (!cancelled) {
          setHasError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  const handleRetry = useCallback(() => {
    track('error_retry_tapped', { screen: 'saved_searches', error_context: 'saved_searches_load' });
    setReloadKey((k) => k + 1);
  }, []);

  // Navigate to search with restored params
  const handlePress = useCallback(
    (item: SavedSearch) => {
      // Reset new items count when user taps the search
      if (userId && (item.newItemsCount ?? 0) > 0) {
        SavedSearchService.resetNewItemsCount(userId, item.id).catch(() => {
          // Best-effort; ignore errors
        });
      }

      track('saved_search_opened', {
        saved_search_id: item.id,
        new_items_count: item.newItemsCount ?? 0,
        has_query: !!item.query,
        filter_keys: filterKeysOf(item.filters),
        notify_enabled: !!item.notifyNewItems,
      });

      router.push({
        pathname: '/search',
        params: {
          query: item.query || '',
          filters: JSON.stringify(item.filters),
          source: 'saved_search',
        },
      });
    },
    [user?.id],
  );

  // Delete a saved search
  const handleDelete = useCallback(
    (item: SavedSearch) => {
      Alert.alert(
        'Supprimer cette recherche ?',
        `"${item.name}" sera supprimée définitivement.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: async () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              if (!user?.id) return;
              try {
                await SavedSearchService.deleteSavedSearch(user.id, item.id);
                setSearches((prev) => prev.filter((s) => s.id !== item.id));
                track('saved_search_deleted', {
                  saved_search_id: item.id,
                  outcome: 'confirmed',
                  notify_enabled: !!item.notifyNewItems,
                });
              } catch (error) {
                if (__DEV__) console.error('Failed to delete saved search:', error);
                track('saved_search_deleted', {
                  saved_search_id: item.id,
                  outcome: 'error',
                  notify_enabled: !!item.notifyNewItems,
                });
                Alert.alert('Erreur', 'Impossible de supprimer cette recherche.');
              }
            },
          },
        ],
      );
    },
    [user?.id],
  );

  // Toggle notifications for a saved search
  const handleToggleNotify = useCallback(
    async (item: SavedSearch) => {
      if (!user?.id) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const newValue = await SavedSearchService.toggleNotifications(user.id, item.id);
        setSearches((prev) =>
          prev.map((s) => (s.id === item.id ? { ...s, notifyNewItems: newValue } : s)),
        );
        track('saved_search_notify_toggled', {
          saved_search_id: item.id,
          new_value: newValue,
          outcome: 'success',
        });
      } catch (error) {
        if (__DEV__) console.error('Failed to toggle notifications:', error);
        track('saved_search_notify_toggled', {
          saved_search_id: item.id,
          new_value: !item.notifyNewItems,
          outcome: 'error',
        });
      }
    },
    [user?.id],
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Recherches sauvegardées"
        onBack={() => router.back()}
        rightContent={
          searches.length > 0 ? (
            <View style={styles.headerCountBadge}>
              <Text style={styles.headerCountText}>{searches.length}</Text>
            </View>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : hasError ? (
        <ErrorState onRetry={handleRetry} />
      ) : searches.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {searches.map((item, index) => (
            <SavedSearchCard
              key={item.id}
              item={item}
              index={index}
              onPress={() => handlePress(item)}
              onDelete={() => handleDelete(item)}
              onToggleNotify={() => handleToggleNotify(item)}
            />
          ))}
        </ScrollView>
      )}
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

  // Header
  headerCountBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
  },
  headerCountText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.primary,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing['2xl'],
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.none,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginRight: spacing.sm,
  },
  cardName: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: colors.foreground,
    flexShrink: 1,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // New items badge
  newBadge: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  newBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.white,
  },
  newItemsText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.primary,
    marginTop: spacing.sm,
  },

  // Filter tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  filterTag: {
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
  },
  filterTagText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.foregroundSecondary,
  },

  // Skeleton
  skeletonContainer: {
    padding: spacing.md,
  },
  skeletonCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  skeletonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  skeletonTags: {
    flexDirection: 'row',
    gap: spacing.xs,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  emptyTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    lineHeight: 26,
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },

  // Error state
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
  },
  retryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.white,
    letterSpacing: 0.3,
  },
});
