/**
 * useDiscoverArticles
 * Calls getNewArrivals Cloud Function with cursor-based pagination (infinite scroll).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { homeKeys } from '@/features/home/query-keys';

// =============================================================================
// TYPES
// =============================================================================

export interface DiscoverArticle {
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

interface NewArrivalsRequest {
  lastDocId: string | null;
  limit: number;
}

interface NewArrivalsResponse {
  articles: DiscoverArticle[];
  lastDocId: string | null;
}

const PAGE_SIZE = 20;

// =============================================================================
// HOOK
// =============================================================================

async function fetchDiscoverPage({
  pageParam,
}: {
  pageParam: string | null;
}): Promise<NewArrivalsResponse> {
  const fn = httpsCallable<NewArrivalsRequest, NewArrivalsResponse>(
    functions,
    'getNewArrivals'
  );
  const result = await fn({ lastDocId: pageParam, limit: PAGE_SIZE });
  return result.data;
}

export function useDiscoverArticles() {
  return useInfiniteQuery({
    queryKey: homeKeys.discover(),
    queryFn: fetchDiscoverPage,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.lastDocId ? lastPage.lastDocId : undefined,
    staleTime: 10 * 60 * 1000,
  });
}
