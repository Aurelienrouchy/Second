/**
 * Unified Search Results Page
 * Handles searches by category, brand, shop, and text query
 */

import ActiveFilters from '@/components/ActiveFilters';
import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import FilterChips, { createSortChips } from '@/components/FilterChips';
import ProductGrid from '@/components/ProductGrid';
import SaveSearchButton from '@/components/SaveSearchButton';
import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { useArticleSearch } from '@/hooks/useArticleSearch';
import { Article, ArticleWithLocation } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SearchResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    category?: string;
    brands?: string;
    shopId?: string;
    query?: string;
    filters?: string; // JSON stringified SearchFilters from SearchOverlay
  }>();

  const [searchText, setSearchText] = useState(params.query || '');
  const [selectedSort, setSelectedSort] = useState<string>('recent');
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);

  // Parse filters from JSON if passed from SearchOverlay
  const parsedFilters = useMemo(() => {
    if (params.filters) {
      try {
        return JSON.parse(params.filters);
      } catch (e) {
        console.warn('Failed to parse filters:', e);
        return {};
      }
    }
    return {};
  }, [params.filters]);

  // Préparer les filtres initiaux à partir des paramètres URL
  const initialFilters = useMemo(() => {
    const filters: any = { ...parsedFilters };
    if (params.brands) {
      filters.brands = params.brands.split(',');
    }
    // Remove categoryIds from filters as it's handled separately
    const { categoryIds, ...rest } = filters;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }, [params.brands, parsedFilters]);

  const initialCategoryPath = useMemo(() => {
    // Priority: parsedFilters.categoryIds > params.category
    if (parsedFilters.categoryIds && parsedFilters.categoryIds.length > 0) {
      return parsedFilters.categoryIds;
    }
    return params.category ? params.category.split(',') : undefined;
  }, [params.category, parsedFilters]);

  const {
    articles,
    filters,
    searchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating,
    hasActiveFilters,
    setFilters,
    setSearchQuery,
    setSelectedCategoryPath,
    search,
    loadMore,
    clearAllFilters,
    handleFilterRemove,
  } = useArticleSearch({
    initialFilters,
    initialQuery: params.query,
    initialCategoryPath,
  });

  // Debounced search
  const handleSearchSubmit = useCallback(() => {
    if (searchText.trim() !== searchQuery.trim()) {
      setSearchQuery(searchText);
    }
  }, [searchText, searchQuery, setSearchQuery]);

  // Handle category selection
  const handleCategorySelect = useCallback(
    (categoryPath: string[]) => {
      setSelectedCategoryPath(categoryPath);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [setSelectedCategoryPath]
  );

  // Handle category clear
  const handleCategoryClear = useCallback(() => {
    setSelectedCategoryPath([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [setSelectedCategoryPath]);

  // Handle filter press (navigate to filters screen)
  const handleFiltersPress = useCallback(() => {
    router.push('/filters');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [router]);

  // Handle sort change
  const handleSortChange = useCallback(
    (sortId: string) => {
      setSelectedSort(sortId);
      const sortBy =
        sortId === 'recent'
          ? 'recent'
          : sortId === 'price_asc'
          ? 'price_asc'
          : sortId === 'price_desc'
          ? 'price_desc'
          : sortId === 'popular'
          ? 'popular'
          : 'recent';
      setFilters({ ...filters, sortBy });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [filters, setFilters]
  );

  // Product press handler
  const handleProductPress = useCallback(
    (article: Article | ArticleWithLocation) => {
      router.push(`/article/${article.id}`);
    },
    [router],
  );


  const sortChips = useMemo(() => createSortChips(selectedSort), [selectedSort]);

  // Get page title based on search params
  const getPageTitle = () => {
    if (params.brands) {
      return 'Résultats par marque';
    }
    // Afficher le nom de la catégorie sélectionnée s'il y en a une
    if (selectedCategoryPath.length > 0) {
      return getCategoryLabelFromIds(selectedCategoryPath);
    }
    // Fallback legacy
    if (params.category) {
      return params.category;
    }
    if (params.shopId) {
      return 'Articles de la boutique';
    }
    return 'Résultats de recherche';
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#1C1C1E" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {getPageTitle()}
        </Text>
        <SaveSearchButton
          query={searchQuery}
          filters={{ ...filters, categoryIds: selectedCategoryPath }}
          style={styles.saveButton}
        />
      </View>

      {/* Search bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color="#8E8E93" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher des articles..."
            placeholderTextColor="#8E8E93"
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText('')}>
              <Ionicons name="close-circle" size={20} color="#8E8E93" />
            </Pressable>
          )}
        </View>

        {/* Category selector */}
        <Pressable style={styles.categoryButton} onPress={() => categorySheetRef.current?.show()}>
          <Ionicons name="grid-outline" size={20} color="#F79F24" />
        </Pressable>
      </View>

      {/* Sort chips */}
      <FilterChips
        chips={sortChips}
        selectedChipId={selectedSort}
        onChipPress={handleSortChange}
        onFilterPress={handleFiltersPress}
        showFilterButton={true}
      />

      {/* Active filters */}
      {hasActiveFilters && (
        <ActiveFilters
          filters={filters}
          selectedCategoryPath={selectedCategoryPath}
          onClearAll={clearAllFilters}
          onFilterRemove={handleFilterRemove}
          onCategoryClear={handleCategoryClear}
        />
      )}

      {/* Results count */}
      {!isLoading && articles.length > 0 && (
        <View style={styles.resultsCount}>
          <Text style={styles.resultsText}>
            {articles.length} article{articles.length > 1 ? 's' : ''} trouvé
            {articles.length > 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Products list */}
      <ProductGrid
        articles={articles}
        isLoading={isLoading}
        isPaginating={isPaginating}
        onLoadMore={loadMore}
        onProductPress={handleProductPress}
        emptyMessage={
          searchQuery
            ? `Aucun article trouvé pour "${searchQuery}"`
            : 'Affinez vos critères de recherche'
        }
        testID="search-results-grid"
      />

      {/* Category Bottom Sheet */}
      <CategoryBottomSheet
        ref={categorySheetRef}
        onSelect={handleCategorySelect}
        selectedCategoryIds={selectedCategoryPath}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    marginHorizontal: 16,
  },
  saveButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1C1C1E',
  },
  categoryButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
  },
  resultsCount: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F9F9F9',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  resultsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});

