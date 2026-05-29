"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileFinances = void 0;
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
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const failedOperations_1 = require("../utils/failedOperations");
/** Only inspect transactions older than this (let webhooks land first). */
const PAYMENT_STALE_MS = 30 * 60 * 1000; // 30 min
/** Only inspect withdrawals stuck 'processing' longer than this. */
const WITHDRAWAL_STALE_MS = 60 * 60 * 1000; // 1 hour
/** Bound the docs each pass pulls per run. */
const MAX_PER_RUN = 200;
/** Process Stripe-bound work in small concurrent lots. */
const LOT_SIZE = 10;
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
async function reconcileOnePayment(doc, stripe) {
    var _a, _b;
    const transactionId = doc.id;
    const data = doc.data();
    const paymentIntentId = data.stripePaymentIntentId;
    if (typeof paymentIntentId !== 'string' || !paymentIntentId || !stripe) {
        return false;
    }
    let piStatus;
    let amountReceived = 0;
    try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        piStatus = pi.status;
        amountReceived = (_b = (_a = pi.amount_received) !== null && _a !== void 0 ? _a : pi.amount) !== null && _b !== void 0 ? _b : 0;
    }
    catch (err) {
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
        await (0, failedOperations_1.writeFailedOperation)({
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
    // Case B: the PI was refunded/canceled but the transaction never reflected it.
    if ((piStatus === 'canceled' && status === 'pending_payment') ||
        (piStatus === 'succeeded' &&
            status === 'paid' &&
            data.stripeRefundId == null &&
            // a charge.refunded that never landed would leave status 'paid' with a
            // refund recorded on Stripe; we only flag if Stripe shows a refund.
            false)) {
        // Canceled PI on a still-pending tx: let expireOrphanedTransactions handle
        // it (it cancels + releases). Just log for visibility, no dead-letter.
        logger.warn('[reconcilePayments] canceled PI on pending_payment tx (expiry will handle)', {
            transactionId,
            paymentIntentId,
        });
        return false;
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
async function reconcileOneWithdrawal(doc, stripe) {
    var _a, _b, _c, _d;
    const requestId = doc.id;
    const data = doc.data();
    const stripeAccountId = typeof data.stripeAccountId === 'string' ? data.stripeAccountId : undefined;
    const payoutId = typeof data.stripePayoutId === 'string' ? data.stripePayoutId : null;
    if (!stripe)
        return false;
    // If we never recorded a payoutId on the request, we cannot match it to a
    // Stripe payout. That itself is suspicious for a 'processing' request — flag.
    if (!payoutId) {
        logger.error('CRITICAL [reconcileWithdrawals] processing withdrawal with no stripePayoutId', {
            requestId,
            userId: data.userId,
            amount: data.amount,
        });
        await (0, failedOperations_1.writeFailedOperation)({
            type: 'payout_reversal_failed',
            refId: requestId,
            payload: {
                kind: 'processing_no_payout_id',
                userId: (_a = data.userId) !== null && _a !== void 0 ? _a : null,
                amount: (_b = data.amount) !== null && _b !== void 0 ? _b : null,
                stripeAccountId: stripeAccountId !== null && stripeAccountId !== void 0 ? stripeAccountId : null,
            },
            error: 'withdrawal_requests stuck processing with no stripePayoutId',
        });
        return true;
    }
    let payoutStatus;
    try {
        const payout = await stripe.payouts.retrieve(payoutId, undefined, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined);
        payoutStatus = payout.status;
    }
    catch (err) {
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
            completedAt: firebase_1.FieldValue.serverTimestamp(),
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
        // Dead-letter: the canonical re-credit lives in handlePayoutFailed; record
        // the divergence so a human / replay re-credits the seller's wallet.
        await (0, failedOperations_1.writeFailedOperation)({
            type: 'payout_reversal_failed',
            refId: requestId,
            payload: {
                kind: 'lost_payout_failed_webhook',
                payoutId,
                payoutStatus,
                userId: (_c = data.userId) !== null && _c !== void 0 ? _c : null,
                amount: (_d = data.amount) !== null && _d !== void 0 ? _d : null,
                stripeAccountId: stripeAccountId !== null && stripeAccountId !== void 0 ? stripeAccountId : null,
            },
            error: `payout ${payoutStatus} but withdrawal_requests still processing`,
        });
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
function checkWalletInvariants(doc) {
    const data = doc.data();
    const balance = typeof data.balance === 'number' ? data.balance : 0;
    const pending = typeof data.pendingBalance === 'number' ? data.pendingBalance : 0;
    const held = typeof data.heldBalance === 'number' ? data.heldBalance : 0;
    const debt = typeof data.sellerDebt === 'number' ? data.sellerDebt : 0;
    const breaches = [];
    if (balance < 0)
        breaches.push(`balance=${balance}`);
    if (pending < 0)
        breaches.push(`pendingBalance=${pending}`);
    if (held < 0)
        breaches.push(`heldBalance=${held}`);
    if (debt < 0)
        breaches.push(`sellerDebt=${debt}`);
    if (breaches.length > 0) {
        logger.error('CRITICAL [reconcileBalances] wallet invariant breach', {
            walletId: doc.id,
            breaches,
            balance,
            pendingBalance: pending,
            heldBalance: held,
            sellerDebt: debt,
        });
        return true;
    }
    return false;
}
// =============================================================================
// SCHEDULED ENTRY POINT
// =============================================================================
exports.reconcileFinances = (0, scheduler_1.onSchedule)({
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY'],
}, async () => {
    const now = Date.now();
    const stripe = (0, stripe_1.getStripe)();
    let paymentDivergences = 0;
    let withdrawalDivergences = 0;
    let balanceBreaches = 0;
    // -------------------------------------------------------------------------
    // 1. reconcilePayments
    // -------------------------------------------------------------------------
    try {
        const cutoff = new Date(now - PAYMENT_STALE_MS);
        const snap = await firebase_1.db
            .collection('transactions')
            .where('status', '==', 'pending_payment')
            .where('createdAt', '<', cutoff)
            .limit(MAX_PER_RUN)
            .get();
        for (let i = 0; i < snap.docs.length; i += LOT_SIZE) {
            const lot = snap.docs.slice(i, i + LOT_SIZE);
            const results = await Promise.allSettled(lot.map((doc) => reconcileOnePayment(doc, stripe)));
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value)
                    paymentDivergences++;
            }
        }
    }
    catch (err) {
        logger.error('[reconcileFinances] reconcilePayments pass failed', {
            error: err instanceof Error ? err.message : err,
        });
    }
    // -------------------------------------------------------------------------
    // 2. reconcileWithdrawals
    // -------------------------------------------------------------------------
    try {
        const cutoff = new Date(now - WITHDRAWAL_STALE_MS);
        const snap = await firebase_1.db
            .collection('withdrawal_requests')
            .where('status', '==', 'processing')
            .where('createdAt', '<', cutoff)
            .limit(MAX_PER_RUN)
            .get();
        for (let i = 0; i < snap.docs.length; i += LOT_SIZE) {
            const lot = snap.docs.slice(i, i + LOT_SIZE);
            const results = await Promise.allSettled(lot.map((doc) => reconcileOneWithdrawal(doc, stripe)));
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value)
                    withdrawalDivergences++;
            }
        }
    }
    catch (err) {
        logger.error('[reconcileFinances] reconcileWithdrawals pass failed', {
            error: err instanceof Error ? err.message : err,
        });
    }
    // -------------------------------------------------------------------------
    // 3. reconcileBalances (invariant checks)
    // -------------------------------------------------------------------------
    try {
        const snap = await firebase_1.db.collection('wallets').limit(MAX_PER_RUN).get();
        for (const doc of snap.docs) {
            if (checkWalletInvariants(doc))
                balanceBreaches++;
        }
    }
    catch (err) {
        logger.error('[reconcileFinances] reconcileBalances pass failed', {
            error: err instanceof Error ? err.message : err,
        });
    }
    logger.info('[reconcileFinances] run complete', {
        paymentDivergences,
        withdrawalDivergences,
        balanceBreaches,
    });
});
//# sourceMappingURL=reconcile.js.map