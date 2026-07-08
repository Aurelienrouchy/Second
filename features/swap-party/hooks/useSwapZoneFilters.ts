/**
 * useSwapZoneFilters — canonical filter stack for the Swap Zone, reusing the
 * SearchFilters shape (types/index.ts) and the same bottom-sheet stack as the
 * search screen (Category / Color / Size / Material / Brand / Condition / Sort).
 *
 * Unlike search (which queries Firestore), the Swap Zone has a bounded, already
 * loaded stock, so filtering is done CLIENT-SIDE over SwapPartyItemExtended.
 *
 * Chip order (no price): Trier, Catégorie, Taille, Couleur, Marque, Matière, État.
 */

import { useCallback, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';

import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { colors as colorData } from '@/data/colors';
import { getConditionLabel } from '@/data/conditions';
import { track } from '@/lib/analytics';

import type { ArticleSize, SearchFilters, SortBy, SwapPartyItemExtended } from '@/types';

const DEFAULT_FILTERS: SearchFilters = {
  colors: [],
  sizes: [],
  materials: [],
  condition: undefined,
  brands: [],
  sortBy: 'recent',
};

// ── Color matching: an article stores `color` as a color id (e.g. 'noir'). ──
function matchesColor(itemColor: string | undefined, selected: string[]): boolean {
  if (!itemColor) return false;
  return selected.includes(itemColor);
}

function sortItems(items: SwapPartyItemExtended[], sortBy: SortBy | undefined): SwapPartyItemExtended[] {
  const next = [...items];
  if (sortBy === 'price_asc') {
    next.sort((a, b) => (a.price || 0) - (b.price || 0));
  } else if (sortBy === 'price_desc') {
    next.sort((a, b) => (b.price || 0) - (a.price || 0));
  } else {
    // 'recent' (default) falls back to addedAt desc — the zone items carry no
    // popularity signal, so 'popular' is not offered in the Swap Zone.
    next.sort((a, b) => {
      const ta = a.addedAt instanceof Date ? a.addedAt.getTime() : 0;
      const tb = b.addedAt instanceof Date ? b.addedAt.getTime() : 0;
      return tb - ta;
    });
  }
  return next;
}

export function useSwapZoneFilters(items: SwapPartyItemExtended[]) {
  const [filters, setFilters] = useState<SearchFilters>({ ...DEFAULT_FILTERS });
  const [selectedCategoryPath, setSelectedCategoryPath] = useState<string[]>([]);
  const [selectedSort, setSelectedSort] = useState<SortBy>('recent');

  // ── Client-side filtering over the bounded stock ──
  const filteredItems = useMemo(() => {
    let result = items;

    if (selectedCategoryPath.length > 0) {
      result = result.filter((item) =>
        item.categoryIds?.some((id) => selectedCategoryPath.includes(id))
      );
    }

    const sizes = filters.sizes ?? [];
    if (sizes.length > 0) {
      result = result.filter(
        (item) =>
          !!item.size &&
          sizes.some(
            (s) => s.value === item.size!.value && s.system === item.size!.system
          )
      );
    }

    const cols = filters.colors ?? [];
    if (cols.length > 0) {
      result = result.filter((item) => matchesColor(item.color, cols));
    }

    const brands = filters.brands ?? [];
    if (brands.length > 0) {
      result = result.filter(
        (item) =>
          !!item.brand && brands.some((b) => b.toLowerCase() === item.brand!.toLowerCase())
      );
    }

    const materials = filters.materials ?? [];
    if (materials.length > 0) {
      result = result.filter((item) => !!item.material && materials.includes(item.material));
    }

    if (filters.condition) {
      result = result.filter((item) => item.condition === filters.condition);
    }

    return sortItems(result, selectedSort);
  }, [items, filters, selectedCategoryPath, selectedSort]);

  // ── Active flags ──
  const isCategoryActive = selectedCategoryPath.length > 0;
  const isSizeActive = (filters.sizes?.length || 0) > 0;
  const isColorActive = (filters.colors?.length || 0) > 0;
  const isBrandActive = (filters.brands?.length || 0) > 0;
  const isMaterialActive = (filters.materials?.length || 0) > 0;
  const isConditionActive = !!filters.condition;
  const isSortActive = selectedSort !== 'recent';

  const hasActiveFilters =
    isCategoryActive ||
    isSizeActive ||
    isColorActive ||
    isBrandActive ||
    isMaterialActive ||
    isConditionActive ||
    isSortActive;

  // ── Label helpers (same conventions as useSearchScreen) ──
  const getSortLabel = useCallback((): string => {
    switch (selectedSort) {
      case 'price_asc':
        return 'Prix croissant';
      case 'price_desc':
        return 'Prix décroissant';
      default:
        return 'Trier';
    }
  }, [selectedSort]);

  const getCategoryLabel = useCallback(
    (): string =>
      selectedCategoryPath.length > 0 ? getCategoryLabelFromIds(selectedCategoryPath) : 'Catégorie',
    [selectedCategoryPath]
  );

  const getSizeLabel = useCallback((): string => {
    const sel = filters.sizes || [];
    if (sel.length === 0) return 'Taille';
    if (sel.length === 1) return sel[0].value;
    return `${sel.length} tailles`;
  }, [filters.sizes]);

  const getColorLabel = useCallback((): string => {
    const sel = filters.colors || [];
    if (sel.length === 0) return 'Couleur';
    if (sel.length === 1) return colorData.find((c) => c.id === sel[0])?.name || sel[0];
    return `${sel.length} couleurs`;
  }, [filters.colors]);

  const getBrandLabel = useCallback((): string => {
    const sel = filters.brands || [];
    if (sel.length === 0) return 'Marque';
    if (sel.length === 1) return sel[0];
    return `${sel.length} marques`;
  }, [filters.brands]);

  const getMaterialLabel = useCallback((): string => {
    const sel = filters.materials || [];
    if (sel.length === 0) return 'Matière';
    if (sel.length === 1) return sel[0];
    return `${sel.length} matières`;
  }, [filters.materials]);

  const getConditionLabelText = useCallback((): string => {
    if (!filters.condition) return 'État';
    return getConditionLabel(filters.condition);
  }, [filters.condition]);

  // ── Mutators ──
  const handleSortSelect = useCallback((sortId: string) => {
    setSelectedSort(sortId as SortBy);
    track('search_filter_applied', {
      screen: 'swap_zone',
      filter_type: 'sort',
      sort_value: sortId,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleCategorySelect = useCallback((categoryPath: string[]) => {
    setSelectedCategoryPath(categoryPath);
    track('search_filter_applied', {
      screen: 'swap_zone',
      filter_type: 'category',
      category_path: categoryPath,
      category_depth: categoryPath.length,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSizesConfirm = useCallback((sizes: ArticleSize[]) => {
    setFilters((prev) => ({ ...prev, sizes }));
    track('search_filter_applied', {
      screen: 'swap_zone',
      filter_type: 'sizes',
      values: sizes.map((s) => s.value),
      values_count: sizes.length,
    });
  }, []);

  const handleColorSelect = useCallback((color: string) => {
    setFilters((prev) => {
      const cur = prev.colors || [];
      const next = cur.includes(color) ? cur.filter((c) => c !== color) : [...cur, color];
      return { ...prev, colors: next };
    });
  }, []);

  const handleColorsConfirm = useCallback((selected: string[]) => {
    setFilters((prev) => ({ ...prev, colors: selected }));
    track('search_filter_applied', {
      screen: 'swap_zone',
      filter_type: 'colors',
      values: selected,
      values_count: selected.length,
    });
  }, []);

  const handleBrandsConfirm = useCallback((brands: string[]) => {
    setFilters((prev) => ({ ...prev, brands }));
    track('search_filter_applied', {
      screen: 'swap_zone',
      filter_type: 'brands',
      values: brands,
      values_count: brands.length,
    });
  }, []);

  const handleMaterialSelect = useCallback((material: string) => {
    setFilters((prev) => {
      const cur = prev.materials || [];
      const next = cur.includes(material) ? cur.filter((m) => m !== material) : [...cur, material];
      return { ...prev, materials: next };
    });
  }, []);

  const handleMaterialsConfirm = useCallback((selected: string[]) => {
    setFilters((prev) => ({ ...prev, materials: selected }));
  }, []);

  const handleConditionSelect = useCallback((condition: string) => {
    setFilters((prev) => ({
      ...prev,
      condition: prev.condition === condition ? undefined : condition,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setSelectedCategoryPath([]);
    setSelectedSort('recent');
  }, []);

  return {
    filters,
    selectedCategoryPath,
    selectedSort,
    filteredItems,
    hasActiveFilters,
    // active flags
    isCategoryActive,
    isSizeActive,
    isColorActive,
    isBrandActive,
    isMaterialActive,
    isConditionActive,
    isSortActive,
    // labels
    getSortLabel,
    getCategoryLabel,
    getSizeLabel,
    getColorLabel,
    getBrandLabel,
    getMaterialLabel,
    getConditionLabelText,
    // handlers
    handleSortSelect,
    handleCategorySelect,
    handleSizesConfirm,
    handleColorSelect,
    handleColorsConfirm,
    handleBrandsConfirm,
    handleMaterialSelect,
    handleMaterialsConfirm,
    handleConditionSelect,
    clearFilters,
  };
}
