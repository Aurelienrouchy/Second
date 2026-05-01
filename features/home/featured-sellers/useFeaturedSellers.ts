/**
 * useFeaturedSellers
 * Calls the getFeaturedSellers Cloud Function independently.
 */

import { useQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { homeKeys } from '@/features/home/query-keys';

export interface FeaturedSeller {
  id: string;
  displayName: string;
  profileImage?: string;
  rating: number;
  articlesCount: number;
  sellerLikesCount: number;
}

async function fetchFeaturedSellers(): Promise<FeaturedSeller[]> {
  const fn = httpsCallable<void, FeaturedSeller[]>(functions, 'getFeaturedSellers');
  const result = await fn();
  return result.data;
}

export function useFeaturedSellers() {
  return useQuery({
    queryKey: homeKeys.featuredSellers(),
    queryFn: fetchFeaturedSellers,
    staleTime: 30 * 60 * 1000, // 30 min — featured sellers are server-curated
    gcTime: 2 * 60 * 60 * 1000, // 2 h
  });
}
