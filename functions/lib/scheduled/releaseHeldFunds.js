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
exports.releaseHeldFunds = exports.DISPUTE_WINDOW_MS = void 0;
exports.applyDeliveredHeldFunds = applyDeliveredHeldFunds;
/**
 * Scheduled held-funds release + 7-day dispute window contract
 * Firebase Functions v2 - using onSchedule, region northamerica-northeast1
 *
 * THREE-BUCKET FUNDS MODEL (seller wallet, collection `wallets`)
 * ------------------------------------------------------------------
 *   pendingBalance — sale paid, NOT yet delivered (escrow, in transit)
 *   heldBalance    — delivered, inside the 7-day buyer-dispute window
 *   balance        — withdrawable (dispute window elapsed, no claim)
 *
 * Lifecycle of seller funds for one purchase:
 *   1. PI.succeeded / payWithWallet  -> pendingBalance += payout
 *   2. DELIVERED (tracking)          -> pendingBalance -= payout
 *                                       heldBalance    += payout
 *                                       transaction.fundsReleaseAt = deliveredAt + 7d
 *   3. fundsReleaseAt <= now & no dispute (THIS JOB)
 *                                    -> heldBalance -= payout
 *                                       balance     += payout
 *                                       transaction.fundsReleasedAt = now
 *
 * The DELIVERED transition (step 2) is owned by the shipping/state-machine
 * chantier (trackingCheck.ts + checkTrackingStatus + manual). This module
 * EXPOSES the reusable `applyDeliveredHeldFunds` helper that those sites must
 * call instead of the old "pendingBalance -> balance" move, so the contract
 * lives in one place. Until those sites are migrated, this scheduled job is a
 * no-op for transactions that have no `fundsReleaseAt` (they release on
 * delivery the old way), and becomes active the moment delivery starts setting
 * the held-funds fields.
 *
 * New wallet fields:  heldBalance, sellerDebt  (server-only, see rules chantier)
 * New transaction fields: fundsReleaseAt, fundsReleasedAt, disputed
 *
 * Ledger types introduced here: 'funds_released'.
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const firestore_1 = require("firebase-admin/firestore");
const notifications_1 = require("../utils/notifications");
const automatedDecisions_1 = require("../callable/automatedDecisions");
/** Buyer-dispute window after delivery before seller funds become withdrawable. */
exports.DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Process at most this many transactions per run to bound execution time. */
const MAX_TRANSACTIONS_PER_RUN = 200;
/**
 * Transaction statuses that BLOCK the release of held funds. If a transaction
 * is in any of these, the dispute window is on hold and funds stay in
 * heldBalance until the dispute is resolved (charge.dispute.closed handler).
 */
const DISPUTE_BLOCKING_STATUSES = new Set([
    'disputed',
    'delivery_failed',
    'lost',
    'refunded',
]);
/**
 * REUSABLE CONTRACT — call this from the DELIVERED transition.
 *
 * Moves a seller payout from `pendingBalance` to `heldBalance` and stamps the
 * transaction with `fundsReleaseAt = deliveredAt + 7 days`. MUST be called
 * inside a runTransaction; the caller is responsible for having already read
 * the wallet/transaction snapshots and for the transaction status update
 * (status -> 'delivered', deliveredAt).
 *
 * @param tx              active Firestore transaction
 * @param sellerWalletRef seller wallet doc ref (collection `wallets`)
 * @param sellerWalletData snapshot data of the seller wallet (for balanceAfter)
 * @param transactionRef  the transaction doc ref
 * @param transactionId   the transaction id (for ledger linkage)
 * @param sellerPayoutCents seller payout in CENTS
 * @param deliveredAtMs   delivery time in epoch ms (used to compute the window)
 */
