/**
 * useSwapParties Hook
 * Calls getActiveSwapPartyInfo Cloud Function
 */

import { useQuery } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { homeKeys } from '@/features/home/query-keys';

// =============================================================================
// TYPES — matches Cloud Function response shape
// =============================================================================

export interface SwapPartyInfo {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  theme?: string;
  isGeneralist?: boolean;
  participantsCount?: number;
  itemsCount?: number;
  swapsCount?: number;
  endDate?: string;
  status?: string;
}

export interface UpcomingPartyInfo {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  theme?: string;
  isGeneralist?: boolean;
  startDate?: string;
  endDate?: string;
}

interface SwapPartyResponse {
  hasActiveParty: boolean;
  party: SwapPartyInfo | null;
  nextParty: UpcomingPartyInfo | null;
}

// =============================================================================
// HOOK
// =============================================================================

async function fetchSwapParties(): Promise<SwapPartyResponse> {
  const getActiveSwapPartyInfo = httpsCallable<void, SwapPartyResponse>(
    functions,
    'getActiveSwapPartyInfo'
  );
  const result = await getActiveSwapPartyInfo();
  return result.data;
}

export function useSwapParties() {
  return useQuery({
    queryKey: homeKeys.swapParties(),
    queryFn: fetchSwapParties,
    staleTime: 10 * 60 * 1000,
  });
}
