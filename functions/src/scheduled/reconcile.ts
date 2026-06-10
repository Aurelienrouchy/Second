/**
 * Scheduled reconciliation jobs — catch silent money divergences (P1 ops)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * Three independent passes, each DETECTION-ONLY (no auto-mutation of money):
 * they emit a `CRITICAL` log line per divergence so a log-based alert can page a
 * human, and dead-letter the actionable ones into `failed_operations` so
 * retryFailedOperations can re-drive them. Detection-only is deliberate:
 * auto-"fixing" a divergence we don't fully understand risks compounding the
 * loss. Webhooks remain the primary path; these jobs are the safety net.
 *
 *  1. reconcilePayments     — transactions stuck in pending_payment / paid whose
 *                             Stripe PaymentIntent actually succeeded/refunded
 *                             (webhook lost) → re-drive via dead-letter / log.
 *  2. reconcileWithdrawals  — withdrawal_requests stuck 'processing' long after
 *                             creation whose Stripe payout already paid/failed
 *                             (payout webhook lost) → reconcile from Stripe.
 *  3. reconcileBalances     — wallet invariant checks (no negative bucket,
 *                             no negative debt, processing-withdrawal sanity).
 *
 * Runs every 6 hours (spaced safety net; webhooks handle the happy path).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { writeFailedOperation, writeAdminAlert } from '../utils/failedOperations';
import { revertFailedPayout } from '../utils/payoutRecovery';

/** Only inspect transactions older than this (let webhooks land first). */
const PAYMENT_STALE_MS = 30 * 60 * 1000; // 30 min

/** Only inspect withdrawals stuck 'processing' longer than this. */
const WITHDRAWAL_STALE_MS = 60 * 60 * 1000; // 1 hour

/** Bound the docs each pass pulls per run. */
const MAX_PER_RUN = 200;

/** Process Stripe-bound work in small concurrent lots. */
const LOT_SIZE = 10;

/** F75: page size when scanning ALL wallets for invariant breaches. */
const WALLET_PAGE_SIZE = 500;

/** F75: hard ceiling so the wallet scan can never run unbounded. */
const BALANCE_SCAN_HARD_CAP = 100_000;

type StripeClient = ReturnType<typeof getStripe>;

// =============================================================================
// 1. reconcilePayments — recover lost payment_intent webhooks
// =============================================================================

/**
 * For a transaction whose Stripe PaymentIntent shows succeeded/refunded but
 * whose Firestore status never advanced (lost webhook), log CRITICAL and
 * dead-letter so the discrepancy is visible and (where safe) auto-handled.
 *
 * We do NOT directly mutate the transaction here — the canonical PI.succeeded /
 * charge.refunded handlers own those state machines (credit seller, label,
 * etc.). Re-driving them blindly from a reconciler would duplicate logic and
 * risk double-credits. Instead we surface the divergence; the lost-webhook can
 * also be replayed from the Stripe dashboard.
 */
