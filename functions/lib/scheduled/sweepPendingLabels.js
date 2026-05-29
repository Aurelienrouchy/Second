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
const shipEngine_1 = require("../config/shipEngine");
const payments_1 = require("../callable/payments");
const labelFulfillment_1 = require("../utils/labelFulfillment");
const refund_1 = require("../utils/refund");
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
 * debit the seller IF they were credited, mark the transaction refunded, notify
 * the buyer.
 *
 * REUSES the shared issueTransactionRefund core (single source of truth for the
 * reverse_transfer / sellerDebt reconciliation + dead-lettering on Stripe
 * failure with the deterministic key). The article IS re-listed (the parcel was
 * never shipped, the item still exists). After the core succeeds we additionally
 * clear the label-pending bookkeeping (cancelReason / labelCreationPending) that
 * is specific to this flow and not owned by the generic refund core.
 */
async function refundPendingLabelTransaction(txRef, txData, transactionId) {
    // Pre-check the precondition before touching Stripe: only a still-paid,
    // still-pending-label transaction should be given up. A concurrent run may
    // have advanced it (label created -> label_created/shipped) in the meantime.
    const preSnap = await txRef.get();
    const preData = preSnap.exists ? preSnap.data() : null;
    if (!preData || preData.status !== 'paid' || preData.labelCreationPending !== true) {
        logger.info('[sweepPendingLabels] label give-up skipped — tx no longer paid+pending', {
            transactionId,
            status: preData === null || preData === void 0 ? void 0 : preData.status,
        });
        return;
    }
    try {
        // Shared core: idempotent Stripe refund (reverse_transfer for destination
        // charges) keyed rf_label_${txId}, then atomic wallet reconciliation
        // (re-credit buyer wallet portion, debit seller exactly sellerCreditedCents
        // — normally 0 for a never-credited pending-label tx — shortfall -> debt),
        // re-list the article, set status -> 'refunded'. On Stripe failure the core
        // dead-letters (type stripe_refund_failed) and throws.
        await (0, refund_1.issueTransactionRefund)(transactionId, preData, {
            reason: 'label_creation_failed',
            idempotencyKey: `rf_label_${transactionId}`,
            // Parcel never shipped — the item still exists, so re-list it (default).
            relistArticle: true,
            source: 'sweepPendingLabels_giveup',
        });
    }
    catch (refundErr) {
        // The core already dead-lettered the Stripe failure with the same
        // deterministic key; leave the tx 'paid' + labelCreationPending so a later
        // run / retryFailedOperations re-drives the refund idempotently rather than
        // cancelling without refunding the buyer. Just log domain context.
        logger.error('CRITICAL [sweepPendingLabels] Stripe refund failed (label give-up)', {
            transactionId,
            paymentIntentId: preData.stripePaymentIntentId,
            error: refundErr instanceof Error ? refundErr.message : refundErr,
        });
        return;
    }
    // Stamp the label-pending bookkeeping the generic core does not own. Best-effort
    // merge — the core already set status='refunded' atomically; this only clears
    // the pending flag and records the give-up reason for the audit trail.
    await txRef
        .update({
        cancelReason: 'label_creation_failed',
        labelCreationPending: false,
    })
        .catch((err) => logger.warn('[sweepPendingLabels] failed to clear labelCreationPending after refund', {
        transactionId,
        error: err instanceof Error ? err.message : err,
    }));
    logger.warn('[sweepPendingLabels] transaction refunded after max label attempts', {
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