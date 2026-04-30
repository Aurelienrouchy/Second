/**
 * Home Feature — TanStack Query Keys
 *
 * Each section has its own key so invalidations are scoped.
 * invalidateQueries({ queryKey: homeKeys.all }) still invalidates everything.
 */

export const homeKeys = {
  all:             ['home'] as const,
  trendingBrands:  () => [...homeKeys.all, 'trending-brands'] as const,
  newArrivals:     () => [...homeKeys.all, 'new-arrivals'] as const,
  priceDrops:      () => [...homeKeys.all, 'price-drops'] as const,
  featuredSellers: () => [...homeKeys.all, 'featured-sellers'] as const,
  swapParties:     () => [...homeKeys.all, 'swap-parties'] as const,
  discover:        () => [...homeKeys.all, 'discover'] as const,
  likedSellers:    () => [...homeKeys.all, 'liked-sellers'] as const,
};
