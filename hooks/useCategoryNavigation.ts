import { CATEGORIES, CategoryNode } from '@/data/categories-v2';
import { useCallback, useMemo, useState } from 'react';

export interface UseCategoryNavigationOptions {
  initialPath?: CategoryNode[];
  onSelect?: (categoryIds: string[]) => void;
}

export interface UseCategoryNavigationReturn {
  // State
  navigationPath: CategoryNode[];
  currentList: CategoryNode[];
  currentTitle: string;
  isAtRoot: boolean;

  // Actions
  goDown: (category: CategoryNode) => void;
  goBack: () => void;
  goToRoot: () => void;
  selectCurrent: () => string[];
  selectCategory: (category: CategoryNode) => string[] | null;

  // Utilities
  getFullPathIds: () => string[];
  getFullPathLabels: (separator?: string) => string;
}

/**
 * Hook for managing category tree navigation.
 * Extracted from CategoryBottomSheet pattern for reuse in SearchOverlay.
 *
 * @example
 * ```tsx
 * const { currentList, goDown, goBack, selectCategory } = useCategoryNavigation({
 *   onSelect: (categoryIds) => {
 *     setFilters(prev => ({ ...prev, categoryIds }));
 *   }
 * });
 * ```
 */
export function useCategoryNavigation({
  initialPath = [],
  onSelect,
}: UseCategoryNavigationOptions = {}): UseCategoryNavigationReturn {
  const [navigationPath, setNavigationPath] = useState<CategoryNode[]>(initialPath);

  // Compute current list based on navigation path
  const currentList = useMemo(() => {
    if (navigationPath.length === 0) {
      return CATEGORIES;
    }
    const lastNode = navigationPath[navigationPath.length - 1];
    return lastNode.children || [];
  }, [navigationPath]);

  // Compute current title
  const currentTitle = useMemo(() => {
    if (navigationPath.length === 0) {
      return 'Catégories';
    }
    return navigationPath[navigationPath.length - 1].label;
  }, [navigationPath]);

  // Check if at root level
  const isAtRoot = navigationPath.length === 0;

  // Get full path as array of IDs
  const getFullPathIds = useCallback((): string[] => {
    return navigationPath.map(node => node.id);
  }, [navigationPath]);

  // Get full path as formatted string
  const getFullPathLabels = useCallback((separator: string = ' > '): string => {
    return navigationPath.map(node => node.label).join(separator);
  }, [navigationPath]);

  // Navigate down into a category
  const goDown = useCallback((category: CategoryNode) => {
    if (category.children && category.children.length > 0) {
      setNavigationPath(prev => [...prev, category]);
    }
  }, []);

  // Navigate back one level
  const goBack = useCallback(() => {
    setNavigationPath(prev => prev.slice(0, -1));
  }, []);

  // Navigate to root
  const goToRoot = useCallback(() => {
    setNavigationPath([]);
  }, []);

  // Select current category (useful for intermediate selections)
  const selectCurrent = useCallback((): string[] => {
    const pathIds = getFullPathIds();
    if (onSelect && pathIds.length > 0) {
      onSelect(pathIds);
    }
    return pathIds;
  }, [getFullPathIds, onSelect]);

  // Handle category selection (drill-down or select leaf)
  const selectCategory = useCallback((category: CategoryNode): string[] | null => {
    if (category.children && category.children.length > 0) {
      // Has children - drill down
      goDown(category);
      return null; // Not selected yet, just navigated
    } else {
      // Leaf node - select and return full path
      const fullPathIds = [...navigationPath.map(n => n.id), category.id];
      if (onSelect) {
        onSelect(fullPathIds);
      }
      return fullPathIds;
    }
  }, [navigationPath, goDown, onSelect]);

  return {
    // State
    navigationPath,
    currentList,
    currentTitle,
    isAtRoot,

    // Actions
    goDown,
    goBack,
    goToRoot,
    selectCurrent,
    selectCategory,

    // Utilities
    getFullPathIds,
    getFullPathLabels,
  };
}

export default useCategoryNavigation;
