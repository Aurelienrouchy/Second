/**
 * Product Reference Data for Gemini AI Analysis
 *
 * This file contains all valid values that Gemini must choose from
 * when analyzing product images. This ensures consistency between
 * AI suggestions and the app's filter system.
 *
 * Categories are imported from the shared source of truth.
 */

// Import categories from local copy (for Firebase deployment)
import {
  FlatCategory,
  FLAT_CATEGORIES,
  getLeafCategories,
  findFlatCategoryById,
  generateCategoryPromptSection,
  TOP_LEVEL_CATEGORIES,
  generateStep1Prompt,
  getSubcategoriesForTopLevel,
  getLeafCategoriesForTopLevel,
  generateStep2CategoryPrompt,
  estimateTokenCount,
  getCategoryStats,
  findCategoryByLabel,
  generateCompactCategoryPrompt,
  findCategoryByLabelFuzzy,
} from './shared/categories';

// Re-export for backward compatibility
export {
  FlatCategory,
  FLAT_CATEGORIES,
  getLeafCategories,
  findFlatCategoryById,
  generateCategoryPromptSection,
  TOP_LEVEL_CATEGORIES,
  generateStep1Prompt,
  getSubcategoriesForTopLevel,
  getLeafCategoriesForTopLevel,
  generateStep2CategoryPrompt,
  estimateTokenCount,
  getCategoryStats,
  findCategoryByLabel,
  generateCompactCategoryPrompt,
  findCategoryByLabelFuzzy,
};

// ============================================
// CATEGORY HELPERS FOR AI
// ============================================

// Legacy type alias for backward compatibility
export type CategoryReference = FlatCategory;
export const CATEGORY_REFERENCE = FLAT_CATEGORIES;

// Alias for backward compatibility
export const findCategoryById = findFlatCategoryById;

// Cached leaf category IDs for fast lookup
let leafCategoryIds: Set<string> | null = null;

/**
 * Check if a category ID is a leaf category (has no children)
 */
export function isLeafCategory(categoryId: string): boolean {
  if (!leafCategoryIds) {
    leafCategoryIds = new Set(getLeafCategories().map(c => c.id));
  }
  return leafCategoryIds.has(categoryId);
}

/**
 * Find a leaf category by ID. Returns undefined if not a leaf.
 */
export function findLeafCategoryById(categoryId: string): FlatCategory | undefined {
  const category = findFlatCategoryById(categoryId);
  if (category && isLeafCategory(categoryId)) {
    return category;
  }
  return undefined;
}

/**
 * Find the closest leaf category for a given parent category.
 * Returns the first child leaf if the category is a parent.
 */
export function findClosestLeafCategory(categoryId: string): FlatCategory | undefined {
  // If it's already a leaf, return it
  const category = findFlatCategoryById(categoryId);
  if (!category) return undefined;

  if (isLeafCategory(categoryId)) {
    return category;
  }

  // Find the first leaf that has this category in its path
  const leaves = getLeafCategories();
  return leaves.find(leaf => leaf.path.includes(categoryId));
}

// ============================================
// COLORS - With IDs for filtering
// ============================================

export interface ColorReference {
  id: string;       // ID to store in Firestore
  name: string;     // Display name
  hex: string;      // Hex color for UI
  aliases: string[]; // Alternative names Gemini might use
}

