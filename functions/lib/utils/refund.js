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
exports.issueTransactionRefund = issueTransactionRefund;
/**
 * Shared transaction-refund core.
 *
 * Single source of truth for the money-movement of a refund, extracted from
 * the original inline logic of `adminRefundTransaction` so that BOTH the
 * admin refund and the buyer-facing auto-refunds (requestRefund, return-leg
 * refund) reuse the EXACT same reverse_transfer / sellerDebt reconciliation.
 *
 * Two stages, in this order (Stripe MUST run outside the Firestore tx):
 *   1. Stripe refund of the card portion OUTSIDE the runTransaction, with a
 *      deterministic idempotency key so re-invocations never double-refund.
 *      For destination charges we pass reverse_transfer + refund_application_fee
 *      to claw the money back from the connected account; for direct platform
 *      (mixed wallet+card) charges those are omitted.
 *   2. Atomic Firestore reconciliation: re-credit any wallet portion to the
 *      buyer, debit the seller EXACTLY what was credited
 *      (pendingBalance -> heldBalance -> balance, shortfall -> sellerDebt),
 *      optionally re-list the article, mark the transaction 'refunded'.
 *
 * IMPORTANT: callers own the AUTHORIZATION and STATUS-PRECONDITION checks
 * (admin guard / buyer ownership / allowed statuses). This helper only owns
 * idempotence + money movement, and is safe to call repeatedly.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const failedOperations_1 = require("./failedOperations");
/**
 * Execute a full refund for a transaction. Idempotent: a no-op (returning
 * `{ success: true, alreadyRefunded: true }`) if the transaction is already
 * `refunded`. The caller must have validated authorization and the status
 * precondition BEFORE calling this.
 *
 * @param transactionId the transaction doc id
 * @param preData       the already-read transaction data (used for the Stripe
 *                      call; the Firestore stage re-reads under the lock)
 * @param opts          refund options (idempotencyKey is required)
 */
