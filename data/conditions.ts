/**
 * Conditions Data — Single source of truth for item condition options.
 *
 * Used by: search filters, listing form (ConditionSelector), SwapZone filters.
 * Values match Firestore document field `condition`.
 */

export interface ConditionItem {
  value: string;
  label: string;
}

export const CONDITIONS: ConditionItem[] = [
  { value: 'neuf', label: 'Neuf avec étiquette' },
  { value: 'neuf sans étiquette', label: 'Neuf sans étiquette' },
  { value: 'très bon état', label: 'Très bon état' },
  { value: 'bon état', label: 'Bon état' },
  { value: 'satisfaisant', label: 'Satisfaisant' },
];

/**
 * Get condition display label from value
 */
export const getConditionLabel = (value: string): string => {
  const condition = CONDITIONS.find(c => c.value === value);
  return condition?.label || value;
};
