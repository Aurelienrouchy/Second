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
 * IDEMPOTENCE
 * -----------
 * Every replay reuses the SAME deterministic Stripe idempotency key that the
 * original call site used (e.g. `rf_label_${txId}`, `rf_admin_${txId}`,
 * `tr_${ledgerId}`). Stripe dedups on the key, so re-driving an operation that
 * in fact already succeeded is a safe no-op that returns the original result.
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
import type { FailedOperationType } from '../utils/failedOperations';

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
): Promise<'resolved' | 'retry'> {
  switch (op.type) {
    // --- Stripe refunds (card / destination charge) -------------------------
    // label_refund_failed / admin_refund_failed are legacy aliases written by
    // sweepPendingLabels and adminRefundTransaction. The original call sites use
    // deterministic keys (rf_label_${txId} / rf_admin_${txId}); reuse them so a
    // retry of an already-succeeded refund is a no-op.
    case 'stripe_refund_failed':
    case 'label_refund_failed':
    case 'admin_refund_failed': {
      if (!stripe) return 'retry';
      const paymentIntentId = op.payload.paymentIntentId;
      if (typeof paymentIntentId !== 'string' || !paymentIntentId) {
        logger.error('CRITICAL [retryFailedOperations] refund op missing paymentIntentId', {
          failedOperationId: op.id,
          type: op.type,
          refId: op.refId,
        });
        return 'retry';
      }
      const idempotencyKey =
        typeof op.payload.idempotencyKey === 'string' && op.payload.idempotencyKey
          ? op.payload.idempotencyKey
          : op.type === 'admin_refund_failed'
            ? `rf_admin_${op.refId}`
            : op.type === 'label_refund_failed'
              ? `rf_label_${op.refId}`
              : `rf_${op.refId}`;
      try {
        await stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            // Single-rail model: platform charge, so no transfer to reverse.
          },
          { idempotencyKey }
        );
        logger.info('[retryFailedOperations] refund replayed', {
          failedOperationId: op.id,
          type: op.type,
          refId: op.refId,
        });
        return 'resolved';
      } catch (err) {
        logger.warn('[retryFailedOperations] refund replay failed — will retry', {
          failedOperationId: op.id,
          refId: op.refId,
          error: err instanceof Error ? err.message : err,
        });
        return 'retry';
      }
    }

    // --- Transfer reversal (payout failed after transfer succeeded) ---------
    case 'transfer_reversal_failed': {
      if (!stripe) return 'retry';
      const transferId = op.payload.transferId;
      if (typeof transferId !== 'string' || !transferId) {
        logger.error('CRITICAL [retryFailedOperations] transfer_reversal missing transferId', {
          failedOperationId: op.id,
          refId: op.refId,
        });
        return 'retry';
      }
      try {
        await stripe.transfers.createReversal(
          transferId,
          {},
          // Deterministic key tied to the transfer so re-driving never reverses
          // more than the original transfer amount.
          { idempotencyKey: `rev_${transferId}` }
        );
        logger.info('[retryFailedOperations] transfer reversal replayed', {
          failedOperationId: op.id,
          transferId,
        });
        return 'resolved';
      } catch (err) {
        logger.warn('[retryFailedOperations] transfer reversal replay failed — will retry', {
          failedOperationId: op.id,
          transferId,
          error: err instanceof Error ? err.message : err,
        });
        return 'retry';
      }
    }

    // --- Payout reversal/cancel --------------------------------------------
    case 'payout_reversal_failed': {
      if (!stripe) return 'retry';
      const payoutId = op.payload.payoutId;
      const stripeAccountId = op.payload.stripeAccountId;
      if (typeof payoutId !== 'string' || !payoutId) {
        logger.error('CRITICAL [retryFailedOperations] payout_reversal missing payoutId', {
          failedOperationId: op.id,
          refId: op.refId,
        });
        return 'retry';
      }
      try {
        await stripe.payouts.cancel(
          payoutId,
          undefined,
          typeof stripeAccountId === 'string' && stripeAccountId
            ? { stripeAccount: stripeAccountId }
            : undefined
        );
        logger.info('[retryFailedOperations] payout cancel replayed', {
          failedOperationId: op.id,
          payoutId,
        });
        return 'resolved';
      } catch (err) {
        // A payout already paid cannot be cancelled — that is a terminal, NOT a
        // transient condition. Leave it for a human (it will exhaust) rather
        // than spinning forever.
        logger.warn('[retryFailedOperations] payout cancel replay failed — will retry', {
          failedOperationId: op.id,
          payoutId,
          error: err instanceof Error ? err.message : err,
        });
        return 'retry';
      }
    }

    // --- Webhook amount mismatch (deterministic) ----------------------------
    // The mismatch itself is not auto-fixable by code (it needs a human to
    // reconcile the expected vs received amount). If the payload requested an
    // auto-refund to make the buyer whole, replay that refund idempotently;
    // otherwise leave the op pending until it exhausts and surfaces for review.
    case 'amount_mismatch': {
      if (op.payload.autoRefund === true && stripe) {
        const paymentIntentId = op.payload.paymentIntentId;
        if (typeof paymentIntentId === 'string' && paymentIntentId) {
          try {
            await stripe.refunds.create(
              {
                payment_intent: paymentIntentId,
                ...(op.payload.isMixedCharge === true
                  ? {}
                  : { reverse_transfer: true, refund_application_fee: true }),
              },
              { idempotencyKey: `rf_mismatch_${op.refId}` }
            );
            logger.info('[retryFailedOperations] amount_mismatch auto-refund replayed', {
              failedOperationId: op.id,
              refId: op.refId,
            });
            return 'resolved';
          } catch (err) {
            logger.warn('[retryFailedOperations] amount_mismatch refund replay failed', {
              failedOperationId: op.id,
              refId: op.refId,
              error: err instanceof Error ? err.message : err,
            });
            return 'retry';
          }
        }
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
    const now = Date.now();
    let resolved = 0;
    let retried = 0;
    let exhausted = 0;
    let skipped = 0;

    // Single equality filter — no composite index required.
    const snap = await db
      .collection('failed_operations')
      .where('status', '==', 'pending')
      .limit(MAX_PER_RUN)
      .get();

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

          if (outcome === 'resolved') {
            await opRef.update({
              status: 'resolved',
              attempts: FieldValue.increment(1),
              lastTriedAt: FieldValue.serverTimestamp(),
              resolvedAt: FieldValue.serverTimestamp(),
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
            return 'exhausted' as const;
          }
          await opRef.update({
            attempts: nextAttempts,
            lastTriedAt: FieldValue.serverTimestamp(),
          });
          return 'retry' as const;
        })
      );

      for (const r of outcomes) {
        if (r.status === 'fulfilled') {
          if (r.value === 'resolved') resolved++;
          else if (r.value === 'exhausted') exhausted++;
          else retried++;
        } else {
          retried++;
          logger.error('[retryFailedOperations] replay bookkeeping failed', {
            error: r.reason instanceof Error ? r.reason.message : r.reason,
          });
        }
      }
    }

    logger.info('[retryFailedOperations] run complete', {
      scanned: snap.size,
      eligible: eligible.length,
      resolved,
      retried,
      exhausted,
      skipped,
    });
  }
);
