/**
 * useSearchScreen — orchestrates state, derived values, and handlers for the
 * search screen. The route file owns refs (for bottom sheets) + JSX only.
 */

import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Keyboard, TextInput } from 'react-native';

import { CATEGORIES, getCategoryLabelFromIds } from '@/data/categories-v2';
import { colors as colorData } from '@/data/colors';
import { getMaterialName } from '@/data/materials';

import { useUser } from '@/hooks/useAuth';
import { useArticleSearch } from '@/hooks/useArticleSearch';
import { useCategoryNavigation } from '@/hooks/useCategoryNavigation';
import { track } from '@/lib/analytics';
import { SearchHistoryItem, SearchHistoryService } from '@/services/searchHistoryService';

import type { Article, ArticleSize, ArticleWithLocation, SearchFilters, SortBy } from '@/types';
import { formatPrice } from '@/utils/formatPrice';

import { CONDITION_ITEMS, SORT_ITEMS } from '../constants';

type SearchFilterKey =
  | 'sort'
  | 'category'
  | 'colors'
  | 'sizes'
  | 'materials'
  | 'brands'
  | 'condition'
  | 'price';

/** Active filter dimension names, aligned with the analytics catalogue. */
function buildFilterKeys(
  filters: SearchFilters,
  categoryPath: string[],
  sort: SortBy,
): SearchFilterKey[] {
  const keys: SearchFilterKey[] = [];
  if (categoryPath.length > 0) keys.push('category');
  if ((filters.colors?.length ?? 0) > 0) keys.push('colors');
  if ((filters.sizes?.length ?? 0) > 0) keys.push('sizes');
  if ((filters.materials?.length ?? 0) > 0) keys.push('materials');
  if ((filters.brands?.length ?? 0) > 0) keys.push('brands');
  if (filters.condition) keys.push('condition');
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) keys.push('price');
  if (sort && sort !== 'recent') keys.push('sort');
  return keys;
}

