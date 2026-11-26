import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CancelledError, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { TransactionService, sortTransactions, type ChatTransactionPage } from '@/services/transactionService';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';

/** Private data is scoped to uid/chat. An explicit older agreement never drifts to a new purchase. */
export function useChatTransactions(chatId: string, userId: string, requestedId?: string) {
  const generation = useAuthStore(getAuthSessionGeneration);
  const context = useShippingPurchaseContext(`chat-orders:${chatId}`, userId || null);
  const scope = JSON.stringify([userId, chatId, generation, context.focusRevision]);
  const [selection, setSelection] = useState<{scope: string; id: string; requestedId: string} | null>(null);
  const [listenerError, setListenerError] = useState<{scope: string; error: Error} | null>(null);
  const selectedId = selection?.scope === scope && selection.requestedId === (requestedId ?? '') ? selection.id : requestedId ?? '';
  const enabled = !!chatId && !!userId && context.focused;
  // A private read invalidated by navigation/background/hydration is an RQ
  // cancellation. Current permission/network/provider failures still surface.
  const readCurrent = async <T,>(signal: AbortSignal, read: (uid: string) => Promise<T>): Promise<T> => {
    try {
      if (signal.aborted) throw new CancelledError({revert: true});
      const operation = context.capture();
      const result = await read(operation.session.uid);
      if (signal.aborted) throw new CancelledError({revert: true});
      context.assertCurrent(operation); return result;
    } catch (error) {
      if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') {
        throw new CancelledError({revert: true});
      }
      throw error;
    }
  };
  const latest = useQuery({
    queryKey: [...queryKeys.chat.transaction(chatId, userId), generation, context.focusRevision],
    queryFn: ({signal}) => readCurrent(signal, uid => TransactionService.getTransactionByChat(chatId, uid)),
    enabled, staleTime: 0, gcTime: 0, retry: false,
  });
  const history = useInfiniteQuery({
    queryKey: [...queryKeys.chat.transactionHistory(chatId, userId), generation, context.focusRevision],
    initialPageParam: undefined as ChatTransactionPage['cursor'] | undefined,
    queryFn: ({pageParam, signal}) => readCurrent(signal, uid => TransactionService.getChatTransactionsPage(chatId, uid, pageParam)),
    getNextPageParam: page => page.hasMore ? page.cursor : undefined,
    enabled, staleTime: 0, gcTime: 0, retry: false,
  });
  const selected = useQuery({
    queryKey: [...queryKeys.chat.selectedTransaction(chatId, userId, selectedId), generation, context.focusRevision],
    queryFn: ({signal}) => readCurrent(signal, uid => TransactionService.getChatTransaction(selectedId, chatId, uid)),
    enabled: enabled && !!selectedId, staleTime: 0, gcTime: 0, retry: false,
  });
  const refresh = useCallback(async () => {
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    await Promise.all([latest.refetch(), history.refetch(), ...(selectedId ? [selected.refetch()] : [])]);
    if (!context.isCurrent(operation)) return;
  }, [context.frame, context.focusRevision, latest.refetch, history.refetch, selected.refetch, selectedId]);
  useFocusEffect(useCallback(() => { if (enabled) void refresh(); }, [enabled, refresh]));
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => sub.remove();
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    const onChange = () => { if (active && context.isCurrent(operation)) { setListenerError(null); void refresh().catch(() => undefined); } };
    const onError = (error: Error) => { if (active && context.isCurrent(operation)) setListenerError({scope, error}); };
    const stop = TransactionService.subscribeToLatestChatTransaction(chatId, userId, onChange, onError);
    return () => { active = false; stop(); };
  }, [enabled, scope, chatId, userId, refresh]);
  const transaction = !enabled ? null : selectedId ? selected.data ?? null : latest.data ?? null;
  useEffect(() => {
    if (!enabled || !transaction?.id) return;
    let active = true;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    const stop = TransactionService.subscribeToTransaction(transaction.id,
      () => { if (active && context.isCurrent(operation)) void refresh().catch(() => undefined); },
      error => { if (active && context.isCurrent(operation)) setListenerError({scope, error}); });
    return () => { active = false; stop(); };
  }, [enabled, scope, transaction?.id, refresh]);
  return {
    transaction,
    transactions: enabled ? sortTransactions([...(history.data?.pages.flatMap(page => page.transactions) ?? []), ...(transaction ? [transaction] : [])]) : [],
    selectTransaction: (id: string) => {context.capture(); setSelection({scope, id, requestedId: requestedId ?? ''});},
    refresh, loadMore: async () => {
      let operation: ReturnType<typeof context.capture>;
      try {operation = context.capture();} catch {return;}
      const result = await history.fetchNextPage(); return context.isCurrent(operation) ? result : undefined;
    }, hasMore: history.hasNextPage,
    isLoading: selectedId ? selected.isLoading : latest.isLoading,
    isFetching: latest.isFetching || selected.isFetching || history.isFetching,
    error: (selectedId ? selected.error : latest.error) ?? history.error ?? (listenerError?.scope === scope ? listenerError.error : null),
  };
}
