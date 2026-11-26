import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
import { inspectPaymentCaptureAnomalyProof } from '../utils/paymentCaptureAnomaly';
import { resumeTransactionRefund, observePurchaseRefund } from '../utils/refund';
/**
 * Scheduled dead-letter replay — `failed_operations` (P1 ops resilience)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * Runs every 30 minutes. Picks up `failed_operations` docs with status
 * 'pending' whose backoff window has elapsed, re-drives the underlying money
 * operation idempotently, and marks each doc 'resolved' (success) or
 * 'exhausted' (after MAX_ATTEMPTS) so it stops being retried and surfaces for a
 * human via a log-based alert on the CRITICAL line.
 *
 * AUTHORITY AND RECOVERY
 * ----------------------
 * Queue rows locate native purchase, swap or withdrawal work. The native
 * engine owns its original frozen authorization and recovery protocol;
 * a queue PaymentIntent/transfer/key/autoRefund flag never authorizes money.
 * Unqualified legacy rows wait for reconciliation without exhausting retries.
 *
 * BACKWARDS COMPATIBILITY
 * -----------------------
 * Earlier chantiers wrote a leaner dead-letter shape (transactionId/reason and
 * no attempts/payload). normalizeOp() coerces both shapes to a common view
 * before dispatch.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { type FailedOperationType, writeAdminAlert } from '../utils/failedOperations';
import { observeWithdrawalPayout, revertFailedPayout } from '../utils/payoutRecovery';
import { redrivePaymentIntentSucceeded } from '../http/webhooks';
import { hasActiveBankDispute } from '../utils/bankDispute';
import {resumeSwapTopUpRefund} from '../utils/swapTopUpRefund';
import {retryAccountSecurityMedia} from '../utils/accountSecurityMedia';

/** Max replay attempts before a dead-letter is marked 'exhausted' (manual). */
const MAX_ATTEMPTS = 6;

/** Cap docs processed per run to bound execution time / network fan-out. */
const MAX_PER_RUN = 100;

/** Process Stripe-bound work in small concurrent lots. */
const LOT_SIZE = 10;

/**
 * Exponential backoff (minutes) keyed by attempts already made. The job runs
 * every 30 min, so the smallest practical gap is 30 min; the table widens the
 * window as attempts accumulate. Index past the end clamps to the last value.
 */
const BACKOFF_MINUTES = [0, 30, 60, 120, 240, 480];

/** A normalized, shape-agnostic view of a failed_operations doc. */
interface NormalizedOp {
  id: string;
  type: FailedOperationType | string;
  refId: string | null;
  payload: Record<string, any>;
  attempts: number;
  lastTriedAtMs: number | null;
}

function normalizeOp(
  doc: FirebaseFirestore.QueryDocumentSnapshot
): NormalizedOp {
  const d = doc.data();
  const payload =
    d.payload && typeof d.payload === 'object' ? (d.payload as Record<string, any>) : {};
  // Legacy docs stored ids/reason at the top level; merge them into payload.
  const mergedPayload: Record<string, any> = {
    ...payload,
    ...(d.paymentIntentId ? { paymentIntentId: d.paymentIntentId } : {}),
    ...(d.transactionId ? { transactionId: d.transactionId } : {}),
  };
  const refId: string | null =
    (typeof d.refId === 'string' && d.refId) ||
    (typeof d.transactionId === 'string' && d.transactionId) ||
    (typeof mergedPayload.transactionId === 'string' && mergedPayload.transactionId) ||
    null;

  let lastTriedAtMs: number | null = null;
  if (d.lastTriedAt && typeof d.lastTriedAt.toMillis === 'function') {
    lastTriedAtMs = d.lastTriedAt.toMillis();
  }

  return {
    id: doc.id,
    type: d.type,
    refId,
    payload: mergedPayload,
    attempts: typeof d.attempts === 'number' ? d.attempts : 0,
    lastTriedAtMs,
  };
}

/** Whether the backoff window for this op has elapsed. */
function backoffElapsed(op: NormalizedOp, now: number): boolean {
  if (op.lastTriedAtMs == null) return true; // never tried → eligible now
  const idx = Math.min(op.attempts, BACKOFF_MINUTES.length - 1);
  const waitMs = BACKOFF_MINUTES[idx] * 60 * 1000;
  return now - op.lastTriedAtMs >= waitMs;
}

