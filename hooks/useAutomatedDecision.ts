/**
 * useAutomatedDecision — transparency & contestation for automated decisions
 * (Loi 25, art. 12.1).
 *
 * Wraps the two party-facing Cloud Functions exposed by
 * `functions/src/callable/automatedDecisions.ts`:
 *   - getAutomatedDecisionLog(transactionId)  → the transparent log of every
 *     automated decision taken on this transaction (read).
 *   - contestAutomatedDecision(transactionId, decisionType, reason) → opens a
 *     human-review request (REVERSES NOTHING server-side).
 *
 * The presence of one or more log entries is how the UI detects that an
 * automated decision was applied and should surface the contestation entry
 * point. Backend errors come back as a `FirebaseError` with a FR `message`;
 * reuse `getRecourseErrorMessage` from `useTransactionRecourse` to surface it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebaseConfig';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AutomatedDecisionLogEntry,
  AutomatedDecisionType,
} from '@/lib/automatedDecisionMeta';

interface GetLogResult {
  ok: boolean;
  transactionId: string;
  entries: AutomatedDecisionLogEntry[];
  count: number;
}

interface ContestResult {
  ok: boolean;
  contestationId: string;
}

interface ContestArgs {
  transactionId: string;
  decisionType: AutomatedDecisionType;
  reason: string;
}

/**
 * @param transactionId  Transaction to read the automated-decision log for.
 * @param enabled        Skip the query until the transaction id is known.
 */
export function useAutomatedDecision(transactionId: string, enabled = true) {
  const queryClient = useQueryClient();

  const logQuery = useQuery({
    queryKey: queryKeys.automatedDecisions.log(transactionId),
    queryFn: async (): Promise<AutomatedDecisionLogEntry[]> => {
      const callable = httpsCallable<{ transactionId: string }, GetLogResult>(
        functions,
        'getAutomatedDecisionLog',
      );
      const result = await callable({ transactionId });
      return result.data?.entries ?? [];
    },
    enabled: enabled && transactionId.length > 0,
    // Automated decisions are immutable once logged → cache aggressively.
    staleTime: 30 * 60 * 1000, // 30 min
  });

  const contestMutation = useMutation({
    mutationFn: async ({
      transactionId: txId,
      decisionType,
      reason,
    }: ContestArgs): Promise<ContestResult> => {
      const callable = httpsCallable<ContestArgs, ContestResult>(
        functions,
        'contestAutomatedDecision',
      );
      const result = await callable({
        transactionId: txId,
        decisionType,
        reason: reason.trim(),
      });
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.automatedDecisions.log(variables.transactionId),
      });
    },
  });

  const entries = logQuery.data ?? [];

  return {
    entries,
    /** The most recent automated decision (entries are sorted desc server-side). */
    latestDecision: entries[0] ?? null,
    /** True once we know at least one automated decision was applied. */
    hasAutomatedDecision: entries.length > 0,
    isLoadingLog: logQuery.isLoading,
    isLogError: logQuery.isError,

    contest: contestMutation.mutateAsync,
    isContesting: contestMutation.isPending,
    contestError: contestMutation.error,
    isContestSuccess: contestMutation.isSuccess,
    resetContest: contestMutation.reset,
  };
}
