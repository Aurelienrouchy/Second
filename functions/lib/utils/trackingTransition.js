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
exports.DELIVERABLE_STATUSES = void 0;
exports.applyTrackingOutcome = applyTrackingOutcome;
/**
 * Shared tracking-state-machine transitions (P1: decouple shipped/label_created,
 * DELIVERED held-funds contract, FAILURE/lost flow).
 *
 * Single source of truth for advancing a SHIPPING transaction's status from a
 * ShipEngine tracking outcome, used by ALL three tracking entry points so the
 * contract lives in one place:
 *   - the scheduled poller        (scheduled/trackingCheck.ts)
 *   - the manual buyer/seller call (callable/payments.ts checkTrackingStatus)
 *   - the ShipEngine webhook       (http/shipEngineWebhook.ts)
 *
 * STATE MACHINE (shipping leg)
 * ----------------------------
 *   paid ── label bought ──> label_created ── 1st carrier scan ──> shipped
 *        └── shipped ── carrier scan DELIVERED ──> delivered (held-funds window)
 *        └── shipped/label_created ── carrier scan FAILURE/exception ──>
 *                                     delivery_failed (funds NOT released)
 *
 * `label_created` means a label exists but the carrier has not scanned the
 * parcel yet (the seller may have printed but not dropped off). The first real
 * carrier scan (IN_TRANSIT / TRANSIT) advances to `shipped`. This lets the
 * label_created-expiry sweep nudge sellers who never actually ship.
 *
 * DELIVERED applies the held-funds contract (pendingBalance -> heldBalance +
 * fundsReleaseAt = +7d), owned by releaseHeldFunds.applyDeliveredHeldFunds.
 *
 * FAILURE / exception NEVER releases funds: it marks `delivery_failed`, opens
 * the dispute window (so releaseHeldFunds keeps the money frozen) and notifies
 * both parties. Resolution (refund) goes through the admin refund callable.
 *
 * All wallet/ledger amounts are CENTS. Transaction cost fields are DOLLARS.
 */
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const releaseHeldFunds_1 = require("../scheduled/releaseHeldFunds");
const wallet_1 = require("../callable/wallet");
const notifications_1 = require("../utils/notifications");
/**
 * Statuses from which a DELIVERED scan may legitimately move funds. A
 * DELIVERED scan on any other status (refunded, disputed, cancelled, already
 * delivered, meetup_*) must be a no-op to avoid double-crediting or driving a
 * wallet negative (P1-21).
 */
exports.DELIVERABLE_STATUSES = new Set(['paid', 'shipped', 'label_created']);
/**
 * Statuses that represent "a real carrier scan can advance us to shipped".
 * Only `label_created` (and defensively `paid`) progresses to `shipped`.
 */
const PRESHIP_STATUSES = new Set(['label_created', 'paid']);
/**
 * Internal tracking-status strings produced by ShipEngineClient.mapStatus that
 * count as a real carrier scan (parcel in the network).
 */
const CARRIER_SCANNED = new Set(['TRANSIT', 'IN_TRANSIT']);
/** Internal tracking-status strings that count as a delivery failure/exception. */
const FAILURE_STATUSES = new Set(['FAILURE', 'EXCEPTION']);
/**
 * Apply a tracking outcome to one transaction atomically + fire best-effort
 * notifications. Idempotent and status-guarded — safe to call from the poller,
 * the manual callable and the webhook for the same parcel.
 *
 * @param transactionId  the transaction doc id
 * @param mappedStatus   ShipEngineClient.mapStatus(...) output
 *                       (UNKNOWN | TRANSIT | IN_TRANSIT | DELIVERED | FAILURE)
 * @param source         short tag for structured logs
 */
