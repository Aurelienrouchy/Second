/**
 * useTransactionRecourse — buyer recourse callables (refund / report / return).
 *
 * Wraps the three buyer-facing Cloud Functions exposed by
 * `functions/src/callable/recourse.ts`:
 *   - requestRefund(transactionId)                  → auto-refund on a
 *     carrier-confirmed `delivery_failed` / `lost` parcel.
 *   - reportTransactionProblem(transactionId, …)    → "delivered but problem",
 *     freezes funds, opens a dispute (no money movement).
 *   - requestReturn(transactionId, reason, uid, scope) → retains the deposited
 *     request/hold DTO independently from a committed return label.
 *
 * Backend errors come back as `FirebaseError` with `code` like
 * `functions/failed-precondition` and a French `message` (the HttpsError text).
 * Callers should surface `message` directly (never a raw stack) and branch on
 * `isFailedPrecondition` when a refund is refused on a delivered parcel.
 */

import { useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebaseConfig';
import type { IssueRefundResult } from '@/types/transaction';
import { TransactionService } from '@/services/transactionService';
import type { ReturnRequestReason, ReturnRequestResult } from '@/types/transaction';

// Backend reason codes (mirror callable/recourse.ts).
export type ReportReasonCode =
  | 'not_received_despite_delivered'
  | 'not_as_described'
  | 'damaged'
  | 'other';

export type ReturnReasonCode = ReturnRequestReason;

/** Narrowed shape of a Firebase callable error. */
interface CallableError {
  code?: string;
  message?: string;
}

function asCallableError(error: unknown): CallableError {
  if (typeof error === 'object' && error !== null) {
    return error as CallableError;
  }
  return {};
}

/** True when a callable rejected with `failed-precondition`. */
export function isFailedPrecondition(error: unknown): boolean {
  return asCallableError(error).code === 'functions/failed-precondition';
}

/**
 * Extracts a user-facing French message from a callable error. The backend
 * HttpsError messages are already written in FR; we fall back to a neutral
 * sentence when the SDK gives us nothing readable.
 */
export function getRecourseErrorMessage(error: unknown): string {
  const message = asCallableError(error).message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim();
  }
  return 'Une erreur est survenue. Veuillez réessayer dans un instant.';
}

export function useTransactionRecourse() {
  const requestRefund = useCallback(async (transactionId: string) => {
    const callable = httpsCallable<{ transactionId: string }, IssueRefundResult>(
      functions,
      'requestRefund',
    );
    const result = await callable({ transactionId });
    return result.data;
  }, []);

  const reportProblem = useCallback(
    (transactionId: string, reason: ReportReasonCode, details: string, uid: string, assertContext: () => void, setDeclaration?: import('@/types/transactionProblem').WholeSetDeclaration) =>
      TransactionService.reportTransactionProblem(transactionId, reason, details, uid, assertContext, setDeclaration),
    [],
  );

  const requestReturn = useCallback(
    (transactionId: string, reason: ReturnReasonCode, uid: string, assertContext: () => void): Promise<ReturnRequestResult> =>
      TransactionService.requestReturn(transactionId, reason, uid, assertContext),
    [],
  );

  return { requestRefund, reportProblem, requestReturn };
}
