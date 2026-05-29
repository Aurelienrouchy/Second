/**
 * Dead-letter queue helper — `failed_operations` collection (P1 ops resilience)
 *
 * WHY
 * ---
 * Every critical money/shipping side-effect (Stripe refund, transfer reversal,
 * payout reversal, ShipEngine label, webhook amount mismatch) can fail AFTER the
 * point of no return. Previously such failures were only logged ("CRITICAL:
 * manual reconciliation needed") and silently lost. This module persists each
 * failure as a replayable dead-letter doc so `retryFailedOperations` (scheduled,
 * every 30 min) can re-drive it with backoff, and a log-based alert can fire on
 * `CRITICAL`.
 *
 * CANONICAL SCHEMA (collection `failed_operations`)
 * -------------------------------------------------
 *   type        FailedOperationType  — discriminates the replay handler
 *   refId       string               — the primary entity id (transactionId,
 *                                       withdrawalRequestId, swapId, eventId…)
 *   payload     Record<string,any>   — everything the replay handler needs
 *                                       (paymentIntentId, transferId, amounts…)
 *   error       string               — last error message
 *   attempts    number               — replay attempts so far (starts at 0)
 *   status      'pending'|'resolved'|'exhausted'
 *   createdAt   serverTimestamp
 *   lastTriedAt serverTimestamp | null
 *
 * Backwards compatibility: earlier chantiers wrote a leaner shape
 * (`type`, `transactionId`, `paymentIntentId`, `reason`, `status:'pending'`).
 * The retry job normalizes those legacy docs (transactionId→refId, reason→error)
 * before dispatching, so both shapes are replayable.
 *
 * IMPORTANT: writing a dead-letter doc is ALWAYS best-effort and NEVER throws —
 * losing the doc must not abort the caller's primary flow.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

/**
 * Discriminator for the replay handler in `retryFailedOperations`.
 * Keep in sync with the dispatch switch in scheduled/retryFailedOperations.ts.
 */
export type FailedOperationType =
  | 'stripe_refund_failed' // a refunds.create failed (card/destination charge)
  | 'transfer_reversal_failed' // transfers.createReversal failed after a payout error
  | 'payout_reversal_failed' // a payout could not be reversed/cancelled
  | 'amount_mismatch' // webhook PI.succeeded amount != expected (deterministic)
  | 'label_refund_failed' // legacy alias kept for old docs (treated as stripe_refund_failed)
  | 'admin_refund_failed'; // legacy alias kept for old docs (treated as stripe_refund_failed)

interface WriteFailedOperationInput {
  type: FailedOperationType;
  /** Primary entity id this failure is about (transaction/withdrawal/swap/event). */
  refId: string;
  /** Everything the replay handler needs to re-drive the operation. */
  payload?: Record<string, unknown>;
  /** Last error (Error or string). */
  error?: unknown;
}

/**
 * Persist a replayable dead-letter doc. Best-effort: swallows its own errors so
 * it can be safely called from any catch block without masking the original
 * failure. Returns the created doc id (or null if the write itself failed).
 */
export async function writeFailedOperation(
  input: WriteFailedOperationInput
): Promise<string | null> {
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === 'string'
        ? input.error
        : input.error != null
          ? String(input.error)
          : 'unknown_error';

  try {
    const ref = await db.collection('failed_operations').add({
      type: input.type,
      refId: input.refId,
      payload: input.payload ?? {},
      error: errorMessage,
      attempts: 0,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      lastTriedAt: null,
    });
    logger.warn('[failedOperations] dead-letter recorded', {
      failedOperationId: ref.id,
      type: input.type,
      refId: input.refId,
    });
    return ref.id;
  } catch (dlErr) {
    // Never throw — the caller's primary flow must not depend on this.
    logger.error('CRITICAL [failedOperations] could not write dead-letter doc', {
      type: input.type,
      refId: input.refId,
      originalError: errorMessage,
      writeError: dlErr instanceof Error ? dlErr.message : dlErr,
    });
    return null;
  }
}
