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
exports.refundWalletPayment = exports.payWithWallet = exports.walletWithdraw = exports.getWalletInfo = exports.activateWallet = void 0;
exports.getOrCreateSellerWallet = getOrCreateSellerWallet;
/**
 * Wallet callable functions
 * Firebase Functions v7 - using onCall
 *
 * Virtual wallet ("porte-monnaie") for the Second marketplace.
 * All amounts are in CENTS to avoid floating-point issues.
 *
 * Functions:
 * - activateWallet: One-click wallet creation
 * - getWalletInfo: Read wallet balance + recent ledger
 * - walletWithdraw: Withdraw from wallet to bank via Stripe
 * - payWithWallet: 100% wallet payment (no card)
 * - refundWalletPayment: Refund a 100% wallet transaction
 *
 * Ledger entry types (WalletLedgerType):
 * - 'purchase_debit'    — buyer pays for article
 * - 'sale_credit'       — seller receives funds into pendingBalance (escrow)
 * - 'funds_held'        — delivered: pendingBalance -> heldBalance (7-day dispute window)
 * - 'funds_released'    — dispute window elapsed: heldBalance -> balance (withdrawable)
 * - 'dispute_hold'      — dispute opened: balance -> heldBalance (frozen)
 * - 'refund_credit'     — refund returned to buyer's wallet
 * - 'refund_debit'      — seller debited on refund / lost dispute (may record sellerDebt)
 * - 'withdrawal'        — funds sent to bank via Stripe (withdrawal_requests='processing')
 * - 'withdrawal_failed' — withdrawal reverted after Stripe failure (F08: must be handled in UI)
 *
 * THREE-BUCKET FUNDS MODEL (see scheduled/releaseHeldFunds.ts for the full contract):
 *   pendingBalance — paid, not delivered (escrow)
 *   heldBalance    — delivered, inside 7-day dispute window (NOT withdrawable)
 *   balance        — withdrawable
 *   sellerDebt     — shortfall owed after a lost dispute (blocks withdrawals)
 *
 * Withdrawals (walletWithdraw) draw ONLY from `balance`, are refused while any
 * sale is `disputed`, and create a withdrawal_requests/{id}='processing' doc
 * (closed out by payout.paid / payout.failed webhooks).
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const shipEngine_1 = require("../config/shipEngine");
const rateLimit_1 = require("../utils/rateLimit");
const labelFulfillment_1 = require("../utils/labelFulfillment");
// Rate limiting: financial callables share a 1-minute sliding window.
// maxCallsUnauthenticated is 0 everywhere — these endpoints require auth.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
// =============================================================================
// HELPER — Get or auto-create seller wallet inside a transaction
// =============================================================================
/**
 * Reads the seller's wallet inside a Firestore transaction. If the wallet
 * does not exist, creates it automatically with zero balances.
 *
 * This ensures every seller gets a wallet on first sale — no manual
 * activation required on the seller side.
 *
 * MUST be called inside a runTransaction callback (tx parameter).
 */
async function getOrCreateSellerWallet(tx, sellerId) {
    const walletRef = firebase_1.db.collection('wallets').doc(sellerId);
    const walletSnap = await tx.get(walletRef);
    if (walletSnap.exists) {
        return { walletRef, walletData: walletSnap.data(), isNew: false };
    }
    const newWallet = {
        balance: 0,
        pendingBalance: 0,
        currency: 'cad',
        status: 'active',
        activatedAt: firebase_1.FieldValue.serverTimestamp(),
        createdAt: firebase_1.FieldValue.serverTimestamp(),
        updatedAt: firebase_1.FieldValue.serverTimestamp(),
    };
    tx.set(walletRef, newWallet);
    return { walletRef, walletData: Object.assign(Object.assign({}, newWallet), { balance: 0, pendingBalance: 0 }), isNew: true };
}
// =============================================================================
// ACTIVATE WALLET — One-click wallet creation
// =============================================================================
/**
 * Creates a wallet for the authenticated user.
 * Idempotent: if wallet already exists, returns current state.
 *
 * No Stripe Customer creation, no forms — just a single button activation.
 */
