/**
 * useSwapFilters Hook
 * Apply filters to Swap Party items with full Article metadata
 */

import { useMemo, useState } from 'react';
import { SwapPartyItemExtended } from '@/types';
import { SwapZoneFilter } from '@/components/SwapZoneFilters';

export function useSwapFilters(items: SwapPartyItemExtended[]) {
  const [filters, setFilters] = useState<SwapZoneFilter>({});

  const filteredItems = useMemo(() => {
    let result = [...items];

    // Filter by categories
    if (filters.categories && filters.categories.length > 0) {
      result = result.filter((item) => {
        if (!item.categoryIds || item.categoryIds.length === 0) {
          // Fallback: check title if no categoryIds
          return filters.categories!.some((filterCat) =>
            item.title.toLowerCase().includes(filterCat.toLowerCase())
          );
        }
        // Check if any of the item's categories match filter categories
        return filters.categories!.some((filterCat) =>
          item.categoryIds!.some((catId) =>
            catId.toLowerCase().includes(filterCat.toLowerCase())
          )
        );
      });
    }

    // Filter by sizes
    if (filters.sizes && filters.sizes.length > 0) {
      result = result.filter((item) => {
        if (item.size) {
          // Direct size match
          return filters.sizes!.includes(item.size);
        }
        // Fallback: check title
        return filters.sizes!.some(
          (size) =>
            item.title.toLowerCase().includes(size.toLowerCase()) ||
            item.title.match(new RegExp(`\\b${size}\\b`, 'i'))
        );
      });
    }

    // Filter by genders
    if (filters.genders && filters.genders.length > 0) {
      result = result.filter((item) => {
        // Check categoryIds first
        if (item.categoryIds && item.categoryIds.length > 0) {
          return filters.genders!.some((gender) => {
            if (gender === 'men') {
              return item.categoryIds!.some((catId) =>
                catId.includes('men') || catId.includes('homme')
              );
            }
            if (gender === 'women') {
              return item.categoryIds!.some((catId) =>
                catId.includes('women') || catId.includes('femme')
              );
            }
            if (gender === 'unisex') {
              return item.categoryIds!.some((catId) =>
                catId.includes('unisex') || catId.includes('mixte')
              );
            }
            return false;
          });
        }
        // Fallback: check title
        const title = item.title.toLowerCase();
        return filters.genders!.some((gender) => {
          if (gender === 'men') return title.includes('homme') || title.includes('men');
          if (gender === 'women') return title.includes('femme') || title.includes('women');
          if (gender === 'unisex') return title.includes('unisex') || title.includes('mixte');
          return false;
        });
      });
    }

    // Filter by brands
    if (filters.brands && filters.brands.length > 0) {
      result = result.filter((item) => {
        if (item.brand) {
          // Direct brand match (case insensitive)
          return filters.brands!.some((brand) =>
            item.brand!.toLowerCase() === brand.toLowerCase()
          );
        }
        // Fallback: check title
        const title = item.title.toLowerCase();
        return filters.brands!.some((brand) =>
          title.includes(brand.toLowerCase())
        );
      });
    }

    // Filter by colors
    if (filters.colors && filters.colors.length > 0) {
      result = result.filter((item) => {
        if (item.color) {
          // Map filter color IDs to actual color values
          const colorMap: Record<string, string[]> = {
            black: ['noir', 'black'],
            white: ['blanc', 'white'],
            gray: ['gris', 'gray', 'grey'],
            navy: ['marine', 'navy'],
            blue: ['bleu', 'blue'],
            red: ['rouge', 'red'],
            green: ['vert', 'green'],
            yellow: ['jaune', 'yellow'],
            pink: ['rose', 'pink'],
            purple: ['violet', 'purple', 'mauve'],
            beige: ['beige'],
            brown: ['marron', 'brown', 'brun'],
          };

          const itemColor = item.color.toLowerCase();
          return filters.colors!.some((colorId) => {
            const colorNames = colorMap[colorId] || [colorId];
            return colorNames.some((colorName) =>
              itemColor.includes(colorName)
            );
          });
        }
        // Fallback: check title
        const title = item.title.toLowerCase();
        return filters.colors!.some((color) => {
          const colorMap: Record<string, string[]> = {
            black: ['noir', 'black'],
            white: ['blanc', 'white'],
            gray: ['gris', 'gray', 'grey'],
            navy: ['marine', 'navy'],
            blue: ['bleu', 'blue'],
            red: ['rouge', 'red'],
            green: ['vert', 'green'],
            yellow: ['jaune', 'yellow'],
            pink: ['rose', 'pink'],
            purple: ['violet', 'purple', 'mauve'],
            beige: ['beige'],
            brown: ['marron', 'brown', 'brun'],
          };
          return colorMap[color]?.some((colorName) =>
            title.includes(colorName)
          );
        });
      });
    }

    // Filter by conditions
    if (filters.conditions && filters.conditions.length > 0) {
      result = result.filter((item) => {
        if (item.condition) {
          // Direct condition match
          return filters.conditions!.includes(item.condition);
        }
        // Fallback: check title
        const title = item.title.toLowerCase();
        return filters.conditions!.some((condition) =>
          title.includes(condition.toLowerCase())
        );
      });
    }

    // Filter by price range
    if (filters.priceRange) {
      const { min, max } = filters.priceRange;
      result = result.filter((item) => {
        const price = item.price || 0;
        return price >= min && price <= max;
      });
    }

    return result;
  }, [items, filters]);

  const hasActiveFilters = useMemo(() => {
    return (
      (filters.categories?.length ?? 0) > 0 ||
      (filters.sizes?.length ?? 0) > 0 ||
      (filters.genders?.length ?? 0) > 0 ||
      (filters.brands?.length ?? 0) > 0 ||
      (filters.colors?.length ?? 0) > 0 ||
      (filters.conditions?.length ?? 0) > 0 ||
      !!filters.priceRange
    );
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.categories) count += filters.categories.length;
    if (filters.sizes) count += filters.sizes.length;
    if (filters.genders) count += filters.genders.length;
    if (filters.brands) count += filters.brands.length;
    if (filters.colors) count += filters.colors.length;
    if (filters.conditions) count += filters.conditions.length;
    if (filters.priceRange) count += 1;
    return count;
  }, [filters]);

  const clearFilters = () => {
    setFilters({});
  };

  return {
    filteredItems,
    filters,
    setFilters,
    hasActiveFilters,
    activeFilterCount,
    clearFilters,
  };
}
