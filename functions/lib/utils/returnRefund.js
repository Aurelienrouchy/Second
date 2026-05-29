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
exports.processReturnDelivered = processReturnDelivered;
/**
 * Return-leg refund handler (B2 anti-fraud guarantee).
 *
 * Single source of truth for the money-movement triggered when a RETURN parcel
 * (created by callable/recourse.ts:requestReturn) is confirmed DELIVERED back to
 * the SELLER by the carrier. This is the anti-fraud guarantee: a return is NEVER
 * refunded on the buyer's word — only once the carrier confirms the seller has
 * physically received the item back.
 *
 * Reuses the shared issueTransactionRefund core with:
 *   - cardRefundAmountCents       — partial card refund of `total - returnLabelCost`
 *   - buyerWalletRefundOverrideCents — wallet portion of the same reduced refund
 *   - relistArticle: false        — the seller has the item back; an admin/seller
 *                                   re-lists it manually (we do not auto-relist).
 * The buyer bears the return label cost (refund = total - returnLabelCost); the
 * seller is debited exactly their `sellerCreditedCents` (shortfall -> sellerDebt),
 * which the refund core handles.
 *
 * IDEMPOTENT: a no-op if the transaction is already `refunded`; the Stripe call
 * is keyed on a deterministic idempotency key so a replayed DELIVERED signal
 * never double-refunds. Safe to call from BOTH the poller and the webhook.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const refund_1 = require("./refund");
const notifications_1 = require("./notifications");
/**
 * Process the carrier-confirmed reception of a RETURN parcel.
 *
 * Refunds the buyer `total - returnLabelCost`, debits the seller their payout,
 * marks the transaction `refunded` and stamps `returnDeliveredAt`. Status-guarded
 * (only acts on `return_requested`) and idempotent.
 *
 * @param transactionId the transaction doc id
 * @param source        short tag for structured logs ('poller' | 'webhook')
 * @returns whether a refund was issued
 */
async function processReturnDelivered(transactionId, source) {
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
        return { refunded: false };
    }
    const preData = preSnap.data();
    // Idempotence: already refunded — nothing to do.
    if (preData.status === 'refunded') {
        return { refunded: false, alreadyRefunded: true };
    }
    // Status guard: only a transaction whose return is in progress can be refunded
    // by the return-leg signal. Any other status is a no-op (defends against a
    // stray DELIVERED scan matching the return tracking number after resolution).
    if (preData.status !== 'return_requested') {
        return { refunded: false };
    }
    // Compute the buyer refund: total paid MINUS the return label cost the buyer
    // bears. Clamp to >= 0 in case label cost somehow exceeds the total.
    const totalAmountCents = Math.round((preData.totalAmount || 0) * 100);
    const returnLabelCostCents = Math.round((preData.returnLabelCost || 0) * 100);
    const buyerRefundCents = Math.max(0, totalAmountCents - returnLabelCostCents);
    // Split the buyer refund across the card portion (Stripe partial refund) and
    // the wallet portion. Card portion charged = total - walletAmountUsed (mixed)
    // or full total (pure card). Refund card first, then the wallet remainder.
    const paidVia = preData.paidVia;
    const isMixedCharge = paidVia === 'wallet_and_card' || paidVia === 'mixed';
    const walletAmountUsedCents = typeof preData.walletAmountUsed === 'number' ? preData.walletAmountUsed : 0;
    const cardPortionCents = preData.stripePaymentIntentId
        ? isMixedCharge
            ? Math.max(0, totalAmountCents - walletAmountUsedCents)
            : totalAmountCents
        : 0;
    const cardRefundCents = Math.min(buyerRefundCents, cardPortionCents);
    const walletRefundCents = buyerRefundCents - cardRefundCents;
    let result;
    try {
        result = await (0, refund_1.issueTransactionRefund)(transactionId, preData, {
            reason: `buyer_return_refund_${preData.returnReason || 'return'}`,
            // Deterministic per logical refund so a replayed DELIVERED signal no-ops.
            idempotencyKey: `rf_return_${transactionId}`,
            // Seller has the item back; do NOT auto-relist (manual decision).
            relistArticle: false,
            // Buyer bears the return label cost: refund total - returnLabelCost.
            cardRefundAmountCents: cardRefundCents,
            buyerWalletRefundOverrideCents: walletRefundCents,
            source: `returnRefund_${source}`,
        });
    }
    catch (error) {
        // issueTransactionRefund dead-letters Stripe failures for retry and throws;
        // we surface the error so the caller logs domain context and (webhook) 500s
        // for a ShipEngine retry. The transaction is NOT mutated on failure.
        logger.error('[processReturnDelivered] return refund failed', {
            transactionId,
            source,
            error: error instanceof Error ? error.message : error,
        });
        throw error;
    }
    // Stamp the return-delivered marker (idempotent merge — issueTransactionRefund
    // already set status -> 'refunded' atomically; this only adds the timestamp).
    await txRef
        .update({ returnDeliveredAt: firebase_1.FieldValue.serverTimestamp() })
        .catch((err) => logger.warn('[processReturnDelivered] returnDeliveredAt stamp failed', {
        transactionId,
        error: err instanceof Error ? err.message : err,
    }));
    if (result.alreadyRefunded) {
        return { refunded: false, alreadyRefunded: true };
    }
    // Best-effort notifications to both parties.
    const articleTitle = preData.articleTitle || 'votre commande';
    const payload = { transactionId, articleId: preData.articleId || '' };
    if (preData.buyerId) {
        (0, notifications_1.sendPushNotification)(preData.buyerId, 'Retour reçu — remboursement effectué', `Le vendeur a reçu le retour de "${articleTitle}". Vous avez été remboursé (hors frais de retour).`, payload, 'order_refunded').catch((err) => logger.warn('[processReturnDelivered] buyer notification failed', {
            transactionId,
            error: err instanceof Error ? err.message : err,
        }));
    }
    if (preData.sellerId) {
        (0, notifications_1.sendPushNotification)(preData.sellerId, 'Retour reçu', `Vous avez reçu le retour de "${articleTitle}". L'acheteur a été remboursé.`, payload, 'order_refunded').catch((err) => logger.warn('[processReturnDelivered] seller notification failed', {
            transactionId,
            error: err instanceof Error ? err.message : err,
        }));
    }
    logger.warn('[processReturnDelivered] return-leg refund completed', {
        transactionId,
        source,
        buyerRefundCents,
        cardRefundCents,
        walletRefundCents,
        returnLabelCostCents,
    });
    return { refunded: true };
}
//# sourceMappingURL=returnRefund.js.map