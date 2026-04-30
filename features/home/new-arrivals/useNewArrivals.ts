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

async function fetchNewArrivals(): Promise<HomeArticle[]> {
  const fn = httpsCallable<{ lastDocId: null; limit: number }, NewArrivalsResponse>(
    functions,
    'getNewArrivals'
  );
  const result = await fn({ lastDocId: null, limit: 10 });
  return result.data.articles;
}

export function useNewArrivals() {
  return useQuery({
    queryKey: homeKeys.newArrivals(),
    queryFn: fetchNewArrivals,
    staleTime: 10 * 60 * 1000,
  });
}
