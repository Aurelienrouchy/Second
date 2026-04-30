/**
 * Search Screen — Seconde (Unified)
 *
 * Merges editorial search (recent/trending, category tree, visual search)
 * with full-featured results (filters, sort, price, sizes).
 *
 * States:
 *  - idle  → shows recent & trending searches (tab RECHERCHE)
 *            or category tree (tab CATEGORIES)
 *  - searching → shows filter bar, sort row, product grid
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 * Palette: cream, charcoal, rust, sage — sharp corners.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, spacing } from '@/constants/theme';

import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import ProductGrid from '@/components/ProductGrid';
import SaveSearchButton from '@/components/SaveSearchButton';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import SizeSelectionSheet, { SizeSelectionSheetRef } from '@/components/SizeSelectionSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';
import RecentSearches from '@/components/search/RecentSearches';
import VisualSearchCamera from '@/components/VisualSearchCamera';

import { CATEGORIES, getCategoryLabelFromIds } from '@/data/categories-v2';
import { colors as colorData, getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';
// getSizeItems kept for legacy; SizeSelectionSheet uses data/sizes directly

import { useAuth } from '@/contexts/AuthContext';
import { useArticleSearch } from '@/hooks/useArticleSearch';
import { useCategoryNavigation } from '@/hooks/useCategoryNavigation';
import { SearchHistoryService, SearchHistoryItem } from '@/services/searchHistoryService';
import { Article, ArticleWithLocation, SearchFilters, SortBy } from '@/types';

// ─── Constants ───────────────────────────────────────────────────────
const CONDITION_ITEMS = [
  { value: 'neuf', label: 'Neuf' },
  { value: 'très bon état', label: 'Tres bon etat' },
  { value: 'bon état', label: 'Bon etat' },
  { value: 'satisfaisant', label: 'Satisfaisant' },
];

const SORT_ITEMS = [
  { value: 'recent', label: 'Plus recents' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix decroissant' },
];

// ═════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════

export default function SearchScreen() {
  // ─── Params (supports both old search & search-results params) ───
  const params = useLocalSearchParams<{
    categoryPath?: string;   // JSON array from home header (old)
    category?: string;       // comma-separated IDs (from category buttons / deep links)
    brands?: string;
    shopId?: string;
    query?: string;
    filters?: string;        // JSON stringified SearchFilters
  }>();

  const { user } = useAuth();

  // ─── Derive initial values from params ───────────────────────────
  const parsedFilters = useMemo(() => {
    if (params.filters) {
      try { return JSON.parse(params.filters); }
      catch { return {}; }
    }
    return {};
  }, [params.filters]);

  const initialCategoryPath = useMemo(() => {
    // Priority: parsedFilters.categoryIds > categoryPath param > category param
    if (parsedFilters.categoryIds?.length > 0) return parsedFilters.categoryIds;
    if (params.categoryPath) {
      try { return JSON.parse(params.categoryPath) as string[]; }
      catch { return undefined; }
    }
    if (params.category) return params.category.split(',');
    return undefined;
  }, [params.categoryPath, params.category, parsedFilters]);

  const initialFilters = useMemo(() => {
    const f: any = { ...parsedFilters };
    if (params.brands) f.brands = params.brands.split(',');
    const { categoryIds, ...rest } = f;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }, [params.brands, parsedFilters]);

  // Did we arrive with initial params that should show results immediately?
  const hasInitialContext = !!(
    params.query || params.category || params.categoryPath ||
    params.brands || params.shopId || params.filters
  );

  // ─── State ───────────────────────────────────────────────────────
  const [searchQuery, setSearchQueryLocal] = useState(params.query || '');
  const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showVisualSearch, setShowVisualSearch] = useState(false);
  const [isSearching, setIsSearching] = useState(hasInitialContext);
  const [selectedSort, setSelectedSort] = useState<SortBy>('recent');
  const [showPriceInputs, setShowPriceInputs] = useState(false);
  const [minPriceText, setMinPriceText] = useState('');
  const [maxPriceText, setMaxPriceText] = useState('');

  // ─── Refs ────────────────────────────────────────────────────────
  const inputRef = useRef<TextInput>(null);
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SizeSelectionSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const conditionSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);
  const sortSheetRef = useRef<SelectionBottomSheetRef>(null);

  // ─── Article search hook ─────────────────────────────────────────
  const {
    articles,
    filters,
    searchQuery: activeSearchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating,
    hasActiveFilters,
    setFilters,
    setSearchQuery: setActiveSearchQuery,
    setSelectedCategoryPath,
    loadMore,
    clearAllFilters,
    handleFilterRemove,
  } = useArticleSearch({
    initialFilters,
    initialQuery: params.query,
    initialCategoryPath,
  });

  // ─── Category navigation (used by CategoryBottomSheet) ──────────
  const categoryNav = useCategoryNavigation({
    onSelect: (categoryIds) => {
      setSelectedCategoryPath(categoryIds);
      setIsSearching(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  // ─── Init ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasInitialContext) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    loadRecentSearches();
  }, []);

  // Auto-hide results when everything is cleared
  useEffect(() => {
    if (
      !searchQuery.trim() &&
      selectedCategoryPath.length === 0 &&
      !hasActiveFilters
    ) {
      setIsSearching(false);
    }
  }, [searchQuery, selectedCategoryPath, hasActiveFilters]);

  // ─── Recent searches ────────────────────────────────────────────
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

  // ─── Navigation handlers ────────────────────────────────────────
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    router.back();
  }, []);

  const handleProductPress = useCallback(
    (article: Article | ArticleWithLocation) => {
      router.push(`/article/${article.id}`);
    },
    []
  );

  // ─── Search handlers ────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const trimmedQuery = searchQuery.trim();
    if (user && (trimmedQuery || hasActiveFilters || selectedCategoryPath.length > 0)) {
      SearchHistoryService.addSearchToHistory(
        user.id, trimmedQuery, { ...filters, categoryIds: selectedCategoryPath }
      ).catch(console.error);
    }
    if (trimmedQuery || hasActiveFilters || selectedCategoryPath.length > 0) {
      setIsSearching(true);
      setActiveSearchQuery(trimmedQuery);
      Keyboard.dismiss();
    }
  }, [searchQuery, filters, selectedCategoryPath, hasActiveFilters, user, setActiveSearchQuery]);

  const handleRecentSearchTap = useCallback((item: SearchHistoryItem) => {
    setSearchQueryLocal(item.query);
    setFilters(item.filters as any);
    if (item.filters.categoryIds) {
      setSelectedCategoryPath(item.filters.categoryIds);
    }
    setIsSearching(true);
    setActiveSearchQuery(item.query || '');
  }, [setActiveSearchQuery, setFilters, setSelectedCategoryPath]);

  const handleTrendingTap = useCallback((query: string) => {
    setSearchQueryLocal(query);
    setIsSearching(true);
    setActiveSearchQuery(query);
  }, [setActiveSearchQuery]);

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

  const handleClearAll = useCallback(() => {
    setSearchQueryLocal('');
    clearAllFilters();
    categoryNav.goToRoot();
    setIsSearching(false);
    setSelectedSort('recent');
    setMinPriceText('');
    setMaxPriceText('');
    setShowPriceInputs(false);
  }, [clearAllFilters, categoryNav]);

  // ─── Visual search ──────────────────────────────────────────────
  const handleOpenVisualSearch = useCallback(() => {
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowVisualSearch(true);
  }, []);

  const handleVisualSearchCapture = useCallback((imageUri: string) => {
    setShowVisualSearch(false);
    router.push({ pathname: '/visual-search-results', params: { imageUri } });
  }, []);

  // ─── Sort handler ───────────────────────────────────────────────
  const handleSortSelect = useCallback(
    (sortId: string) => {
      setSelectedSort(sortId as SortBy);
      setFilters({ ...filters, sortBy: sortId as SortBy });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [filters, setFilters]
  );

  // ─── Filter handlers (multi-select) ─────────────────────────────
  const handleCategorySelect = useCallback(
    (categoryPath: string[]) => {
      setSelectedCategoryPath(categoryPath);
      setIsSearching(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [setSelectedCategoryPath]
  );

  const handleColorSelect = useCallback(
    (color: string) => {
      const cur = filters.colors || [];
      const next = cur.includes(color) ? cur.filter((c: string) => c !== color) : [...cur, color];
      setFilters({ ...filters, colors: next });
      if (!isSearching) setIsSearching(true);
    },
    [filters, setFilters, isSearching]
  );

  const handleSizesConfirm = useCallback(
    (sizes: string[]) => {
      setFilters({ ...filters, sizes });
      if (!isSearching && sizes.length > 0) setIsSearching(true);
    },
    [filters, setFilters, isSearching]
  );

  const handleMaterialSelect = useCallback(
    (material: string) => {
      const cur = filters.materials || [];
      const next = cur.includes(material) ? cur.filter((m: string) => m !== material) : [...cur, material];
      setFilters({ ...filters, materials: next });
      if (!isSearching) setIsSearching(true);
    },
    [filters, setFilters, isSearching]
  );

  const handleConditionSelect = useCallback(
    (condition: string) => {
      setFilters({ ...filters, condition: filters.condition === condition ? undefined : condition });
      if (!isSearching) setIsSearching(true);
    },
    [filters, setFilters, isSearching]
  );

  const handleBrandsConfirm = useCallback(
    (brands: string[]) => {
      setFilters({ ...filters, brands: brands.length > 0 ? brands : undefined });
      if (!isSearching && brands.length > 0) setIsSearching(true);
    },
    [filters, setFilters, isSearching]
  );

  const handlePriceApply = useCallback(() => {
    const minPrice = minPriceText ? parseFloat(minPriceText) : undefined;
    const maxPrice = maxPriceText ? parseFloat(maxPriceText) : undefined;
    setFilters({ ...filters, minPrice, maxPrice });
    setShowPriceInputs(false);
    if (!isSearching && (minPrice || maxPrice)) setIsSearching(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [minPriceText, maxPriceText, filters, setFilters, isSearching]);

  const handlePriceClear = useCallback(() => {
    setMinPriceText('');
    setMaxPriceText('');
    setFilters({ ...filters, minPrice: undefined, maxPrice: undefined });
    setShowPriceInputs(false);
  }, [filters, setFilters]);

  // ─── Label helpers ──────────────────────────────────────────────
  const getCategoryLabel = (): string =>
    selectedCategoryPath.length > 0 ? getCategoryLabelFromIds(selectedCategoryPath) : 'Categorie';

  const getColorLabel = (): string => {
    const sel = filters.colors || [];
    if (sel.length === 0) return 'Couleur';
    if (sel.length === 1) return colorData.find((c) => c.id === sel[0])?.name || sel[0];
    return `${sel.length} couleurs`;
  };

  const getSizeLabel = (): string => {
    const sel = filters.sizes || [];
    if (sel.length === 0) return 'Taille';
    if (sel.length === 1) return sel[0];
    return `${sel.length} tailles`;
  };

  const getMaterialLabel = (): string => {
    const sel = filters.materials || [];
    if (sel.length === 0) return 'Matiere';
    if (sel.length === 1) return sel[0];
    return `${sel.length} matieres`;
  };

  const getBrandLabel = (): string => {
    const sel = filters.brands || [];
    if (sel.length === 0) return 'Marque';
    if (sel.length === 1) return sel[0];
    return `${sel.length} marques`;
  };

  const getConditionLabel = (): string => {
    if (!filters.condition) return 'Etat';
    return CONDITION_ITEMS.find((c) => c.value === filters.condition)?.label || 'Etat';
  };

  const getPriceLabel = (): string => {
    if (filters.minPrice && filters.maxPrice) return `${filters.minPrice}$ - ${filters.maxPrice}$`;
    if (filters.minPrice) return `Min ${filters.minPrice}$`;
    if (filters.maxPrice) return `Max ${filters.maxPrice}$`;
    return 'Prix';
  };

  const getSortLabel = (): string => {
    const item = SORT_ITEMS.find((s) => s.value === selectedSort);
    return item ? item.label : 'Trier';
  };

  // ─── Active state helpers ───────────────────────────────────────
  const isCategoryActive = selectedCategoryPath.length > 0;
  const isColorActive = (filters.colors?.length || 0) > 0;
  const isSizeActive = (filters.sizes?.length || 0) > 0;
  const isMaterialActive = (filters.materials?.length || 0) > 0;
  const isBrandActive = (filters.brands?.length || 0) > 0;
  const isConditionActive = !!filters.condition;
  const isPriceActive = !!(filters.minPrice || filters.maxPrice);

  const anyFilterActive =
    isCategoryActive || isColorActive || isSizeActive || isMaterialActive ||
    isBrandActive || isConditionActive || isPriceActive;

  // ─── Filter chips config ────────────────────────────────────────
  const isSortActive = selectedSort !== 'recent';

  const filterChips = [
    { key: 'sort', label: getSortLabel(), active: isSortActive, onPress: () => sortSheetRef.current?.show() },
    { key: 'category', label: getCategoryLabel(), active: isCategoryActive, onPress: () => categorySheetRef.current?.show() },
    { key: 'colors', label: getColorLabel(), active: isColorActive, onPress: () => colorSheetRef.current?.show() },
    { key: 'sizes', label: getSizeLabel(), active: isSizeActive, onPress: () => sizeSheetRef.current?.show() },
    { key: 'materials', label: getMaterialLabel(), active: isMaterialActive, onPress: () => materialSheetRef.current?.show() },
    { key: 'brands', label: getBrandLabel(), active: isBrandActive, onPress: () => brandSheetRef.current?.show() },
    { key: 'condition', label: getConditionLabel(), active: isConditionActive, onPress: () => conditionSheetRef.current?.show() },
    { key: 'price', label: getPriceLabel(), active: isPriceActive, onPress: () => { setShowPriceInputs(!showPriceInputs); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } },
  ];

  // ─── Page title ─────────────────────────────────────────────────
  const getPageTitle = (): string => {
    if (params.brands) return 'Resultats par marque';
    if (selectedCategoryPath.length > 0) return getCategoryLabelFromIds(selectedCategoryPath);
    if (params.category) {
      const cat = CATEGORIES.find((c) => c.id === params.category);
      return cat?.label || params.category;
    }
    if (params.shopId) return 'Articles de la boutique';
    return 'Rechercher';
  };

  // ═════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <Animated.View entering={FadeIn.duration(300)} style={styles.header}>
        <Pressable onPress={handleClose} style={styles.backButton} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.charcoal} />
        </Pressable>

        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={16} color={colors.muted} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={setSearchQueryLocal}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQueryLocal('')} style={styles.clearButton} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <Pressable onPress={handleOpenVisualSearch} style={styles.cameraButton} hitSlop={4}>
          <Ionicons name="camera-outline" size={20} color={colors.rust} />
        </Pressable>

        {(searchQuery.length > 0 || anyFilterActive) && (
          <Pressable onPress={handleSearch} style={styles.okButton}>
            <Text style={styles.okButtonText}>OK</Text>
          </Pressable>
        )}
      </Animated.View>

      {/* ── Filter chips (horizontal scroll) — always visible ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterChipsContainer}
        contentContainerStyle={styles.filterChipsContent}
      >
        {filterChips.map(({ key, label, active, onPress }) => (
          <Pressable
            key={key}
            style={[styles.filterChip, active && styles.filterChipActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPress();
            }}
          >
            <Text
              style={[styles.filterChipText, active && styles.filterChipTextActive]}
              numberOfLines={1}
            >
              {label}
            </Text>
            <Ionicons name="chevron-down" size={14} color={active ? colors.white : colors.muted} />
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Price range inputs (collapsible) ── */}
      {showPriceInputs && (
        <Animated.View entering={FadeInDown.duration(200)} style={styles.priceSection}>
          <View style={styles.priceInputsRow}>
            <View style={styles.priceInputWrapper}>
              <Text style={styles.priceInputLabel}>Min</Text>
              <TextInput
                style={styles.priceInput}
                placeholder="0"
                placeholderTextColor={colors.muted}
                value={minPriceText}
                onChangeText={setMinPriceText}
                keyboardType="numeric"
                returnKeyType="done"
              />
              <Text style={styles.priceCurrency}>$</Text>
            </View>
            <View style={styles.priceSeparator} />
            <View style={styles.priceInputWrapper}>
              <Text style={styles.priceInputLabel}>Max</Text>
              <TextInput
                style={styles.priceInput}
                placeholder="1000"
                placeholderTextColor={colors.muted}
                value={maxPriceText}
                onChangeText={setMaxPriceText}
                keyboardType="numeric"
                returnKeyType="done"
              />
              <Text style={styles.priceCurrency}>$</Text>
            </View>
          </View>
          <View style={styles.priceActions}>
            {isPriceActive && (
              <Pressable onPress={handlePriceClear} style={styles.priceClearButton}>
                <Text style={styles.priceClearText}>Effacer</Text>
              </Pressable>
            )}
            <Pressable onPress={handlePriceApply} style={styles.priceApplyButton}>
              <Text style={styles.priceApplyText}>Appliquer</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* ── Content ── */}
      <View style={styles.content}>
        {/* Results info bar */}
        {(isSearching || anyFilterActive) && (
          <View style={styles.resultsInfoBar}>
            {!isLoading && articles.length > 0 && (
              <Text style={styles.resultsCountInline}>
                {articles.length} article{articles.length > 1 ? 's' : ''} trouve{articles.length > 1 ? 's' : ''}
              </Text>
            )}
            {anyFilterActive && (
              <Pressable onPress={handleClearAll} style={styles.clearAllButton}>
                <Text style={styles.clearAllText}>Effacer tout</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Recent searches (shown when no search is active) */}
        {!isSearching && (
          <RecentSearches
            searches={recentSearches}
            isLoading={isLoadingHistory}
            onSearchTap={handleRecentSearchTap}
            onSearchDelete={handleRecentSearchDelete}
            onTrendingTap={handleTrendingTap}
          />
        )}

        {/* Product grid (shown when searching) */}
        {isSearching && (
          <ProductGrid
            articles={articles || []}
            isLoading={isLoading}
            isPaginating={isPaginating}
            onLoadMore={loadMore}
            onProductPress={handleProductPress}
            emptyMessage={
              activeSearchQuery
                ? `Aucun resultat pour "${activeSearchQuery}"`
                : 'Aucun article trouve avec ces filtres'
            }
            testID="search-results-grid"
          />
        )}
      </View>

      {/* ── Visual Search Modal ── */}
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

      {/* ── Bottom Sheets ── */}
      <CategoryBottomSheet
        ref={categorySheetRef}
        onSelect={handleCategorySelect}
        selectedCategoryIds={selectedCategoryPath}
      />

      <SelectionBottomSheet
        ref={colorSheetRef}
        title="Couleur"
        items={getColorItems()}
        selectedValue={filters.colors?.[0]}
        selectedValues={filters.colors || []}
        onSelect={handleColorSelect}
        type="color"
        multiSelect
      />

      <SizeSelectionSheet
        ref={sizeSheetRef}
        selectedSizes={filters.sizes || []}
        onConfirm={handleSizesConfirm}
      />

      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matiere"
        items={getMaterialItems()}
        selectedValue={filters.materials?.[0]}
        selectedValues={filters.materials || []}
        onSelect={handleMaterialSelect}
        multiSelect
      />

      <SelectionBottomSheet
        ref={conditionSheetRef}
        title="Etat"
        items={CONDITION_ITEMS}
        selectedValue={filters.condition}
        onSelect={handleConditionSelect}
      />

      <BrandSelectionSheet
        ref={brandSheetRef}
        selectedBrands={filters.brands || []}
        onConfirm={handleBrandsConfirm}
      />

      <SelectionBottomSheet
        ref={sortSheetRef}
        title="Trier par"
        items={SORT_ITEMS}
        selectedValue={selectedSort}
        onSelect={handleSortSelect}
      />
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════
// STYLES — Editorial (sharp corners, charcoal/rust palette)
// ═════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInputContainer: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    letterSpacing: 0.1,
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
  },
  cameraButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: colors.rust,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  okButton: {
    height: 40,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.charcoal,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  okButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },

  // ── Filter chips (horizontal scroll) ──
  filterChipsContainer: {
    maxHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipsContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    backgroundColor: 'transparent',
    gap: 6,
  },
  filterChipActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  filterChipText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
    maxWidth: 120,
  },
  filterChipTextActive: {
    color: colors.white,
  },

  // ── Price section ──
  priceSection: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surfaceWarm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  priceInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  priceInputLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted,
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    paddingVertical: 0,
  },
  priceCurrency: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.muted,
    marginLeft: 4,
  },
  priceSeparator: {
    width: 12,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  priceActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  priceClearButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  priceClearText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.rust,
  },
  priceApplyButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: colors.charcoal,
    borderRadius: 0,
  },
  priceApplyText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.white,
  },

  // ── Results info bar ──
  resultsInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultsCountInline: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.1,
    color: colors.muted,
  },
  clearAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearAllText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.rust,
  },

  // ── Content ──
  content: {
    flex: 1,
  },
});
