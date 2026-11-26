import {useQuery} from '@tanstack/react-query';

import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {queryKeys} from '@/lib/queryKeys';
import {ArticlesService} from '@/services/articlesService';
import {getAuthSessionGeneration} from '@/store/authStore';
import {readScopedQuery} from '@/utils/readScopedQuery';

/** Reopening the deposit picker is an explicit request for current inventory.
 * A fresh cached empty wardrobe must never hide a newly published article. */
export function useSwapDepositArticles(uid: string | null, opened: boolean) {
  const scope = useLabelLifecycleContext('troc-deposit-inventory', uid);
  return useQuery({
    queryKey: [
      ...queryKeys.articles.userList(uid ?? ''),
      'troc-deposit',
      getAuthSessionGeneration(),
      scope.focusRevision,
    ],
    queryFn: ({signal}) => readScopedQuery(
      signal,
      () => {
        const operation = scope.capture();
        return () => scope.assertCurrent(operation);
      },
      () => ArticlesService.getUserArticles(uid!),
    ),
    enabled: !!uid && opened && scope.focused,
    staleTime: 0,
  });
}
