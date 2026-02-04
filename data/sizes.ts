/**
 * Sizes Data
 *
 * IMPORTANT: These values MUST match the SIZE_REFERENCE in functions/src/productReference.ts
 * to ensure consistency between AI suggestions and the app's selectors.
 */

export interface SizeCategory {
  categoryType: 'women_clothing' | 'women_shoes' | 'men_clothing' | 'men_shoes' | 'kids_clothing' | 'kids_shoes' | 'accessories';
  sizes: string[];
}

// Size data matching SIZE_REFERENCE in productReference.ts
export const SIZE_DATA: SizeCategory[] = [
  { categoryType: 'women_clothing', sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '34', '36', '38', '40', '42', '44', '46', '48', '50'] },
  { categoryType: 'women_shoes', sizes: ['35', '35.5', '36', '36.5', '37', '37.5', '38', '38.5', '39', '39.5', '40', '40.5', '41', '42'] },
  { categoryType: 'men_clothing', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '38', '40', '42', '44', '46', '48', '50', '52', '54'] },
  { categoryType: 'men_shoes', sizes: ['39', '40', '41', '42', '43', '44', '45', '46', '47', '48'] },
  { categoryType: 'kids_clothing', sizes: ['2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans', '10 ans', '12 ans', '14 ans', '16 ans', '50', '56', '62', '68', '74', '80', '86', '92', '98'] },
  { categoryType: 'kids_shoes', sizes: ['16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38'] },
  { categoryType: 'accessories', sizes: ['Unique', 'S', 'M', 'L', 'XL'] },
];

// Legacy object format for backward compatibility
export const sizes = {
  women: {
    clothing: SIZE_DATA.find(s => s.categoryType === 'women_clothing')!.sizes,
    shoes: SIZE_DATA.find(s => s.categoryType === 'women_shoes')!.sizes,
    accessories: SIZE_DATA.find(s => s.categoryType === 'accessories')!.sizes.slice(0, 4), // Unique, S, M, L
  },
  men: {
    clothing: SIZE_DATA.find(s => s.categoryType === 'men_clothing')!.sizes,
    shoes: SIZE_DATA.find(s => s.categoryType === 'men_shoes')!.sizes,
    accessories: SIZE_DATA.find(s => s.categoryType === 'accessories')!.sizes,
  },
  kids: {
    baby: SIZE_DATA.find(s => s.categoryType === 'kids_clothing')!.sizes.filter(s => !s.includes('ans')), // Numeric sizes only
    clothing: SIZE_DATA.find(s => s.categoryType === 'kids_clothing')!.sizes.filter(s => s.includes('ans')), // Age-based sizes
    shoes: SIZE_DATA.find(s => s.categoryType === 'kids_shoes')!.sizes,
  },
};

/**
 * Get size items for SelectionBottomSheet
 * Returns items with value and label (same for sizes)
 */
export const getSizeItems = (categoryIds: string[]) => {
  return getSizesForCategory(categoryIds).map(size => ({
    value: size,
    label: size,
  }));
};

/**
 * Get the category type from category IDs
 */
export const getCategoryType = (categoryIds: string[]): SizeCategory['categoryType'] => {
  if (!categoryIds || categoryIds.length === 0) return 'women_clothing';

  // Check from most specific to least specific
  for (let i = categoryIds.length - 1; i >= 0; i--) {
    const id = categoryIds[i].toLowerCase();

    // Kids
    if (id.includes('kids') || id.includes('enfant')) {
      if (id.includes('shoes') || id.includes('chaussure')) return 'kids_shoes';
      return 'kids_clothing';
    }

    // Men
    if (id.includes('men') || id.includes('homme')) {
      if (id.includes('shoes') || id.includes('chaussure')) return 'men_shoes';
      if (id.includes('bags') || id.includes('accessories') || id.includes('jewelry') || id.includes('sac') || id.includes('accessoire')) {
        return 'accessories';
      }
      return 'men_clothing';
    }

    // Women
    if (id.includes('women') || id.includes('femme')) {
      if (id.includes('shoes') || id.includes('chaussure')) return 'women_shoes';
      if (id.includes('bags') || id.includes('accessories') || id.includes('jewelry') || id.includes('sac') || id.includes('accessoire')) {
        return 'accessories';
      }
      return 'women_clothing';
    }

    // Generic shoes
    if (id.includes('shoes') || id.includes('chaussure')) return 'women_shoes';

    // Generic accessories
    if (id.includes('bags') || id.includes('accessories') || id.includes('jewelry') || id.includes('sac') || id.includes('accessoire')) {
      return 'accessories';
    }
  }

  return 'women_clothing';
};

/**
 * Returns available sizes based on the list of category IDs
 * Ex: ['women', 'women_shoes', 'women_shoes_boots'] -> women's shoes sizes
 */
export const getSizesForCategory = (categoryIds: string[]): string[] => {
  const categoryType = getCategoryType(categoryIds);
  const sizeData = SIZE_DATA.find(s => s.categoryType === categoryType);
  return sizeData?.sizes || SIZE_DATA[0].sizes;
};

/**
 * Find a size in the available sizes for a category
 */
export const findSizeInCategory = (size: string, categoryIds: string[]): string | undefined => {
  const availableSizes = getSizesForCategory(categoryIds);
  // Case-insensitive comparison
  return availableSizes.find(s => s.toLowerCase() === size.toLowerCase());
};

/**
 * Check if a size is valid for a given category
 */
export const isSizeValidForCategory = (size: string, categoryIds: string[]): boolean => {
  return findSizeInCategory(size, categoryIds) !== undefined;
};