type StripeClient = ReturnType<typeof getStripe>;
type ReplayOutcome = 'resolved' | 'retry' | 'waiting_bank' | 'waiting_bank_reconciliation' | 'waiting_refund' | 'waiting_refund_action' | 'waiting_payment_reconciliation';

/** This queue also replays swaps/non-purchase operations. Qualify the purchase
 * by its PaymentIntent rather than trusting the legacy dead-letter refId alone.
 * Bank waiting does not consume an infrastructure-failure attempt.
 */
async function refundBankGuard(op: NormalizedOp): Promise<ReplayOutcome | null> {
  const pi = op.payload.paymentIntentId;
  if (typeof pi !== 'string' || !pi) return null;
  const purchases = await db.collection('transactions').where('stripePaymentIntentId', '==', pi).limit(1).get();
  if (purchases.empty) return null;
  const data = purchases.docs[0].data();
  if (hasActiveBankDispute(data)) return 'waiting_bank';
  const lostBank = data.bankDispute?.outcome === 'lost' || data.disputeOutcome === 'lost' || data.refundedVia === 'chargeback';
  if (!lostBank) return null;
  // Only the atomic bank reconciliation marker proves the ledger was repaired.
  // Unqualified legacy loss remains a human review, never a second card refund.
  if (data.status === 'refunded' && data.refundedVia === 'chargeback' && data.bankDispute?.ledgerReconciledAt) return 'resolved';
  const alertRef = db.collection('admin_alerts').doc(`bank_retry_${op.id}`);
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const snap = await tx.get(alertRef);
    if (!snap.exists) { await recoveryCommit({refs: [(alertRef).path]}); tx.set(alertRef, { kind: 'bank_dispute_reconciliation_required', severity: 'critical', refId: purchases.docs[0].id,
      message: 'Rapprocher le débit vendeur et le crédit acheteur du chargeback avant de clôturer la réparation ; ne pas émettre de remboursement carte.',
      context: { failedOperationId: op.id, paymentIntentId: pi }, status: 'open', createdAt: FieldValue.serverTimestamp() }); }
  });
  return 'waiting_bank_reconciliation';
}

async function replayPurchaseRefund(op: NormalizedOp): Promise<ReplayOutcome | null> {
  const direct = op.refId ? await db.collection('transactions').doc(op.refId).get() : null;
  const pi = op.payload.paymentIntentId;
  const matches = typeof pi === 'string' && pi ? await db.collection('transactions').where('stripePaymentIntentId', '==', pi).limit(1).get() : null;
  const doc = matches?.docs[0] ?? (direct?.exists ? direct : null);
  if (!doc) return null;
  const data = doc.data()!;
  if (typeof pi === 'string' && data.stripePaymentIntentId && pi !== data.stripePaymentIntentId) return 'waiting_refund_action';
  if (data.refund) {
    const result = (hasActiveBankDispute(data) || data.refundedVia === 'chargeback') && data.refund.stripeRefundId
      ? await observePurchaseRefund(doc.id, data.refund.stripeRefundId) : await resumeTransactionRefund(doc.id);
    if (result.success) return 'resolved';
    const current = (await doc.ref.get()).data() ?? data;
    if (hasActiveBankDispute(current)) return 'waiting_bank';
    return result.status === 'pending' ? 'waiting_refund' : 'waiting_refund_action';
  }
  const bank = await refundBankGuard(op);
  if (bank) return bank;
  // Legacy retries have no durable amounts/options nor proof of absence of an
  // external refund. Retain them for an operator instead of issuing a full refund.
  const alertRef = db.collection('admin_alerts').doc('refund_legacy_retry_' + op.id);
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const alert = await tx.get(alertRef);
    const current = (await tx.get(doc.ref)).data();
    if (!current) return;
    if (!current.refund) { await recoveryCommit({refs: [(doc.ref).path]}); tx.update(doc.ref, { refundBlocked: true, refundLegacyReconciliationRequired: true, refundLegacyOperationId: op.id }); }
    if (!alert.exists) { await recoveryCommit({refs: [(alertRef).path]}); tx.set(alertRef, { kind: 'purchase_refund_action_required', severity: 'critical', refId: doc.id,
      message: 'Réparation legacy : rapprocher les refunds Stripe, les montants et le ledger avant toute nouvelle demande.',
      context: { failedOperationId: op.id, paymentIntentId: pi ?? null }, status: 'open', createdAt: FieldValue.serverTimestamp() }); }
  });
  return 'waiting_refund_action';
}

