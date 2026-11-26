/**
 * Types — Recherche : tri et filtres.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { ArticleSize } from './article';

export type SortBy = 'recent' | 'price_asc' | 'price_desc' | 'popular';

export interface SearchFilters {
  category?: string; // Legacy
  categoryIds?: string[]; // Nouvelle recherche par IDs
  colors: string[];
  sizes: ArticleSize[];
  materials: string[];
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
  brands?: string[];
  sortBy?: SortBy;
}