async function reconcileOnePayment(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  const transactionId = doc.id;
  const data = doc.data();
  const paymentIntentId = data.stripePaymentIntentId;

  if (typeof paymentIntentId !== 'string' || !paymentIntentId || !stripe) {
    return false;
  }

  let piStatus: string | undefined;
  let amountReceived = 0;
  let amountRefunded = 0;
  let amountCaptured = 0;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
    piStatus = pi.status;
    amountReceived = pi.amount_received ?? pi.amount ?? 0;
    const charge = (pi as any).latest_charge;
    if (charge && typeof charge === 'object') {
      amountRefunded = typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0;
      amountCaptured =
        typeof charge.amount_captured === 'number'
          ? charge.amount_captured
          : typeof charge.amount === 'number'
            ? charge.amount
            : 0;
    }
  } catch (err) {
    logger.warn('[reconcilePayments] PI retrieve failed — skipping', {
      transactionId,
      paymentIntentId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }

  const status = data.status;

  // Case A: PI succeeded but the transaction is still awaiting payment. The
  // PI.succeeded webhook was lost. This is a real divergence: the buyer paid but
  // the seller was never credited / no label / article maybe still listed.
  if (piStatus === 'succeeded' && status === 'pending_payment') {
    logger.error('CRITICAL [reconcilePayments] paid PI but transaction still pending_payment (lost webhook)', {
      transactionId,
      paymentIntentId,
      amountReceived,
    });
    await writeFailedOperation({
      type: 'amount_mismatch', // generic money-divergence bucket; manual review
      refId: transactionId,
      payload: {
        kind: 'lost_pi_succeeded_webhook',
        paymentIntentId,
        amountReceived,
        firestoreStatus: status,
      },
      error: 'PaymentIntent succeeded but transaction never advanced past pending_payment',
    });
    return true;
  }

  // Case B1: canceled PI on a still-pending tx — let expireOrphanedTransactions
  // handle it (it cancels + releases). Just log for visibility, no dead-letter.
  if (piStatus === 'canceled' && status === 'pending_payment') {
    logger.warn('[reconcilePayments] canceled PI on pending_payment tx (expiry will handle)', {
      transactionId,
      paymentIntentId,
    });
    return false;
  }

  // Case B2 (F76): Stripe shows the charge was REFUNDED (fully) but our
  // transaction is still 'paid' and never recorded a refund — the charge.refunded
  // webhook was lost. The seller may have been credited for a refunded sale.
  // Surface + dead-letter so the discrepancy is visible (the canonical
  // handleChargeRefunded owns the state machine; we do not mutate money here).
  // Only flag a FULL refund (amount_refunded >= amount_captured) to avoid
  // mislabeling a deliberate partial refund.
  if (
    piStatus === 'succeeded' &&
    status === 'paid' &&
    data.stripeRefundId == null &&
    amountRefunded > 0 &&
    amountCaptured > 0 &&
    amountRefunded >= amountCaptured
  ) {
    logger.error('CRITICAL [reconcilePayments] charge fully refunded on Stripe but tx still paid (lost webhook)', {
      transactionId,
      paymentIntentId,
      amountRefunded,
      amountCaptured,
    });
    await writeFailedOperation({
      type: 'amount_mismatch', // generic money-divergence bucket; manual review
      refId: transactionId,
      payload: {
        kind: 'lost_charge_refunded_webhook',
        paymentIntentId,
        amountRefunded,
        amountCaptured,
        firestoreStatus: status,
        autoRefund: false,
      },
      error: 'Charge refunded on Stripe but transaction never marked refunded',
    });
    return true;
  }

  return false;
}

// =============================================================================
// 2. reconcileWithdrawals — recover lost payout webhooks
// =============================================================================

/**
 * For a withdrawal_requests doc stuck 'processing' well past creation, look up
 * the Stripe payout and reconcile:
 *   - payout 'paid'     → mark request 'completed' (idempotent, bookkeeping)
 *   - payout 'failed'   → dead-letter so retryFailedOperations / a human can
 *                         re-credit (the canonical re-credit lives in the
 *                         payout.failed webhook; we surface + record here).
 *   - payout 'canceled' → dead-letter for manual review.
 */
async function reconcileOneWithdrawal(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  const requestId = doc.id;
  const data = doc.data();
  const stripeAccountId =
    typeof data.stripeAccountId === 'string' ? data.stripeAccountId : undefined;
  const payoutId = typeof data.stripePayoutId === 'string' ? data.stripePayoutId : null;

  if (!stripe) return false;

  // If we never recorded a payoutId on the request, we cannot match it to a
  // Stripe payout. That itself is suspicious for a 'processing' request — flag.
  if (!payoutId) {
    logger.error('CRITICAL [reconcileWithdrawals] processing withdrawal with no stripePayoutId', {
      requestId,
      userId: data.userId,
      amount: data.amount,
    });
    await writeFailedOperation({
      type: 'payout_reversal_failed',
      refId: requestId,
      payload: {
        kind: 'processing_no_payout_id',
        userId: data.userId ?? null,
        amount: data.amount ?? null,
        stripeAccountId: stripeAccountId ?? null,
      },
      error: 'withdrawal_requests stuck processing with no stripePayoutId',
    });
    return true;
  }

  let payoutStatus: string | undefined;
  try {
    const payout = await stripe.payouts.retrieve(
      payoutId,
      undefined,
      stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
    );
    payoutStatus = payout.status;
  } catch (err) {
    logger.warn('[reconcileWithdrawals] payout retrieve failed — skipping', {
      requestId,
      payoutId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }

  if (payoutStatus === 'paid') {
    // Bookkeeping only — the wallet was already debited at walletWithdraw time.
    await doc.ref.update({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      reconciledBy: 'reconcileWithdrawals',
    });
    logger.info('[reconcileWithdrawals] processing withdrawal reconciled to completed', {
      requestId,
      payoutId,
    });
    return true;
  }

  if (payoutStatus === 'failed' || payoutStatus === 'canceled') {
    logger.error('CRITICAL [reconcileWithdrawals] payout failed/canceled but request still processing (lost webhook)', {
      requestId,
      payoutId,
      payoutStatus,
      userId: data.userId,
      amount: data.amount,
    });
    // F36/F99: the payout.failed webhook was lost. Re-drive the EXACT same
    // recovery the webhook would have run — re-credit the wallet AND reverse the
    // platform->connected transfer — via the shared idempotent helper (no-op if
    // the request is no longer 'processing'). The helper dead-letters its own
    // transfer-reversal failures.
    await revertFailedPayout(
      {
        withdrawalRequestId: requestId,
        payoutId,
        failureReason: `payout ${payoutStatus} (reconciled from Stripe)`,
        ownerIdFallback: typeof data.userId === 'string' ? data.userId : null,
      },
      stripe
    );
    return true;
  }

  // pending / in_transit — still legitimately in flight, leave it.
  return false;
}

// =============================================================================
// 3. reconcileBalances — wallet invariant checks
// =============================================================================

/**
 * Invariant checks on wallet docs (no ledger replay — that is fragile across the
 * mixed-semantics ledger types). A breach is a structural bug, logged CRITICAL.
 */
async function checkWalletInvariants(
  doc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<boolean> {
  const data = doc.data();
  const balance = typeof data.balance === 'number' ? data.balance : 0;
  const pending = typeof data.pendingBalance === 'number' ? data.pendingBalance : 0;
  const held = typeof data.heldBalance === 'number' ? data.heldBalance : 0;
  const debt = typeof data.sellerDebt === 'number' ? data.sellerDebt : 0;

  const breaches: string[] = [];
  if (balance < 0) breaches.push(`balance=${balance}`);
  if (pending < 0) breaches.push(`pendingBalance=${pending}`);
  if (held < 0) breaches.push(`heldBalance=${held}`);
  if (debt < 0) breaches.push(`sellerDebt=${debt}`);

  if (breaches.length > 0) {
    logger.error('CRITICAL [reconcileBalances] wallet invariant breach', {
      walletId: doc.id,
      breaches,
      balance,
      pendingBalance: pending,
      heldBalance: held,
      sellerDebt: debt,
    });
    // F85: invariant breaches have no auto-retry path (they are structural bugs),
    // so raise an operator alert in addition to the CRITICAL log.
    await writeAdminAlert({
      kind: 'wallet_invariant_breach',
      severity: 'critical',
      refId: doc.id,
      message: 'Invariant de porte-monnaie violé (solde négatif) — corruption probable, audit requis.',
      context: { walletId: doc.id, breaches, balance, pendingBalance: pending, heldBalance: held, sellerDebt: debt },
    });
    return true;
  }
  return false;
}

// =============================================================================
// SCHEDULED ENTRY POINT
// =============================================================================

export const reconcileFinances = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async () => {
    const now = Date.now();
    const stripe = getStripe();

    let paymentDivergences = 0;
    let withdrawalDivergences = 0;
    let balanceBreaches = 0;

    // -------------------------------------------------------------------------
    // 1. reconcilePayments
    // -------------------------------------------------------------------------
    try {
      const cutoff = new Date(now - PAYMENT_STALE_MS);
      const snap = await db
        .collection('transactions')
        .where('status', '==', 'pending_payment')
        .where('createdAt', '<', cutoff)
        .limit(MAX_PER_RUN)
        .get();

      for (let i = 0; i < snap.docs.length; i += LOT_SIZE) {
        const lot = snap.docs.slice(i, i + LOT_SIZE);
        const results = await Promise.allSettled(
          lot.map((doc) => reconcileOnePayment(doc, stripe))
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) paymentDivergences++;
        }
      }
    } catch (err) {
      logger.error('[reconcileFinances] reconcilePayments pass failed', {
        error: err instanceof Error ? err.message : err,
      });
    }

    // -------------------------------------------------------------------------
    // 2. reconcileWithdrawals
    // -------------------------------------------------------------------------
    try {
      const cutoff = new Date(now - WITHDRAWAL_STALE_MS);
      const snap = await db
        .collection('withdrawal_requests')
        .where('status', '==', 'processing')
        .where('createdAt', '<', cutoff)
        .limit(MAX_PER_RUN)
        .get();

      for (let i = 0; i < snap.docs.length; i += LOT_SIZE) {
        const lot = snap.docs.slice(i, i + LOT_SIZE);
        const results = await Promise.allSettled(
          lot.map((doc) => reconcileOneWithdrawal(doc, stripe))
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) withdrawalDivergences++;
        }
      }
    } catch (err) {
      logger.error('[reconcileFinances] reconcileWithdrawals pass failed', {
        error: err instanceof Error ? err.message : err,
      });
    }

    // -------------------------------------------------------------------------
    // 3. reconcileBalances (invariant checks)
    // F75: paginate over ALL wallets (cursor on __name__) instead of only the
    // first MAX_PER_RUN — a 200-doc cap silently skipped every wallet beyond the
    // first page, so a breach on wallet #201 was never detected. The scan is
    // read-only + cheap; a global hard cap guards against a runaway loop.
    // -------------------------------------------------------------------------
    try {
      let lastId: string | null = null;
      let scanned = 0;
      while (scanned < BALANCE_SCAN_HARD_CAP) {
        let q = db.collection('wallets').orderBy('__name__').limit(WALLET_PAGE_SIZE);
        if (lastId) q = q.startAfter(lastId);
        const snap = await q.get();
        if (snap.empty) break;
        for (const doc of snap.docs) {
          if (checkWalletInvariants(doc)) balanceBreaches++;
        }
        scanned += snap.size;
        lastId = snap.docs[snap.docs.length - 1].id;
        if (snap.size < WALLET_PAGE_SIZE) break;
      }
      if (scanned >= BALANCE_SCAN_HARD_CAP) {
        logger.warn('[reconcileBalances] hit BALANCE_SCAN_HARD_CAP — not all wallets scanned', {
          scanned,
        });
      }
    } catch (err) {
      logger.error('[reconcileFinances] reconcileBalances pass failed', {
        error: err instanceof Error ? err.message : err,
      });
    }

    logger.info('[reconcileFinances] run complete', {
      paymentDivergences,
      withdrawalDivergences,
      balanceBreaches,
    });
  }
);
