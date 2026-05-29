/**
 * useSwapParties Hook
 * Calls getActiveSwapPartyInfo Cloud Function.
 *
 * The Swap Zone is a single, always-active generalist zone, so the response
 * only carries { hasActiveParty, party } — no theme, dates, status or nextParty.
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
  itemsCount?: number;
  swapsCount?: number;
}

interface SwapPartyResponse {
  hasActiveParty: boolean;
  party: SwapPartyInfo | null;
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
