/**
 * Sizes Data — Unified source of truth
 *
 * These sizes are also used by the onboarding flow and the server AI reference.
 * 3 sections: Tops, Bottoms, Shoes
 * 2 systems: US, EU
 * 2 demographics: Adult, Kids
 *
 * Canonical arrays live in functions/src/shared/sizeCatalog.json.
 */

// Single source of truth lives in types/index.ts. data must never be imported
// by types — this one-way re-export keeps SizeSystem identical on both sides.
import sizeCatalog from '@/functions/src/shared/sizeCatalog.json';
import type { SizeSystem } from '@/types';
export type { SizeSystem };
export type SizeDemographic = 'adult' | 'kids';
export type SizeSection = 'tops' | 'bottoms' | 'shoes';

// Pure data shared with Functions; kept in its source tree so deployment includes it.

export const SIZES_ADULT_TOPS_US = sizeCatalog.SIZES_ADULT_TOPS_US;
export const SIZES_ADULT_BOTTOMS_US = sizeCatalog.SIZES_ADULT_BOTTOMS_US;
export const SIZES_ADULT_SHOES_US = sizeCatalog.SIZES_ADULT_SHOES_US;
export const SIZES_ADULT_TOPS_EU = sizeCatalog.SIZES_ADULT_TOPS_EU;
export const SIZES_ADULT_BOTTOMS_EU = sizeCatalog.SIZES_ADULT_BOTTOMS_EU;
export const SIZES_ADULT_SHOES_EU = sizeCatalog.SIZES_ADULT_SHOES_EU;
export const SIZES_KIDS_TOPS_US = sizeCatalog.SIZES_KIDS_TOPS_US;
export const SIZES_KIDS_BOTTOMS_US = sizeCatalog.SIZES_KIDS_BOTTOMS_US;
export const SIZES_KIDS_SHOES_US = sizeCatalog.SIZES_KIDS_SHOES_US;
export const SIZES_KIDS_TOPS_EU = sizeCatalog.SIZES_KIDS_TOPS_EU;
export const SIZES_KIDS_BOTTOMS_EU = sizeCatalog.SIZES_KIDS_BOTTOMS_EU;
export const SIZES_KIDS_SHOES_EU = sizeCatalog.SIZES_KIDS_SHOES_EU;

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
  { categoryType: 'accessories', sizes: sizeCatalog.SIZES_ACCESSORIES },
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
  return [...new Set(sizeData?.sizes || SIZE_DATA[0].sizes)];
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