async function issueTransactionRefund(transactionId, preData, opts) {
    var _a;
    const source = (_a = opts.source) !== null && _a !== void 0 ? _a : 'issueTransactionRefund';
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    const stripe = (0, stripe_1.getStripe)();
    // Idempotence: already refunded — nothing to do.
    if (preData.status === 'refunded') {
        return { success: true, alreadyRefunded: true };
    }
    const paidVia = preData.paidVia;
    const isMixedCharge = paidVia === 'wallet_and_card' || paidVia === 'mixed';
    const extraSellerDebitCents = typeof opts.extraSellerDebitCents === 'number' && opts.extraSellerDebitCents > 0
        ? Math.round(opts.extraSellerDebitCents)
        : 0;
    const relistArticle = opts.relistArticle !== false; // default true
    // Card portion actually charged (cents): for a mixed wallet+card charge the
    // card covers `total - walletAmountUsed`; for a pure-card charge it covers the
    // full total. Used only to cap the partial card refund (return-leg, B2).
    const totalAmountCents = Math.round((preData.totalAmount || 0) * 100);
    const walletAmountUsedCents = typeof preData.walletAmountUsed === 'number' ? preData.walletAmountUsed : 0;
    const cardPortionCents = isMixedCharge
        ? Math.max(0, totalAmountCents - walletAmountUsedCents)
        : totalAmountCents;
    // Partial card refund (return-leg): refund exactly cardRefundAmountCents,
    // capped to the card portion charged. When omitted -> full card refund.
    const partialCardRefund = typeof opts.cardRefundAmountCents === 'number' && opts.cardRefundAmountCents >= 0;
    const cardRefundCents = partialCardRefund
        ? Math.min(Math.round(opts.cardRefundAmountCents), cardPortionCents)
        : null;
    // --- Stripe refund (card portion) OUTSIDE the Firestore transaction ---
    // Skip the Stripe call entirely when a partial refund resolves to 0 card cents
    // (e.g. label cost >= card portion) — there is nothing to refund on the card.
    if (preData.stripePaymentIntentId && stripe && cardRefundCents !== 0) {
        try {
            await stripe.refunds.create(Object.assign(Object.assign({ payment_intent: preData.stripePaymentIntentId }, (cardRefundCents !== null ? { amount: cardRefundCents } : {})), (isMixedCharge
                ? {}
                : { reverse_transfer: true, refund_application_fee: true })), { idempotencyKey: opts.idempotencyKey });
            logger.info('[issueTransactionRefund] Stripe refund created', {
                transactionId,
                source,
                paymentIntentId: preData.stripePaymentIntentId,
                reverseTransfer: !isMixedCharge,
                amountCents: cardRefundCents,
            });
        }
        catch (refundErr) {
            logger.error('CRITICAL [issueTransactionRefund] Stripe refund failed', {
                transactionId,
                source,
                paymentIntentId: preData.stripePaymentIntentId,
                error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
            // Dead-letter via the canonical helper so retryFailedOperations re-drives
            // it with the SAME deterministic idempotency key (replay = no-op if the
            // refund actually went through). Never throws.
            await (0, failedOperations_1.writeFailedOperation)({
                type: 'stripe_refund_failed',
                refId: transactionId,
                payload: {
                    transactionId,
                    paymentIntentId: preData.stripePaymentIntentId,
                    idempotencyKey: opts.idempotencyKey,
                    isMixedCharge,
                    source,
                },
                error: refundErr,
            });
            throw new Error('Stripe refund failed — operation recorded for retry, transaction not modified');
        }
    }
    // --- Atomic Firestore reconciliation ---
    await firebase_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists)
            throw new Error('Transaction not found');
        const data = snap.data();
        // Idempotence inside the transaction.
        if (data.status === 'refunded')
            return;
        const buyerId = data.buyerId;
        const sellerId = data.sellerId;
        const walletAmountUsed = data.walletAmountUsed || 0; // cents
        const hasWalletPortion = walletAmountUsed > 0 &&
            (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');
        // Debit the EXACT amount credited to the seller (0 if never credited),
        // plus any extra (e.g. return label cost ruled against the seller).
        const baseSellerDebit = typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
        const sellerDebitTarget = baseSellerDebit + extraSellerDebitCents;
        // Reads first.
        const buyerWalletRef = hasWalletPortion && buyerId ? firebase_1.db.collection('wallets').doc(buyerId) : null;
        const buyerWalletSnap = buyerWalletRef ? await tx.get(buyerWalletRef) : null;
        const sellerWalletRef = sellerDebitTarget > 0 && sellerId ? firebase_1.db.collection('wallets').doc(sellerId) : null;
        const sellerWalletSnap = sellerWalletRef ? await tx.get(sellerWalletRef) : null;
        const articleRef = data.articleId
            ? firebase_1.db.collection('articles').doc(data.articleId)
            : null;
        const articleSnap = articleRef ? await tx.get(articleRef) : null;
        // Writes.
        tx.update(txRef, {
            status: 'refunded',
            refundedAt: firebase_1.FieldValue.serverTimestamp(),
            refundedVia: preData.stripePaymentIntentId ? 'stripe' : 'wallet',
            refundReason: typeof opts.reason === 'string' ? opts.reason.substring(0, 300) : 'refund',
            disputed: false,
        });
        if (relistArticle && articleRef && articleSnap && articleSnap.exists) {
            tx.update(articleRef, { isSold: false });
        }
        // Re-credit buyer wallet portion (card portion goes back via Stripe).
        if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
            let refundCents = paidVia === 'wallet'
                ? Math.round((data.totalAmount || 0) * 100)
                : walletAmountUsed;
            // Return-leg override: the buyer bears part of the cost, so we re-credit
            // a smaller wallet amount. Never exceed what was actually paid via wallet.
            if (typeof opts.buyerWalletRefundOverrideCents === 'number' &&
                opts.buyerWalletRefundOverrideCents >= 0) {
                refundCents = Math.min(refundCents, Math.round(opts.buyerWalletRefundOverrideCents));
            }
            if (refundCents > 0) {
                const wd = buyerWalletSnap.data();
                tx.update(buyerWalletRef, {
                    balance: firebase_1.FieldValue.increment(refundCents),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
                tx.set(buyerLedgerRef, {
                    type: 'refund_credit',
                    amount: refundCents,
                    balanceAfter: (wd.balance || 0) + refundCents,
                    description: 'Remboursement — retour au porte-monnaie',
                    transactionId,
                    createdAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
        }
        // Debit seller across the three buckets in escrow order; shortfall = debt.
        if (sellerDebitTarget > 0 && sellerWalletRef) {
            if (sellerWalletSnap && sellerWalletSnap.exists) {
                const swd = sellerWalletSnap.data();
                const pendingNow = swd.pendingBalance || 0;
                const heldNow = swd.heldBalance || 0;
                const balanceNow = swd.balance || 0;
                const fromPending = Math.min(sellerDebitTarget, pendingNow);
                let remaining = sellerDebitTarget - fromPending;
                const fromHeld = Math.min(remaining, heldNow);
                remaining -= fromHeld;
                const fromBalance = Math.min(remaining, balanceNow);
                const shortfall = remaining - fromBalance;
                const walletUpdate = {
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                };
                if (fromPending > 0)
                    walletUpdate.pendingBalance = firebase_1.FieldValue.increment(-fromPending);
                if (fromHeld > 0)
                    walletUpdate.heldBalance = firebase_1.FieldValue.increment(-fromHeld);
                if (fromBalance > 0)
                    walletUpdate.balance = firebase_1.FieldValue.increment(-fromBalance);
                if (shortfall > 0)
                    walletUpdate.sellerDebt = firebase_1.FieldValue.increment(shortfall);
                tx.update(sellerWalletRef, walletUpdate);
                const debited = fromPending + fromHeld + fromBalance;
                const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
                tx.set(sellerLedgerRef, Object.assign({ type: 'refund_debit', amount: debited, balanceAfter: balanceNow - fromBalance, description: shortfall > 0
                        ? 'Remboursement — débit vendeur (dette enregistrée)'
                        : 'Remboursement — débit vendeur', transactionId, createdAt: firebase_1.FieldValue.serverTimestamp() }, (shortfall > 0 && { debtRecorded: shortfall })));
            }
            else {
                // No wallet at all: record full target as debt.
                tx.set(sellerWalletRef, {
                    sellerDebt: firebase_1.FieldValue.increment(sellerDebitTarget),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }
    });
    return { success: true };
}
//# sourceMappingURL=refund.js.map