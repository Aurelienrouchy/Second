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
const notifications_1 = require("../utils/notifications");
const wallet_1 = require("../callable/wallet");
/** Process at most this many transactions per run to avoid timeouts */
const MAX_TRANSACTIONS_PER_RUN = 200;
exports.checkShippedTracking = (0, scheduler_1.onSchedule)({
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'],
}, async () => {
    var _a;
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
                await firebase_1.db.runTransaction(async (tx) => {
                    const txSnap = await tx.get(doc.ref);
                    // Guard: if already delivered, skip (idempotent)
                    if (txSnap.exists && txSnap.data().status === 'delivered') {
                        return;
                    }
                    // Get or create seller wallet
                    const { walletRef: sellerWalletRef, walletData: sellerWalletData } = await (0, wallet_1.getOrCreateSellerWallet)(tx, sellerId);
                    // 1. Update transaction
                    tx.update(doc.ref, {
                        trackingStatus,
                        status: 'delivered',
                        deliveredAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    // 2. Credit seller wallet: move pendingBalance -> balance
                    const sellerPayoutCents = Math.round(sellerPayout * 100);
                    tx.update(sellerWalletRef, {
                        pendingBalance: firebase_1.FieldValue.increment(-sellerPayoutCents),
                        balance: firebase_1.FieldValue.increment(sellerPayoutCents),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    // Create ledger entry
                    const ledgerRef = sellerWalletRef.collection('ledger').doc();
                    tx.set(ledgerRef, {
                        type: 'sale_available',
                        amount: sellerPayoutCents,
                        balanceAfter: (sellerWalletData.balance || 0) + sellerPayoutCents,
                        description: 'Vente livrée — fonds disponibles',
                        transactionId,
                        createdAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                });
                deliveredCount++;
                // Send system message to chat (non-critical)
                if (data.chatId) {
                    try {
                        let participants = [];
                        const chatSnap = await firebase_1.db.collection('chats').doc(data.chatId).get();
                        if (chatSnap.exists) {
                            participants = ((_a = chatSnap.data()) === null || _a === void 0 ? void 0 : _a.participants) || [];
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