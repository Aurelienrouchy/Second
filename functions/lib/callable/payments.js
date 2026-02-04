"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTrackingStatus = exports.createPaymentIntent = exports.getShippingEstimate = void 0;
/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const shippo_1 = require("../config/shippo");
/**
 * Get shipping estimate via Shippo
 */
exports.getShippingEstimate = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    var _a, _b, _c;
    const { fromAddress, toAddress, weight, dimensions } = request.data;
    if (!fromAddress || !toAddress) {
        throw new https_1.HttpsError('invalid-argument', 'From and to addresses are required');
    }
    const shippo = (0, shippo_1.getShippo)();
    if (!shippo) {
        throw new https_1.HttpsError('failed-precondition', 'Shippo API not configured');
    }
    try {
        // Use provided dimensions or default values
        const parcelDimensions = {
            length: ((_a = dimensions === null || dimensions === void 0 ? void 0 : dimensions.length) === null || _a === void 0 ? void 0 : _a.toString()) || '30',
            width: ((_b = dimensions === null || dimensions === void 0 ? void 0 : dimensions.width) === null || _b === void 0 ? void 0 : _b.toString()) || '25',
            height: ((_c = dimensions === null || dimensions === void 0 ? void 0 : dimensions.height) === null || _c === void 0 ? void 0 : _c.toString()) || '10',
            distanceUnit: 'cm',
            weight: (weight === null || weight === void 0 ? void 0 : weight.toString()) || '0.5',
            massUnit: 'kg',
        };
        console.log('📦 Creating Shippo shipment with:', {
            fromAddress,
            toAddress,
            parcelDimensions,
        });
        // Create shipment object
        const shipment = await shippo.shipments.create({
            addressFrom: {
                name: fromAddress.name,
                street1: fromAddress.street,
                city: fromAddress.city,
                zip: fromAddress.postalCode,
                country: fromAddress.country,
            },
            addressTo: {
                name: toAddress.name,
                street1: toAddress.street,
                city: toAddress.city,
                zip: toAddress.postalCode,
                country: toAddress.country,
                phone: toAddress.phoneNumber || '',
            },
            parcels: [parcelDimensions],
            async: false,
        });
        // Extract rates
        const rates = shipment.rates.map((rate) => ({
            carrier: rate.provider,
            serviceName: rate.servicelevel.name,
            estimatedDays: rate.estimatedDays || '3-5',
            amount: parseFloat(rate.amount),
            currency: rate.currency,
            shippoRateId: rate.objectId,
        }));
        console.log(`✅ Retrieved ${rates.length} shipping rates`);
        // Return cheapest and fastest options
        return {
            success: true,
            rates: rates.slice(0, 3), // Return top 3 options
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
            currency: 'eur',
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
 * Check tracking status from Shippo
 */
exports.checkTrackingStatus = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    var _a, _b;
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
        const shippo = (0, shippo_1.getShippo)();
        if (!shippo) {
            throw new https_1.HttpsError('failed-precondition', 'Shippo API not configured');
        }
        // Get tracking info from Shippo
        const tracking = await shippo.trackingStatus.get(transaction.trackingNumber, ((_a = transaction.shippingEstimate) === null || _a === void 0 ? void 0 : _a.carrier) || 'usps');
        const trackingStatus = ((_b = tracking.trackingStatus) === null || _b === void 0 ? void 0 : _b.status) || 'UNKNOWN';
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
            trackingHistory: tracking.trackingHistory || [],
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error checking tracking status:', error);
        throw new https_1.HttpsError('internal', `Failed to check tracking: ${message}`);
    }
});
//# sourceMappingURL=payments.js.map