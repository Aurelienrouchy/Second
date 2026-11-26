import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { AutomatedDecisionService } from '@/services/automatedDecisionService';
import { SupportRequestService, isSupportOpaqueAttempt, newSupportRequestId, supportReceiptRequestId } from '@/services/supportRequestService';
import { getAuthSessionGeneration } from '@/store/authStore';
import type { SupportAttempt, SupportDecisionReference, SupportServicingReceipt } from '@/types/supportRequest';

/** Private refusals do not require a transaction, a complete profile or new trade eligibility. */
export function useOwnerAdmissionRefusals(decisionId?: string, priorSupportRequestId?: string, routeReferenceKey = '') {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration(), client = useQueryClient();
  const context = useLabelLifecycleContext(JSON.stringify(['owner-admission-refusals', decisionId, priorSupportRequestId, routeReferenceKey]), uid);
  const logKey = ['owner-admission-refusals', uid, generation, decisionId, context.focusRevision] as const;
  const journalKey = ['support-owner-journal', uid, generation, context.focusRevision] as const;
  const log = useInfiniteQuery({queryKey: logKey, enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture(); return AutomatedDecisionService.ownerRefusals(operation.base.session.uid,
      decisionId ? {decisionId} : pageParam ? {cursor: pageParam} : {}, () => context.assertCurrent(operation));},
    getNextPageParam: page => page.cursor ?? undefined});
  const journal = useQuery({queryKey: journalKey, enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return SupportRequestService.journal(operation.base.session.uid, 'owner', () => context.assertCurrent(operation));}});
  const sourceReady = context.focused && log.isSuccess && !log.isFetching && !log.isError && journal.isSuccess && !journal.isFetching && !journal.isError;
  const entries = sourceReady ? log.data.pages.flatMap(page => page.entries).filter((entry, index, all) => all.findIndex(other => other.id === entry.id) === index) : [];
  const pending = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const pendingContest = pending && !isSupportOpaqueAttempt(pending) && pending.scope === 'owner' && pending.command.action === 'submit' &&
    pending.command.kind === 'automated_decision_review' && pending.command.transactionId === null ? pending : null;
  const [outcome, setOutcome] = useState<{frame: symbol; focusRevision: string; result: SupportServicingReceipt} | null>(null);
  const assertSources = () => {
    for (const [key, data, at] of [[logKey, log.data, log.dataUpdatedAt], [journalKey, journal.data, journal.dataUpdatedAt]] as const) {
      const state = client.getQueryState(key);
      if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== data || state.dataUpdatedAt !== at)
        throw new Error('Relisez les sources et le journal avant une nouvelle demande.');
    }
  };
  type Input = {mode: 'submit'; decision: SupportDecisionReference; narrative: string; assertDraftCurrent: () => void} |
    {mode: 'observe' | 'neutralize' | 'acknowledge'};
  const mutation = useMutation({mutationFn: async (input: Input) => {
    const operation = context.start(); if (!operation) throw new Error('Une demande est déjà en cours.');
    const guard = () => {context.assertCurrent(operation); if (input.mode === 'submit') {assertSources(); input.assertDraftCurrent();}};
    try {
      setOutcome(null); let result: SupportServicingReceipt;
      if (input.mode === 'submit') {
        guard();
        if (!sourceReady || pending || !entries.some(entry => entry.id === input.decision.id && entry.revision !== null && entry.revision === input.decision.revision &&
          entry.sourceHash === input.decision.sourceHash)) throw new Error('Choisissez une source exacte fraîchement relue.');
        const narrative = input.narrative.trim(); if (!narrative || narrative.length > 4000) throw new Error('Décrivez votre demande en 4 000 caractères au maximum.');
        const attempt: SupportAttempt = {version: 1, uid: operation.base.session.uid, scope: 'owner', requestId: newSupportRequestId(),
          command: {action: 'submit', kind: 'automated_decision_review', transactionId: null, decision: input.decision, narrative, evidence: [],
            ...(priorSupportRequestId ? {priorSupportRequestId} : {})}};
        result = await SupportRequestService.execute(attempt, guard);
      } else {
        if (!pendingContest) throw new Error('Aucune intention exacte de révision de refus n’est relue.');
        result = input.mode === 'observe' ? await SupportRequestService.observe(pendingContest, guard) :
          input.mode === 'neutralize' ? await SupportRequestService.neutralize(pendingContest, guard) : await SupportRequestService.acknowledge(pendingContest, guard);
      }
      context.assertCurrent(operation); setOutcome({frame: context.frame, focusRevision: context.focusRevision, result}); return result;
    } finally {context.finish(operation);}
  }, onSettled: () => {void journal.refetch();}});
  const receipt = outcome?.frame === context.frame && outcome.focusRevision === context.focusRevision && outcome.result.actorId === uid &&
    supportReceiptRequestId(outcome.result) === pendingContest?.requestId ? outcome.result : null;
  return {uid, context, entries, sourceReady, pendingContest, receipt, otherIntentionPending: !!pending && !pendingContest,
    journalError: journal.isError, isLoading: log.isPending || log.isFetching, logError: log.isError, hasMore: log.hasNextPage,
    loadingMore: log.isFetchingNextPage, unknownEntries: sourceReady ? log.data.pages.reduce((sum, page) => sum + page.unknownEntries, 0) : 0,
    working: mutation.isPending, submit: (decision: SupportDecisionReference, narrative: string, assertDraftCurrent: () => void) => mutation.mutateAsync({mode: 'submit', decision, narrative, assertDraftCurrent}),
    recover: (mode: 'observe' | 'neutralize' | 'acknowledge') => mutation.mutateAsync({mode}),
    refresh: () => Promise.all([log.refetch(), journal.refetch()]), loadMore: log.fetchNextPage};
}
