import {useQuery} from '@tanstack/react-query';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {readSwapProposalImage} from '@/services/swapService';
import {readScopedQuery} from '@/utils/readScopedQuery';
/** Before acceptance, only the still-public listing can authorize its own thumbnail. */
export function useSwapProposalImage(articleId: string, reference: string | null, sellerId?: string, enabled = false) {
  const uid = useAuthenticatedUid();
  const scope = useShippingPurchaseContext(JSON.stringify(['swap-proposal-photo', articleId, reference, sellerId]), uid);
  const result = useQuery({queryKey: ['swap-proposal-photo', uid, getAuthSessionGeneration(), scope.focusRevision, articleId, reference, sellerId],
    enabled: enabled && !!uid && !!sellerId && !!reference && scope.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {const op = scope.capture(); return () => scope.assertCurrent(op);}, assertCurrent => readSwapProposalImage(uid!, articleId, sellerId!, reference!, assertCurrent)),
  });
  return enabled && scope.focused && result.isSuccess && !result.isFetching && !result.isError ? result.data : null;
}
