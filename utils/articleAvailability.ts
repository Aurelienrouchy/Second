export interface ArticleInventoryAvailability {
  protocol: 'inventory_article_availability_v1';
  state: 'available' | 'engaged' | 'consumed';
}
type ArticleAvailabilitySource = {
  isSold?: boolean;
  isActive?: boolean;
  inventoryAvailability?: unknown;
};

/** isSold also locks reservations; only the native projection distinguishes them. */
export function articleAvailability(article: ArticleAvailabilitySource): 'available' | 'reserved' | 'sold' | 'unavailable' {
  const value = article.inventoryAvailability;
  const projected = value && typeof value === 'object' && !Array.isArray(value) &&
    'protocol' in value && value.protocol === 'inventory_article_availability_v1' && 'state' in value
    ? value.state : null;
  if (article.isActive === false) return 'unavailable';
  if (projected === 'engaged') return 'reserved';
  if (projected === 'consumed') return 'sold';
  return article.isSold === true ? 'unavailable' : 'available';
}
