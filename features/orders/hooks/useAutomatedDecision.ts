import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AutomatedDecisionService } from '@/services/automatedDecisionService';
import { SupportRequestService, newSupportRequestId, isSupportOpaqueAttempt, supportReceiptRequestId } from '@/services/supportRequestService';
import type { SupportAttempt, SupportDecisionReference } from '@/types/supportRequest';

interface ContestArgs {transactionId: string; decision: SupportDecisionReference; reason: string; priorSupportRequestId?: string}
/** A best-effort journal entry qualifies its own source, never exhaustive financial execution. */
export function useAutomatedDecision(transactionId: string, enabled = true, options?: {readJournal?: boolean}) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration();
  const context = useShippingPurchaseContext(`automated-decision:${transactionId}`, uid);
  const logQuery = useInfiniteQuery({queryKey: ['automated-decision-log', transactionId, uid, generation, context.focusRevision],
    enabled: enabled && !!uid && !!transactionId && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture(); return AutomatedDecisionService.list(operation.session.uid,
      transactionId, pageParam, () => context.assertCurrent(operation));}, getNextPageParam: page => page.cursor ?? undefined });
  const journal = useQuery({queryKey: ['support-owner-journal', uid, generation, context.focusRevision],
    enabled: options?.readJournal !== false && !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return SupportRequestService.journal(operation.session.uid, 'owner', () => context.assertCurrent(operation));} });
  const sourceReady = context.focused && logQuery.isSuccess && !logQuery.isFetching && journal.isSuccess && !journal.isFetching;
  const entries = sourceReady ? logQuery.data.pages.flatMap(page => page.entries) : [];
  const pending = context.focused && journal.isSuccess && !journal.isFetching ? journal.data : null;
  const pendingContest = pending?.scope === 'owner' && !isSupportOpaqueAttempt(pending) && pending.command.action === 'submit' &&
    pending.command.kind === 'automated_decision_review' && pending.command.transactionId === transactionId ? pending : null;
  const mutation = useMutation({mutationFn: async (input: {mode: 'submit'; args: ContestArgs} | {mode: 'observe' | 'resume' | 'acknowledge'}) => {
    const operation = context.start(); if (!operation) throw new Error('Une intention est déjà en cours.');
    try {
      if (input.mode !== 'submit') {
        if (!pendingContest) throw new Error('Aucune intention de révision exacte n’est conservée pour cette commande.');
        return input.mode === 'resume' ? await SupportRequestService.execute(pendingContest, () => context.assertCurrent(operation), true) :
          input.mode === 'observe' ? await SupportRequestService.observe(pendingContest, () => context.assertCurrent(operation)) :
          await SupportRequestService.acknowledge(pendingContest, () => context.assertCurrent(operation));
      }
      const {args} = input;
      if (!sourceReady || pending || args.transactionId !== transactionId || !entries.some(e => e.id === args.decision.id &&
        e.revision === args.decision.revision && e.sourceHash === args.decision.sourceHash)) throw new Error('Relisez le journal exact et toute intention conservée avant une nouvelle révision.');
      const attempt: SupportAttempt = {version: 1, uid: operation.session.uid, scope: 'owner', requestId: newSupportRequestId(),
        command: {action: 'submit', kind: 'automated_decision_review', transactionId, decision: args.decision, narrative: args.reason.trim(),
          ...(args.priorSupportRequestId ? {priorSupportRequestId: args.priorSupportRequestId} : {})}};
      return await SupportRequestService.execute(attempt, () => context.assertCurrent(operation));
    } finally {context.finish(operation);}
  }, onSettled: () => {
    try {context.capture(); void journal.refetch();} catch { /* An old response cannot restart a private read after leaving this page. */ }
  } });
  const receipt = mutation.data?.actorId === uid && supportReceiptRequestId(mutation.data) === pendingContest?.requestId ? mutation.data : null;
  return {entries, latestDecision: entries[0] ?? null, hasAutomatedDecision: entries.length > 0, sourceReady,
    isLoadingLog: logQuery.isPending || logQuery.isFetching, isLogError: logQuery.isError,
    hasMore: logQuery.hasNextPage, loadingMore: logQuery.isFetchingNextPage,
    loadMore: () => {try {context.capture(); return logQuery.fetchNextPage();} catch {return Promise.resolve();}},
    refresh: () => {try {context.capture(); return Promise.all([logQuery.refetch(), journal.refetch()]);} catch {return Promise.resolve();}}, pendingContest, receipt,
    otherIntentionPending: !!pending && !pendingContest, journalError: journal.isError,
    contest: (args: ContestArgs) => mutation.mutateAsync({mode: 'submit', args}),
    observeContest: () => mutation.mutateAsync({mode: 'observe'}), acknowledgeContest: () => mutation.mutateAsync({mode: 'acknowledge'}),
    resumeContest: () => mutation.mutateAsync({mode: 'resume'}),
    isContesting: mutation.isPending, contestError: mutation.error, isContestSuccess: mutation.isSuccess, resetContest: mutation.reset};
}
