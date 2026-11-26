/**
 * Search feature — barrel exports.
 */

export { FilterChipsRow, type FilterChip } from './components/FilterChipsRow';
export { PriceRangeInputs } from './components/PriceRangeInputs';
export { SearchHeader } from './components/SearchHeader';
export { searchStyles } from './styles';
export { CONDITION_ITEMS, SORT_ITEMS } from './constants';

// — modules rattachés lors du regroupement par feature —
export { default as RecentSearches } from './components/RecentSearches';
export { default as SaveSearchButton } from './components/SaveSearchButton';
export { default as VisualSearchCamera } from './components/VisualSearchCamera';
export { useSearchScreen } from './hooks/useSearchScreen';