export const COLOR_REFERENCE: ColorReference[] = [
  { id: 'noir', name: 'Noir', hex: '#000000', aliases: ['black', 'sombre', 'ébène'] },
  { id: 'blanc', name: 'Blanc', hex: '#FFFFFF', aliases: ['white', 'ivoire', 'écru', 'cassé'] },
  { id: 'gris', name: 'Gris', hex: '#808080', aliases: ['grey', 'gray', 'anthracite', 'charbon'] },
  { id: 'gris-clair', name: 'Gris clair', hex: '#D3D3D3', aliases: ['light grey', 'perle', 'souris'] },
  { id: 'bleu', name: 'Bleu', hex: '#0066FF', aliases: ['blue', 'azur', 'cobalt', 'roi'] },
  { id: 'bleu-marine', name: 'Bleu marine', hex: '#000080', aliases: ['navy', 'marine', 'nuit'] },
  { id: 'bleu-clair', name: 'Bleu clair', hex: '#87CEEB', aliases: ['ciel', 'pastel', 'baby blue', 'light blue'] },
  { id: 'turquoise', name: 'Turquoise', hex: '#40E0D0', aliases: ['cyan', 'aqua', 'lagon'] },
  { id: 'rouge', name: 'Rouge', hex: '#FF0000', aliases: ['red', 'carmin', 'vermillon', 'cerise'] },
  { id: 'bordeaux', name: 'Bordeaux', hex: '#800020', aliases: ['burgundy', 'lie de vin', 'grenat', 'pourpre'] },
  { id: 'rose', name: 'Rose', hex: '#FFC0CB', aliases: ['pink', 'fuchsia', 'magenta', 'saumon'] },
  { id: 'rose-pale', name: 'Rose pâle', hex: '#FFE4E1', aliases: ['blush', 'poudre', 'dragée'] },
  { id: 'vert', name: 'Vert', hex: '#008000', aliases: ['green', 'émeraude', 'jade'] },
  { id: 'vert-fonce', name: 'Vert foncé', hex: '#006400', aliases: ['kaki', 'olive', 'sapin', 'bouteille', 'forêt'] },
  { id: 'vert-clair', name: 'Vert clair', hex: '#90EE90', aliases: ['menthe', 'pistache', 'anis', 'lime'] },
  { id: 'jaune', name: 'Jaune', hex: '#FFCC00', aliases: ['yellow', 'citron', 'moutarde'] },
  { id: 'orange', name: 'Orange', hex: '#FFA500', aliases: ['tangerine', 'abricot', 'pêche'] },
  { id: 'corail', name: 'Corail', hex: '#FF7F50', aliases: ['coral', 'saumon', 'pamplemousse'] },
  { id: 'violet', name: 'Violet', hex: '#800080', aliases: ['purple', 'mauve', 'lilas', 'prune', 'aubergine'] },
  { id: 'lavande', name: 'Lavande', hex: '#E6E6FA', aliases: ['parme', 'lilas clair', 'glycine'] },
  { id: 'marron', name: 'Marron', hex: '#8B4513', aliases: ['brown', 'chocolat', 'café', 'noisette', 'taupe'] },
  { id: 'beige', name: 'Beige', hex: '#F5F5DC', aliases: ['sable', 'nude', 'chameau', 'crème'] },
  { id: 'camel', name: 'Camel', hex: '#C19A6B', aliases: ['fauve', 'cognac', 'havane', 'tan'] },
  { id: 'creme', name: 'Crème', hex: '#FFFDD0', aliases: ['cream', 'ivoire', 'vanille', 'nacre'] },
  { id: 'argent', name: 'Argent', hex: '#C0C0C0', aliases: ['silver', 'métallisé'] },
  { id: 'or', name: 'Or', hex: '#FFD700', aliases: ['gold', 'doré', 'bronze', 'cuivré'] },
  { id: 'cuivre', name: 'Cuivre', hex: '#B87333', aliases: ['copper', 'bronze', 'rouille'] },
  { id: 'multicolore', name: 'Multicolore', hex: '#FF6B6B', aliases: ['imprimé', 'motif', 'rayé', 'fleuri', 'coloré'] },
];

// ============================================
// MATERIALS - With IDs for filtering
// ============================================

export interface MaterialReference {
  id: string;       // ID to store in Firestore
  name: string;     // Display name
  aliases: string[]; // Alternative names
}

export const MATERIAL_REFERENCE: MaterialReference[] = [
  // Fibres naturelles
  { id: 'coton', name: 'Coton', aliases: ['cotton', 'jersey', 'molleton'] },
  { id: 'laine', name: 'Laine', aliases: ['wool', 'mérinos'] },
  { id: 'soie', name: 'Soie', aliases: ['silk', 'satin de soie'] },
  { id: 'lin', name: 'Lin', aliases: ['linen', 'toile de lin'] },
  { id: 'cachemire', name: 'Cachemire', aliases: ['cashmere'] },
  { id: 'mohair', name: 'Mohair', aliases: [] },
  { id: 'angora', name: 'Angora', aliases: [] },
  { id: 'alpaga', name: 'Alpaga', aliases: ['alpaca'] },
  { id: 'chanvre', name: 'Chanvre', aliases: ['hemp'] },
  { id: 'bambou', name: 'Bambou', aliases: ['bamboo'] },
  // Fibres synthétiques
  { id: 'polyester', name: 'Polyester', aliases: ['synthétique', 'microfibre'] },
  { id: 'viscose', name: 'Viscose', aliases: ['rayonne', 'rayon', 'modal'] },
  { id: 'elasthanne', name: 'Élasthanne', aliases: ['spandex', 'lycra', 'stretch'] },
  { id: 'nylon', name: 'Nylon', aliases: ['polyamide'] },
  { id: 'acrylique', name: 'Acrylique', aliases: ['acrylic'] },
  // Cuirs et similaires
  { id: 'cuir', name: 'Cuir', aliases: ['leather', 'nappa', 'daim', 'suède', 'nubuck'] },
  { id: 'cuir-synthetique', name: 'Cuir synthétique', aliases: ['simili cuir', 'faux cuir', 'skaï', 'vegan leather'] },
  { id: 'daim', name: 'Daim', aliases: ['suede', 'suède', 'nubuck'] },
  // Textiles spéciaux
  { id: 'denim', name: 'Jean/Denim', aliases: ['jean', 'jeans', 'toile'] },
  { id: 'velours', name: 'Velours', aliases: ['velvet', 'velours côtelé', 'corduroy'] },
  { id: 'dentelle', name: 'Dentelle', aliases: ['lace', 'guipure', 'broderie anglaise'] },
  { id: 'satin', name: 'Satin', aliases: ['satiné', 'charmeuse'] },
  { id: 'tweed', name: 'Tweed', aliases: ['bouclé', 'bouclette'] },
  { id: 'maille', name: 'Maille', aliases: ['tricot', 'knit', 'crochet'] },
  { id: 'mousseline', name: 'Mousseline', aliases: ['chiffon', 'voile'] },
  // Fourrures
  { id: 'fourrure', name: 'Fourrure', aliases: ['fur', 'vison', 'renard'] },
  { id: 'fourrure-synthetique', name: 'Fourrure synthétique', aliases: ['fausse fourrure', 'faux fur'] },
  // Matériaux rigides
  { id: 'bois', name: 'Bois', aliases: ['wood', 'bambou', 'rotin', 'osier'] },
  { id: 'metal', name: 'Métal', aliases: ['metal', 'acier', 'laiton', 'aluminium', 'fer'] },
  { id: 'plastique', name: 'Plastique', aliases: ['pvc', 'vinyle', 'résine'] },
  { id: 'verre', name: 'Verre', aliases: ['glass', 'cristal'] },
  { id: 'ceramique', name: 'Céramique', aliases: ['ceramic', 'porcelaine', 'terre cuite'] },
  // Accessoires
  { id: 'paillettes', name: 'Paillettes', aliases: ['sequins', 'strass', 'glitter'] },
  { id: 'perles', name: 'Perles', aliases: ['pearls', 'nacre'] },
  { id: 'raphia', name: 'Raphia', aliases: ['paille', 'straw', 'jonc'] },
];

