/**
 * Utilitaires pour la gestion des marques
 * Toutes les marques sont stockées dans Firestore (collection 'brands')
 * Source: vinted-brands.txt (environ 7300 marques)
 */

export interface BrandItem {
  value: string;
  label: string;
}

/**
 * Normalise un nom de marque pour la recherche
 * (minuscules, sans espaces superflus)
 */
export function normalizeBrandName(name: string): string {
  return name.toLowerCase().trim();
}