async function applyTrackingOutcome(transactionId, mappedStatus, source) {
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    // ---- DELIVERED: pendingBalance -> heldBalance + 7-day window ----
    if (mappedStatus === 'DELIVERED') {
        let notify = null;
        const changed = await firebase_1.db.runTransaction(async (tx) => {
            var _a;
            const snap = await tx.get(txRef);
            if (!snap.exists)
                return false;
            const data = snap.data();
            // Status guard (P1-21): only deliverable statuses advance to delivered.
            if (!exports.DELIVERABLE_STATUSES.has(data.status)) {
                return false;
            }
            const sellerId = data.sellerId;
            const sellerPayout = (_a = data.sellerPayout) !== null && _a !== void 0 ? _a : data.amount;
            const sellerPayoutCents = typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;
            // The seller is credited (pendingBalance) at label creation under the
            // deferred-credit model. If for any reason they were never credited
            // (sellerCreditedCents absent) we still mark delivered but cannot move
            // funds that are not there — log and skip the held-funds move.
            const creditedCents = typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
            tx.update(txRef, {
                trackingStatus: 'DELIVERED',
                status: 'delivered',
                deliveredAt: firebase_1.FieldValue.serverTimestamp(),
            });
            if (sellerId && creditedCents > 0) {
                const { walletRef, walletData } = await (0, wallet_1.getOrCreateSellerWallet)(tx, sellerId);
                // Move exactly what was credited (creditedCents), not a freshly derived
                // payout, so credit and held-move can never drift.
                (0, releaseHeldFunds_1.applyDeliveredHeldFunds)(tx, walletRef, walletData, txRef, transactionId, creditedCents, Date.now());
            }
            else {
                logger.warn('[trackingTransition] DELIVERED but seller not credited — no held move', {
                    transactionId,
                    source,
                    sellerId,
                    sellerPayoutCents,
                });
            }
            notify = {
                buyerId: data.buyerId,
                sellerId: data.sellerId,
                chatId: data.chatId,
                articleTitle: data.articleTitle || 'votre commande',
                articleId: data.articleId || '',
            };
            return true;
        });
        if (changed && notify) {
            await emitDeliveredSideEffects(transactionId, notify, source);
        }
        return { kind: 'delivered', changed };
    }
    // ---- FAILURE / exception: freeze funds, open dispute window, notify both ----
    if (FAILURE_STATUSES.has(mappedStatus)) {
        let notify = null;
        const changed = await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(txRef);
            if (!snap.exists)
                return false;
            const data = snap.data();
            // Only act on in-flight statuses; never override a terminal/dispute state.
            if (!['paid', 'shipped', 'label_created'].includes(data.status)) {
                return false;
            }
            // Idempotence: already flagged failed.
            if (data.deliveryFailedAt)
                return false;
            tx.update(txRef, {
                trackingStatus: 'FAILURE',
                status: 'delivery_failed',
                // Open the dispute window so releaseHeldFunds keeps the money frozen and
                // a manual/admin refund can resolve it. Funds are NOT released.
                disputed: true,
                deliveryFailedAt: firebase_1.FieldValue.serverTimestamp(),
                statusBeforeDispute: data.status,
            });
            notify = {
                buyerId: data.buyerId,
                sellerId: data.sellerId,
                articleTitle: data.articleTitle || 'votre commande',
                articleId: data.articleId || '',
            };
            return true;
        });
        if (changed && notify) {
            await emitFailureSideEffects(transactionId, notify, source);
        }
        return { kind: 'failed', changed };
    }
    // ---- Real carrier scan: label_created -> shipped ----
    if (CARRIER_SCANNED.has(mappedStatus)) {
        const changed = await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(txRef);
            if (!snap.exists)
                return false;
            const data = snap.data();
            const trackingChanged = data.trackingStatus !== mappedStatus;
            if (PRESHIP_STATUSES.has(data.status)) {
                tx.update(txRef, {
                    status: 'shipped',
                    shippedAt: firebase_1.FieldValue.serverTimestamp(),
                    trackingStatus: mappedStatus,
                });
                return true;
            }
            // Already shipped/delivered/etc — just refresh trackingStatus if changed.
            if (trackingChanged) {
                tx.update(txRef, { trackingStatus: mappedStatus });
            }
            return false;
        });
        return { kind: changed ? 'shipped' : 'tracking_updated', changed };
    }
    // ---- UNKNOWN / other: best-effort trackingStatus refresh, no state change ----
    const changed = await firebase_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists)
            return false;
        const data = snap.data();
        if (data.trackingStatus === mappedStatus)
            return false;
        tx.update(txRef, { trackingStatus: mappedStatus });
        return true;
    });
    return { kind: 'tracking_updated', changed };
}
/** Best-effort system message + buyer push after a delivery transition. */
async function emitDeliveredSideEffects(transactionId, notify, source) {
    var _a;
    if (notify.chatId) {
        try {
            let participants = [];
            const chatSnap = await firebase_1.db.collection('chats').doc(notify.chatId).get();
            if (chatSnap.exists) {
                participants = ((_a = chatSnap.data()) === null || _a === void 0 ? void 0 : _a.participants) || [];
            }
            await firebase_1.db.collection('messages').add({
                chatId: notify.chatId,
                senderId: 'system',
                receiverId: 'system',
                type: 'system',
                content: 'Colis livré ! Les fonds du vendeur seront disponibles après la fenêtre de litige de 7 jours.',
                participants,
                timestamp: firebase_1.FieldValue.serverTimestamp(),
                status: 'sent',
                isRead: true,
            });
        }
        catch (msgErr) {
            logger.warn('[trackingTransition] delivered system message failed', {
                transactionId,
                source,
                error: msgErr instanceof Error ? msgErr.message : msgErr,
            });
        }
    }
    if (notify.buyerId) {
        try {
            await (0, notifications_1.sendPushNotification)(notify.buyerId, 'Colis livre !', `Votre commande ${notify.articleTitle} a ete livree.`, { transactionId, articleId: notify.articleId || '' }, 'order_delivered');
        }
        catch (notifErr) {
            logger.warn('[trackingTransition] delivered buyer notification failed', {
                transactionId,
                source,
                error: notifErr instanceof Error ? notifErr.message : notifErr,
            });
        }
    }
}
/** Best-effort push to BOTH parties after a delivery failure / lost parcel. */
async function emitFailureSideEffects(transactionId, notify, source) {
    const payload = { transactionId, articleId: notify.articleId || '' };
    if (notify.buyerId) {
        (0, notifications_1.sendPushNotification)(notify.buyerId, 'Probleme de livraison', `La livraison de ${notify.articleTitle} a echoue. Notre equipe va etudier votre dossier — vous serez rembourse si le colis est introuvable.`, payload, 'delivery_failed').catch((err) => logger.warn('[trackingTransition] failure buyer notification failed', {
            transactionId,
            source,
            error: err instanceof Error ? err.message : err,
        }));
    }
    if (notify.sellerId) {
        (0, notifications_1.sendPushNotification)(notify.sellerId, 'Probleme de livraison', `La livraison de ${notify.articleTitle} a echoue. Les fonds restent en attente le temps de la resolution.`, payload, 'delivery_failed').catch((err) => logger.warn('[trackingTransition] failure seller notification failed', {
            transactionId,
            source,
            error: err instanceof Error ? err.message : err,
        }));
    }
    logger.warn('[trackingTransition] delivery failure — funds frozen, dispute window opened', {
        transactionId,
        source,
    });
}
//# sourceMappingURL=trackingTransition.js.map