// ============================================
// SIZES - Per category type
// ============================================

export interface SizeReference {
  categoryType: 'women_clothing' | 'women_shoes' | 'men_clothing' | 'men_shoes' | 'kids_clothing' | 'kids_shoes' | 'accessories';
  sizes: string[];
}

export const SIZE_REFERENCE: SizeReference[] = [
  { categoryType: 'women_clothing', sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '34', '36', '38', '40', '42', '44', '46', '48', '50'] },
  { categoryType: 'women_shoes', sizes: ['35', '35.5', '36', '36.5', '37', '37.5', '38', '38.5', '39', '39.5', '40', '40.5', '41', '42'] },
  { categoryType: 'men_clothing', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '38', '40', '42', '44', '46', '48', '50', '52', '54'] },
  { categoryType: 'men_shoes', sizes: ['39', '40', '41', '42', '43', '44', '45', '46', '47', '48'] },
  { categoryType: 'kids_clothing', sizes: ['2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans', '10 ans', '12 ans', '14 ans', '16 ans', '50', '56', '62', '68', '74', '80', '86', '92', '98'] },
  { categoryType: 'kids_shoes', sizes: ['16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38'] },
  { categoryType: 'accessories', sizes: ['Unique', 'S', 'M', 'L', 'XL'] },
];

// ============================================
// CONDITIONS - Standard values
// ============================================

export const CONDITION_REFERENCE = [
  { id: 'neuf', name: 'Neuf avec étiquette', description: 'Article jamais porté, étiquette encore attachée' },
  { id: 'tres-bon-etat', name: 'Très bon état', description: 'Article peu porté, aucun défaut visible' },
  { id: 'bon-etat', name: 'Bon état', description: 'Article porté avec de légères traces d\'usure' },
  { id: 'satisfaisant', name: 'Satisfaisant', description: 'Article avec défauts visibles (taches, accrocs...)' },
];

// ============================================
// HELPER: Generate prompt sections for Gemini
// ============================================

// generateCategoryPromptSection is imported from shared/categories

export function generateColorPromptSection(): string {
  return COLOR_REFERENCE.map(c => `"${c.id}" (${c.name})`).join(', ');
}

export function generateMaterialPromptSection(): string {
  return MATERIAL_REFERENCE.map(m => `"${m.id}" (${m.name})`).join(', ');
}

export function generateSizePromptSection(): string {
  return SIZE_REFERENCE.map(s =>
    `  - ${s.categoryType}: ${s.sizes.slice(0, 8).join(', ')}...`
  ).join('\n');
}

// ============================================
// HELPER: Find color by ID or alias
// ============================================

// findCategoryById is imported as findFlatCategoryById from shared/categories

export function findColorByNameOrAlias(name: string): ColorReference | undefined {
  const normalized = name.toLowerCase().trim();
  return COLOR_REFERENCE.find(color =>
    color.id === normalized ||
    color.name.toLowerCase() === normalized ||
    color.aliases.some(alias => alias.toLowerCase() === normalized)
  );
}

// ============================================
// HELPER: Find material by ID or alias
// ============================================

export function findMaterialByNameOrAlias(name: string): MaterialReference | undefined {
  const normalized = name.toLowerCase().trim();
  return MATERIAL_REFERENCE.find(mat =>
    mat.id === normalized ||
    mat.name.toLowerCase() === normalized ||
    mat.aliases.some(alias => alias.toLowerCase() === normalized)
  );
}
