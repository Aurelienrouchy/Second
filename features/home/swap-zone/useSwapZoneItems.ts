/**
 * useSwapZoneItems Hook
 * Fetches the most recent available items of the (single) Swap Zone so the
 * home card can preview real stock. Also derives a simple "new this week"
 * freshness count from item.addedAt.
 *
 * Reuses the composite index swapPartyItems(partyId + isSwapped + addedAt desc)
 * via swapService.getRecentPartyItems.
 */

import { useQuery } from '@tanstack/react-query';

import { getRecentPartyItems } from '@/services/swapService';
import { SwapPartyItem } from '@/types';
import { homeKeys } from '@/features/home/query-keys';

// =============================================================================
// CONSTANTS
// =============================================================================

const PREVIEW_LIMIT = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// =============================================================================
// HELPERS
// =============================================================================

/** Count items added within the last 7 days (freshness signal). */
function countNewThisWeek(items: SwapPartyItem[]): number {
  const threshold = Date.now() - WEEK_MS;
  return items.reduce((acc, item) => {
    const added = item.addedAt instanceof Date ? item.addedAt.getTime() : 0;
    return added >= threshold ? acc + 1 : acc;
  }, 0);
}

// =============================================================================
// HOOK
// =============================================================================

export function useSwapZoneItems(partyId?: string) {
  const query = useQuery({
    queryKey: homeKeys.swapZoneItems(partyId ?? ''),
    queryFn: () => getRecentPartyItems(partyId as string, PREVIEW_LIMIT),
    enabled: !!partyId,
    staleTime: 5 * 60 * 1000,
  });

  const items = query.data ?? [];

  return {
    items,
    newThisWeek: countNewThisWeek(items),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
