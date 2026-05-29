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
exports.SHIPPING_COST_MISMATCH_THRESHOLD = void 0;
exports.creditSellerForSale = creditSellerForSale;
exports.reconcileShippingCost = reconcileShippingCost;
/**
 * Shared label-fulfillment helpers (P1: atomic payment<->label + reconciliation)
 *
 * Single source of truth for:
 *  - crediting the seller's wallet pendingBalance for a sale (escrow), used by
 *    BOTH the Stripe webhook and payWithWallet AND the sweepPendingLabels retry
 *    job, so the credit happens exactly once and only AFTER the shipping label
 *    is successfully created.
 *  - reconciling the real ShipEngine label cost (shipment_cost + insurance_cost)
 *    against the estimated shippingCost billed to the buyer, persisting the
 *    delta on the transaction and writing a platform ledger entry + a CRITICAL
 *    log on a large mismatch.
 *
 * All amounts in the wallet/ledger are CENTS. The transaction `shippingCost` /
 * `actualShippingCost` fields are in DOLLARS (consistent with createTransaction).
 */
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const wallet_1 = require("../callable/wallet");
/**
 * Threshold (in DOLLARS) above which a difference between the real label cost
 * and the estimated shippingCost billed to the buyer is treated as a critical
 * anomaly (logged at error level + recorded for accounting follow-up).
 */
exports.SHIPPING_COST_MISMATCH_THRESHOLD = 2;
/**
 * Credits the seller's wallet `pendingBalance` for a delivered-pending sale and
 * persists `sellerCreditedCents` on the transaction. MUST be called inside a
 * runTransaction. Idempotent: if `sellerCreditedCents` is already set on the
 * transaction, this is a no-op (the seller was already credited).
 *
 * The caller is responsible for the transaction status update (e.g. -> 'shipped')
 * and for having read the transaction snapshot used to produce `txData`.
 *
 * @returns true if the seller was credited by this call, false if skipped
 *          (already credited / invalid payout).
 */
async function creditSellerForSale(tx, transactionRef, txData, transactionId) {
    var _a;
    // Idempotence: never credit twice for the same sale.
    if (typeof txData.sellerCreditedCents === 'number') {
        return false;
    }
    const sellerId = txData.sellerId;
    const sellerPayout = (_a = txData.sellerPayout) !== null && _a !== void 0 ? _a : txData.amount;
    const sellerPayoutCents = typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;
    if (!sellerId || sellerPayoutCents <= 0) {
        logger.warn('[creditSellerForSale] missing sellerId/payout — not crediting', {
            transactionId,
            sellerId,
            sellerPayoutCents,
        });
        return false;
    }
    const { walletRef: sellerWalletRef, walletData: sellerWalletData, isNew: sellerWalletIsNew, } = await (0, wallet_1.getOrCreateSellerWallet)(tx, sellerId);
    if (!sellerWalletIsNew) {
        tx.update(sellerWalletRef, {
            pendingBalance: firebase_1.FieldValue.increment(sellerPayoutCents),
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
    }
    else {
        tx.update(sellerWalletRef, {
            pendingBalance: sellerPayoutCents,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
    }
    const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
    tx.set(sellerLedgerRef, {
        type: 'sale_credit',
        amount: sellerPayoutCents,
        balanceAfter: (sellerWalletData.pendingBalance || 0) + sellerPayoutCents,
        description: 'Vente — fonds en attente de livraison',
        transactionId,
        createdAt: firebase_1.FieldValue.serverTimestamp(),
        status: 'pending',
    });
    // Persist the EXACT amount credited so a later refund/dispute debits precisely
    // this figure (and records any shortfall as sellerDebt rather than masking it).
    tx.update(transactionRef, {
        sellerCreditedCents: sellerPayoutCents,
    });
    return true;
}
/**
 * Reconciles the real label cost against the estimated shippingCost billed to
 * the buyer. Persists `actualShippingCost` (dollars), `shippingCostDelta`
 * (actual - estimated, dollars) and `insuranceCost` on the transaction (these
 * fields are added to the `update` object so the CALLER commits them alongside
 * its other writes — this function does NOT call the network or Firestore for
 * the transaction itself).
 *
 * On a delta above SHIPPING_COST_MISMATCH_THRESHOLD it writes a
 * `platform_ledger` entry (best-effort, outside any transaction) and logs at
 * error level. Small deltas are absorbed by the buyer-protection fee.
 *
 * @param update mutable object the caller will pass to tx.update / .update()
 * @returns the computed delta in dollars (actual - estimated)
 */
function reconcileShippingCost(label, estimatedShippingCost, transactionId, update) {
    const actual = (label.shipmentCost || 0) + (label.insuranceCost || 0);
    const estimated = typeof estimatedShippingCost === 'number' ? estimatedShippingCost : 0;
    const delta = Math.round((actual - estimated) * 100) / 100;
    update.actualShippingCost = actual;
    update.shippingCostDelta = delta;
    update.insuranceCost = label.insuranceCost || 0;
    update.shippingReconciledAt = firebase_1.FieldValue.serverTimestamp();
    logger.info('[reconcileShippingCost] label cost reconciled', {
        transactionId,
        estimated,
        actual,
        delta,
    });
    if (Math.abs(delta) > exports.SHIPPING_COST_MISMATCH_THRESHOLD) {
        logger.error('CRITICAL shipping cost mismatch', {
            transactionId,
            estimated,
            actual,
            delta,
            threshold: exports.SHIPPING_COST_MISMATCH_THRESHOLD,
        });
        // Best-effort platform ledger entry for accounting follow-up. Fire-and-forget:
        // a failure here must never block label fulfillment.
        firebase_1.db.collection('platform_ledger')
            .add({
            type: 'shipping_cost_variance',
            transactionId,
            estimatedShippingCost: estimated,
            actualShippingCost: actual,
            delta,
            currency: 'cad',
            createdAt: firebase_1.FieldValue.serverTimestamp(),
        })
            .catch((err) => {
            logger.error('[reconcileShippingCost] failed to write platform_ledger entry', {
                transactionId,
                error: err instanceof Error ? err.message : err,
            });
        });
    }
    return delta;
}
//# sourceMappingURL=labelFulfillment.js.map