exports.activateWallet = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userId = request.auth.uid;
    const walletRef = firebase_1.db.collection('wallets').doc(userId);
    try {
        const result = await firebase_1.db.runTransaction(async (tx) => {
            const walletSnap = await tx.get(walletRef);
            if (walletSnap.exists) {
                // Idempotent: return current state
                const data = walletSnap.data();
                return {
                    success: true,
                    balance: data.balance,
                    pendingBalance: data.pendingBalance,
                    status: data.status,
                    alreadyExisted: true,
                };
            }
            // Create new wallet
            tx.set(walletRef, {
                balance: 0,
                pendingBalance: 0,
                currency: 'cad',
                status: 'active',
                activatedAt: firebase_1.FieldValue.serverTimestamp(),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            return {
                success: true,
                balance: 0,
                pendingBalance: 0,
                status: 'active',
                alreadyExisted: false,
            };
        });
        logger.info('Wallet activated', {
            userId,
            alreadyExisted: result.alreadyExisted,
        });
        return {
            success: true,
            balance: result.balance,
            pendingBalance: result.pendingBalance,
            status: result.status,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error activating wallet', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to activate wallet: ${message}`);
    }
});
// =============================================================================
// GET WALLET INFO — Read wallet balance + recent ledger entries
// =============================================================================
/**
 * Returns wallet balance, pendingBalance, status, and last 20 ledger entries.
 * If no wallet exists, returns { hasWallet: false }.
 */
exports.getWalletInfo = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a, _b, _c, _d, _e, _f;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userId = request.auth.uid;
    try {
        const walletRef = firebase_1.db.collection('wallets').doc(userId);
        const walletSnap = await walletRef.get();
        if (!walletSnap.exists) {
            return { hasWallet: false };
        }
        const walletData = walletSnap.data();
        // Fetch last 20 ledger entries
        const ledgerSnap = await walletRef
            .collection('ledger')
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        const ledgerEntries = ledgerSnap.docs.map((doc) => {
            var _a, _b, _c;
            const data = doc.data();
            return {
                id: doc.id,
                type: data.type,
                amount: data.amount,
                balanceAfter: data.balanceAfter,
                description: data.description,
                transactionId: data.transactionId || null,
                createdAt: ((_c = (_b = (_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString()) || null,
            };
        });
        return {
            hasWallet: true,
            balance: walletData.balance,
            pendingBalance: walletData.pendingBalance,
            currency: walletData.currency,
            status: walletData.status,
            activatedAt: ((_c = (_b = (_a = walletData.activatedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString()) || null,
            updatedAt: ((_f = (_e = (_d = walletData.updatedAt) === null || _d === void 0 ? void 0 : _d.toDate) === null || _e === void 0 ? void 0 : _e.call(_d)) === null || _f === void 0 ? void 0 : _f.toISOString()) || null,
            ledger: ledgerEntries,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error getting wallet info', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to get wallet info: ${message}`);
    }
});
// =============================================================================
// WALLET WITHDRAW — Transfer funds from wallet to bank via Stripe
// =============================================================================
/**
 * Withdraws funds from the user's wallet to their bank account via Stripe.
 *
 * Flow:
 * 1. Validate inputs (amount in cents, min $10 = 1000 cents)
 * 2. Verify user has active Stripe Connect account with charges enabled
 * 3. Atomically debit wallet balance via runTransaction
 * 4. Create Stripe transfer (platform -> Connect account)
 * 5. Create Stripe payout (Connect account -> bank)
 * 6. Record ledger entry
 *
 * If Stripe calls fail, the wallet debit is reverted atomically.
 */
exports.walletWithdraw = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'walletWithdraw',
        maxCallsAuthenticated: 5,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const { amount } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    const userId = request.auth.uid;
    // --- Input validation ---
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        throw new https_1.HttpsError('invalid-argument', 'Le montant doit etre un entier positif (en cents)');
    }
    if (amount < 1000) {
        throw new https_1.HttpsError('invalid-argument', 'Le retrait minimum est de 10,00 $ (1000 cents)');
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    // --- Verify Stripe account ---
    const userRef = firebase_1.db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
        throw new https_1.HttpsError('not-found', 'User not found');
    }
    const userData = userDoc.data();
    if (!userData.stripeAccountId) {
        throw new https_1.HttpsError('failed-precondition', 'Aucun compte de paiement configure. Completez votre inscription vendeur.');
    }
    if (userData.stripeChargesEnabled !== true) {
        throw new https_1.HttpsError('failed-precondition', 'Votre compte de paiement n\'est pas encore actif.');
    }
    if (userData.stripePayoutsEnabled !== true) {
        throw new https_1.HttpsError('failed-precondition', 'Les virements ne sont pas encore actives sur votre compte.');
    }
    const stripeAccountId = userData.stripeAccountId;
    const walletRef = firebase_1.db.collection('wallets').doc(userId);
    // --- Dispute guard: refuse withdrawal while a dispute is active ---
    // A seller with any transaction currently in 'disputed' status (chargeback
    // open) cannot cash out: the funds may need to be clawed back. Funds in
    // heldBalance/pendingBalance are already non-withdrawable; this guard also
    // freezes the rest of the balance for the duration of the dispute.
    const disputedSnap = await firebase_1.db
        .collection('transactions')
        .where('sellerId', '==', userId)
        .where('disputed', '==', true)
        .limit(1)
        .get();
    if (!disputedSnap.empty) {
        throw new https_1.HttpsError('failed-precondition', 'Un litige est en cours sur l\'une de vos ventes. Les retraits sont suspendus jusqu\'à sa résolution.');
    }
    try {
        // Step 1: Atomically debit wallet + create withdrawal_requests doc
        const ledgerEntryRef = walletRef.collection('ledger').doc();
        const withdrawalRequestRef = firebase_1.db.collection('withdrawal_requests').doc();
        let newBalance;
        await firebase_1.db.runTransaction(async (tx) => {
            const walletSnap = await tx.get(walletRef);
            if (!walletSnap.exists) {
                throw new https_1.HttpsError('not-found', 'Aucun porte-monnaie trouve');
            }
            const walletData = walletSnap.data();
            if (walletData.status !== 'active') {
                throw new https_1.HttpsError('failed-precondition', 'Le porte-monnaie n\'est pas actif');
            }
            // Block withdrawals while the seller carries a debt (e.g. lost dispute
            // where funds were already withdrawn). Only `balance` is withdrawable;
            // heldBalance/pendingBalance are never touched here.
            if ((walletData.sellerDebt || 0) > 0) {
                throw new https_1.HttpsError('failed-precondition', 'Votre compte présente un solde dû. Les retraits sont suspendus.');
            }
            if (walletData.balance < amount) {
                throw new https_1.HttpsError('failed-precondition', 'Solde insuffisant');
            }
            newBalance = walletData.balance - amount;
            tx.update(walletRef, {
                balance: firebase_1.FieldValue.increment(-amount),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            tx.set(ledgerEntryRef, {
                type: 'withdrawal',
                amount,
                balanceAfter: newBalance,
                description: `Retrait vers compte bancaire ****${userData.stripeBankAccountLast4 || '****'}`,
                withdrawalRequestId: withdrawalRequestRef.id,
                createdAt: firebase_1.FieldValue.serverTimestamp(),
            });
            // Audit/tracking doc for the payout lifecycle (payout.paid/failed).
            tx.set(withdrawalRequestRef, {
                userId,
                amount,
                currency: 'cad',
                status: 'processing',
                ledgerEntryId: ledgerEntryRef.id,
                stripeAccountId,
                createdAt: firebase_1.FieldValue.serverTimestamp(),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        });
        // Step 2: Create Stripe transfer + payout
        let transfer;
        try {
            transfer = await stripe.transfers.create({
                amount,
                currency: 'cad',
                destination: stripeAccountId,
                metadata: {
                    firebaseUserId: userId,
                    walletWithdrawal: 'true',
                    withdrawalRequestId: withdrawalRequestRef.id,
                },
            }, 
            // Deterministic key tied to the (stable) ledger entry id so a retry
            // never moves the same withdrawal twice.
            { idempotencyKey: `tr_${ledgerEntryRef.id}` });
            const payout = await stripe.payouts.create({
                amount,
                currency: 'cad',
                metadata: {
                    firebaseUserId: userId,
                    walletWithdrawal: 'true',
                    // Matched by handlePayoutFailed/handlePayoutPaid to close out the
                    // withdrawal_requests doc asynchronously.
                    withdrawalRequestId: withdrawalRequestRef.id,
                },
            }, 
            // stripe-node v22 takes a SINGLE RequestOptions object: both the
            // Connect account selection (stripeAccount) and the deterministic
            // idempotencyKey live here. Tied to the stable ledger entry id so a
            // retry never pays out the same withdrawal twice.
            { stripeAccount: stripeAccountId, idempotencyKey: `po_${ledgerEntryRef.id}` });
            logger.info('Wallet withdrawal initiated', {
                userId,
                amount,
                transferId: transfer.id,
                payoutId: payout.id,
                withdrawalRequestId: withdrawalRequestRef.id,
            });
            return {
                success: true,
                newBalance: newBalance,
                transferId: transfer.id,
                payoutId: payout.id,
                withdrawalRequestId: withdrawalRequestRef.id,
            };
        }
        catch (stripeError) {
            // Stripe failed — revert wallet debit
            logger.error('Stripe transfer/payout failed — reverting wallet debit', {
                userId,
                amount,
                error: stripeError instanceof Error ? stripeError.message : stripeError,
            });
            // F09: If the transfer succeeded but payout failed, reverse the transfer
            // to prevent the user having both wallet balance (restored) AND funds
            // on their Connect account.
            if (transfer) {
                try {
                    await stripe.transfers.createReversal(transfer.id);
                    logger.info('Stripe transfer reversed after payout failure', {
                        userId,
                        transferId: transfer.id,
                    });
                }
                catch (reversalError) {
                    // If reversal also fails, log for manual reconciliation but still
                    // re-credit the wallet (user experience takes priority).
                    logger.error('CRITICAL: Failed to reverse Stripe transfer — manual reconciliation needed', {
                        userId,
                        transferId: transfer.id,
                        error: reversalError instanceof Error ? reversalError.message : reversalError,
                    });
                }
            }
            await firebase_1.db.runTransaction(async (tx) => {
                const walletSnap = await tx.get(walletRef);
                if (!walletSnap.exists)
                    return;
                tx.update(walletRef, {
                    balance: firebase_1.FieldValue.increment(amount),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                // Update ledger entry to mark as failed
                tx.update(ledgerEntryRef, {
                    description: `Retrait echoue — fonds restitues`,
                    type: 'withdrawal_failed',
                });
                // Mark the withdrawal request as failed (synchronous failure — the
                // async payout.failed handler will be a no-op since status != processing).
                tx.update(withdrawalRequestRef, {
                    status: 'failed',
                    failedAt: firebase_1.FieldValue.serverTimestamp(),
                    failureReason: stripeError instanceof Error ? stripeError.message : 'stripe_error',
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            });
            const message = stripeError instanceof Error ? stripeError.message : 'Unknown error';
            throw new https_1.HttpsError('internal', `Echec du retrait: ${message}`);
        }
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error in walletWithdraw', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to withdraw: ${message}`);
    }
});
// =============================================================================
// PAY WITH WALLET — 100% wallet payment (no Stripe charge)
// =============================================================================
/**
 * Pays for a transaction entirely from the buyer's wallet.
 * No PaymentIntent, no Stripe charge — pure Firestore transaction.
 *
 * Flow:
 * 1. Read transaction doc — verify status pending_payment, get amounts
 * 2. Read buyer's wallet — verify balance >= totalAmount
 * 3. Debit buyer's wallet
 * 4. If seller has wallet: increment seller's pendingBalance
 * 5. Mark transaction as paid with paidVia: 'wallet'
 * 6. Mark article as sold
 * 7. Create buyer ledger entry
 */
exports.payWithWallet = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'payWithWallet',
        maxCallsAuthenticated: 10,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const { transactionId } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const buyerId = request.auth.uid;
    try {
        const txRef = firebase_1.db.collection('transactions').doc(transactionId);
        const buyerWalletRef = firebase_1.db.collection('wallets').doc(buyerId);
        const result = await firebase_1.db.runTransaction(async (tx) => {
            // --- Read all docs first (Firestore requirement) ---
            const [txSnap, buyerWalletSnap] = await Promise.all([
                tx.get(txRef),
                tx.get(buyerWalletRef),
            ]);
            if (!txSnap.exists) {
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            }
            const txData = txSnap.data();
            // Verify caller is the buyer
            if (txData.buyerId !== buyerId) {
                throw new https_1.HttpsError('permission-denied', 'You are not the buyer of this transaction');
            }
            // Verify transaction status
            if (txData.status !== 'pending_payment') {
                throw new https_1.HttpsError('failed-precondition', `Cannot pay for transaction in status ${txData.status}`);
            }
            // Verify buyer has a wallet
            if (!buyerWalletSnap.exists) {
                throw new https_1.HttpsError('failed-precondition', 'Aucun porte-monnaie trouve');
            }
            const buyerWallet = buyerWalletSnap.data();
            if (buyerWallet.status !== 'active') {
                throw new https_1.HttpsError('failed-precondition', 'Le porte-monnaie n\'est pas actif');
            }
            // Calculate total in cents
            // The transaction stores amounts in dollars; convert to cents for wallet
            const totalAmountCents = Math.round((txData.totalAmount || 0) * 100);
            if (totalAmountCents <= 0) {
                throw new https_1.HttpsError('failed-precondition', 'Transaction amount is invalid');
            }
            if (buyerWallet.balance < totalAmountCents) {
                throw new https_1.HttpsError('failed-precondition', 'Solde insuffisant dans le porte-monnaie');
            }
            const sellerId = txData.sellerId;
            const isShipping = txData.deliveryType === 'shipping';
            // --- Read article to mark as sold ---
            let articleRef = null;
            if (txData.articleId) {
                articleRef = firebase_1.db.collection('articles').doc(txData.articleId);
            }
            const newBuyerBalance = buyerWallet.balance - totalAmountCents;
            // --- Writes ---
            // 1. Debit buyer wallet
            tx.update(buyerWalletRef, {
                balance: firebase_1.FieldValue.increment(-totalAmountCents),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            // 2. Credit seller wallet pendingBalance.
            // P1 (atomicity payment<->label): for SHIPPING transactions defer the
            // seller credit until the shipping label is created (label step /
            // sweepPendingLabels). Crediting then failing the label would pay the
            // seller for a parcel that never ships. For non-shipping there is no
            // label, so credit immediately. creditSellerForSale also persists
            // sellerCreditedCents (the exact amount for an accurate refund debit).
            if (!isShipping) {
                await (0, labelFulfillment_1.creditSellerForSale)(tx, txRef, txData, transactionId);
            }
            // 3. Mark transaction as paid
            tx.update(txRef, {
                status: 'paid',
                paidAt: firebase_1.FieldValue.serverTimestamp(),
                paidVia: 'wallet',
                walletAmountUsed: totalAmountCents,
            });
            // 4. Mark article as sold
            if (articleRef) {
                tx.update(articleRef, {
                    isSold: true,
                    soldAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            // 5. Create buyer ledger entry
            const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
            tx.set(buyerLedgerRef, {
                type: 'purchase_debit',
                amount: totalAmountCents,
                balanceAfter: newBuyerBalance,
                description: `Achat article`,
                transactionId,
                createdAt: firebase_1.FieldValue.serverTimestamp(),
            });
            return {
                newBalance: newBuyerBalance,
                sellerId,
                chatId: txData.chatId,
                deliveryType: txData.deliveryType,
                shipEngineRateId: txData.shipEngineRateId || null,
                shippingCost: typeof txData.shippingCost === 'number' ? txData.shippingCost : 0,
                articleId: txData.articleId || null,
                articleTitle: txData.articleTitle || null,
            };
        });
        // =====================================================================
        // SHIPPING LABEL (for shipping transactions — mirrors webhook logic)
        // =====================================================================
        if (result.deliveryType === 'shipping') {
            const rateId = result.shipEngineRateId;
            // Guard: reject fallback rateIds generated by the client. The seller is
            // NOT credited (deferred above) and the transaction stays 'paid' for the
            // sweep job to re-rate + retry.
            if (rateId && rateId.startsWith('fallback_')) {
                logger.warn('payWithWallet: fallback rateId detected — deferring to sweepPendingLabels', {
                    transactionId,
                    rateId,
                });
                await txRef.update({
                    labelCreationPending: true,
                    labelCreationNote: `Fallback rateId "${rateId}" — re-rate + retry required`,
                });
            }
            else {
                const shipEngine = (0, shipEngine_1.getShipEngine)();
                if (shipEngine && rateId) {
                    try {
                        const label = await shipEngine.createLabel(rateId);
                        // ATOMIC: credit the seller now that the label exists, reconcile
                        // the real label cost vs the estimated shippingCost, persist label
                        // fields, clear the pending flag, and mark 'label_created'.
                        // NOTE: 'label_created', NOT 'shipped' — the carrier hasn't scanned
                        // the parcel yet. The first real scan (poller / ShipEngine webhook)
                        // advances label_created -> shipped.
                        await firebase_1.db.runTransaction(async (tx) => {
                            const txSnap = await tx.get(txRef);
                            const tdata = txSnap.data();
                            if (!tdata)
                                return;
                            if (tdata.status === 'label_created' ||
                                tdata.status === 'shipped' ||
                                tdata.status === 'delivered')
                                return;
                            await (0, labelFulfillment_1.creditSellerForSale)(tx, txRef, tdata, transactionId);
                            const update = {
                                trackingNumber: label.trackingNumber,
                                shippingLabelUrl: label.labelDownload.href,
                                trackingUrl: label.trackingUrl,
                                carrierCode: label.carrierCode,
                                trackingStatus: 'LABEL_CREATED',
                                shipEngineLabelId: label.labelId,
                                status: 'label_created',
                                labelCreatedAt: firebase_1.FieldValue.serverTimestamp(),
                                labelCreationPending: false,
                            };
                            (0, labelFulfillment_1.reconcileShippingCost)(label, result.shippingCost, transactionId, update);
                            tx.update(txRef, update);
                        });
                        logger.info('payWithWallet: ShipEngine label created — seller credited, transaction marked shipped', {
                            transactionId,
                            trackingNumber: label.trackingNumber,
                            carrierCode: label.carrierCode,
                        });
                        // Send system message with tracking info
                        if (result.chatId) {
                            let participants = [];
                            try {
                                const chatSnap = await firebase_1.db.collection('chats').doc(result.chatId).get();
                                if (chatSnap.exists) {
                                    participants = ((_b = chatSnap.data()) === null || _b === void 0 ? void 0 : _b.participants) || [];
                                }
                            }
                            catch (lookupErr) {
                                logger.warn('payWithWallet: Could not load chat participants', {
                                    chatId: result.chatId,
                                    error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
                                });
                            }
                            await firebase_1.db.collection('messages').add({
                                chatId: result.chatId,
                                senderId: 'system',
                                receiverId: 'system',
                                type: 'system',
                                content: `Paiement confirme !\n\nNumero de suivi: ${label.trackingNumber}\nEtiquette: disponible dans les details de la commande.\n\nLe vendeur peut maintenant expedier l'article.`,
                                participants,
                                timestamp: firebase_1.FieldValue.serverTimestamp(),
                                status: 'sent',
                                isRead: true,
                                shippingLabel: {
                                    labelUrl: label.labelDownload.href,
                                    trackingNumber: label.trackingNumber,
                                    trackingUrl: label.trackingUrl,
                                },
                            });
                        }
                    }
                    catch (labelError) {
                        logger.error('payWithWallet: Error creating ShipEngine label (will retry manually)', {
                            transactionId,
                            error: labelError instanceof Error ? labelError.message : labelError,
                        });
                        await txRef.update({
                            labelCreationPending: true,
                            labelCreationNote: 'ShipEngine createLabel failed — retry needed',
                        }).catch((err) => {
                            logger.error('payWithWallet: Failed to flag labelCreationPending', {
                                transactionId,
                                error: err instanceof Error ? err.message : err,
                            });
                        });
                    }
                }
                else if (!rateId) {
                    logger.warn('payWithWallet: no shipEngineRateId on shipping transaction', {
                        transactionId,
                    });
                    await txRef.update({
                        labelCreationPending: true,
                        labelCreationNote: 'No shipEngineRateId — label must be created manually',
                    });
                }
            }
        }
        logger.info('Wallet payment completed', {
            transactionId,
            buyerId,
            newBalance: result.newBalance,
        });
        return {
            success: true,
            newBalance: result.newBalance,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error in payWithWallet', { buyerId, transactionId, error: message });
        throw new https_1.HttpsError('internal', `Failed to pay with wallet: ${message}`);
    }
});
// =============================================================================
// REFUND WALLET PAYMENT — Refund a 100% wallet transaction
// =============================================================================
/**
 * Refunds a transaction that was paid 100% via wallet.
 * These transactions have no stripePaymentIntentId, so the charge.refunded
 * webhook can never trigger for them. This callable provides the refund path.
 *
 * Flow:
 * 1. Validate transaction: exists, paidVia === 'wallet', refundable status
 * 2. Atomically in runTransaction:
 *    a. Credit buyer's wallet (refund_credit ledger entry)
 *    b. Debit seller's wallet (pendingBalance or balance)
 *    c. Mark transaction as 'refunded'
 *    d. Release article (isSold = false)
 *
 * Authorization: buyer of the transaction OR admin.
 */
exports.refundWalletPayment = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const callerUid = request.auth.uid;
    const isAdmin = request.auth.token.admin === true;
    try {
        const txRef = firebase_1.db.collection('transactions').doc(transactionId);
        await firebase_1.db.runTransaction(async (tx) => {
            // --- All reads first ---
            const txSnap = await tx.get(txRef);
            if (!txSnap.exists) {
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            }
            const txData = txSnap.data();
            // Authorization: buyer or admin
            if (txData.buyerId !== callerUid && !isAdmin) {
                throw new https_1.HttpsError('permission-denied', 'Only the buyer or an admin can refund this transaction');
            }
            // Must be a 100% wallet payment
            if (txData.paidVia !== 'wallet') {
                throw new https_1.HttpsError('failed-precondition', 'This function only handles 100% wallet payments. For card/mixed payments, use Stripe refund.');
            }
            // Idempotence — check before refundable status
            if (txData.status === 'refunded') {
                return;
            }
            // Must be in a refundable status
            const refundableStatuses = new Set(['paid', 'shipped', 'delivered', 'meetup_completed']);
            if (!refundableStatuses.has(txData.status)) {
                throw new https_1.HttpsError('failed-precondition', `Cannot refund transaction in status ${txData.status}`);
            }
            const buyerId = txData.buyerId;
            const sellerId = txData.sellerId;
            const totalAmountCents = txData.walletAmountUsed || Math.round((txData.totalAmount || 0) * 100);
            // P1: debit the EXACT amount credited to the seller (persisted at credit
            // time). Under the deferred-credit model an uncredited shipping tx still
            // 'paid' with labelCreationPending has no sellerCreditedCents and so a
            // debit target of 0 — debiting would create false sellerDebt.
            const sellerDebitTarget = typeof txData.sellerCreditedCents === 'number' ? txData.sellerCreditedCents : 0;
            // Read buyer wallet
            const buyerWalletRef = firebase_1.db.collection('wallets').doc(buyerId);
            const buyerWalletSnap = await tx.get(buyerWalletRef);
            // Read seller wallet
            const sellerWalletRef = firebase_1.db.collection('wallets').doc(sellerId);
            const sellerWalletSnap = await tx.get(sellerWalletRef);
            // Read article
            let articleRef = null;
            let articleSnap = null;
            if (txData.articleId) {
                articleRef = firebase_1.db.collection('articles').doc(txData.articleId);
                articleSnap = await tx.get(articleRef);
            }
            // --- All writes ---
            // 1. Credit buyer's wallet
            if (buyerWalletSnap.exists) {
                const buyerWalletData = buyerWalletSnap.data();
                tx.update(buyerWalletRef, {
                    balance: firebase_1.FieldValue.increment(totalAmountCents),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
                tx.set(buyerLedgerRef, {
                    type: 'refund_credit',
                    amount: totalAmountCents,
                    balanceAfter: (buyerWalletData.balance || 0) + totalAmountCents,
                    description: 'Remboursement — retour au porte-monnaie',
                    transactionId,
                    createdAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            // 2. Debit seller wallet of EXACTLY what was credited.
            // P1: cascade across the three buckets in escrow order
            // pendingBalance -> heldBalance -> balance. Any remainder the seller no
            // longer holds (already withdrawn) becomes sellerDebt and blocks future
            // withdrawals until recovered — NEVER masked with min().
            if (sellerDebitTarget > 0) {
                if (sellerWalletSnap.exists) {
                    const sellerWalletData = sellerWalletSnap.data();
                    const pendingNow = sellerWalletData.pendingBalance || 0;
                    const heldNow = sellerWalletData.heldBalance || 0;
                    const balanceNow = sellerWalletData.balance || 0;
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
                            ? 'Remboursement — débit vendeur (dette enregistrée pour le solde manquant)'
                            : 'Remboursement — débit vendeur', transactionId, createdAt: firebase_1.FieldValue.serverTimestamp() }, (shortfall > 0 && { debtRecorded: shortfall })));
                    if (shortfall > 0) {
                        logger.warn('[refundWalletPayment] Seller balance insufficient — debt recorded', {
                            transactionId,
                            sellerId,
                            debitTarget: sellerDebitTarget,
                            debited,
                            shortfall,
                        });
                    }
                }
                else {
                    logger.warn('[refundWalletPayment] Seller wallet not found — recording full debt', {
                        transactionId,
                        sellerId,
                        debitTarget: sellerDebitTarget,
                    });
                    tx.set(sellerWalletRef, {
                        sellerDebt: firebase_1.FieldValue.increment(sellerDebitTarget),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
                    tx.set(sellerLedgerRef, {
                        type: 'refund_debit',
                        amount: 0,
                        balanceAfter: 0,
                        description: 'Remboursement — porte-monnaie absent, dette enregistrée',
                        transactionId,
                        createdAt: firebase_1.FieldValue.serverTimestamp(),
                        debtRecorded: sellerDebitTarget,
                    });
                }
            }
            // 3. Mark transaction as refunded
            tx.update(txRef, {
                status: 'refunded',
                refundedAt: firebase_1.FieldValue.serverTimestamp(),
                refundedVia: 'wallet',
            });
            // 4. Release article
            if (articleRef && articleSnap && articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
            }
        });
        logger.info('Wallet payment refunded', { transactionId, callerUid });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error in refundWalletPayment', { transactionId, callerUid, error: message });
        throw new https_1.HttpsError('internal', `Failed to refund wallet payment: ${message}`);
    }
});
//# sourceMappingURL=wallet.js.map