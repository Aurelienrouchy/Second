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
exports.sweepPendingLabels = void 0;
/**
 * Scheduled sweep of pending shipping labels (P1: atomicity payment<->label)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * PROBLEM SOLVED
 * --------------
 * When a purchase is paid but the ShipEngine label could not be created
 * (ShipEngine down, transient 5xx, expired/fallback rateId), the payment flow
 * sets `labelCreationPending = true`, leaves the transaction in `status: 'paid'`,
 * and — under the deferred-credit model — does NOT credit the seller. Without a
 * sweep these orders are frozen forever: buyer charged, no label, no shipment.
 *
 * WHAT THIS JOB DOES (every hour)
 * -------------------------------
 * For each transaction with `labelCreationPending === true` and `status: 'paid'`:
 *   1. Re-rate a FRESH ShipEngine rate (origin = seller address, destination =
 *      buyer shippingAddress, parcel = article metadata) — never reuse the old
 *      possibly-stale/fallback rateId.
 *   2. Retry `createLabel` on the fresh rate. On success: ATOMICALLY credit the
 *      seller (pendingBalance), reconcile the real label cost, persist label
 *      fields, clear the flag and mark `shipped`.
 *   3. Increment `labelAttempts`. After N = MAX_ATTEMPTS failures: REFUND the
 *      buyer (idempotent reverse_transfer for card charges; wallet re-credit for
 *      wallet portions), debit the seller pendingBalance IF they were credited
 *      (they normally weren't — deferred), release the article (isSold = false),
 *      cancel the transaction and notify the buyer. A definitive failure writes
 *      a `failed_operations` dead-letter doc (collection owned by the dead-letter
 *      chantier).
 *
 * All wallet/ledger amounts are CENTS. transaction cost fields are DOLLARS.
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const shipEngine_1 = require("../config/shipEngine");
const payments_1 = require("../callable/payments");
const labelFulfillment_1 = require("../utils/labelFulfillment");
const notifications_1 = require("../utils/notifications");
/** Process at most this many transactions per run to bound execution time. */
const MAX_TRANSACTIONS_PER_RUN = 50;
/** Number of label-creation attempts before giving up and refunding the buyer. */
const MAX_ATTEMPTS = 4;
/**
 * Re-rate a fresh ShipEngine rate for a pending-label transaction.
 * Returns the chosen rate (cheapest home-delivery rate) or null if no rate /
 * no usable origin/destination/parcel could be resolved.
 */
async function refreshRateForTransaction(txData, transactionId) {
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        logger.warn('[sweepPendingLabels] ShipEngine not configured — cannot re-rate', {
            transactionId,
        });
        return null;
    }
    const articleId = txData.articleId;
    if (!articleId) {
        logger.warn('[sweepPendingLabels] missing articleId — cannot re-rate', { transactionId });
        return null;
    }
    const articleSnap = await firebase_1.db.collection('articles').doc(articleId).get();
    if (!articleSnap.exists) {
        logger.warn('[sweepPendingLabels] article not found — cannot re-rate', {
            transactionId,
            articleId,
        });
        return null;
    }
    const articleData = articleSnap.data();
    const sellerSnap = await firebase_1.db.collection('users').doc(txData.sellerId).get();
    if (!sellerSnap.exists) {
        logger.warn('[sweepPendingLabels] seller not found — cannot re-rate', {
            transactionId,
            sellerId: txData.sellerId,
        });
        return null;
    }
    const sellerData = sellerSnap.data();
    const origin = (0, payments_1.resolveSellerOriginAddress)(sellerData, articleData);
    if (!origin) {
        logger.warn('[sweepPendingLabels] no usable seller origin address — cannot re-rate', {
            transactionId,
        });
        return null;
    }
    const shippingAddress = txData.shippingAddress || {};
    const destPostal = (shippingAddress.postalCode || '').toString().trim();
    if (destPostal.length === 0) {
        logger.warn('[sweepPendingLabels] missing buyer postal code — cannot re-rate', {
            transactionId,
        });
        return null;
    }
    const destination = {
        name: shippingAddress.name || 'Acheteur',
        addressLine1: shippingAddress.street || origin.addressLine1,
        cityLocality: shippingAddress.city || origin.cityLocality,
        stateProvince: shippingAddress.province || origin.stateProvince,
        postalCode: destPostal,
        countryCode: 'CA',
        phone: shippingAddress.phone || origin.phone,
    };
    const parcelWeight = parseFloat(articleData.weight) || 0.5;
    const dims = articleData.dimensions || {};
    const parcel = {
        weight: { value: parcelWeight, unit: 'kilogram' },
        dimensions: {
            length: parseFloat(dims.length) || 30,
            width: parseFloat(dims.width) || 25,
            height: parseFloat(dims.height) || 10,
            unit: 'centimeter',
        },
    };
    let rates;
    try {
        rates = await shipEngine.getRates(origin, destination, parcel);
    }
    catch (err) {
        logger.error('[sweepPendingLabels] getRates failed', {
            transactionId,
            error: err instanceof Error ? err.message : err,
        });
        return null;
    }
    if (!rates || rates.length === 0) {
        logger.warn('[sweepPendingLabels] no rates returned — cannot re-rate', { transactionId });
        return null;
    }
    // Cheapest home-delivery rate (server-authoritative selection).
    const sorted = [...rates].sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount);
    return sorted[0];
}
/**
 * Definitive failure path: refund the buyer (idempotent), release the article,
 * debit the seller IF they were credited, cancel the transaction, notify the
 * buyer. Writes a `failed_operations` doc if the Stripe refund itself fails.
 */
