"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelPendingTransaction = exports.requestWithdrawal = exports.checkTrackingStatus = exports.findPickupPoints = exports.createHelcimCheckout = exports.getServiceFee = exports.getShippingEstimate = void 0;
/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 *
 * Shipping via ShipEngine (Intelcom + Canada Post)
 * Payment via Helcim (HelcimPay.js checkout)
 * Commission via service fee calculation
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const shipEngine_1 = require("../config/shipEngine");
const helcim_1 = require("../config/helcim");
const fees_1 = require("../utils/fees");
// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================
exports.getShippingEstimate = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { fromAddress, toAddress, weight, dimensions } = request.data;
    if (!fromAddress || !toAddress) {
        throw new https_1.HttpsError('invalid-argument', 'From and to addresses are required');
    }
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
    }
    try {
        const parcelWeight = parseFloat(weight) || 0.5;
        const parcelLength = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.length) || 30;
        const parcelWidth = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.width) || 25;
        const parcelHeight = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.height) || 10;
        console.log('📦 Getting ShipEngine multi-carrier rates:', {
            from: fromAddress.postalCode,
            to: toAddress.postalCode,
            weight: parcelWeight,
        });
        // Rate shopping across Intelcom + Canada Post via ShipEngine
        const rates = await shipEngine.getRates({
            name: fromAddress.name || 'Vendeur',
            addressLine1: fromAddress.street || '',
            cityLocality: fromAddress.city || '',
            stateProvince: fromAddress.province || 'QC',
            postalCode: fromAddress.postalCode,
            countryCode: 'CA',
        }, {
            name: toAddress.name || 'Acheteur',
            addressLine1: toAddress.street || '',
            cityLocality: toAddress.city || '',
            stateProvince: toAddress.province || 'QC',
            postalCode: toAddress.postalCode,
            countryCode: 'CA',
        }, {
            weight: { value: parcelWeight, unit: 'kilogram' },
            dimensions: {
                length: parcelLength,
                width: parcelWidth,
                height: parcelHeight,
                unit: 'centimeter',
            },
        });
        // Format rates for the client
        const formattedRates = rates
            .sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount)
            .slice(0, 5)
            .map((rate) => ({
            rateId: rate.rateId,
            carrier: rate.carrierFriendlyName,
            carrierCode: rate.carrierCode,
            serviceName: rate.serviceType,
            estimatedDays: `${rate.estimatedDeliveryDays} jour${rate.estimatedDeliveryDays > 1 ? 's' : ''} ouvrable${rate.estimatedDeliveryDays > 1 ? 's' : ''}`,
            amount: rate.shippingAmount.amount,
            currency: rate.shippingAmount.currency,
            deliveryType: rate.deliveryType,
        }));
        console.log(`✅ Retrieved ${formattedRates.length} shipping rates from ShipEngine`);
        return {
            success: true,
            rates: formattedRates,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting shipping estimate:', error);
        throw new https_1.HttpsError('internal', `Failed to get shipping estimate: ${message}`);
    }
});
// =============================================================================
// GET SERVICE FEE — Returns fee info for client display
// =============================================================================
exports.getServiceFee = (0, https_1.onCall)(async (request) => {
    const { articlePrice } = request.data;
    if (!articlePrice || articlePrice <= 0) {
        throw new https_1.HttpsError('invalid-argument', 'Article price is required');
    }
    const serviceFee = (0, fees_1.calculateServiceFee)(articlePrice);
    const config = (0, fees_1.getServiceFeeConfig)();
    return {
        success: true,
        serviceFee,
        serviceFeePercent: config.percent,
        serviceFeeFixed: config.fixed,
        serviceFeeMin: config.min,
    };
});
// =============================================================================
// CREATE HELCIM CHECKOUT — Initialize HelcimPay.js session
// =============================================================================
exports.createHelcimCheckout = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { transactionId } = request.data;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (!transactionId) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const helcim = (0, helcim_1.getHelcim)();
    if (!helcim) {
        throw new https_1.HttpsError('failed-precondition', 'Helcim API not configured');
    }
    try {
        // Get transaction details
        const transactionDoc = await firebase_1.db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Transaction not found');
        }
        const transaction = transactionDoc.data();
        // Verify the user is the buyer
        if (transaction.buyerId !== request.auth.uid) {
            throw new https_1.HttpsError('permission-denied', 'You are not authorized for this transaction');
        }
        // Check if already paid
        if (transaction.status === 'paid') {
            throw new https_1.HttpsError('already-exists', 'Transaction already paid');
        }
        // Calculate fees
        const fees = (0, fees_1.calculateFees)(transaction.amount, transaction.shippingCost);
        // Update transaction with fee info if not already set
        if (!transaction.serviceFee) {
            await firebase_1.db.collection('transactions').doc(transactionId).update({
                serviceFee: fees.serviceFee,
                serviceFeePercent: fees.serviceFeePercent,
                totalAmount: fees.buyerTotal,
                sellerPayout: fees.sellerPayout,
            });
        }
        // Create Helcim checkout session
        const checkout = await helcim.createCheckoutSession({
            amount: fees.buyerTotal,
            currency: 'CAD',
            paymentType: 'purchase',
            invoiceNumber: transactionId,
            taxAmount: 0, // Pas de taxe sur les ventes C2C de seconde main
        });
        // Store the secret token for webhook verification
        await firebase_1.db.collection('transactions').doc(transactionId).update({
            helcimSecretToken: checkout.secretToken,
            helcimCheckoutCreatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
        console.log(`✅ Helcim checkout created for transaction ${transactionId} — total: $${fees.buyerTotal}`);
        return {
            success: true,
            checkoutToken: checkout.checkoutToken,
            feeBreakdown: {
                articlePrice: fees.articlePrice,
                shippingCost: fees.shippingCost,
                serviceFee: fees.serviceFee,
                serviceFeePercent: fees.serviceFeePercent,
                buyerTotal: fees.buyerTotal,
            },
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error creating Helcim checkout:', error);
        throw new https_1.HttpsError('internal', `Failed to create checkout: ${message}`);
    }
});
// =============================================================================
// FIND PICKUP POINTS — ShipEngine PUDO search
// =============================================================================
exports.findPickupPoints = (0, https_1.onCall)(async (request) => {
    const { postalCode } = request.data;
    if (!postalCode) {
        throw new https_1.HttpsError('invalid-argument', 'Postal code is required');
    }
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
    }
    try {
        const locations = await shipEngine.findPUDOLocations(postalCode, 'CA', 10);
        return {
            success: true,
            locations,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error finding pickup points:', error);
        throw new https_1.HttpsError('internal', `Failed to find pickup points: ${message}`);
    }
});
// =============================================================================
// CHECK TRACKING STATUS — Via ShipEngine
// =============================================================================
exports.checkTrackingStatus = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = request.data;
    if (!transactionId) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    try {
        const transactionDoc = await firebase_1.db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Transaction not found');
        }
        const transaction = transactionDoc.data();
        // SECURITY: only the buyer or seller can trigger tracking status checks.
        // Without this, any authenticated user could force DELIVERED status and
        // trigger fund transfer to the seller.
        const callerUid = request.auth.uid;
        if (transaction.buyerId !== callerUid && transaction.sellerId !== callerUid) {
            throw new https_1.HttpsError('permission-denied', 'You are not authorized for this transaction');
        }
        if (!transaction.trackingNumber) {
            throw new https_1.HttpsError('failed-precondition', 'No tracking number available');
        }
        const shipEngine = (0, shipEngine_1.getShipEngine)();
        if (!shipEngine) {
            throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
        }
        const carrierCode = transaction.carrierCode || 'intelcom_ca';
        const tracking = await shipEngine.getTracking(carrierCode, transaction.trackingNumber);
        const trackingStatus = shipEngine_1.ShipEngineClient.mapStatus(tracking.statusCode);
        // Update transaction
        await firebase_1.db.collection('transactions').doc(transactionId).update({
            trackingStatus,
        });
        // If delivered, move funds from pending to available
        if (trackingStatus === 'DELIVERED') {
            await firebase_1.db.collection('transactions').doc(transactionId).update({
                status: 'delivered',
                deliveredAt: firebase_1.FieldValue.serverTimestamp(),
            });
            const sellerId = transaction.sellerId;
            const sellerPayout = transaction.sellerPayout || transaction.amount;
            // Move from pending to available balance
            const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
            const sellerBalanceDoc = await sellerBalanceRef.get();
            if (sellerBalanceDoc.exists) {
                const balanceData = sellerBalanceDoc.data();
                const transactions = balanceData.transactions || [];
                const updatedTransactions = transactions.map((t) => {
                    if (t.id === transactionId) {
                        return Object.assign(Object.assign({}, t), { status: 'completed' });
                    }
                    return t;
                });
                await sellerBalanceRef.update({
                    pendingBalance: firebase_1.FieldValue.increment(-sellerPayout),
                    availableBalance: firebase_1.FieldValue.increment(sellerPayout),
                    totalEarnings: firebase_1.FieldValue.increment(sellerPayout),
                    transactions: updatedTransactions,
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            // Send system message
            if (transaction.chatId) {
                // Look up chat participants so the message is visible to listeners
                // that filter messages by participants and respects rules.
                let participants = [];
                try {
                    const chatSnap = await firebase_1.db.collection('chats').doc(transaction.chatId).get();
                    if (chatSnap.exists) {
                        participants = ((_a = chatSnap.data()) === null || _a === void 0 ? void 0 : _a.participants) || [];
                    }
                }
                catch (lookupErr) {
                    console.warn('[payments] Could not load chat participants:', lookupErr);
                }
                await firebase_1.db.collection('messages').add({
                    chatId: transaction.chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: 'Colis livré ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
                    participants,
                    timestamp: firebase_1.FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                });
            }
        }
        return {
            success: true,
            trackingStatus,
            trackingHistory: tracking.events || [],
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error checking tracking status:', error);
        throw new https_1.HttpsError('internal', `Failed to check tracking: ${message}`);
    }
});
// =============================================================================
// REQUEST WITHDRAWAL — Atomic balance debit + withdrawal record creation
// =============================================================================
/**
 * Caller (the seller) requests a withdrawal of `amount` to `iban`.
 *
 * Why this is a CF, not a client mutation:
 * - The previous client implementation read the balance, then issued an
 *   updateDoc with `increment(-amount)`. Two concurrent requests could both
 *   pass the read-side check and double-spend.
 * - Validation (min amount, IBAN format, balance check) must run on a
 *   server we trust.
 *
 * Authorization: caller must be the balance owner (request.auth.uid).
 */
exports.requestWithdrawal = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { amount, iban } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    const userId = request.auth.uid;
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid amount');
    }
    if (amount < 10) {
        throw new https_1.HttpsError('invalid-argument', 'Minimum withdrawal is 10');
    }
    if (typeof iban !== 'string' || iban.replace(/\s/g, '').length < 15) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid IBAN');
    }
    const sanitizedIban = iban.replace(/\s/g, '');
    const balanceRef = firebase_1.db.collection('seller_balances').doc(userId);
    try {
        const withdrawalId = `withdrawal_${Date.now()}_${userId.slice(0, 6)}`;
        await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(balanceRef);
            if (!snap.exists) {
                throw new https_1.HttpsError('not-found', 'Balance not found');
            }
            const data = snap.data();
            const available = typeof data.availableBalance === 'number' ? data.availableBalance : 0;
            if (available < amount) {
                throw new https_1.HttpsError('failed-precondition', 'Insufficient balance');
            }
            const transactions = Array.isArray(data.transactions) ? data.transactions : [];
            const withdrawalEntry = {
                id: withdrawalId,
                type: 'withdrawal',
                amount: -amount,
                description: `Withdrawal to ****${sanitizedIban.slice(-4)}`,
                // serverTimestamp() can't be used inside an array element; use Date instead.
                createdAt: new Date(),
                status: 'pending',
            };
            tx.update(balanceRef, {
                availableBalance: firebase_1.FieldValue.increment(-amount),
                transactions: [...transactions, withdrawalEntry],
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        });
        // Persist the withdrawal request as a separate doc so admins can act on
        // it without parsing the embedded array.
        await firebase_1.db.collection('withdrawal_requests').doc(withdrawalId).set({
            withdrawalId,
            userId,
            amount,
            ibanLast4: sanitizedIban.slice(-4),
            status: 'pending',
            createdAt: firebase_1.FieldValue.serverTimestamp(),
        });
        return { success: true, withdrawalId };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error requesting withdrawal:', error);
        throw new https_1.HttpsError('internal', `Failed to request withdrawal: ${message}`);
    }
});
// =============================================================================
// CANCEL PENDING TRANSACTION — Buyer cancels a non-paid transaction
// =============================================================================
/**
 * Buyer cancels a transaction that has not been paid yet (e.g. Helcim
 * checkout failed or was abandoned).
 *
 * Authorization: caller must be the buyer of the transaction. We refuse to
 * cancel transactions whose current status is anything beyond pending —
 * we cannot mark a paid/shipped/delivered transaction as cancelled this way.
 */
exports.cancelPendingTransaction = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    const callerUid = request.auth.uid;
    try {
        await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(txRef);
            if (!snap.exists) {
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            }
            const data = snap.data();
            if (data.buyerId !== callerUid) {
                throw new https_1.HttpsError('permission-denied', 'Only the buyer can cancel this transaction');
            }
            const cancellableStatuses = new Set([
                'pending',
                'pending_payment',
                'meetup_pending',
            ]);
            if (!cancellableStatuses.has(data.status)) {
                throw new https_1.HttpsError('failed-precondition', `Cannot cancel transaction in status ${data.status}`);
            }
            tx.update(txRef, {
                status: 'cancelled',
                cancelledAt: firebase_1.FieldValue.serverTimestamp(),
            });
        });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error cancelling transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to cancel: ${message}`);
    }
});
//# sourceMappingURL=payments.js.map