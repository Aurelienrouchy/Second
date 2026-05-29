/**
 * useTransactionRecourse — buyer recourse callables (refund / report / return).
 *
 * Wraps the three buyer-facing Cloud Functions exposed by
 * `functions/src/callable/recourse.ts`:
 *   - requestRefund(transactionId)                  → auto-refund on a
 *     carrier-confirmed `delivery_failed` / `lost` parcel.
 *   - reportTransactionProblem(transactionId, …)    → "delivered but problem",
 *     freezes funds, opens a dispute (no money movement).
 *   - requestReturn(transactionId, reason)          → buys a return label,
 *     freezes funds, status → `return_requested`.
 *
 * Backend errors come back as `FirebaseError` with `code` like
 * `functions/failed-precondition` and a French `message` (the HttpsError text).
 * Callers should surface `message` directly (never a raw stack) and branch on
 * `isFailedPrecondition` when a refund is refused on a delivered parcel.
 */

import { useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebaseConfig';

// Backend reason codes (mirror callable/recourse.ts).
export type ReportReasonCode =
  | 'not_received_despite_delivered'
  | 'not_as_described'
  | 'damaged'
  | 'other';

export type ReturnReasonCode = 'not_as_described' | 'damaged' | 'wrong_item' | 'other';

interface RecourseSuccess {
  success: boolean;
}

interface RequestRefundResult extends RecourseSuccess {
  alreadyRefunded?: boolean;
}

interface ReportProblemResult extends RecourseSuccess {
  disputeId?: string;
}

interface RequestReturnResult extends RecourseSuccess {
  alreadyRequested?: boolean;
  returnTrackingNumber?: string | null;
  returnLabelUrl?: string | null;
  returnLabelCost?: number;
}

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
    const callable = httpsCallable<{ transactionId: string }, RequestRefundResult>(
      functions,
      'requestRefund',
    );
    const result = await callable({ transactionId });
    return result.data;
  }, []);

  const reportProblem = useCallback(
    async (transactionId: string, reason: ReportReasonCode, details?: string) => {
      const callable = httpsCallable<
        { transactionId: string; reason: ReportReasonCode; details?: string },
        ReportProblemResult
      >(functions, 'reportTransactionProblem');
      const payload: { transactionId: string; reason: ReportReasonCode; details?: string } = {
        transactionId,
        reason,
      };
      if (details && details.trim().length > 0) {
        payload.details = details.trim();
      }
      const result = await callable(payload);
      return result.data;
    },
    [],
  );

  const requestReturn = useCallback(
    async (transactionId: string, reason: ReturnReasonCode) => {
      const callable = httpsCallable<
        { transactionId: string; reason: ReturnReasonCode },
        RequestReturnResult
      >(functions, 'requestReturn');
      const result = await callable({ transactionId, reason });
      return result.data;
    },
    [],
  );

  return { requestRefund, reportProblem, requestReturn };
}
