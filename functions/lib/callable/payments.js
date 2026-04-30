"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTrackingStatus = exports.createPaymentIntent = exports.getShippingEstimate = void 0;
/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 * Shipping via Intelcom (Dragonfly) API
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const intelcom_1 = require("../config/intelcom");
/**
 * Get shipping estimate via Intelcom Rate API
 */
exports.getShippingEstimate = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { fromAddress, toAddress, weight, dimensions } = request.data;
    if (!fromAddress || !toAddress) {
        throw new https_1.HttpsError('invalid-argument', 'From and to addresses are required');
    }
    const intelcom = (0, intelcom_1.getIntelcom)();
    if (!intelcom) {
        throw new https_1.HttpsError('failed-precondition', 'Intelcom API not configured');
    }
    try {
        const parcelWeight = parseFloat(weight) || 0.5;
        const parcelLength = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.length) || 30;
        const parcelWidth = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.width) || 25;
        const parcelHeight = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.height) || 10;
        console.log('📦 Getting Intelcom shipping rates:', {
            fromPostalCode: fromAddress.postalCode,
            toPostalCode: toAddress.postalCode,
            weight: parcelWeight,
            dimensions: { length: parcelLength, width: parcelWidth, height: parcelHeight },
        });
        // Call Intelcom Rate API
        const rates = await intelcom.getRates({
            originPostalCode: fromAddress.postalCode,
            destinationPostalCode: toAddress.postalCode,
            weight: parcelWeight,
            length: parcelLength,
            width: parcelWidth,
            height: parcelHeight,
        });
        // Map to our ShippingEstimate format
        const formattedRates = rates.map((rate) => ({
            carrier: 'Intelcom',
            serviceName: rate.serviceName,
            estimatedDays: rate.estimatedDays,
            amount: rate.amount,
            currency: rate.currency,
            intelcomRateId: rate.rateId,
            intelcomServiceLevel: rate.serviceLevel,
        }));
        console.log(`✅ Retrieved ${formattedRates.length} Intelcom shipping rates`);
        return {
            success: true,
            rates: formattedRates.slice(0, 3), // Return top 3 options
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting shipping estimate:', error);
        throw new https_1.HttpsError('internal', `Failed to get shipping estimate: ${message}`);
    }
});
/**
 * Create Stripe Payment Intent
 */
exports.createPaymentIntent = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { transactionId } = request.data;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (!transactionId) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const stripeClient = (0, stripe_1.getStripe)();
    if (!stripeClient) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
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
        // Check if payment intent already exists
        if (transaction.paymentIntentId) {
            const existingIntent = await stripeClient.paymentIntents.retrieve(transaction.paymentIntentId);
            if (existingIntent.status !== 'canceled') {
                return {
                    success: true,
                    clientSecret: existingIntent.client_secret,
                    paymentIntentId: existingIntent.id,
                };
            }
        }
        // Create new payment intent
        const paymentIntent = await stripeClient.paymentIntents.create({
            amount: Math.round(transaction.totalAmount * 100), // Convert to cents
            currency: 'cad',
            metadata: {
                transactionId,
                buyerId: transaction.buyerId,
                sellerId: transaction.sellerId,
                articleId: transaction.articleId,
            },
            automatic_payment_methods: {
                enabled: true,
            },
        });
        // Update transaction with payment intent ID
        await firebase_1.db.collection('transactions').doc(transactionId).update({
            paymentIntentId: paymentIntent.id,
        });
        return {
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error creating payment intent:', error);
        throw new https_1.HttpsError('internal', `Failed to create payment intent: ${message}`);
    }
});
/**
 * Check tracking status from Intelcom Tracking API
 */
exports.checkTrackingStatus = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { transactionId } = request.data;
    if (!transactionId) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    try {
        // Get transaction
        const transactionDoc = await firebase_1.db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Transaction not found');
        }
        const transaction = transactionDoc.data();
        if (!transaction.trackingNumber) {
            throw new https_1.HttpsError('failed-precondition', 'No tracking number available');
        }
        const intelcom = (0, intelcom_1.getIntelcom)();
        if (!intelcom) {
            throw new https_1.HttpsError('failed-precondition', 'Intelcom API not configured');
        }
        // Get tracking info from Intelcom
        const tracking = await intelcom.getTracking(transaction.trackingNumber);
        // Map Intelcom status to our normalized status
        const trackingStatus = mapIntelcomStatus(tracking.status);
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
            const amount = transaction.amount;
            // Move from pending to available balance
            const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
            const sellerBalanceDoc = await sellerBalanceRef.get();
            if (sellerBalanceDoc.exists) {
                const balanceData = sellerBalanceDoc.data();
                const transactions = balanceData.transactions || [];
                // Update the sale transaction status to completed
                const updatedTransactions = transactions.map((t) => {
                    if (t.id === transactionId) {
                        return Object.assign(Object.assign({}, t), { status: 'completed' });
                    }
                    return t;
                });
                await sellerBalanceRef.update({
                    pendingBalance: firebase_1.FieldValue.increment(-amount),
                    availableBalance: firebase_1.FieldValue.increment(amount),
                    totalEarnings: firebase_1.FieldValue.increment(amount),
                    transactions: updatedTransactions,
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            // Send system message
            const chatQuery = await firebase_1.db
                .collection('chats')
                .where('articleId', '==', transaction.articleId)
                .where('participants', 'array-contains', transaction.buyerId)
                .limit(1)
                .get();
            if (!chatQuery.empty) {
                const chatId = chatQuery.docs[0].id;
                await firebase_1.db.collection('messages').add({
                    chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: '✅ Colis livré ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
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
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error checking tracking status:', error);
        throw new https_1.HttpsError('internal', `Failed to check tracking: ${message}`);
    }
});
/**
 * Map Intelcom tracking status to our normalized status codes
 * Intelcom uses statuses like: BOOKED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED, RETURNED
 */
function mapIntelcomStatus(intelcomStatus) {
    const statusMap = {
        BOOKED: 'TRANSIT',
        PICKED_UP: 'TRANSIT',
        IN_TRANSIT: 'IN_TRANSIT',
        AT_STATION: 'IN_TRANSIT',
        OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
        DELIVERED: 'DELIVERED',
        FAILED: 'FAILURE',
        RETURNED: 'RETURNED',
        CANCELLED: 'FAILURE',
    };
    return statusMap[intelcomStatus === null || intelcomStatus === void 0 ? void 0 : intelcomStatus.toUpperCase()] || 'UNKNOWN';
}
//# sourceMappingURL=payments.js.map