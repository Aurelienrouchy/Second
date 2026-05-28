/**
 * prefetchHome — warm the home queries that sit at the top of the
 * viewport so the first paint of the Home tab has data already in cache.
 *
 * Called once at startup (root layout) while the native splash screen is
 * still visible. By the time the Home FlashList mounts and its first
 * sections fire `useQuery`, the cache is populated → no in-app spinner
 * flash.
 *
 * Only the two sections guaranteed to be in the initial viewport are
 * prefetched (Trending Brands + New Arrivals). The remaining sections
 * fire their own CFs as the user scrolls them into view, so eagerly
 * prefetching them would waste cold-starts on first paint.
 *
 * Uses `prefetchQuery` (not `ensureQueryData`) so a failure here never
 * rejects the startup gate — the sections will retry on mount via their
 * own `useQuery` and render their normal error/loading UI.
 */

import type { QueryClient } from '@tanstack/react-query';

import { homeKeys } from './query-keys';
import {
  fetchNewArrivals,
  NEW_ARRIVALS_STALE_TIME,
} from './new-arrivals/useNewArrivals';
import {
  fetchTrendingBrands,
  TRENDING_BRANDS_STALE_TIME,
} from './trending-brands/useTrendingBrands';

export async function prefetchHome(client: QueryClient): Promise<void> {
  await Promise.allSettled([
    client.prefetchQuery({
      queryKey: homeKeys.trendingBrands(),
      queryFn: fetchTrendingBrands,
      staleTime: TRENDING_BRANDS_STALE_TIME,
      // No retries here: a failed prefetch must resolve fast so it never
      // holds the splash screen up. The section's own `useQuery` retries
      // (retry: 2) when it mounts.
      retry: false,
    }),
    client.prefetchQuery({
      queryKey: homeKeys.newArrivals(),
      queryFn: fetchNewArrivals,
      staleTime: NEW_ARRIVALS_STALE_TIME,
      retry: false,
    }),
  ]);
}
