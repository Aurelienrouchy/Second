import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@/utils/environmentStorage';
import { assertTradeSessionCurrent, captureTradeSession, isDefinitiveTradeRefusal, staleTradeOperation } from '@/services/tradeOperation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/queryKeys';
import { EligibilityService, newEligibilityRequestId } from '@/services/eligibilityService';
import { UserService } from '@/services/userService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import type { EligibilityReviewStatus, AdminEligibilitySalesPage } from '@/types/eligibility';
import { readScopedQuery } from '@/utils/readScopedQuery';

export function useEligibility() {
  const uid = useAuthenticatedUid();
  const generation = useAuthStore(getAuthSessionGeneration);
  return useQuery({ queryKey: [...queryKeys.eligibility.owner(uid ?? ''), generation],
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const session = captureTradeSession(uid!);
      if (session.generation !== generation) throw staleTradeOperation();
      return () => assertTradeSessionCurrent(session);
    }, () => EligibilityService.getMine(uid!)),
    enabled: !!uid, staleTime: 0, gcTime: 0, retry: false });
}
export function useMyEligibilityReviews() {
  const uid = useAuthenticatedUid();
  return useInfiniteQuery({ queryKey: queryKeys.eligibility.reviews(uid ?? ''),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => EligibilityService.listMine(uid!, pageParam), enabled: !!uid,
    getNextPageParam: page => page.hasMore ? page.cursor ?? undefined : undefined, staleTime: 0, gcTime: 0, retry: false });
}
export function useEligibilityReview(reviewId: string | null) {
  const uid = useAuthenticatedUid();
  return useQuery({ queryKey: queryKeys.eligibility.review(uid ?? '', reviewId ?? ''),
    queryFn: () => EligibilityService.getReview(uid!, reviewId!), enabled: !!uid && !!reviewId,
    staleTime: 0, gcTime: 0, retry: false });
}
export function useAdminEligibility(status?: EligibilityReviewStatus, reviewId?: string | null, salesPage?: AdminEligibilitySalesPage) {
  const uid = useAuthenticatedUid();
  const permission = useQuery({ queryKey: queryKeys.eligibility.adminPermission(uid ?? ''),
    queryFn: async () => {
      const generation = getAuthSessionGeneration();
      const allowed = await UserService.isUserAdmin(uid!);
      if (generation !== getAuthSessionGeneration()) throw new Error('La session a changé.');
      return allowed;
    }, enabled: !!uid, staleTime: 0, gcTime: 0, retry: false });
  const queue = useInfiniteQuery({ queryKey: queryKeys.eligibility.adminQueue(uid ?? '', status ?? null),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => EligibilityService.listAdmin(uid!, status, pageParam),
    enabled: !!uid && permission.data === true && !permission.isFetching && !permission.isError,
    getNextPageParam: page => page.hasMore ? page.cursor ?? undefined : undefined, staleTime: 0, gcTime: 0, retry: false });
  const generation = useAuthStore(getAuthSessionGeneration);
  const detail = useQuery({ queryKey: [...queryKeys.eligibility.adminReview(uid ?? '', reviewId ?? ''), generation,
      salesPage?.ownerId ?? null, salesPage?.expectedVersion ?? null, salesPage?.expectedRequestVersion ?? null, salesPage?.cursor ?? null],
    queryFn: async () => {
      if (getAuthSessionGeneration() !== generation) throw new Error('La session a changé. Rouvrez le dossier actuel.');
      const response = await EligibilityService.getAdminReview(uid!, reviewId!, salesPage?.cursor);
      if (getAuthSessionGeneration() !== generation || response.request.id !== reviewId || (salesPage && (
          response.request.ownerId !== salesPage.ownerId || response.request.requestVersion !== salesPage.expectedRequestVersion ||
          response.eligibility.version !== salesPage.expectedVersion))) {
        throw new Error('Ce dossier a changé. Revenez à la première page et relisez-le avant de poursuivre.');
      }
      return response;
    },
    enabled: !!uid && !!reviewId && permission.data === true && !permission.isFetching && !permission.isError,
    staleTime: 0, gcTime: 0, retry: false });
  return { permission, queue, detail };
}
/** Payload is frozen on first send, including versions and ID. Lost-response retry
 * reuses that exact operation. A confirmed conflict must be refreshed/revalidated. */
