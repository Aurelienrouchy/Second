/**
 * Search screen constants — condition + sort options.
 */

import { CONDITIONS } from '@/data/conditions';

export const CONDITION_ITEMS = CONDITIONS;

export const SORT_ITEMS = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'popular', label: 'Populaires' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
];