async function replaySwapRefund(op: NormalizedOp, stripe: StripeClient): Promise<ReplayOutcome | null> {
  const pi = op.payload.paymentIntentId;
  const swaps = typeof pi === 'string' && pi
    ? await db.collection('swaps').where('topUpPaymentIntentId', '==', pi).limit(2).get() : null;
  const hint = typeof op.payload.kind === 'string' && op.payload.kind.startsWith('swap_topup_') ||
    typeof op.payload.idempotencyKey === 'string' && op.payload.idempotencyKey.startsWith('rf_swap_');
  if (swaps && !swaps.empty) {
    if (swaps.size !== 1 || op.refId !== swaps.docs[0].id) return 'waiting_refund_action';
    const result = await resumeSwapTopUpRefund(swaps.docs[0].id, pi, stripe ?? undefined);
    return result === 'resolved' ? 'resolved' : result === 'pending' ? 'waiting_refund' : 'waiting_refund_action';
  }
  return hint ? 'waiting_refund_action' : null;
}

/**
 * Replay a single dead-letter. Returns:
 *   'resolved'   the operation succeeded (or was already a no-op) → mark resolved
 *   'retry'      transient/not-yet-actionable → bump attempts, leave pending
 *                (exhausts to manual after MAX_ATTEMPTS). Backoff eligibility is
 *                handled by the caller before this runs.
 */