export function useEligibilityOperation<T>(operation: (uid: string, payload: T & { requestId: string }) => Promise<unknown>, operationKey: string, admin = false, enabled = true) {
  const uid = useAuthenticatedUid();
  const client = useQueryClient();
  const pending = useRef<(T & { requestId: string }) | null>(null);
  const busy = useRef(false);
  const [isRestoring, setRestoring] = useState(true);
  const [hasPendingOperation, setHasPending] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [pendingPayload, setPendingPayload] = useState<(T & { requestId: string }) | null>(null);
  const storageKey = `eligibility_operation_${uid ?? 'guest'}_${operationKey}`;
  const operationIdentity = `${storageKey}:${enabled}`;
  const [operationOwner, setOperationOwner] = useState(operationIdentity);
  if (operationOwner !== operationIdentity) { setOperationOwner(operationIdentity); setHasPending(false); setRestoring(true); setRestoreError(false); setPendingPayload(null); }
  const mutation = useMutation({ retry: false, mutationFn: async ({payload, assertCurrent}: {
    payload: T & {requestId: string}; assertCurrent?: () => void;
  }) => {
    // React Query can pause between mutateAsync and mutationFn (offline/onMutate).
    assertCurrent?.();
    if (!uid) throw new Error('Connexion requise.');
    const result = await operation(uid, payload);
    assertCurrent?.();
    return result;
  } });
  useEffect(() => {
    let cancelled = false;
    pending.current = null; busy.current = false; mutation.reset();
    if (!uid || !enabled) { void Promise.resolve().then(() => { if (!cancelled) setRestoring(false); }); return; }
    void AsyncStorage.getItem(storageKey).then(value => {
      if (cancelled) return;
      setPendingPayload(null); setHasPending(false);
      if (value) {
        const saved = JSON.parse(value) as { uid: string; payload: T & { requestId: string } };
        if (saved.uid !== uid || typeof saved.payload?.requestId !== 'string') throw new Error('Tentative conservée invalide.');
        if (saved.uid === uid) {
          pending.current = saved.payload; setPendingPayload(saved.payload); setHasPending(true);
        }
      }
    }).catch(() => { /* A failed pending-operation read blocks sending until retry. */
      if (!cancelled) setRestoreError(true);
    }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [uid, storageKey, restoreAttempt, enabled]);
  const send = async (payload: T, options?: {assertCurrent?: () => void}) => {
    if (busy.current || isRestoring || restoreError || !uid || !enabled) return;
    busy.current = true;
    const generation = getAuthSessionGeneration();
    const sameSession = () => generation === getAuthSessionGeneration();
    if (!pending.current) {
      // A restore/recheck can reset the hook view while an explicit replay is
      // waiting. Preserve its recorded identity even across that role recheck.
      const replayId = payload && typeof payload === 'object' && 'requestId' in payload && typeof payload.requestId === 'string'
        ? payload.requestId : newEligibilityRequestId();
      pending.current = { ...payload, requestId: replayId };
    }
    const submitted = pending.current;
    setHasPending(true); setPendingPayload(submitted);
    try {
      options?.assertCurrent?.();
      // Persist the exact operation before IO, so route/app closure can resume it.
      await AsyncStorage.setItem(storageKey, JSON.stringify({ uid, payload: submitted }));
      options?.assertCurrent?.();
      if (!sameSession()) throw new Error('La session a changé.');
      const result = await mutation.mutateAsync({payload: submitted, assertCurrent: options?.assertCurrent});
      options?.assertCurrent?.();
      if (!sameSession()) return;
      await AsyncStorage.removeItem(storageKey);
      pending.current = null; setPendingPayload(null); setHasPending(false);
      await client.invalidateQueries({ queryKey: admin ? queryKeys.eligibility.admin(uid) : queryKeys.eligibility.owner(uid) });
      if (!sameSession()) return;
      return result;
    } catch (error) {
      // Local focus/source fences can fail after a committed RPC. Only a
      // definitive server refusal authorizes discarding the exact operation.
      if (sameSession() && isDefinitiveTradeRefusal(error)) {
        await AsyncStorage.removeItem(storageKey); pending.current = null; setPendingPayload(null); setHasPending(false);
      }
      throw error;
    } finally { if (sameSession()) busy.current = false; }
  };
  return { ...mutation, send, isRestoring, restoreError, retryRestore: () => { setRestoring(true); setRestoreError(false); setRestoreAttempt(value => value + 1); }, hasPendingOperation,
    pendingPayload };
}
