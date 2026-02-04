/**
 * Re-export categories from the shared source of truth
 * This file exists for backward compatibility with existing imports
 */

export {
  // Types
  CategoryNode,
  FlatCategory,
  CategoryInfo,

  // Main data
  CATEGORIES,
  FLAT_CATEGORIES,

  // Helper functions
  findCategoryById,
  getCategoryPath,
  getCategoryLabelFromIds,
  getCategoryInfoFromIds,
  getLeafCategoryLabel,
  flattenCategories,
  findFlatCategoryById,
  getLeafCategories,
  generateCategoryPromptSection,
} from '@/shared/categories';
