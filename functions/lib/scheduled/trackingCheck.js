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
exports.checkShippedTracking = void 0;
/**
 * Scheduled tracking check
 * Firebase Functions v7 - using onSchedule
 *
 * Polls ShipEngine for tracking updates on all shipped transactions.
 * Runs every 6 hours.
 *
 * For each transaction with status 'shipped' and a trackingNumber:
 * - Queries ShipEngine for the current tracking status
 * - If delivered: atomically marks the transaction as 'delivered',
 *   transfers seller funds from pending to available, and notifies buyer
 * - Otherwise: updates the trackingStatus field
 *
 * This replaces the previous manual-only tracking approach where buyers
 * had to call checkTrackingStatus to trigger delivery detection.
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const shipEngine_1 = require("../config/shipEngine");
const stripe_1 = require("../config/stripe");
const notifications_1 = require("../utils/notifications");
/** Process at most this many transactions per run to avoid timeouts */
const MAX_TRANSACTIONS_PER_RUN = 200;
exports.checkShippedTracking = (0, scheduler_1.onSchedule)({
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'],
}, async () => {
    var _a, _b;
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        logger.warn('[checkShippedTracking] ShipEngine not configured, skipping');
        return;
    }
    // Query all shipped transactions that have a tracking number
    const shippedSnap = await firebase_1.db
        .collection('transactions')
        .where('status', '==', 'shipped')
        .limit(MAX_TRANSACTIONS_PER_RUN)
        .get();
    if (shippedSnap.empty) {
        logger.info('[checkShippedTracking] No shipped transactions to check');
        return;
    }
    logger.info(`[checkShippedTracking] Checking ${shippedSnap.size} shipped transactions`);
    let deliveredCount = 0;
    let errorCount = 0;
    for (const doc of shippedSnap.docs) {
        const data = doc.data();
        const transactionId = doc.id;
        if (!data.trackingNumber) {
            // No tracking number yet — skip
            continue;
        }
        try {
            const carrierCode = data.carrierCode || 'intelcom_ca';
            const tracking = await shipEngine.getTracking(carrierCode, data.trackingNumber);
            const trackingStatus = shipEngine_1.ShipEngineClient.mapStatus(tracking.statusCode);
            if (trackingStatus === 'DELIVERED') {
                // Atomically mark delivered + transfer seller funds
                const sellerId = data.sellerId;
                const sellerPayout = data.sellerPayout || data.amount;
                const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
                const paidVia = data.paidVia;
                const isWalletPayment = paidVia === 'wallet' || paidVia === 'wallet_and_card';
                await firebase_1.db.runTransaction(async (tx) => {
                    const txSnap = await tx.get(doc.ref);
                    const sellerBalanceDoc = await tx.get(sellerBalanceRef);
                    const sellerWalletRef = firebase_1.db.collection('wallets').doc(sellerId);
                    const sellerWalletSnap = await tx.get(sellerWalletRef);
                    // Guard: if already delivered, skip (idempotent)
                    if (txSnap.exists && txSnap.data().status === 'delivered') {
                        return;
                    }
                    // 1. Update transaction
                    tx.update(doc.ref, {
                        trackingStatus,
                        status: 'delivered',
                        deliveredAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    // 2. Credit seller — wallet-first, fallback to seller_balances
                    const sellerPayoutCents = Math.round(sellerPayout * 100);
                    if (sellerWalletSnap.exists && sellerWalletSnap.data().status === 'active') {
                        // Seller has wallet: move pendingBalance -> balance
                        tx.update(sellerWalletRef, {
                            pendingBalance: firebase_1.FieldValue.increment(-sellerPayoutCents),
                            balance: firebase_1.FieldValue.increment(sellerPayoutCents),
                            updatedAt: firebase_1.FieldValue.serverTimestamp(),
                        });
                        // Create ledger entry
                        const ledgerRef = sellerWalletRef.collection('ledger').doc();
                        const currentWallet = sellerWalletSnap.data();
                        tx.set(ledgerRef, {
                            type: 'sale_credit',
                            amount: sellerPayoutCents,
                            balanceAfter: (currentWallet.balance || 0) + sellerPayoutCents,
                            description: 'Vente livree — fonds disponibles',
                            transactionId,
                            createdAt: firebase_1.FieldValue.serverTimestamp(),
                        });
                    }
                    else if (sellerBalanceDoc.exists) {
                        // Fallback to seller_balances
                        const balanceData = sellerBalanceDoc.data();
                        const txns = balanceData.transactions || [];
                        // Guard against negative pendingBalance
                        const currentPending = balanceData.pendingBalance || 0;
                        let actualPayout = sellerPayout;
                        if (currentPending < sellerPayout) {
                            logger.warn(`[checkShippedTracking] pendingBalance (${currentPending}) < sellerPayout (${sellerPayout}) for seller ${sellerId}`);
                            actualPayout = Math.min(sellerPayout, Math.max(0, currentPending));
                        }
                        const updatedTransactions = txns.map((txn) => {
                            if (txn.id === transactionId) {
                                return Object.assign(Object.assign({}, txn), { status: 'completed' });
                            }
                            return txn;
                        });
                        tx.update(sellerBalanceRef, {
                            pendingBalance: firebase_1.FieldValue.increment(-actualPayout),
                            availableBalance: firebase_1.FieldValue.increment(actualPayout),
                            totalEarnings: firebase_1.FieldValue.increment(actualPayout),
                            transactions: updatedTransactions,
                            updatedAt: firebase_1.FieldValue.serverTimestamp(),
                        });
                    }
                });
                // For wallet/mixed payments where seller has no wallet:
                // Transfer from platform to seller's Connect account
                if (isWalletPayment) {
                    const sellerWalletSnap = await firebase_1.db.collection('wallets').doc(sellerId).get();
                    if (!sellerWalletSnap.exists || ((_a = sellerWalletSnap.data()) === null || _a === void 0 ? void 0 : _a.status) !== 'active') {
                        const sellerDoc = await firebase_1.db.collection('users').doc(sellerId).get();
                        const sellerData = sellerDoc.data();
                        if ((sellerData === null || sellerData === void 0 ? void 0 : sellerData.stripeAccountId) && (sellerData === null || sellerData === void 0 ? void 0 : sellerData.stripeChargesEnabled)) {
                            try {
                                const stripe = (0, stripe_1.getStripe)();
                                if (stripe) {
                                    const sellerPayoutCents = Math.round(sellerPayout * 100);
                                    await stripe.transfers.create({
                                        amount: sellerPayoutCents,
                                        currency: 'cad',
                                        destination: sellerData.stripeAccountId,
                                        metadata: {
                                            transactionId,
                                            reason: 'wallet_payment_delivery',
                                        },
                                    });
                                    logger.info('[checkShippedTracking] Stripe transfer for wallet delivery', {
                                        transactionId, sellerId, amount: sellerPayoutCents,
                                    });
                                }
                            }
                            catch (transferErr) {
                                logger.error('[checkShippedTracking] Failed Stripe transfer for wallet payment', {
                                    transactionId, sellerId,
                                    error: transferErr instanceof Error ? transferErr.message : transferErr,
                                });
                            }
                        }
                    }
                }
                deliveredCount++;
                // Send system message to chat (non-critical)
                if (data.chatId) {
                    try {
                        let participants = [];
                        const chatSnap = await firebase_1.db.collection('chats').doc(data.chatId).get();
                        if (chatSnap.exists) {
                            participants = ((_b = chatSnap.data()) === null || _b === void 0 ? void 0 : _b.participants) || [];
                        }
                        await firebase_1.db.collection('messages').add({
                            chatId: data.chatId,
                            senderId: 'system',
                            receiverId: 'system',
                            type: 'system',
                            content: 'Colis livre ! La transaction est terminee. Les fonds ont ete transferes au vendeur.',
                            participants,
                            timestamp: firebase_1.FieldValue.serverTimestamp(),
                            status: 'sent',
                            isRead: true,
                        });
                    }
                    catch (msgErr) {
                        logger.warn('[checkShippedTracking] Failed to send system message', {
                            transactionId,
                            error: msgErr instanceof Error ? msgErr.message : msgErr,
                        });
                    }
                }
                // Push notification to buyer
                try {
                    const articleTitle = data.articleTitle || 'votre commande';
                    await (0, notifications_1.sendPushNotification)(data.buyerId, 'Colis livre !', `Votre commande ${articleTitle} a ete livree.`, { transactionId, articleId: data.articleId || '' }, 'order_delivered');
                }
                catch (notifErr) {
                    logger.warn('[checkShippedTracking] Failed to send buyer notification', {
                        transactionId,
                        error: notifErr instanceof Error ? notifErr.message : notifErr,
                    });
                }
                logger.info('[checkShippedTracking] Transaction delivered', {
                    transactionId,
                    trackingNumber: data.trackingNumber,
                });
            }
            else {
                // Just update tracking status if changed
                if (trackingStatus !== data.trackingStatus) {
                    await doc.ref.update({ trackingStatus });
                }
            }
        }
        catch (err) {
            errorCount++;
            logger.error('[checkShippedTracking] Error checking tracking', {
                transactionId,
                trackingNumber: data.trackingNumber,
                error: err instanceof Error ? err.message : err,
            });
        }
    }
    logger.info('[checkShippedTracking] Run complete', {
        checked: shippedSnap.size,
        delivered: deliveredCount,
        errors: errorCount,
    });
});
//# sourceMappingURL=trackingCheck.js.map