async function refundPendingLabelTransaction(txRef, txData, transactionId) {
    const stripe = (0, stripe_1.getStripe)();
    const paidVia = txData.paidVia;
    const walletAmountUsed = txData.walletAmountUsed || 0; // cents
    const hasWalletPortion = walletAmountUsed > 0 &&
        (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');
    // --- Stripe refund (card portion) — OUTSIDE the Firestore transaction ---
    let stripeRefundFailed = false;
    if (txData.stripePaymentIntentId && stripe) {
        try {
            // Mixed wallet+card charges are direct platform charges (no transfer_data),
            // so reverse_transfer/refund_application_fee must be omitted there.
            const isMixedCharge = paidVia === 'wallet_and_card' || paidVia === 'mixed';
            await stripe.refunds.create(Object.assign({ payment_intent: txData.stripePaymentIntentId }, (isMixedCharge
                ? {}
                : { reverse_transfer: true, refund_application_fee: true })), 
            // Deterministic key tied to the transaction so re-runs never double-refund.
            { idempotencyKey: `rf_label_${transactionId}` });
            logger.info('[sweepPendingLabels] Stripe refund created (label give-up)', {
                transactionId,
                paymentIntentId: txData.stripePaymentIntentId,
                reverseTransfer: !isMixedCharge,
            });
        }
        catch (refundErr) {
            stripeRefundFailed = true;
            logger.error('CRITICAL [sweepPendingLabels] Stripe refund failed (label give-up)', {
                transactionId,
                paymentIntentId: txData.stripePaymentIntentId,
                error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
            // Dead-letter for the retry chantier. Best-effort; never throws.
            await firebase_1.db
                .collection('failed_operations')
                .add({
                type: 'label_refund_failed',
                transactionId,
                paymentIntentId: txData.stripePaymentIntentId,
                reason: refundErr instanceof Error ? refundErr.message : 'stripe_refund_error',
                createdAt: firebase_1.FieldValue.serverTimestamp(),
                status: 'pending',
            })
                .catch((dlErr) => {
                logger.error('[sweepPendingLabels] failed to write failed_operations doc', {
                    transactionId,
                    error: dlErr instanceof Error ? dlErr.message : dlErr,
                });
            });
            // Do NOT proceed to cancel/release if the card refund failed: leaving the
            // transaction 'paid' + labelCreationPending lets a later run retry the
            // refund idempotently rather than cancelling without refunding the buyer.
            return;
        }
    }
    // --- Atomic Firestore reconciliation: cancel + release + wallet movements ---
    await firebase_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        const data = snap.data();
        if (!data)
            return;
        // Idempotence: only act on a still-pending paid transaction.
        if (data.status !== 'paid' || data.labelCreationPending !== true) {
            return;
        }
        // Reads first.
        let buyerWalletSnap = null;
        const buyerWalletRef = hasWalletPortion && data.buyerId
            ? firebase_1.db.collection('wallets').doc(data.buyerId)
            : null;
        if (buyerWalletRef) {
            buyerWalletSnap = await tx.get(buyerWalletRef);
        }
        // Seller debit only if they were actually credited (deferred model => normally
        // NOT credited for a pending-label tx, so sellerCreditedCents is absent).
        const sellerDebitTarget = typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
        let sellerWalletSnap = null;
        const sellerWalletRef = sellerDebitTarget > 0 && data.sellerId
            ? firebase_1.db.collection('wallets').doc(data.sellerId)
            : null;
        if (sellerWalletRef) {
            sellerWalletSnap = await tx.get(sellerWalletRef);
        }
        let articleSnap = null;
        const articleRef = data.articleId
            ? firebase_1.db.collection('articles').doc(data.articleId)
            : null;
        if (articleRef) {
            articleSnap = await tx.get(articleRef);
        }
        // Writes.
        tx.update(txRef, {
            status: 'cancelled',
            cancelledAt: firebase_1.FieldValue.serverTimestamp(),
            cancelReason: 'label_creation_failed',
            labelCreationPending: false,
            refundedAt: firebase_1.FieldValue.serverTimestamp(),
        });
        if (articleRef && articleSnap && articleSnap.exists) {
            tx.update(articleRef, { isSold: false });
        }
        // Re-credit buyer wallet portion (card portion goes back via Stripe refund).
        if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
            const refundCents = paidVia === 'wallet'
                ? Math.round((data.totalAmount || 0) * 100)
                : walletAmountUsed;
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
                    description: 'Remboursement — etiquette d\'expedition introuvable',
                    transactionId,
                    createdAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
        }
        // Debit seller pendingBalance/heldBalance/balance only if they were credited.
        if (sellerDebitTarget > 0 && sellerWalletRef && sellerWalletSnap && sellerWalletSnap.exists) {
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
                    ? 'Annulation etiquette — debit vendeur (dette enregistree pour le solde manquant)'
                    : 'Annulation etiquette — debit vendeur', transactionId, createdAt: firebase_1.FieldValue.serverTimestamp() }, (shortfall > 0 && { debtRecorded: shortfall })));
        }
    });
    if (stripeRefundFailed)
        return; // unreachable (early return above) — defensive
    logger.warn('[sweepPendingLabels] transaction refunded + cancelled after max label attempts', {
        transactionId,
    });
    // Notify buyer (best-effort).
    if (txData.buyerId) {
        const articleTitle = txData.articleTitle || 'votre article';
        (0, notifications_1.sendPushNotification)(txData.buyerId, 'Commande annulee et remboursee', `Nous n'avons pas pu generer l'etiquette d'expedition pour ${articleTitle}. Votre commande a ete annulee et remboursee.`, { transactionId, articleId: txData.articleId || '' }, 'order_cancelled').catch((err) => {
            logger.warn('[sweepPendingLabels] failed to notify buyer of label give-up', {
                transactionId,
                error: err instanceof Error ? err.message : err,
            });
        });
    }
}
exports.sweepPendingLabels = (0, scheduler_1.onSchedule)({
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'],
}, async () => {
    var _a;
    let shipped = 0;
    let refunded = 0;
    let retried = 0;
    let errors = 0;
    // Composite index required: (labelCreationPending ASC, status ASC, createdAt ASC).
    const snap = await firebase_1.db
        .collection('transactions')
        .where('labelCreationPending', '==', true)
        .where('status', '==', 'paid')
        .orderBy('createdAt', 'asc')
        .limit(MAX_TRANSACTIONS_PER_RUN)
        .get();
    if (snap.empty) {
        logger.info('[sweepPendingLabels] no pending-label transactions');
        return;
    }
    for (const doc of snap.docs) {
        const txData = doc.data();
        const transactionId = doc.id;
        const txRef = doc.ref;
        try {
            // Re-rate fresh.
            const rate = await refreshRateForTransaction(txData, transactionId);
            if (rate) {
                const shipEngine = (0, shipEngine_1.getShipEngine)();
                if (!shipEngine) {
                    errors++;
                    continue;
                }
                try {
                    const label = await shipEngine.createLabel(rate.rateId);
                    // ATOMIC: credit seller, reconcile cost, persist label, mark shipped.
                    const ok = await firebase_1.db.runTransaction(async (tx) => {
                        const fresh = await tx.get(txRef);
                        const fdata = fresh.data();
                        if (!fdata)
                            return false;
                        if (fdata.status !== 'paid' || fdata.labelCreationPending !== true) {
                            return false; // already resolved by another run
                        }
                        await (0, labelFulfillment_1.creditSellerForSale)(tx, txRef, fdata, transactionId);
                        const update = {
                            trackingNumber: label.trackingNumber,
                            shippingLabelUrl: label.labelDownload.href,
                            trackingUrl: label.trackingUrl,
                            carrierCode: label.carrierCode,
                            trackingStatus: 'LABEL_CREATED',
                            shipEngineLabelId: label.labelId,
                            shipEngineRateId: rate.rateId,
                            // 'label_created', NOT 'shipped' — the first real carrier scan
                            // advances it (poller / ShipEngine webhook).
                            status: 'label_created',
                            labelCreatedAt: firebase_1.FieldValue.serverTimestamp(),
                            labelCreationPending: false,
                            labelCreationNote: firebase_1.FieldValue.delete(),
                        };
                        (0, labelFulfillment_1.reconcileShippingCost)(label, typeof fdata.shippingCost === 'number' ? fdata.shippingCost : 0, transactionId, update);
                        tx.update(txRef, update);
                        return true;
                    });
                    if (ok) {
                        shipped++;
                        logger.info('[sweepPendingLabels] label created on retry — shipped', {
                            transactionId,
                            trackingNumber: label.trackingNumber,
                        });
                        // Notify buyer + system message (best-effort).
                        if (txData.chatId) {
                            let participants = [];
                            try {
                                const chatSnap = await firebase_1.db.collection('chats').doc(txData.chatId).get();
                                if (chatSnap.exists) {
                                    participants = ((_a = chatSnap.data()) === null || _a === void 0 ? void 0 : _a.participants) || [];
                                }
                            }
                            catch (_b) {
                                // ignore lookup failure
                            }
                            await firebase_1.db
                                .collection('messages')
                                .add({
                                chatId: txData.chatId,
                                senderId: 'system',
                                receiverId: 'system',
                                type: 'system',
                                content: `Etiquette d'expedition generee !\n\nNumero de suivi: ${label.trackingNumber}\n\nLe vendeur peut maintenant expedier l'article.`,
                                participants,
                                timestamp: firebase_1.FieldValue.serverTimestamp(),
                                status: 'sent',
                                isRead: true,
                                shippingLabel: {
                                    labelUrl: label.labelDownload.href,
                                    trackingNumber: label.trackingNumber,
                                    trackingUrl: label.trackingUrl,
                                },
                            })
                                .catch(() => undefined);
                        }
                    }
                    continue;
                }
                catch (labelErr) {
                    logger.error('[sweepPendingLabels] createLabel retry failed', {
                        transactionId,
                        error: labelErr instanceof Error ? labelErr.message : labelErr,
                    });
                    // fall through to attempt bookkeeping below
                }
            }
            // Either re-rate failed or createLabel retry failed: bump the attempt
            // counter atomically and refund if we've exhausted MAX_ATTEMPTS.
            const nextAttempts = (typeof txData.labelAttempts === 'number' ? txData.labelAttempts : 0) + 1;
            if (nextAttempts >= MAX_ATTEMPTS) {
                await refundPendingLabelTransaction(txRef, txData, transactionId);
                // refundPendingLabelTransaction may early-return on Stripe failure,
                // leaving the tx still pending; record the attempt regardless.
                await txRef
                    .update({
                    labelAttempts: nextAttempts,
                    lastLabelAttemptAt: firebase_1.FieldValue.serverTimestamp(),
                })
                    .catch(() => undefined);
                refunded++;
            }
            else {
                await txRef.update({
                    labelAttempts: nextAttempts,
                    lastLabelAttemptAt: firebase_1.FieldValue.serverTimestamp(),
                });
                retried++;
            }
        }
        catch (err) {
            errors++;
            logger.error('[sweepPendingLabels] error processing transaction', {
                transactionId,
                error: err instanceof Error ? err.message : err,
            });
        }
    }
    logger.info('[sweepPendingLabels] run complete', { shipped, refunded, retried, errors });
});
//# sourceMappingURL=sweepPendingLabels.js.map