async function replayOp(
  op: NormalizedOp,
  stripe: StripeClient
): Promise<ReplayOutcome> {
  switch (op.type) {
    case 'payment_capture_reconciliation':
      await inspectPaymentCaptureAnomalyProof(op.id, 'retryFailedOperations');
      return 'waiting_payment_reconciliation';
    case 'payment_checkout_reconciliation':
      // Explicit operator inspection owns fresh proof. This is not a replayable
      // capture/refund instruction and must never exhaust infrastructure retries.
      return 'waiting_payment_reconciliation';
    // --- Native purchase / Troc refund recovery ----------------------------
    // Legacy aliases locate the same native intention; an idempotency key in
    // the queue cannot prove original amounts, ownership or authorization.
    case 'stripe_refund_failed':
    case 'label_refund_failed':
    case 'admin_refund_failed': {
      // A queue payload is only a locator, never a refund instruction. Swaps
      // use native never-authorized work for their first authorization; after a
      // dispatch is authorized, recovery is exclusively GET-only observation.
      const swapOutcome = await replaySwapRefund(op, stripe);
      if (swapOutcome) return swapOutcome;
      const purchaseOutcome = await replayPurchaseRefund(op);
      if (purchaseOutcome) return purchaseOutcome;
      const bankGuard = await refundBankGuard(op);
      if (bankGuard) return bankGuard;
      // No native source accepted this locator. A provider GET (even empty)
      // could not create the missing original refund authorization either.
      return 'waiting_refund_action';
    }

    // --- Transfer reversal (payout failed after transfer succeeded) ---------
    case 'transfer_reversal_failed': {
      if (typeof op.payload.withdrawalRequestId === 'string' && op.payload.withdrawalRequestId) {
        if (!stripe) return 'retry';
        const outcome = await revertFailedPayout({ withdrawalRequestId: op.payload.withdrawalRequestId }, stripe);
        return outcome.recoveryState === 'recovered' ? 'resolved' : 'retry';
      }
      // A transfer ID/key in a queue row has no native withdrawal authority.
      // Keep the unresolved liability visible; never reverse/re-credit it here.
      return 'waiting_payment_reconciliation';
    }

    // --- Lost payout.failed recovery ---------------------------------------
    // F36/F99: a payout.failed webhook was lost. The canonical recovery is
    // revertFailedPayout (re-credit wallet + reverse the platform->connected
    // transfer), idempotent via the withdrawal_requests status. The dead-letter
    // refId IS the withdrawalRequestId. Legacy 'processing_no_payout_id' docs
    // (no payoutId, nothing to reverse) still surface here and exhaust to manual.
    case 'payout_reversal_failed': {
      if (!stripe) return 'retry';
      if (op.payload.kind === 'payout_identity_reconciliation') return 'retry';
      const withdrawalRequestId =
        op.refId ||
        (typeof op.payload.withdrawalRequestId === 'string'
          ? op.payload.withdrawalRequestId
          : null);
      if (!withdrawalRequestId) {
        logger.error('CRITICAL [retryFailedOperations] payout_reversal missing withdrawalRequestId', {
          failedOperationId: op.id,
          refId: op.refId,
        });
        return 'retry';
      }
      try {
        const outcome = await observeWithdrawalPayout(withdrawalRequestId, stripe);
        logger.info('[retryFailedOperations] withdrawal current recovery observed', {
          failedOperationId: op.id, withdrawalRequestId, state: outcome.state,
        });
        return outcome.state === 'recovered' || outcome.state === 'paid' ? 'resolved' : 'retry';
      } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
        logger.warn('[retryFailedOperations] payout failure recovery replay failed — will retry', {
          failedOperationId: op.id,
          withdrawalRequestId,
          error: err instanceof Error ? err.message : err,
        });
        return 'retry';
      }
    }

    // --- Webhook amount mismatch (deterministic) ----------------------------
    // Explicitly authorized native work may resume below. An autoRefund flag
    // alone remains a request for reconciliation, never a new full refund.
    case 'amount_mismatch': {
      const swapOutcome = await replaySwapRefund(op, stripe);
      if (swapOutcome) return swapOutcome;
      // F77: a LOST payment_intent.succeeded was dead-lettered under this bucket
      // with kind 'lost_pi_succeeded_webhook'. Re-drive the canonical PI.succeeded
      // handler (idempotent) so the buyer's paid order is recovered automatically
      // instead of waiting for a human. refId IS the transactionId; the PI id is
      // in the payload.
      if (op.payload.kind === 'lost_pi_succeeded_webhook') {
        const paymentIntentId = op.payload.paymentIntentId;
        if (typeof paymentIntentId !== 'string' || !paymentIntentId) {
          logger.error('CRITICAL [retryFailedOperations] lost PI op missing paymentIntentId', {
            failedOperationId: op.id,
            refId: op.refId,
          });
          return 'retry';
        }
        try {
          const ran = await redrivePaymentIntentSucceeded(paymentIntentId);
          if (ran) {
            logger.info('[retryFailedOperations] lost PI.succeeded re-driven', {
              failedOperationId: op.id,
              refId: op.refId,
            });
            return 'resolved';
          }
          return 'retry';
        } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
          logger.warn('[retryFailedOperations] lost PI.succeeded re-drive failed — will retry', {
            failedOperationId: op.id,
            refId: op.refId,
            error: err instanceof Error ? err.message : err,
          });
          return 'retry';
        }
      }

      if (op.payload.autoRefund === true) {
        const purchaseOutcome = await replayPurchaseRefund(op);
        if (purchaseOutcome) return purchaseOutcome;
        const bankGuard = await refundBankGuard(op);
        if (bankGuard) return bankGuard;
        return 'waiting_refund_action';
      }
      // No auto-fix available — keep retrying (will exhaust) so it stays visible.
      logger.warn('CRITICAL [retryFailedOperations] amount_mismatch needs manual reconciliation', {
        failedOperationId: op.id,
        refId: op.refId,
        payload: op.payload,
      });
      return 'retry';
    }

    default: {
      // Unknown type: we cannot safely auto-replay. Keep it pending so it
      // exhausts and surfaces, but never take a destructive action.
      logger.warn('CRITICAL [retryFailedOperations] unknown dead-letter type — manual handling', {
        failedOperationId: op.id,
        type: op.type,
        refId: op.refId,
      });
      return 'retry';
    }
  }
}