/** Filter keys from a stored/partial filter set (recent + saved searches). */
function buildFilterKeysFromPartial(
  f: Partial<SearchFilters> & { categoryIds?: string[] },
): SearchFilterKey[] {
  const keys: SearchFilterKey[] = [];
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

type SearchOpenedSource =
  | 'home_header'
  | 'home_quick_category'
  | 'home_see_all'
  | 'home_brand'
  | 'shop'
  | 'saved_search'
  | 'visual_fallback'
  | 'deep_link'
  | 'other';

export function useSearchScreen() {
  // ─── Params (supports both old search & search-results params) ───
  const params = useLocalSearchParams<{
    categoryPath?: string;
    category?: string;
    brands?: string;
    shopId?: string;
    query?: string;
    filters?: string;
    browse?: string;
    source?: string;
  }>();

  const user = useUser();

  // ─── Derive initial values from params ───────────────────────────
  const parsedFilters = useMemo(() => {
    if (params.filters) {
      try { return JSON.parse(params.filters); }
      catch { return {}; }
    }
    return {};
  }, [params.filters]);

  const initialCategoryPath = useMemo(() => {
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

  // "Parcourir tout" (Voir tout home) : tout le catalogue trié récent, sans
  // terme ni filtre. Déclenche la requête (sortBy 'recent' ne compte pas comme
  // filtre actif) et compte comme contexte initial (donc pas d'auto-focus).
  const isBrowseAll = params.browse === '1';

  // Did we arrive with initial params that should show results immediately?
  const hasInitialContext = !!(
    params.query || params.category || params.categoryPath ||
    params.brands || params.shopId || params.filters || isBrowseAll
  );

  // ─── State ───────────────────────────────────────────────────────
  const [searchQuery, setSearchQueryLocal] = useState(params.query || '');
  const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showVisualSearch, setShowVisualSearch] = useState(false);
  const [isSearching, setIsSearching] = useState(hasInitialContext);
  // M6 — hydrate the sort chip from restored filters (deep-link / saved search)
  // so the chip label/active state matches the query's actual sort.
  const [selectedSort, setSelectedSort] = useState<SortBy>(
    (initialFilters?.sortBy as SortBy) || 'recent'
  );
  const [showPriceInputs, setShowPriceInputs] = useState(false);
  // M7 — hydrate the price inputs from restored filters so a re-Apply doesn't
  // wipe a restored price range.
  const [minPriceText, setMinPriceText] = useState(
    initialFilters?.minPrice !== undefined ? String(initialFilters.minPrice) : ''
  );
  const [maxPriceText, setMaxPriceText] = useState(
    initialFilters?.maxPrice !== undefined ? String(initialFilters.maxPrice) : ''
  );

  // ─── Refs ────────────────────────────────────────────────────────
  const inputRef = useRef<TextInput>(null);

  // ─── Article search hook ─────────────────────────────────────────
  const {
    articles,
    filters,
    searchQuery: activeSearchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating,
    hasNextPage,
    hasActiveFilters,
    error: searchError,
    isError,
    refetch,
    setFilters,
    setSearchQuery: setActiveSearchQuery,
    commitSearchQuery,
    setSelectedCategoryPath,
    loadMore,
    clearAllFilters,
    handleFilterRemove,
  } = useArticleSearch({
    initialFilters,
    initialQuery: params.query,
    initialCategoryPath,
    sellerId: params.shopId,
    browseAll: isBrowseAll,
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
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;
    if (!hasInitialContext) {
      // Focus after the navigation/mount interactions settle (no magic timeout).
      task = InteractionManager.runAfterInteractions(() => inputRef.current?.focus());
    }
    loadRecentSearches();
    return () => task?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // search_opened — one event per mount, carrying the entry context.
  useEffect(() => {
    const entrySource: 'query' | 'category' | 'category_path' | 'brands' | 'shop' | 'filters' | 'browse' | 'none' =
      isBrowseAll ? 'browse'
        : params.query ? 'query'
        : params.categoryPath ? 'category_path'
        : params.category ? 'category'
        : params.brands ? 'brands'
        : params.shopId ? 'shop'
        : params.filters ? 'filters'
        : 'none';
    track('search_opened', {
      source: ((params.source as SearchOpenedSource) || 'other'),
      entry_source: entrySource,
      is_browse_all: isBrowseAll,
      initial_category_path: initialCategoryPath,
      initial_brands: params.brands ? params.brands.split(',') : undefined,
      brand_name: params.brands ? params.brands.split(',')[0] : undefined,
    });
    // Restored search (saved search / deep link carrying a query or filters),
    // excluding the "Voir tout" browse-all entry which carries a sort-only filter.
    if (!isBrowseAll && (params.query || params.filters)) {
      const q = params.query || '';
      const keys = buildFilterKeys(filters, selectedCategoryPath, selectedSort);
      track('search_performed', {
        trigger: 'restored',
        query: q.slice(0, 100),
        query_length: q.length,
        has_active_filters: keys.length > 0,
        active_filter_keys: keys,
        category_path: selectedCategoryPath.length > 0 ? selectedCategoryPath : undefined,
        sort_by: selectedSort,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide results when everything is cleared. En mode "parcourir tout"
  // (Voir tout home), aucun terme/catégorie/filtre n'est requis : on garde la
  // grille visible (tout le catalogue trié récent).
  useEffect(() => {
    if (
      !isBrowseAll &&
      !searchQuery.trim() &&
      selectedCategoryPath.length === 0 &&
      !hasActiveFilters
    ) {
      setIsSearching(false);
    }
  }, [isBrowseAll, searchQuery, selectedCategoryPath, hasActiveFilters]);

  // ─── Recent searches ────────────────────────────────────────────
  const loadRecentSearches = async () => {
    if (!user) return;
    setIsLoadingHistory(true);
    try {
      const searches = await SearchHistoryService.getRecentSearches(user.id, 10);
      setRecentSearches(searches);
    } catch (error) {
      if (__DEV__) console.error('Error loading recent searches:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // ─── Navigation handlers ────────────────────────────────────────
  const handleClose = useCallback(() => {
    const keys = buildFilterKeys(filters, selectedCategoryPath, selectedSort);
    track('search_closed', {
      had_results: articles.length > 0,
      query_length: activeSearchQuery.trim().length,
      any_filter_active: keys.length > 0,
    });
    Keyboard.dismiss();
    router.back();
  }, [filters, selectedCategoryPath, selectedSort, articles.length, activeSearchQuery]);

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
      )
        // Reflect the just-saved search in the recent list immediately.
        .then(() => loadRecentSearches())
        .catch((error) => {
          if (__DEV__) console.error('Error saving search to history:', error);
        });
    }
    if (trimmedQuery || hasActiveFilters || selectedCategoryPath.length > 0) {
      setIsSearching(true);
      const keys = buildFilterKeys(filters, selectedCategoryPath, selectedSort);
      track('search_performed', {
        trigger: 'submit',
        query: trimmedQuery.slice(0, 100),
        query_length: trimmedQuery.length,
        has_active_filters: keys.length > 0,
        active_filter_keys: keys,
        category_path: selectedCategoryPath.length > 0 ? selectedCategoryPath : undefined,
        sort_by: selectedSort,
      });
      // Explicit OK/Enter: commit immediately, bypassing the 350ms debounce.
      commitSearchQuery(trimmedQuery);
      Keyboard.dismiss();
    }
  }, [searchQuery, filters, selectedCategoryPath, selectedSort, hasActiveFilters, user, commitSearchQuery]);

  const handleRecentSearchTap = useCallback((item: SearchHistoryItem) => {
    setSearchQueryLocal(item.query);
    setFilters(item.filters as any);
    if (item.filters.categoryIds) {
      setSelectedCategoryPath(item.filters.categoryIds);
    }
    // M6 — keep the sort chip in sync with the restored sort.
    setSelectedSort((item.filters?.sortBy as SortBy) || 'recent');
    // M7 — keep the price inputs in sync with the restored range.
    setMinPriceText(
      item.filters?.minPrice !== undefined ? String(item.filters.minPrice) : ''
    );
    setMaxPriceText(
      item.filters?.maxPrice !== undefined ? String(item.filters.maxPrice) : ''
    );
    setIsSearching(true);
    const keys = buildFilterKeysFromPartial(item.filters);
    track('search_performed', {
      trigger: 'recent',
      query: (item.query || '').slice(0, 100),
      query_length: (item.query || '').length,
      has_active_filters: keys.length > 0,
      active_filter_keys: keys,
      category_path:
        (item.filters as { categoryIds?: string[] }).categoryIds ?? undefined,
      sort_by: item.filters?.sortBy || 'recent',
      history_item_age: item.timestamp
        ? Math.round((Date.now() - item.timestamp.getTime()) / 1000)
        : undefined,
    });
    // Tapping a saved search is an explicit commit — bypass the debounce.
    commitSearchQuery(item.query || '');
  }, [commitSearchQuery, setFilters, setSelectedCategoryPath]);

  const handleTrendingTap = useCallback((query: string) => {
    setSearchQueryLocal(query);
    setIsSearching(true);
    track('search_performed', {
      trigger: 'trending',
      query: query.slice(0, 100),
      query_length: query.length,
      has_active_filters: false,
      active_filter_keys: [],
      sort_by: selectedSort,
      trending_term: query,
    });
    // Tapping a trending term is an explicit commit — bypass the debounce.
    commitSearchQuery(query);
  }, [commitSearchQuery, selectedSort]);

  const handleRecentSearchDelete = useCallback(
    async (item: SearchHistoryItem) => {
      if (!user) return;
      try {
        await SearchHistoryService.deleteSearchFromHistory(user.id, item.id);
        setRecentSearches((prev) => prev.filter((s) => s.id !== item.id));
      } catch (error) {
        if (__DEV__) console.error('Error deleting search:', error);
      }
    },
    [user]
  );

  const handleClearAll = useCallback(() => {
    track('search_filters_cleared', {
      screen: 'search',
      cleared_filter_keys: buildFilterKeys(filters, selectedCategoryPath, selectedSort),
      query_length: activeSearchQuery.trim().length,
    });
    setSearchQueryLocal('');
    setActiveSearchQuery('');
    clearAllFilters();
    setSelectedCategoryPath([]);
    categoryNav.goToRoot();
    setIsSearching(false);
    setSelectedSort('recent');
    setMinPriceText('');
    setMaxPriceText('');
    setShowPriceInputs(false);
  }, [clearAllFilters, categoryNav, setSelectedCategoryPath, setActiveSearchQuery, filters, selectedCategoryPath, selectedSort, activeSearchQuery]);

  // ─── Visual search ──────────────────────────────────────────────
  const handleOpenVisualSearch = useCallback(() => {
    track('visual_search_opened', {
      source: 'search',
      query_length: searchQuery.trim().length,
    });
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowVisualSearch(true);
  }, [searchQuery]);

  const handleVisualSearchCapture = useCallback((imageUri: string) => {
    setShowVisualSearch(false);
    // Defer the push until the Modal dismiss interaction settles, otherwise the
    // Modal close and router.push race and the navigation can be dropped.
    InteractionManager.runAfterInteractions(() => {
      router.push({ pathname: '/visual-search-results', params: { imageUri } });
    });
  }, []);

  // ─── Sort handler ───────────────────────────────────────────────
  const handleSortSelect = useCallback(
    (sortId: string) => {
      setSelectedSort(sortId as SortBy);
      setFilters({ ...filters, sortBy: sortId as SortBy });
      track('search_filter_applied', {
        screen: 'search',
        filter_type: 'sort',
        sort_value: sortId,
      });
      // A sort-only selection (no text/filters) must still reveal results.
      if (!isSearching) setIsSearching(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [filters, setFilters, isSearching]
  );

  // H5/H6 — with a text term, the server result order is popularity/relevance.
  // Price/date sorts would re-order only the current page (wrong global order +
  // skipped docs), so we only offer the relevance-compatible options in text
  // mode. Without a term, all sorts stay available.
  const isTextMode = !!activeSearchQuery.trim();
  const availableSortItems = useMemo(
    () =>
      isTextMode
        ? SORT_ITEMS.filter((s) => s.value === 'popular')
        : SORT_ITEMS,
    [isTextMode]
  );

  // If a text term is committed while an incompatible sort is selected, snap
  // back to the only valid sort so the chip label never lies.
  useEffect(() => {
    if (isTextMode && selectedSort !== 'popular') {
      setSelectedSort('popular');
      setFilters({ ...filters, sortBy: 'popular' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTextMode]);

  // ─── Filter handlers (multi-select) ─────────────────────────────
  const handleCategorySelect = useCallback(
    (categoryPath: string[]) => {
      setSelectedCategoryPath(categoryPath);
      track('search_filter_applied', {
        screen: 'search',
        filter_type: 'category',
        category_path: categoryPath,
        category_depth: categoryPath.length,
      });
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

  const handleColorsConfirm = useCallback(
    (selectedColors: string[]) => {
      setFilters({ ...filters, colors: selectedColors.length > 0 ? selectedColors : [] });
      if (!isSearching && selectedColors.length > 0) setIsSearching(true);
    },
    [filters, setFilters, isSearching]
  );

  const handleSizesConfirm = useCallback(
    (sizes: ArticleSize[]) => {
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

  const handleMaterialsConfirm = useCallback(
    (selectedMaterials: string[]) => {
      setFilters({ ...filters, materials: selectedMaterials.length > 0 ? selectedMaterials : [] });
      if (!isSearching && selectedMaterials.length > 0) setIsSearching(true);
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
    // FR keyboards emit a comma as the decimal separator; normalize before parse.
    const parsedMin = parseFloat(minPriceText.replace(',', '.'));
    const parsedMax = parseFloat(maxPriceText.replace(',', '.'));
    let minPrice = (!isNaN(parsedMin) && parsedMin >= 0) ? parsedMin : undefined;
    let maxPrice = (!isNaN(parsedMax) && parsedMax >= 0) ? parsedMax : undefined;
    // Ensure min <= max when both are provided
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      const temp = minPrice;
      minPrice = maxPrice;
      maxPrice = temp;
      setMinPriceText(String(minPrice));
      setMaxPriceText(String(maxPrice));
    }
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

  // ─── Per-chip remove handlers (L3 — chip X buttons) ──────────────
  // Each clears exactly one filter dimension. Multi-value dimensions and
  // condition delegate to useArticleSearch.handleFilterRemove (no value =
  // clear the whole dimension); sort/category/price live in this hook.
  const handleSortRemove = useCallback(() => {
    setSelectedSort('recent');
    setFilters({ ...filters, sortBy: 'recent' });
  }, [filters, setFilters]);

  const handleCategoryRemove = useCallback(() => {
    setSelectedCategoryPath([]);
    categoryNav.goToRoot();
  }, [categoryNav, setSelectedCategoryPath]);

  // ─── Label helpers ──────────────────────────────────────────────
  const getCategoryLabel = (): string =>
    selectedCategoryPath.length > 0 ? getCategoryLabelFromIds(selectedCategoryPath) : 'Catégorie';

  const getColorLabel = (): string => {
    const sel = filters.colors || [];
    if (sel.length === 0) return 'Couleur';
    if (sel.length === 1) return colorData.find((c) => c.id === sel[0])?.name || sel[0];
    return `${sel.length} couleurs`;
  };

  const getSizeLabel = (): string => {
    const sel = filters.sizes || [];
    if (sel.length === 0) return 'Taille';
    if (sel.length === 1) return sel[0].value;
    return `${sel.length} tailles`;
  };

  const getMaterialLabel = (): string => {
    const sel = filters.materials || [];
    if (sel.length === 0) return 'Matière';
    if (sel.length === 1) return getMaterialName(sel[0]);
    return `${sel.length} matières`;
  };

  const getBrandLabel = (): string => {
    const sel = filters.brands || [];
    if (sel.length === 0) return 'Marque';
    if (sel.length === 1) return sel[0];
    return `${sel.length} marques`;
  };

  const getConditionLabel = (): string => {
    if (!filters.condition) return 'État';
    return CONDITION_ITEMS.find((c) => c.value === filters.condition)?.label || 'État';
  };

  const getPriceLabel = (): string => {
    if (filters.minPrice && filters.maxPrice) return `${formatPrice(filters.minPrice)} - ${formatPrice(filters.maxPrice)}`;
    if (filters.minPrice) return `Min ${formatPrice(filters.minPrice)}`;
    if (filters.maxPrice) return `Max ${formatPrice(filters.maxPrice)}`;
    return 'Prix';
  };

  // In text mode only one sort is valid (relevance), so the sort chip can't
  // change anything — surface that explicitly instead of opening a 1-item sheet.
  const isSortLocked = availableSortItems.length === 1;

  const getSortLabel = (): string => {
    if (isSortLocked) return 'Tri automatique';
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
  const isSortActive = selectedSort !== 'recent';

  const anyFilterActive =
    isCategoryActive || isColorActive || isSizeActive || isMaterialActive ||
    isBrandActive || isConditionActive || isPriceActive || isSortActive;

  // ─── Page title ─────────────────────────────────────────────────
  const getPageTitle = (): string => {
    if (params.brands) return 'Résultats par marque';
    if (selectedCategoryPath.length > 0) return getCategoryLabelFromIds(selectedCategoryPath);
    if (params.category) {
      const cat = CATEGORIES.find((c) => c.id === params.category);
      return cat?.label || params.category;
    }
    if (params.shopId) return 'Articles de la boutique';
    return 'Rechercher';
  };

  return {
    // params + auth
    params,
    user,

    // refs
    inputRef,

    // input state
    searchQuery,
    setSearchQueryLocal,
    minPriceText,
    setMinPriceText,
    maxPriceText,
    setMaxPriceText,
    showPriceInputs,
    setShowPriceInputs,
    showVisualSearch,
    setShowVisualSearch,
    selectedSort,
    availableSortItems,
    isSortLocked,

    // search hook
    articles,
    filters,
    activeSearchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating,
    hasNextPage,
    hasActiveFilters,
    searchError,
    isError,
    refetch,
    isSearching,
    isGuest: !user,
    setIsSearching,
    loadMore,
    handleFilterRemove,

    // recent searches
    recentSearches,
    isLoadingHistory,

    // active flags
    isCategoryActive,
    isColorActive,
    isSizeActive,
    isMaterialActive,
    isBrandActive,
    isConditionActive,
    isPriceActive,
    isSortActive,
    anyFilterActive,

    // labels
    getCategoryLabel,
    getColorLabel,
    getSizeLabel,
    getMaterialLabel,
    getBrandLabel,
    getConditionLabel,
    getPriceLabel,
    getSortLabel,
    getPageTitle,

    // handlers
    handleClose,
    handleProductPress,
    handleSearch,
    handleRecentSearchTap,
    handleTrendingTap,
    handleRecentSearchDelete,
    handleClearAll,
    handleOpenVisualSearch,
    handleVisualSearchCapture,
    handleSortSelect,
    handleCategorySelect,
    handleColorSelect,
    handleColorsConfirm,
    handleSizesConfirm,
    handleMaterialSelect,
    handleMaterialsConfirm,
    handleConditionSelect,
    handleBrandsConfirm,
    handlePriceApply,
    handlePriceClear,
    handleSortRemove,
    handleCategoryRemove,
  };
}
