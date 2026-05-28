/**
 * useTrendingBrands
 * Calls the getTrendingBrands Cloud Function independently.
 */

import { useQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { homeKeys } from '@/features/home/query-keys';

export interface TrendingBrand {
  name: string;
  articleCount: number;
}

export async function fetchTrendingBrands(): Promise<TrendingBrand[]> {
  const fn = httpsCallable<void, TrendingBrand[]>(functions, 'getTrendingBrands');
  const result = await fn();
  return result.data;
}

/** staleTime shared between the hook and the startup prefetch. */
export const TRENDING_BRANDS_STALE_TIME = 60 * 60 * 1000; // 1 h

export function useTrendingBrands() {
  return useQuery({
    queryKey: homeKeys.trendingBrands(),
    queryFn: fetchTrendingBrands,
    // Trending brands change at most once a day server-side. Long
    // staleTime so revisiting the home tab doesn't hit the CF every
    // time. gcTime keeps the cached payload alive between sessions.
    staleTime: 60 * 60 * 1000, // 1 h
    gcTime: 24 * 60 * 60 * 1000, // 24 h
  });
}
