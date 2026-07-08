/**
 * Search Screen — Seconde (Unified)
 *
 * Merges editorial search (recent/trending, category tree, visual search)
 * with full-featured results (filters, sort, price, sizes).
 *
 * State + handlers + label helpers live in features/search/hooks/useSearchScreen.
 * UI sub-pieces (header, filter chips, price inputs) live in features/search/components.
 * The route file is the orchestrator: refs (for bottom sheets) + JSX composition.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { colors } from '@/constants/theme';
import { track } from '@/lib/analytics';

import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import ProductGrid from '@/components/ProductGrid';
import SaveSearchButton from '@/components/SaveSearchButton';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import SizeSelectionSheet, { SizeSelectionSheetRef } from '@/components/SizeSelectionSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';
import RecentSearches from '@/components/search/RecentSearches';
import VisualSearchCamera from '@/components/VisualSearchCamera';

import { getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';

import {
  CONDITION_ITEMS,
  FilterChipsRow,
  PriceRangeInputs,
  SearchHeader,
  searchStyles as styles,
  useSearchScreen,
  type FilterChip,
} from '@/features/search';

export default function SearchScreen() {
  const screen = useSearchScreen();
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(() => {
    track('list_refreshed', { screen: 'search', items_count: screen.articles.length });
    queryClient.invalidateQueries({ queryKey: ['articles', 'search'] });
  }, [queryClient, screen.articles.length]);

  const handleRetry = useCallback(() => {
    track('error_retry_tapped', { screen: 'search', error_context: 'search_results' });
    screen.refetch();
  }, [screen.refetch]);

  // ─── Refs (sheets stay here so JSX can imperatively show them) ──
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sizeSheetRef = useRef<SizeSelectionSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const conditionSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);
  const sortSheetRef = useRef<SelectionBottomSheetRef>(null);

  const filterChips: FilterChip[] = [
    // In text mode the sort is locked to relevance, so the chip neither opens
    // the (1-item) sheet nor offers a remove action.
    { key: 'sort', label: screen.getSortLabel(), active: screen.isSortActive, onPress: () => { if (!screen.isSortLocked) sortSheetRef.current?.show(); }, onRemove: screen.isSortLocked ? undefined : screen.handleSortRemove },
    { key: 'category', label: screen.getCategoryLabel(), active: screen.isCategoryActive, onPress: () => categorySheetRef.current?.show(), onRemove: screen.handleCategoryRemove },
    { key: 'colors', label: screen.getColorLabel(), active: screen.isColorActive, onPress: () => colorSheetRef.current?.show(), onRemove: () => screen.handleFilterRemove('colors') },
    { key: 'sizes', label: screen.getSizeLabel(), active: screen.isSizeActive, onPress: () => sizeSheetRef.current?.show(), onRemove: () => screen.handleFilterRemove('sizes') },
    { key: 'materials', label: screen.getMaterialLabel(), active: screen.isMaterialActive, onPress: () => materialSheetRef.current?.show(), onRemove: () => screen.handleFilterRemove('materials') },
    { key: 'brands', label: screen.getBrandLabel(), active: screen.isBrandActive, onPress: () => brandSheetRef.current?.show(), onRemove: () => screen.handleFilterRemove('brands') },
    { key: 'condition', label: screen.getConditionLabel(), active: screen.isConditionActive, onPress: () => conditionSheetRef.current?.show(), onRemove: () => screen.handleFilterRemove('condition') },
    { key: 'price', label: screen.getPriceLabel(), active: screen.isPriceActive, onPress: () => screen.setShowPriceInputs(!screen.showPriceInputs), onRemove: screen.handlePriceClear },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <SearchHeader
        inputRef={screen.inputRef}
        searchQuery={screen.searchQuery}
        showOk={screen.searchQuery.length > 0 || screen.anyFilterActive}
        onChangeQuery={screen.setSearchQueryLocal}
        onClear={() => screen.setSearchQueryLocal('')}
        onSubmit={screen.handleSearch}
        onClose={screen.handleClose}
        onOpenVisualSearch={screen.handleOpenVisualSearch}
      />

      <FilterChipsRow chips={filterChips} />

      {screen.showPriceInputs && (
        <PriceRangeInputs
          minPriceText={screen.minPriceText}
          maxPriceText={screen.maxPriceText}
          isPriceActive={screen.isPriceActive}
          onMinChange={screen.setMinPriceText}
          onMaxChange={screen.setMaxPriceText}
          onClear={screen.handlePriceClear}
          onApply={screen.handlePriceApply}
        />
      )}

      {/* ── Content ── */}
      <View style={styles.content}>
        {/* Results info bar */}
        {(screen.isSearching || screen.anyFilterActive) && (
          <View style={styles.resultsInfoBar}>
            {!screen.isLoading && screen.articles.length > 0 && (
              <Text style={styles.resultsCountInline}>
                {screen.hasNextPage
                  ? `${screen.articles.length}+ articles trouvés`
                  : `${screen.articles.length} article${screen.articles.length > 1 ? 's' : ''} trouvé${screen.articles.length > 1 ? 's' : ''}`}
              </Text>
            )}
            {screen.anyFilterActive && (
              <Pressable onPress={screen.handleClearAll} style={styles.clearAllButton}>
                <Text style={styles.clearAllText}>Effacer tout</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Recent searches (shown when no search is active) */}
        {!screen.isSearching && (
          <RecentSearches
            searches={screen.recentSearches}
            isLoading={screen.isLoadingHistory}
            isGuest={screen.isGuest}
            onSearchTap={screen.handleRecentSearchTap}
            onSearchDelete={screen.handleRecentSearchDelete}
            onTrendingTap={screen.handleTrendingTap}
          />
        )}

        {/* Product grid or error state (shown when searching) */}
        {screen.isSearching && (
          <>
            {!screen.isLoading && !screen.isError && screen.articles.length > 0 && (
              <SaveSearchButton
                query={screen.activeSearchQuery}
                filters={{ ...screen.filters, categoryIds: screen.selectedCategoryPath }}
              />
            )}
            {screen.isError ? (
              <View style={styles.errorContainer}>
                <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
                <Text style={styles.errorTitle}>Une erreur est survenue</Text>
                <Text style={styles.errorSubtitle}>
                  Vérifiez votre connexion et réessayez
                </Text>
                <Pressable style={styles.retryButton} onPress={handleRetry}>
                  <Text style={styles.retryButtonText}>Réessayer</Text>
                </Pressable>
              </View>
            ) : (
              <ProductGrid
                articles={screen.articles || []}
                isLoading={screen.isLoading}
                isPaginating={screen.isPaginating}
                onLoadMore={screen.loadMore}
                onProductPress={screen.handleProductPress}
                onRefresh={handleRefresh}
                emptyMessage={
                  screen.activeSearchQuery
                    ? `Aucun résultat pour "${screen.activeSearchQuery}"`
                    : 'Aucun article trouvé avec ces filtres'
                }
                testID="search-results-grid"
              />
            )}
          </>
        )}
      </View>

      {/* ── Visual Search Modal ── */}
      <Modal
        visible={screen.showVisualSearch}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => screen.setShowVisualSearch(false)}
      >
        <VisualSearchCamera
          source="search"
          onClose={() => screen.setShowVisualSearch(false)}
          onPhotoCapture={screen.handleVisualSearchCapture}
        />
      </Modal>

      {/* ── Bottom Sheets ── */}
      <CategoryBottomSheet
        ref={categorySheetRef}
        onSelect={screen.handleCategorySelect}
        selectedCategoryIds={screen.selectedCategoryPath}
      />

      <SelectionBottomSheet
        ref={colorSheetRef}
        title="Couleur"
        items={getColorItems()}
        selectedValue={screen.filters.colors?.[0]}
        selectedValues={screen.filters.colors || []}
        onSelect={screen.handleColorSelect}
        onSelectMultiple={screen.handleColorsConfirm}
        type="color"
        multiSelect
      />

      <SizeSelectionSheet
        ref={sizeSheetRef}
        selectedSizes={screen.filters.sizes || []}
        onConfirm={screen.handleSizesConfirm}
        categoryPath={screen.selectedCategoryPath}
      />

      <SelectionBottomSheet
        ref={materialSheetRef}
        title="Matière"
        items={getMaterialItems()}
        selectedValue={screen.filters.materials?.[0]}
        selectedValues={screen.filters.materials || []}
        onSelect={screen.handleMaterialSelect}
        onSelectMultiple={screen.handleMaterialsConfirm}
        multiSelect
      />

      <SelectionBottomSheet
        ref={conditionSheetRef}
        title="État"
        items={CONDITION_ITEMS}
        selectedValue={screen.filters.condition}
        onSelect={screen.handleConditionSelect}
      />

      <BrandSelectionSheet
        ref={brandSheetRef}
        selectedBrands={screen.filters.brands || []}
        onConfirm={screen.handleBrandsConfirm}
      />

      <SelectionBottomSheet
        ref={sortSheetRef}
        title="Trier par"
        items={screen.availableSortItems}
        selectedValue={screen.selectedSort}
        onSelect={screen.handleSortSelect}
      />
    </SafeAreaView>
  );
}