function applyDeliveredHeldFunds(tx, sellerWalletRef, sellerWalletData, transactionRef, transactionId, sellerPayoutCents, deliveredAtMs) {
    // Move pending -> held (delivered, inside dispute window)
    tx.update(sellerWalletRef, {
        pendingBalance: firebase_1.FieldValue.increment(-sellerPayoutCents),
        heldBalance: firebase_1.FieldValue.increment(sellerPayoutCents),
        updatedAt: firebase_1.FieldValue.serverTimestamp(),
    });
    const ledgerRef = sellerWalletRef.collection('ledger').doc();
    tx.set(ledgerRef, {
        type: 'funds_held',
        amount: sellerPayoutCents,
        balanceAfter: (sellerWalletData.heldBalance || 0) + sellerPayoutCents,
        description: 'Vente livrée — fonds en attente (fenêtre de litige 7 jours)',
        transactionId,
        createdAt: firebase_1.FieldValue.serverTimestamp(),
        status: 'held',
    });
    // Stamp the release deadline on the transaction.
    const releaseAt = firestore_1.Timestamp.fromMillis(deliveredAtMs + exports.DISPUTE_WINDOW_MS);
    tx.update(transactionRef, {
        fundsReleaseAt: releaseAt,
    });
}
exports.releaseHeldFunds = (0, scheduler_1.onSchedule)({
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
}, async () => {
    var _a, _b;
    const now = firestore_1.Timestamp.now();
    let released = 0;
    let skipped = 0;
    let errors = 0;
    // Paginate by fundsReleaseAt ascending; only past-due, delivered txs.
    // Composite index required: (status ASC, fundsReleaseAt ASC).
    let lastReleaseAt = null;
    let keepGoing = true;
    while (keepGoing) {
        let query = firebase_1.db
            .collection('transactions')
            .where('status', '==', 'delivered')
            .where('fundsReleaseAt', '<=', now)
            .orderBy('fundsReleaseAt', 'asc')
            .limit(MAX_TRANSACTIONS_PER_RUN);
        if (lastReleaseAt) {
            query = query.startAfter(lastReleaseAt);
        }
        const snap = await query.get();
        if (snap.empty) {
            break;
        }
        for (const doc of snap.docs) {
            const data = doc.data();
            const transactionId = doc.id;
            lastReleaseAt = (_a = data.fundsReleaseAt) !== null && _a !== void 0 ? _a : lastReleaseAt;
            // Defense-in-depth: never release a disputed/lost/refunded transaction.
            if (data.disputed === true || DISPUTE_BLOCKING_STATUSES.has(data.status)) {
                skipped++;
                continue;
            }
            const sellerId = data.sellerId;
            const sellerPayout = (_b = data.sellerPayout) !== null && _b !== void 0 ? _b : data.amount;
            if (!sellerId || typeof sellerPayout !== 'number') {
                logger.warn('[releaseHeldFunds] missing sellerId/payout — skipping', {
                    transactionId,
                });
                skipped++;
                continue;
            }
            const sellerPayoutCents = Math.round(sellerPayout * 100);
            const sellerWalletRef = firebase_1.db.collection('wallets').doc(sellerId);
            try {
                const moved = await firebase_1.db.runTransaction(async (tx) => {
                    const txSnap = await tx.get(doc.ref);
                    if (!txSnap.exists)
                        return false;
                    const tdata = txSnap.data();
                    // Re-check invariants inside the transaction (status may have
                    // changed between query and commit — e.g. a dispute was opened).
                    if (tdata.status !== 'delivered')
                        return false;
                    if (tdata.disputed === true)
                        return false;
                    if (tdata.fundsReleasedAt)
                        return false; // idempotence
                    const walletSnap = await tx.get(sellerWalletRef);
                    if (!walletSnap.exists) {
                        logger.warn('[releaseHeldFunds] seller wallet not found — skipping', {
                            transactionId,
                            sellerId,
                        });
                        return false;
                    }
                    const walletData = walletSnap.data();
                    // Move from heldBalance to balance, capped so heldBalance never
                    // goes negative (defensive — should equal sellerPayoutCents).
                    const heldNow = walletData.heldBalance || 0;
                    const moveCents = Math.min(sellerPayoutCents, heldNow);
                    tx.update(sellerWalletRef, {
                        heldBalance: firebase_1.FieldValue.increment(-moveCents),
                        balance: firebase_1.FieldValue.increment(moveCents),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    const ledgerRef = sellerWalletRef.collection('ledger').doc();
                    tx.set(ledgerRef, {
                        type: 'funds_released',
                        amount: moveCents,
                        balanceAfter: (walletData.balance || 0) + moveCents,
                        description: 'Fenêtre de litige écoulée — fonds disponibles',
                        transactionId,
                        createdAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    // Stamp completedAt alongside status:'completed' to match every
                    // other writer of this transition (webhooks/payments/reconcile/
                    // swaps). reviews.ts anchors its 60-day review window on
                    // completedAt, so this is the "reviewable" marker for the
                    // delivered -> completed transition once 'completed' is added to
                    // the reviews terminalStatuses (be-reviews-callable).
                    tx.update(doc.ref, {
                        status: 'completed',
                        completedAt: firebase_1.FieldValue.serverTimestamp(),
                        fundsReleasedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    return true;
                });
                if (moved) {
                    released++;
                    // Loi 25 art. 12.1 — journal the AUTOMATED decision (best-effort,
                    // never throws, never rolls back the money move above).
                    await (0, automatedDecisions_1.logAutomatedDecision)({
                        transactionId,
                        userId: sellerId,
                        decisionType: 'funds_released',
                        criteria: {
                            status: 'delivered',
                            disputed: false,
                            fundsReleaseAt: data.fundsReleaseAt instanceof firestore_1.Timestamp
                                ? data.fundsReleaseAt.toDate().toISOString()
                                : null,
                            disputeWindowDays: 7,
                        },
                        result: 'Fonds libérés au vendeur (fenêtre de litige écoulée)',
                    });
                    // Best-effort notification to the seller. ENRICHED for Loi 25
                    // transparency: states the decision was AUTOMATIC and that it can
                    // be contested (right to human review).
                    try {
                        await (0, notifications_1.sendPushNotification)(sellerId, 'Fonds libérés automatiquement', 'Vos fonds ont été libérés automatiquement : la livraison a été confirmée et le délai de réclamation (7 jours) est écoulé. Si vous contestez cette décision, vous pouvez nous le signaler.', { transactionId }, 'funds_released');
                    }
                    catch (notifErr) {
                        logger.warn('[releaseHeldFunds] seller notification failed', {
                            transactionId,
                            error: notifErr instanceof Error ? notifErr.message : notifErr,
                        });
                    }
                }
                else {
                    skipped++;
                }
            }
            catch (err) {
                errors++;
                logger.error('[releaseHeldFunds] error releasing funds', {
                    transactionId,
                    error: err instanceof Error ? err.message : err,
                });
            }
        }
        keepGoing = snap.size === MAX_TRANSACTIONS_PER_RUN;
    }
    // Second sweep: swap cash top-ups held after reception (same 7-day window).
    const swapStats = await releaseSwapTopUpHeldFunds(now);
    logger.info('[releaseHeldFunds] run complete', {
        released,
        skipped,
        errors,
        swapReleased: swapStats.released,
        swapSkipped: swapStats.skipped,
        swapErrors: swapStats.errors,
    });
});
/**
 * Release swap cash top-up funds that have cleared the 7-day post-reception
 * window. EXACTLY mirrors the purchase release above: moves the payee's
 * complement from heldBalance to withdrawable balance and stamps topUpReleasedAt
 * on the swap (the idempotence + "no more auto-refund" marker also read by
 * openSwapDispute).
 *
 * Query: swaps where status == 'completed' AND topUpFundsReleaseAt <= now.
 * Composite index required: swaps (status ASC, topUpFundsReleaseAt ASC).
 *
 * A swap moved to 'disputed' (openSwapDispute) is excluded by the status filter,
 * so funds in the window are never released out from under an open dispute. The
 * inner transaction re-checks status + topUpReleasedAt for full idempotence.
 */
async function releaseSwapTopUpHeldFunds(now) {
    var _a;
    let released = 0;
    let skipped = 0;
    let errors = 0;
    let lastReleaseAt = null;
    let keepGoing = true;
    while (keepGoing) {
        let query = firebase_1.db
            .collection('swaps')
            .where('status', '==', 'completed')
            .where('topUpFundsReleaseAt', '<=', now)
            .orderBy('topUpFundsReleaseAt', 'asc')
            .limit(MAX_TRANSACTIONS_PER_RUN);
        if (lastReleaseAt) {
            query = query.startAfter(lastReleaseAt);
        }
        const snap = await query.get();
        if (snap.empty)
            break;
        for (const doc of snap.docs) {
            const data = doc.data();
            const swapId = doc.id;
            lastReleaseAt = (_a = data.topUpFundsReleaseAt) !== null && _a !== void 0 ? _a : lastReleaseAt;
            // Idempotence / guard: nothing to do if already released, never held, or
            // no top-up at all.
            if (data.topUpReleasedAt || !data.topUpFundsHeldAt || data.cashTopUp == null) {
                skipped++;
                continue;
            }
            const topUp = data.cashTopUp;
            const payeeId = topUp.payerId === data.initiatorId ? data.receiverId : data.initiatorId;
            const payoutCents = typeof topUp.amount === 'number' ? Math.round(topUp.amount) : 0;
            if (!payeeId || payoutCents <= 0) {
                logger.warn('[releaseHeldFunds] swap top-up missing payee/amount — skipping', { swapId });
                skipped++;
                continue;
            }
            const payeeWalletRef = firebase_1.db.collection('wallets').doc(payeeId);
            try {
                const moved = await firebase_1.db.runTransaction(async (tx) => {
                    const swapSnap = await tx.get(doc.ref);
                    if (!swapSnap.exists)
                        return false;
                    const sdata = swapSnap.data();
                    // Re-check invariants inside the transaction (a dispute may have been
                    // opened between the query and the commit).
                    if (sdata.status !== 'completed')
                        return false;
                    if (!sdata.topUpFundsHeldAt)
                        return false;
                    if (sdata.topUpReleasedAt)
                        return false; // idempotence
                    const walletSnap = await tx.get(payeeWalletRef);
                    if (!walletSnap.exists) {
                        logger.warn('[releaseHeldFunds] swap payee wallet not found — skipping', {
                            swapId,
                            payeeId,
                        });
                        return false;
                    }
                    const walletData = walletSnap.data();
                    // Move heldBalance -> balance, capped so heldBalance never goes
                    // negative (defensive — should equal payoutCents).
                    const heldNow = walletData.heldBalance || 0;
                    const moveCents = Math.min(payoutCents, heldNow);
                    if (moveCents > 0) {
                        tx.update(payeeWalletRef, {
                            heldBalance: firebase_1.FieldValue.increment(-moveCents),
                            balance: firebase_1.FieldValue.increment(moveCents),
                            updatedAt: firebase_1.FieldValue.serverTimestamp(),
                        });
                        const ledgerRef = payeeWalletRef.collection('ledger').doc();
                        tx.set(ledgerRef, {
                            type: 'funds_released',
                            amount: moveCents,
                            balanceAfter: (walletData.balance || 0) + moveCents,
                            description: 'Complément d\'échange — fenêtre de litige écoulée, fonds disponibles',
                            swapId,
                            createdAt: firebase_1.FieldValue.serverTimestamp(),
                        });
                    }
                    tx.update(doc.ref, {
                        topUpReleasedAt: firebase_1.FieldValue.serverTimestamp(),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    return true;
                });
                if (moved) {
                    released++;
                }
                else {
                    skipped++;
                }
            }
            catch (err) {
                errors++;
                logger.error('[releaseHeldFunds] error releasing swap top-up funds', {
                    swapId,
                    error: err instanceof Error ? err.message : err,
                });
            }
        }
        keepGoing = snap.size === MAX_TRANSACTIONS_PER_RUN;
    }
    return { released, skipped, errors };
}
//# sourceMappingURL=releaseHeldFunds.js.map