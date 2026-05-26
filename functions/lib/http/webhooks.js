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
exports.stripeWebhook = void 0;
/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 *
 * Stripe webhook: payment confirmation + ShipEngine label creation
 * Stripe Connect account status updates
 *
 * CRITICAL: All Firestore mutations (transaction status, article sold,
 * seller_balance credit) are wrapped in a single runTransaction for
 * atomicity. The idempotence check is INSIDE the transaction to prevent
 * race conditions from concurrent webhook replays.
 *
 * ShipEngine label creation (external network call) runs AFTER the
 * transaction — it is not atomic but can be safely retried/recreated
 * manually without financial inconsistency.
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const shipEngine_1 = require("../config/shipEngine");
const stripe_1 = require("../config/stripe");
const notifications_1 = require("../utils/notifications");
// =============================================================================
// STRIPE WEBHOOK — Payment confirmed + Account updates
// =============================================================================
/**
 * Stripe calls this endpoint for payment and account events.
 *
 * Handled events:
 * - payment_intent.succeeded: Mark transaction paid, credit seller, create label
 * - payment_intent.payment_failed: Cancel transaction, release article
 * - charge.dispute.created: Mark transaction disputed
 * - charge.refunded: Mark transaction refunded, decrement seller balance
 * - account.updated: Update seller's Connect account status in Firestore
 *
 * Flow for payment_intent.succeeded:
 * 1. Verify webhook signature (Stripe constructEvent)
 * 2. Atomic transaction: idempotence check + mark paid + mark sold + credit seller
 * 3. Create shipping label via ShipEngine (non-atomic, retry-safe)
 * 4. Send system message with tracking info
 */
