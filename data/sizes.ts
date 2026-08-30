/**
 * Sizes Data — Unified source of truth
 *
 * These sizes match EXACTLY what is shown in the onboarding flow.
 * 3 sections: Tops, Bottoms, Shoes
 * 2 systems: US, EU
 * 2 demographics: Adult, Kids
 *
 * IMPORTANT: These values MUST match the SIZE_REFERENCE in functions/src/productReference.ts
 * to ensure consistency between AI suggestions and the app's selectors.
 */

// Single source of truth lives in types/index.ts. data must never be imported
// by types — this one-way re-export keeps SizeSystem identical on both sides.
import type { SizeSystem } from '@/types';
export type { SizeSystem };
export type SizeDemographic = 'adult' | 'kids';
export type SizeSection = 'tops' | 'bottoms' | 'shoes';

// ─── Adult sizes ─────────────────────────────────────────────────────

// US
export const SIZES_ADULT_TOPS_US = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
export const SIZES_ADULT_BOTTOMS_US = ['24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40'];
export const SIZES_ADULT_SHOES_US = [
  '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5',
  '9', '9.5', '10', '10.5', '11', '11.5', '12', '13',
];

// EU
export const SIZES_ADULT_TOPS_EU = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
export const SIZES_ADULT_BOTTOMS_EU = ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52'];
export const SIZES_ADULT_SHOES_EU = [
  '35', '35.5', '36', '36.5', '37', '37.5', '38', '38.5',
  '39', '39.5', '40', '40.5', '41', '42', '43', '44', '45', '46',
];

// ─── Kids sizes ──────────────────────────────────────────────────────

// US
export const SIZES_KIDS_TOPS_US = [
  '2T', '3T', '4T', '5', '6', '6X', '7', '8',
  '10', '12', '14', '16',
];
export const SIZES_KIDS_BOTTOMS_US = [
  '2T', '3T', '4T', '5', '6', '6X', '7', '8',
  '10', '12', '14', '16',
];
export const SIZES_KIDS_SHOES_US = [
  '5C', '6C', '7C', '8C', '9C', '10C', '11C', '12C', '13C',
  '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y',
];

// EU
export const SIZES_KIDS_TOPS_EU = [
  '2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans',
  '10 ans', '12 ans', '14 ans', '16 ans',
];
export const SIZES_KIDS_BOTTOMS_EU = [
  '2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans',
  '10 ans', '12 ans', '14 ans', '16 ans',
];
export const SIZES_KIDS_SHOES_EU = [
  '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35',
];

// ─── Accessor map ────────────────────────────────────────────────────

const SIZE_MAP: Record<SizeDemographic, Record<SizeSystem, Record<SizeSection, string[]>>> = {
  adult: {
    US: { tops: SIZES_ADULT_TOPS_US, bottoms: SIZES_ADULT_BOTTOMS_US, shoes: SIZES_ADULT_SHOES_US },
    EU: { tops: SIZES_ADULT_TOPS_EU, bottoms: SIZES_ADULT_BOTTOMS_EU, shoes: SIZES_ADULT_SHOES_EU },
  },
  kids: {
    US: { tops: SIZES_KIDS_TOPS_US, bottoms: SIZES_KIDS_BOTTOMS_US, shoes: SIZES_KIDS_SHOES_US },
    EU: { tops: SIZES_KIDS_TOPS_EU, bottoms: SIZES_KIDS_BOTTOMS_EU, shoes: SIZES_KIDS_SHOES_EU },
  },
};

/**
 * Get sizes for a specific section / system / demographic
 */
export const getSizes = (
  section: SizeSection,
  system: SizeSystem = 'EU',
  demographic: SizeDemographic = 'adult',
): string[] => {
  return SIZE_MAP[demographic]?.[system]?.[section] ?? SIZES_ADULT_TOPS_EU;
};

/**
 * Get all sizes across all sections for a system/demographic (flattened)
 */
export const getAllSizes = (
  system: SizeSystem = 'EU',
  demographic: SizeDemographic = 'adult',
): string[] => {
  const sections = SIZE_MAP[demographic]?.[system];
  if (!sections) return SIZES_ADULT_TOPS_EU;
  return [...sections.tops, ...sections.bottoms, ...sections.shoes];
};

/**
 * Section labels (French)
 */
export const SIZE_SECTION_LABELS: Record<SizeSection, string> = {
  tops: 'TAILLE DU HAUT',
  bottoms: 'TAILLE DU BAS',
  shoes: 'POINTURE',
};

