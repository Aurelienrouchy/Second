/**
 * usePriceDrops
 * Calls the getPriceDrops Cloud Function independently.
 */

import { useQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { homeKeys } from '@/features/home/query-keys';

export interface PriceDropArticle {
  id: string;
  title: string;
  brand?: string;
  price: number;
  originalPrice: number;
  reduction: string;
  images: { url: string; blurhash?: string }[];
  sellerId: string;
  sellerName: string;
}

async function fetchPriceDrops(): Promise<PriceDropArticle[]> {
  const fn = httpsCallable<void, PriceDropArticle[]>(functions, 'getPriceDrops');
  const result = await fn();
  return result.data;
}

export function usePriceDrops() {
  return useQuery({
    queryKey: homeKeys.priceDrops(),
    queryFn: fetchPriceDrops,
    staleTime: 10 * 60 * 1000,
  });
}