exports.stripeWebhook = (0, https_1.onRequest)({
    region: 'northamerica-northeast1',
    cors: false,
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SHIPENGINE_API_KEY'],
}, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        logger.error('Stripe webhook: Stripe not configured');
        res.status(500).send('Stripe not configured');
        return;
    }
    // =========================================================================
    // SIGNATURE VERIFICATION
    // =========================================================================
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    if (endpointSecret && sig) {
        // Production path: verify signature
        try {
            event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            logger.error('Stripe webhook: signature verification failed', { error: message });
            res.status(401).send(`Webhook signature verification failed: ${message}`);
            return;
        }
    }
    else if (!endpointSecret) {
        // Webhook secret not yet configured — accept but log warning
        // This path exists only during initial setup; once STRIPE_WEBHOOK_SECRET
        // is set in Secret Manager, this branch is never taken.
        logger.warn('Stripe webhook: STRIPE_WEBHOOK_SECRET not configured, accepting without signature verification');
        event = req.body;
    }
    else {
        logger.error('Stripe webhook: missing stripe-signature header');
        res.status(401).send('Missing stripe-signature header');
        return;
    }
    try {
        const eventType = event.type;
        // =======================================================================
        // PAYMENT_INTENT.SUCCEEDED
        // =======================================================================
        if (eventType === 'payment_intent.succeeded') {
            await handlePaymentIntentSucceeded(event.data.object);
        }
        // =======================================================================
        // PAYMENT_INTENT.PAYMENT_FAILED
        // =======================================================================
        else if (eventType === 'payment_intent.payment_failed') {
            await handlePaymentIntentFailed(event.data.object);
        }
        // =======================================================================
        // CHARGE.DISPUTE.CREATED — Buyer opened a dispute
        // =======================================================================
        else if (eventType === 'charge.dispute.created') {
            await handleDisputeCreated(event.data.object);
        }
        // =======================================================================
        // CHARGE.REFUNDED — Full or partial refund processed
        // =======================================================================
        else if (eventType === 'charge.refunded') {
            await handleChargeRefunded(event.data.object);
        }
        // =======================================================================
        // ACCOUNT.UPDATED — Seller's Connect account status changed
        // =======================================================================
        else if (eventType === 'account.updated') {
            await handleAccountUpdated(event.data.object);
        }
        // =======================================================================
        // UNHANDLED EVENT
        // =======================================================================
        else {
            logger.info('Stripe webhook: unhandled event type', { eventType });
        }
        res.json({ received: true });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error processing Stripe webhook', { error: message });
        res.status(500).send(`Webhook processing error: ${message}`);
    }
});
// =============================================================================
// HANDLER: payment_intent.succeeded
// =============================================================================
async function handlePaymentIntentSucceeded(paymentIntent) {
    var _a, _b;
    const transactionId = (_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.transactionId;
    if (!transactionId) {
        logger.error('Stripe webhook: PaymentIntent missing transactionId in metadata', {
            paymentIntentId: paymentIntent.id,
        });
        return;
    }
    // Sanity bounds: Firestore doc IDs are 1-1500 chars, cannot contain '/'
    if (typeof transactionId !== 'string' ||
        transactionId.length === 0 ||
        transactionId.length > 200 ||
        transactionId.includes('/')) {
        logger.error('Stripe webhook: invalid transactionId shape', { transactionId });
        return;
    }
    // Amount received (in cents) — convert to dollars for verification
    const amountReceivedCents = paymentIntent.amount_received || paymentIntent.amount;
    const amountReceivedDollars = amountReceivedCents / 100;
    const transactionRef = firebase_1.db.collection('transactions').doc(transactionId);
    // =====================================================================
    // ATOMIC TRANSACTION: idempotence + mark paid + mark sold + credit seller
    // =====================================================================
    const result = await firebase_1.db.runTransaction(async (tx) => {
        const txSnap = await tx.get(transactionRef);
        const txData = txSnap.data();
        if (!txData) {
            logger.error('Stripe webhook: transaction not found', { transactionId });
            return { processed: false, reason: 'transaction_not_found' };
        }
        // SECURITY: Verify the paid amount matches what we expect.
        const expectedAmount = txData.totalAmount;
        if (expectedAmount != null && Math.abs(amountReceivedDollars - expectedAmount) > 0.01) {
            logger.error('Stripe webhook: amount mismatch', {
                transactionId,
                received: amountReceivedDollars,
                expected: expectedAmount,
            });
            throw new Error('Payment amount does not match transaction total');
        }
        // IDEMPOTENCE: If already paid/shipped/delivered, do nothing (replay protection).
        // Also reject cancelled transactions.
        const currentStatus = txData.status;
        if (currentStatus === 'paid' ||
            currentStatus === 'shipped' ||
            currentStatus === 'delivered' ||
            currentStatus === 'cancelled') {
            logger.info('Stripe webhook: transaction already processed', {
                transactionId,
                currentStatus,
            });
            return { processed: false, reason: 'already_processed' };
        }
        // --- Mark transaction as paid ---
        tx.update(transactionRef, {
            status: 'paid',
            paidAt: firebase_1.FieldValue.serverTimestamp(),
            stripePaymentIntentId: paymentIntent.id,
            stripeChargeId: paymentIntent.latest_charge || null,
        });
        // --- Mark article as sold ---
        if (txData.articleId) {
            const articleRef = firebase_1.db.collection('articles').doc(txData.articleId);
            tx.update(articleRef, {
                isSold: true,
                soldAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
        // --- Credit seller's pending balance ---
        const sellerId = txData.sellerId;
        const sellerPayout = txData.sellerPayout || txData.amount;
        const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
        const sellerBalanceSnap = await tx.get(sellerBalanceRef);
        const saleTransaction = {
            id: transactionId,
            type: 'sale',
            amount: sellerPayout,
            description: `Vente de l'article`,
            createdAt: firebase_1.FieldValue.serverTimestamp(),
            status: 'pending',
        };
        if (!sellerBalanceSnap.exists) {
            // Initialize totalEarnings to sellerPayout (not 0) because this IS
            // a sale — the amount is pending delivery confirmation but it still
            // counts as an earning for the seller's dashboard display.
            tx.set(sellerBalanceRef, {
                userId: sellerId,
                availableBalance: 0,
                pendingBalance: sellerPayout,
                totalEarnings: sellerPayout,
                transactions: [saleTransaction],
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
        else {
            tx.update(sellerBalanceRef, {
                pendingBalance: firebase_1.FieldValue.increment(sellerPayout),
                transactions: firebase_1.FieldValue.arrayUnion(saleTransaction),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
        return {
            processed: true,
            sellerId,
            chatId: txData.chatId,
            shipEngineRateId: txData.shipEngineRateId,
            deliveryType: txData.deliveryType,
            articleId: txData.articleId,
            articleTitle: txData.articleTitle || null,
        };
    });
    if (!result.processed) {
        logger.info('Stripe webhook: skipping post-processing', {
            transactionId,
            reason: result.reason,
        });
        return;
    }
    logger.info('Stripe webhook: payment confirmed, atomic mutations committed', {
        transactionId,
        paymentIntentId: paymentIntent.id,
    });
    // =====================================================================
    // SHIPPING LABEL (non-atomic, external call — safe to retry separately)
    // =====================================================================
    let trackingNumber = '';
    let labelUrl = '';
    let trackingUrl = '';
    let carrierCode = '';
    if (result.deliveryType === 'shipping') {
        const rateId = result.shipEngineRateId;
        // Guard: reject fallback rateIds generated by the client when ShipEngine
        // was unreachable. These are not real ShipEngine rate IDs and will fail
        // label creation. Flag the transaction for manual label creation instead.
        if (rateId && rateId.startsWith('fallback_')) {
            logger.warn('Stripe webhook: fallback rateId detected — skipping label creation', {
                transactionId,
                rateId,
            });
            await firebase_1.db.collection('transactions').doc(transactionId).update({
                labelCreationPending: true,
                labelCreationNote: `Fallback rateId "${rateId}" — label must be created manually`,
                status: 'paid',
            });
        }
        else {
            const shipEngine = (0, shipEngine_1.getShipEngine)();
            if (shipEngine && rateId) {
                try {
                    const label = await shipEngine.createLabel(rateId);
                    trackingNumber = label.trackingNumber;
                    labelUrl = label.labelDownload.href;
                    trackingUrl = label.trackingUrl;
                    carrierCode = label.carrierCode;
                    // Correction #3: also set status to 'shipped' when label is created
                    await firebase_1.db.collection('transactions').doc(transactionId).update({
                        trackingNumber,
                        shippingLabelUrl: labelUrl,
                        trackingUrl,
                        carrierCode,
                        trackingStatus: 'TRANSIT',
                        shipEngineLabelId: label.labelId,
                        status: 'shipped',
                        shippedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    logger.info('ShipEngine label created — transaction marked shipped', {
                        transactionId,
                        trackingNumber,
                        carrierCode,
                    });
                }
                catch (labelError) {
                    logger.error('Error creating ShipEngine label (will retry manually)', {
                        transactionId,
                        error: labelError instanceof Error ? labelError.message : labelError,
                    });
                    // Payment is still valid — label can be created manually later
                    // Flag for manual creation
                    await firebase_1.db.collection('transactions').doc(transactionId).update({
                        labelCreationPending: true,
                        labelCreationNote: 'ShipEngine createLabel failed — retry needed',
                    }).catch((err) => {
                        logger.error('Failed to flag labelCreationPending', {
                            transactionId,
                            error: err instanceof Error ? err.message : err,
                        });
                    });
                }
            }
        }
    }
    // =====================================================================
    // SYSTEM MESSAGE: Send shipping/tracking info to chat
    // =====================================================================
    const chatId = result.chatId;
    if (chatId) {
        const labelInfo = trackingNumber
            ? `\n\nNumero de suivi: ${trackingNumber}\nEtiquette: disponible dans les details de la commande.`
            : '\n\nL\'etiquette d\'expedition sera disponible sous peu.';
        let participants = [];
        try {
            const chatSnap = await firebase_1.db.collection('chats').doc(chatId).get();
            if (chatSnap.exists) {
                participants = ((_b = chatSnap.data()) === null || _b === void 0 ? void 0 : _b.participants) || [];
            }
        }
        catch (lookupErr) {
            logger.warn('Could not load chat participants', {
                chatId,
                error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
            });
        }
        await firebase_1.db.collection('messages').add(Object.assign({ chatId, senderId: 'system', receiverId: 'system', type: 'system', content: `Paiement confirme !${labelInfo}\n\nLe vendeur peut maintenant expedier l'article.`, participants, timestamp: firebase_1.FieldValue.serverTimestamp(), status: 'sent', isRead: true }, (trackingNumber && {
            shippingLabel: {
                labelUrl,
                trackingNumber,
                trackingUrl,
            },
        })));
    }
    // =====================================================================
    // PUSH NOTIFICATION: Notify seller of new sale
    // =====================================================================
    try {
        const articleTitle = result.articleTitle || 'un article';
        await (0, notifications_1.sendPushNotification)(result.sellerId, 'Nouvelle vente !', `Vous avez vendu ${articleTitle}. Preparez l'envoi.`, { transactionId, articleId: result.articleId || '' }, 'new_sale');
        logger.info('Stripe webhook: seller notification sent', {
            transactionId,
            sellerId: result.sellerId,
        });
    }
    catch (notifError) {
        // Non-critical: payment is already confirmed, don't fail the webhook
        logger.warn('Stripe webhook: failed to send seller notification', {
            transactionId,
            error: notifError instanceof Error ? notifError.message : notifError,
        });
    }
    logger.info('Stripe webhook: fully processed', { transactionId });
}
// =============================================================================
// HANDLER: payment_intent.payment_failed
// =============================================================================
async function handlePaymentIntentFailed(paymentIntent) {
    var _a, _b;
    const transactionId = (_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.transactionId;
    if (!transactionId) {
        logger.error('Stripe webhook: payment_failed PaymentIntent missing transactionId in metadata', {
            paymentIntentId: paymentIntent.id,
        });
        return;
    }
    if (typeof transactionId !== 'string' ||
        transactionId.length === 0 ||
        transactionId.length > 200 ||
        transactionId.includes('/')) {
        logger.error('Stripe webhook: payment_failed invalid transactionId shape', { transactionId });
        return;
    }
    const transactionRef = firebase_1.db.collection('transactions').doc(transactionId);
    await firebase_1.db.runTransaction(async (tx) => {
        const txSnap = await tx.get(transactionRef);
        const txData = txSnap.data();
        if (!txData) {
            logger.error('Stripe webhook: payment_failed transaction not found', { transactionId });
            return;
        }
        // Idempotence: only cancel if still in a pre-payment status
        const cancellableStatuses = new Set(['pending_payment', 'pending']);
        if (!cancellableStatuses.has(txData.status)) {
            logger.info('Stripe webhook: payment_failed skipping — transaction not in cancellable status', {
                transactionId,
                currentStatus: txData.status,
            });
            return;
        }
        // Cancel the transaction
        tx.update(transactionRef, {
            status: 'cancelled',
            cancelledAt: firebase_1.FieldValue.serverTimestamp(),
            cancelReason: 'payment_failed',
        });
        // Release the article so it can be purchased again
        if (txData.articleId) {
            const articleRef = firebase_1.db.collection('articles').doc(txData.articleId);
            const articleSnap = await tx.get(articleRef);
            if (articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
            }
        }
    });
    const failureMessage = ((_b = paymentIntent.last_payment_error) === null || _b === void 0 ? void 0 : _b.message) || 'Unknown failure';
    logger.error('Stripe webhook: payment failed — transaction cancelled', {
        transactionId,
        paymentIntentId: paymentIntent.id,
        failureMessage,
    });
}
// =============================================================================
// HANDLER: charge.dispute.created
// =============================================================================
async function handleDisputeCreated(dispute) {
    // The dispute object contains a payment_intent field
    const paymentIntentId = dispute.payment_intent;
    if (!paymentIntentId) {
        logger.error('Stripe webhook: dispute missing payment_intent', {
            disputeId: dispute.id,
        });
        return;
    }
    // Look up the transaction by stripePaymentIntentId
    const txQuery = await firebase_1.db
        .collection('transactions')
        .where('stripePaymentIntentId', '==', paymentIntentId)
        .limit(1)
        .get();
    if (txQuery.empty) {
        logger.error('Stripe webhook: dispute — no transaction found for PaymentIntent', {
            disputeId: dispute.id,
            paymentIntentId,
        });
        return;
    }
    const txDoc = txQuery.docs[0];
    const transactionId = txDoc.id;
    await firebase_1.db.runTransaction(async (tx) => {
        const txSnap = await tx.get(txDoc.ref);
        const txData = txSnap.data();
        if (!txData)
            return;
        // Idempotence: if already disputed or refunded, skip
        if (txData.status === 'disputed' || txData.status === 'refunded') {
            logger.info('Stripe webhook: dispute skipping — already in terminal status', {
                transactionId,
                currentStatus: txData.status,
            });
            return;
        }
        tx.update(txDoc.ref, {
            status: 'disputed',
            disputeId: dispute.id,
            disputedAt: firebase_1.FieldValue.serverTimestamp(),
            disputeReason: dispute.reason || null,
        });
    });
    logger.warn('Stripe webhook: dispute created — transaction marked disputed', {
        transactionId,
        disputeId: dispute.id,
        reason: dispute.reason,
        amount: dispute.amount,
    });
}
// =============================================================================
// HANDLER: charge.refunded
// =============================================================================
async function handleChargeRefunded(charge) {
    const paymentIntentId = charge.payment_intent;
    if (!paymentIntentId) {
        logger.error('Stripe webhook: refund missing payment_intent on charge', {
            chargeId: charge.id,
        });
        return;
    }
    // Look up the transaction by stripePaymentIntentId
    const txQuery = await firebase_1.db
        .collection('transactions')
        .where('stripePaymentIntentId', '==', paymentIntentId)
        .limit(1)
        .get();
    if (txQuery.empty) {
        logger.error('Stripe webhook: refund — no transaction found for PaymentIntent', {
            chargeId: charge.id,
            paymentIntentId,
        });
        return;
    }
    const txDoc = txQuery.docs[0];
    const transactionId = txDoc.id;
    await firebase_1.db.runTransaction(async (tx) => {
        var _a, _b, _c;
        const txSnap = await tx.get(txDoc.ref);
        const txData = txSnap.data();
        if (!txData)
            return;
        // Idempotence: if already refunded, skip
        if (txData.status === 'refunded') {
            logger.info('Stripe webhook: refund skipping — already refunded', { transactionId });
            return;
        }
        // Mark transaction as refunded
        tx.update(txDoc.ref, {
            status: 'refunded',
            refundedAt: firebase_1.FieldValue.serverTimestamp(),
            stripeRefundId: ((_c = (_b = (_a = charge.refunds) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.id) || null,
        });
        // Decrement seller balance
        const sellerId = txData.sellerId;
        const sellerPayout = txData.sellerPayout || txData.amount;
        const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
        const sellerBalanceSnap = await tx.get(sellerBalanceRef);
        if (sellerBalanceSnap.exists) {
            const balanceData = sellerBalanceSnap.data();
            // Determine which balance to decrement based on transaction status
            // If the funds were already available (delivered), decrement availableBalance.
            // If still pending (paid but not delivered), decrement pendingBalance.
            const previousStatus = txData.status;
            const wasDelivered = previousStatus === 'delivered' || previousStatus === 'meetup_completed';
            if (wasDelivered) {
                // Guard against going negative
                const currentAvailable = balanceData.availableBalance || 0;
                const deduction = Math.min(sellerPayout, currentAvailable);
                tx.update(sellerBalanceRef, {
                    availableBalance: firebase_1.FieldValue.increment(-deduction),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            else {
                // Funds still in pending
                const currentPending = balanceData.pendingBalance || 0;
                const deduction = Math.min(sellerPayout, currentPending);
                tx.update(sellerBalanceRef, {
                    pendingBalance: firebase_1.FieldValue.increment(-deduction),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
        }
        // Release the article
        if (txData.articleId) {
            const articleRef = firebase_1.db.collection('articles').doc(txData.articleId);
            const articleSnap = await tx.get(articleRef);
            if (articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
            }
        }
    });
    logger.warn('Stripe webhook: charge refunded — transaction marked refunded, seller balance decremented', {
        transactionId,
        chargeId: charge.id,
        paymentIntentId,
    });
}
// =============================================================================
// HANDLER: account.updated
// =============================================================================
async function handleAccountUpdated(account) {
    var _a, _b;
    const stripeAccountId = account.id;
    if (!stripeAccountId) {
        logger.warn('Stripe webhook: account.updated missing account id');
        return;
    }
    // Find the user with this Stripe account
    const usersQuery = await firebase_1.db
        .collection('users')
        .where('stripeAccountId', '==', stripeAccountId)
        .limit(1)
        .get();
    if (usersQuery.empty) {
        logger.info('Stripe webhook: no user found for Stripe account', { stripeAccountId });
        return;
    }
    const userDoc = usersQuery.docs[0];
    // Determine status — works for both Standard and Custom accounts.
    // For Custom accounts, charges_enabled becomes true once capabilities
    // are active and payouts_enabled becomes true once a bank account is
    // attached and verified.
    let status;
    if (account.charges_enabled && account.payouts_enabled) {
        status = 'active';
    }
    else if (account.charges_enabled) {
        // Custom accounts: charges enabled but no bank account yet
        status = 'partially_active';
    }
    else if (account.details_submitted) {
        status = 'pending_verification';
    }
    else {
        status = 'pending';
    }
    // Check if external accounts (bank accounts) are attached
    const hasExternalAccount = ((_b = (_a = account.external_accounts) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.length) > 0 ||
        false;
    const updateData = {
        stripeAccountStatus: status,
        stripeChargesEnabled: account.charges_enabled || false,
        stripePayoutsEnabled: account.payouts_enabled || false,
        stripeDetailsSubmitted: account.details_submitted || false,
    };
    // Track external account status for Custom accounts
    if (hasExternalAccount) {
        updateData.stripeBankAccountAdded = true;
    }
    await userDoc.ref.update(updateData);
    logger.info('Stripe webhook: seller account status updated', {
        userId: userDoc.id,
        stripeAccountId,
        status,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        hasExternalAccount,
    });
}
//# sourceMappingURL=webhooks.js.map