/**
 * Size sections in display order
 */
export const SIZE_SECTIONS: SizeSection[] = ['tops', 'bottoms', 'shoes'];

const EU_TOP_EQUIVALENCE: Record<string, string> = {
  XXS: '32', XS: '34', S: '36', M: '38', L: '40', XL: '42',
  XXL: '44', '3XL': '46', '4XL': '48', '5XL': '50',
};

/** Libellé lisible dans les préférences, sans changer la valeur stockée. */
export const getPreferenceSizeLabel = (size: string, system: SizeSystem): string =>
  system === 'EU' && EU_TOP_EQUIVALENCE[size]
    ? `${size} / ${EU_TOP_EQUIVALENCE[size]}`
    : size;

// ─── Legacy helpers (backward compatibility) ─────────────────────────

export interface SizeCategory {
  categoryType: 'women_clothing' | 'women_shoes' | 'men_clothing' | 'men_shoes' | 'kids_clothing' | 'kids_shoes' | 'accessories';
  sizes: string[];
}

export const SIZE_DATA: SizeCategory[] = [
  { categoryType: 'women_clothing', sizes: [...SIZES_ADULT_TOPS_EU, ...SIZES_ADULT_BOTTOMS_EU] },
  { categoryType: 'women_shoes', sizes: SIZES_ADULT_SHOES_EU },
  { categoryType: 'men_clothing', sizes: [...SIZES_ADULT_TOPS_EU, ...SIZES_ADULT_BOTTOMS_EU] },
  { categoryType: 'men_shoes', sizes: SIZES_ADULT_SHOES_EU },
  { categoryType: 'kids_clothing', sizes: [...SIZES_KIDS_TOPS_EU, ...SIZES_KIDS_BOTTOMS_EU] },
  { categoryType: 'kids_shoes', sizes: SIZES_KIDS_SHOES_EU },
  { categoryType: 'accessories', sizes: ['Unique', 'S', 'M', 'L', 'XL'] },
];

export const sizes = {
  women: {
    clothing: [...SIZES_ADULT_TOPS_EU, ...SIZES_ADULT_BOTTOMS_EU],
    shoes: SIZES_ADULT_SHOES_EU,
    accessories: ['Unique', 'S', 'M', 'L'],
  },
  men: {
    clothing: [...SIZES_ADULT_TOPS_EU, ...SIZES_ADULT_BOTTOMS_EU],
    shoes: SIZES_ADULT_SHOES_EU,
    accessories: ['Unique', 'S', 'M', 'L', 'XL'],
  },
  kids: {
    baby: SIZES_KIDS_TOPS_EU.filter(s => !s.includes('ans')),
    clothing: SIZES_KIDS_TOPS_EU,
    shoes: SIZES_KIDS_SHOES_EU,
  },
};

/**
 * Get size items for SelectionBottomSheet (legacy)
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

  for (let i = categoryIds.length - 1; i >= 0; i--) {
    const id = categoryIds[i].toLowerCase();

    if (id.includes('kids') || id.includes('enfant')) {
      if (id.includes('shoes') || id.includes('chaussure')) return 'kids_shoes';
      return 'kids_clothing';
    }

    if (id.includes('men') || id.includes('homme')) {
      if (id.includes('shoes') || id.includes('chaussure')) return 'men_shoes';
      if (id.includes('bags') || id.includes('accessories') || id.includes('jewelry') || id.includes('sac') || id.includes('accessoire')) {
        return 'accessories';
      }
      return 'men_clothing';
    }

    if (id.includes('women') || id.includes('femme')) {
      if (id.includes('shoes') || id.includes('chaussure')) return 'women_shoes';
      if (id.includes('bags') || id.includes('accessories') || id.includes('jewelry') || id.includes('sac') || id.includes('accessoire')) {
        return 'accessories';
      }
      return 'women_clothing';
    }

    if (id.includes('shoes') || id.includes('chaussure')) return 'women_shoes';

    if (id.includes('bags') || id.includes('accessories') || id.includes('jewelry') || id.includes('sac') || id.includes('accessoire')) {
      return 'accessories';
    }
  }

  return 'women_clothing';
};

/**
 * Returns available sizes based on the list of category IDs
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
  return availableSizes.find(s => s.toLowerCase() === size.toLowerCase());
};

/**
 * Check if a size is valid for a given category
 */
export const isSizeValidForCategory = (size: string, categoryIds: string[]): boolean => {
  return findSizeInCategory(size, categoryIds) !== undefined;
};
