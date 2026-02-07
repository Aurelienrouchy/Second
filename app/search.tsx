import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { animations, colors, radius, spacing, typography } from '@/constants/theme';

import CategoryTree from '@/components/search/CategoryTree';
import RecentSearches from '@/components/search/RecentSearches';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import { colors as colorData, getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
import VisualSearchCamera from '@/components/VisualSearchCamera';
import ProductGrid from '@/components/ProductGrid';
import { useAuth } from '@/contexts/AuthContext';
import { useCategoryNavigation } from '@/hooks/useCategoryNavigation';
import { useArticleSearch } from '@/hooks/useArticleSearch';
import { SearchHistoryService, SearchHistoryItem } from '@/services/searchHistoryService';
import { SearchFilters, Article, ArticleWithLocation } from '@/types';

type SearchTab = 'search' | 'categories';

export default function SearchScreen() {
  const params = useLocalSearchParams<{ categoryPath?: string }>();
  const { user } = useAuth();

  const initialCategoryPath = params.categoryPath
    ? (JSON.parse(params.categoryPath) as string[])
    : undefined;

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('search');
  const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Partial<SearchFilters>>({});
  const [showVisualSearch, setShowVisualSearch] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Article search hook
  const {
    articles,
    searchQuery: activeSearchQuery,
    isLoading: isLoadingResults,
    isPaginating,
    setSearchQuery: setActiveSearchQuery,
    setFilters: setActiveFilters,
    loadMore,
  } = useArticleSearch({
    initialQuery: '',
    initialFilters: {},
  });

  const inputRef = useRef<TextInput>(null);

  // Filter bottom sheet refs
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const conditionSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);

  // Condition options
  const conditionItems = [
    { value: 'neuf', label: 'Neuf' },
    { value: 'très bon état', label: 'Très bon état' },
    { value: 'bon état', label: 'Bon état' },
    { value: 'satisfaisant', label: 'Satisfaisant' },
  ];

  // Category navigation hook
  const categoryNav = useCategoryNavigation({
    onSelect: (categoryIds) => {
      setSelectedFilters((prev) => ({ ...prev, categoryIds }));
      setActiveTab('search');
    },
  });

  // Initial setup
  useEffect(() => {
    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 100);
    // Load recent searches
    loadRecentSearches();

    // Apply initial category if provided
    if (initialCategoryPath && initialCategoryPath.length > 0) {
      setSelectedFilters((prev) => ({ ...prev, categoryIds: initialCategoryPath }));
      setActiveTab('categories');
    }
  }, []);

  // Auto-hide search results when query and filters are cleared
  useEffect(() => {
    if (!searchQuery.trim() && Object.keys(selectedFilters).length === 0) {
      setIsSearching(false);
    }
  }, [searchQuery, selectedFilters]);

  // Load recent searches
  const loadRecentSearches = async () => {
    if (!user) return;

    setIsLoadingHistory(true);
    try {
      const searches = await SearchHistoryService.getRecentSearches(user.id, 10);
      setRecentSearches(searches);
    } catch (error) {
      console.error('Error loading recent searches:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Handle close (go back)
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    router.back();
  }, []);

  // Handle search submission
  const handleSearch = useCallback(() => {
    const trimmedQuery = searchQuery.trim();

    // Save to history if user is logged in
    if (user && (trimmedQuery || Object.keys(selectedFilters).length > 0)) {
      SearchHistoryService.addSearchToHistory(user.id, trimmedQuery, selectedFilters).catch(
        console.error
      );
    }

    if (trimmedQuery || Object.keys(selectedFilters).length > 0) {
      // Trigger search inline
      setIsSearching(true);
      setActiveSearchQuery(trimmedQuery);
      setActiveFilters(selectedFilters);
      Keyboard.dismiss();
    }
  }, [searchQuery, selectedFilters, user, setActiveSearchQuery, setActiveFilters]);

  // Handle recent search tap
  const handleRecentSearchTap = useCallback((item: SearchHistoryItem) => {
    setSearchQuery(item.query);
    setSelectedFilters(item.filters);
    setIsSearching(true);
    setActiveSearchQuery(item.query || '');
    setActiveFilters(item.filters);
  }, [setActiveSearchQuery, setActiveFilters]);

  // Handle trending search tap
  const handleTrendingTap = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedFilters({});
    setIsSearching(true);
    setActiveSearchQuery(query);
    setActiveFilters({});
  }, [setActiveSearchQuery, setActiveFilters]);

  // Handle recent search delete
  const handleRecentSearchDelete = useCallback(
    async (item: SearchHistoryItem) => {
      if (!user) return;

      try {
        await SearchHistoryService.deleteSearchFromHistory(user.id, item.id);
        setRecentSearches((prev) => prev.filter((s) => s.id !== item.id));
      } catch (error) {
        console.error('Error deleting search:', error);
      }
    },
    [user]
  );

  // Clear filters
  const handleClearFilters = useCallback(() => {
    setSelectedFilters({});
    categoryNav.goToRoot();
    setIsSearching(false);
  }, [categoryNav]);

  // Handle product press
  const handleProductPress = useCallback(
    (article: Article | ArticleWithLocation) => {
      router.push(`/article/${article.id}`);
    },
    [router]
  );

  // Visual search handlers
  const handleOpenVisualSearch = useCallback(() => {
    Keyboard.dismiss();
    setShowVisualSearch(true);
  }, []);

  const handleCloseVisualSearch = useCallback(() => {
    setShowVisualSearch(false);
  }, []);

  const handleVisualSearchCapture = useCallback((imageUri: string) => {
    setShowVisualSearch(false);
    router.push({
      pathname: '/visual-search-results',
      params: { imageUri },
    });
  }, []);

  // Filter handlers
  const handleColorSelect = useCallback((color: string) => {
    setSelectedFilters((prev) => {
      const currentColors = prev.colors || [];
      if (currentColors.includes(color)) {
        return { ...prev, colors: currentColors.filter((c) => c !== color) };
      }
      return { ...prev, colors: [...currentColors, color] };
    });
  }, []);

  const handleMaterialSelect = useCallback((material: string) => {
    setSelectedFilters((prev) => {
      const currentMaterials = prev.materials || [];
      if (currentMaterials.includes(material)) {
        return { ...prev, materials: currentMaterials.filter((m) => m !== material) };
      }
      return { ...prev, materials: [...currentMaterials, material] };
    });
  }, []);

  const handleConditionSelect = useCallback((condition: string) => {
    setSelectedFilters((prev) => ({
      ...prev,
      condition: prev.condition === condition ? undefined : condition,
    }));
  }, []);

  const handleBrandsConfirm = useCallback((brands: string[]) => {
    setSelectedFilters((prev) => ({
      ...prev,
      brands: brands.length > 0 ? brands : undefined,
    }));
  }, []);

  const getFilterLabel = (filterType: string): string => {
    switch (filterType) {
      case 'colors':
        const selectedColors = selectedFilters.colors || [];
        if (selectedColors.length === 0) return 'Couleur';
        if (selectedColors.length === 1) {
          const color = colorData.find((c) => c.id === selectedColors[0]);
          return color?.name || selectedColors[0];
        }
        return `${selectedColors.length} couleurs`;
      case 'materials':
        const selectedMaterials = selectedFilters.materials || [];
        if (selectedMaterials.length === 0) return 'Matière';
        return selectedMaterials.length === 1
          ? selectedMaterials[0]
          : `${selectedMaterials.length} matières`;
      case 'condition':
        if (!selectedFilters.condition) return 'État';
        return conditionItems.find((c) => c.value === selectedFilters.condition)?.label || 'État';
      case 'brands':
        const selectedBrands = selectedFilters.brands || [];
        if (selectedBrands.length === 0) return 'Marque';
        return selectedBrands.length === 1
          ? selectedBrands[0]
          : `${selectedBrands.length} marques`;
      default:
        return filterType;
    }
  };

  const isFilterActive = (filterType: string): boolean => {
    switch (filterType) {
      case 'colors':
        return (selectedFilters.colors?.length || 0) > 0;
      case 'materials':
        return (selectedFilters.materials?.length || 0) > 0;
      case 'condition':
        return !!selectedFilters.condition;
      case 'brands':
        return (selectedFilters.brands?.length || 0) > 0;
      default:
        return false;
    }
  };

  const hasFilters = Object.keys(selectedFilters).length > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleClose} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>

        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={18} color={colors.muted} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <Pressable onPress={handleOpenVisualSearch} style={styles.cameraButton}>
          <Ionicons name="camera-outline" size={22} color={colors.primary} />
        </Pressable>

        {(searchQuery.length > 0 || hasFilters) && (
          <Pressable onPress={handleSearch} style={styles.searchButton}>
            <Text style={styles.searchButtonText}>OK</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'search' && styles.activeTab]}
          onPress={() => setActiveTab('search')}
        >
          <Text style={[styles.tabText, activeTab === 'search' && styles.activeTabText]}>
            Recherche
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'categories' && styles.activeTab]}
          onPress={() => setActiveTab('categories')}
        >
          <Text style={[styles.tabText, activeTab === 'categories' && styles.activeTabText]}>
            Catégories
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterChipsContainer}
        contentContainerStyle={styles.filterChipsContent}
      >
        <Pressable
          style={[styles.filterChipButton, isFilterActive('colors') && styles.filterChipButtonActive]}
          onPress={() => colorSheetRef.current?.show()}
        >
          <Text style={[styles.filterChipButtonText, isFilterActive('colors') && styles.filterChipButtonTextActive]}>
            {getFilterLabel('colors')}
          </Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={isFilterActive('colors') ? colors.white : colors.muted}
          />
        </Pressable>

        <Pressable
          style={[styles.filterChipButton, isFilterActive('condition') && styles.filterChipButtonActive]}
          onPress={() => conditionSheetRef.current?.show()}
        >
          <Text style={[styles.filterChipButtonText, isFilterActive('condition') && styles.filterChipButtonTextActive]}>
            {getFilterLabel('condition')}
          </Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={isFilterActive('condition') ? colors.white : colors.muted}
          />
        </Pressable>

        <Pressable
          style={[styles.filterChipButton, isFilterActive('brands') && styles.filterChipButtonActive]}
          onPress={() => brandSheetRef.current?.show()}
        >
          <Text style={[styles.filterChipButtonText, isFilterActive('brands') && styles.filterChipButtonTextActive]}>
            {getFilterLabel('brands')}
          </Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={isFilterActive('brands') ? colors.white : colors.muted}
          />
        </Pressable>

        <Pressable
          style={[styles.filterChipButton, isFilterActive('materials') && styles.filterChipButtonActive]}
          onPress={() => materialSheetRef.current?.show()}
        >
          <Text style={[styles.filterChipButtonText, isFilterActive('materials') && styles.filterChipButtonTextActive]}>
            {getFilterLabel('materials')}
          </Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={isFilterActive('materials') ? colors.white : colors.muted}
          />
        </Pressable>
      </ScrollView>

      {/* Active Filters */}
      {hasFilters && (
        <View style={styles.activeFiltersContainer}>
          {selectedFilters.categoryIds && selectedFilters.categoryIds.length > 0 && (
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText} numberOfLines={1}>
                {selectedFilters.categoryIds[selectedFilters.categoryIds.length - 1]}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  setSelectedFilters((prev) => {
                    const { categoryIds, ...rest } = prev;
                    return rest;
                  })
                }
              >
                <Ionicons name="close" size={16} color={colors.muted} />
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity onPress={handleClearFilters} style={styles.clearFiltersButton}>
            <Text style={styles.clearFiltersText}>Effacer tout</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {activeTab === 'search' ? (
          isSearching ? (
            // Search results
            <>
              {!isLoadingResults && articles.length > 0 && (
                <View style={styles.resultsCount}>
                  <Text style={styles.resultsText}>
                    {articles.length} article{articles.length > 1 ? 's' : ''} trouvé
                    {articles.length > 1 ? 's' : ''}
                  </Text>
                </View>
              )}
              <ProductGrid
                articles={articles}
                isLoading={isLoadingResults}
                isPaginating={isPaginating}
                onProductPress={handleProductPress}
                onEndReached={loadMore}
                onEndReachedThreshold={0.5}
                emptyMessage={
                  activeSearchQuery
                    ? `Aucun résultat pour "${activeSearchQuery}"`
                    : 'Aucun article trouvé avec ces filtres'
                }
              />
            </>
          ) : (
            // Recent searches
            <RecentSearches
              searches={recentSearches}
              isLoading={isLoadingHistory}
              onSearchTap={handleRecentSearchTap}
              onSearchDelete={handleRecentSearchDelete}
              onTrendingTap={handleTrendingTap}
            />
          )
        ) : (
          <CategoryTree
            navigationPath={categoryNav.navigationPath}
            currentList={categoryNav.currentList}
            currentTitle={categoryNav.currentTitle}
            isAtRoot={categoryNav.isAtRoot}
            onCategorySelect={categoryNav.selectCategory}
            onBack={categoryNav.goBack}
            onSelectCurrent={categoryNav.selectCurrent}
          />
        )}
      </View>

      {/* Visual Search Camera Modal */}
      <Modal
        visible={showVisualSearch}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleCloseVisualSearch}
      >
        <VisualSearchCamera
          onClose={handleCloseVisualSearch}
          onPhotoCapture={handleVisualSearchCapture}
        />
      </Modal>

      {/* Filter Bottom Sheets */}
      <SelectionBottomSheet
        ref={colorSheetRef}
        title="Couleur"
        items={getColorItems()}
        selectedValue={selectedFilters.colors?.[0]}
        onSelect={handleColorSelect}
        type="color"
      />

      <SelectionBottomSheet
        ref={conditionSheetRef}
        title="État"
        items={conditionItems}
        selectedValue={selectedFilters.condition}
        onSelect={handleConditionSelect}
      />

      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matière"
        items={getMaterialItems()}
        selectedValue={selectedFilters.materials?.[0]}
        onSelect={handleMaterialSelect}
      />

      <BrandSelectionSheet
        ref={brandSheetRef}
        selectedBrands={selectedFilters.brands || []}
        onConfirm={handleBrandsConfirm}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.borderLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    color: colors.foreground,
    paddingVertical: 0,
  },
  clearButton: {
    padding: spacing.xs,
  },
  cameraButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
    backgroundColor: colors.primaryLight,
  },
  searchButton: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
  },
  searchButtonText: {
    color: colors.white,
    fontFamily: typography.label.fontFamily,
    fontWeight: '600',
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: colors.foreground,
  },
  tabText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 15,
    color: colors.muted,
    fontWeight: '500',
  },
  activeTabText: {
    color: colors.foreground,
    fontWeight: '600',
  },
  activeFiltersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.borderLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: spacing.xs + 2,
    paddingLeft: spacing.sm + 4,
    paddingRight: spacing.sm,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipText: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 13,
    color: colors.foreground,
    marginRight: spacing.xs,
    maxWidth: 150,
  },
  clearFiltersButton: {
    marginLeft: 'auto',
  },
  clearFiltersText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
  filterChipsContainer: {
    maxHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipsContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.borderLight,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  filterChipButtonActive: {
    backgroundColor: colors.foreground,
  },
  filterChipButtonText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 14,
    color: colors.foreground,
    fontWeight: '500',
  },
  filterChipButtonTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  resultsCount: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.borderLight,
  },
  resultsText: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 13,
    color: colors.muted,
  },
});
