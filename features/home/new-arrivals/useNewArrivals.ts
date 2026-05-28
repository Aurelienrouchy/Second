/**
 * useNewArrivals
 * Calls getNewArrivals Cloud Function — first page only (10 items).
 */

import { useQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { homeKeys } from '@/features/home/query-keys';

export interface HomeArticle {
  id: string;
  title: string;
  brand?: string;
  price: number;
  images: { url: string; blurhash?: string }[];
  sellerId: string;
  sellerName: string;
  size?: string;
  condition?: string;
}

interface NewArrivalsResponse {
  articles: HomeArticle[];
  lastDocId: string | null;
}

export async function fetchNewArrivals(): Promise<HomeArticle[]> {
  const fn = httpsCallable<{ lastDocId: null; limit: number }, NewArrivalsResponse>(
    functions,
    'getNewArrivals'
  );
  const result = await fn({ lastDocId: null, limit: 10 });
  return result.data.articles;
}

/** staleTime shared between the hook and the startup prefetch. */
export const NEW_ARRIVALS_STALE_TIME = 10 * 60 * 1000; // 10 min

export function useNewArrivals() {
  return useQuery({
    queryKey: homeKeys.newArrivals(),
    queryFn: fetchNewArrivals,
    staleTime: NEW_ARRIVALS_STALE_TIME,
  });
}