export const retryFailedOperations = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async () => {
    // Non-financial containment work has its own native authority/budget. A
    // failed media observation must never prevent the existing money engine.
    try { await retryAccountSecurityMedia(); }
    catch { logger.warn('[retryFailedOperations] containment media remains unknown'); }
    return withFinancialRecoveryScope({operation: "scheduled/retryFailedOperations.retryFailedOperations"}, async () => {
    const now = Date.now();
    let resolved = 0;
    let retried = 0;
    let exhausted = 0;
    let skipped = 0;

    // Rotate the bounded pending page by DOCUMENT ID (including legacy docs
    // without createdAt). Bank-waiting docs cannot monopolize the first page.
    // status's automatic single-field index already includes __name__ ASC.
    const cursorRef = db.collection('job_locks').doc('retryFailedOperations_cursor');
    const cursor = (await cursorRef.get()).data()?.lastPendingId;
    const pendingQuery = db
      .collection('failed_operations')
      .where('status', '==', 'pending')
      .orderBy('__name__', 'asc')
      .limit(MAX_PER_RUN);
    let snap = await (typeof cursor === 'string' ? pendingQuery.startAfter(cursor) : pendingQuery).get();
    if (snap.empty && typeof cursor === 'string') snap = await pendingQuery.get();

    if (snap.empty) {
      logger.info('[retryFailedOperations] no pending operations');
      return;
    }

    const stripe = getStripe();
    const eligible = snap.docs
      .map(normalizeOp)
      .filter((op) => {
        if (!backoffElapsed(op, now)) {
          skipped++;
          return false;
        }
        return true;
      });

    for (let i = 0; i < eligible.length; i += LOT_SIZE) {
      const lot = eligible.slice(i, i + LOT_SIZE);
      const outcomes = await Promise.allSettled(
        lot.map(async (op) => {
          const outcome = await replayOp(op, stripe);
          const opRef = db.collection('failed_operations').doc(op.id);

          if (outcome === 'waiting_bank' || outcome === 'waiting_bank_reconciliation' || outcome === 'waiting_refund' || outcome === 'waiting_refund_action' || outcome === 'waiting_payment_reconciliation') {
            await opRef.update({ waitingReason: outcome, lastBankCheckedAt: FieldValue.serverTimestamp() });
            return 'waiting_bank' as const;
          }

          if (outcome === 'resolved') {
            await opRef.update({
              status: 'resolved',
              attempts: FieldValue.increment(1),
              lastTriedAt: FieldValue.serverTimestamp(),
              resolvedAt: FieldValue.serverTimestamp(),
              waitingReason: FieldValue.delete(),
              lastBankCheckedAt: FieldValue.delete(),
            });
            return 'resolved' as const;
          }

          // outcome === 'retry'
          const nextAttempts = op.attempts + 1;
          if (nextAttempts >= MAX_ATTEMPTS) {
            await opRef.update({
              status: 'exhausted',
              attempts: nextAttempts,
              lastTriedAt: FieldValue.serverTimestamp(),
              exhaustedAt: FieldValue.serverTimestamp(),
            });
            logger.error('CRITICAL [retryFailedOperations] dead-letter EXHAUSTED — manual intervention required', {
              failedOperationId: op.id,
              type: op.type,
              refId: op.refId,
              attempts: nextAttempts,
            });
            // F85: a log line alone is easy to miss. Write an actionable operator
            // alert into admin_alerts so an exhausted financial dead-letter
            // surfaces in the admin console, not just in the log stream.
            await writeAdminAlert({
              kind: 'dead_letter_exhausted',
              severity: 'critical',
              refId: op.refId ?? op.id,
              message:
                'Une opération financière en file morte a épuisé ses tentatives de rejeu automatique — intervention manuelle requise.',
              context: {
                failedOperationId: op.id,
                type: op.type,
                attempts: nextAttempts,
                payload: op.payload,
              },
            });
            return 'exhausted' as const;
          }
          await opRef.update({
            attempts: nextAttempts,
            lastTriedAt: FieldValue.serverTimestamp(),
            waitingReason: FieldValue.delete(),
            lastBankCheckedAt: FieldValue.delete(),
          });
          return 'retry' as const;
        })
      );

      for (const r of outcomes) {
        if (r.status === 'fulfilled') {
          if (r.value === 'resolved') resolved++;
          else if (r.value === 'exhausted') exhausted++;
          else if (r.value === 'waiting_bank') skipped++;
          else retried++;
        } else {
          if (r.reason instanceof FinancialRecoveryBlocked) {
            skipped++;
            logger.info('[retryFailedOperations] financial recovery suspended the native operation');
            continue;
          }
          retried++;
          logger.error('[retryFailedOperations] replay bookkeeping failed', {
            error: r.reason instanceof Error ? r.reason.message : r.reason,
          });
        }
      }
    }

    await cursorRef.set({ lastPendingId: snap.docs[snap.docs.length - 1].id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info('[retryFailedOperations] run complete', {
      scanned: snap.size,
      eligible: eligible.length,
      resolved,
      retried,
      exhausted,
      skipped,
    });

    });
  }
);
