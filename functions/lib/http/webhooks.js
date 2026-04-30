"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhook = void 0;
/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 * Shipping via Intelcom (Dragonfly) Booking + Label API
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const intelcom_1 = require("../config/intelcom");
/**
 * Stripe Webhook - Confirm payment and create shipping label via Intelcom
 */
exports.stripeWebhook = (0, https_1.onRequest)({
    cors: false,
    memory: '512MiB',
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const sig = req.headers['stripe-signature'];
    const stripeClient = (0, stripe_1.getStripe)();
    if (!stripeClient) {
        res.status(500).send('Stripe API not configured');
        return;
    }
    let event;
    try {
        // Verify webhook signature
        event = stripeClient.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Webhook signature verification failed:', message);
        res.status(400).send(`Webhook Error: ${message}`);
        return;
    }
    // Handle payment_intent.succeeded event
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const { transactionId, sellerId, articleId } = paymentIntent.metadata;
        try {
            // Get transaction details
            const transactionDoc = await firebase_1.db.collection('transactions').doc(transactionId).get();
            if (!transactionDoc.exists) {
                throw new Error('Transaction not found');
            }
            const transaction = transactionDoc.data();
            const intelcom = (0, intelcom_1.getIntelcom)();
            if (!intelcom) {
                throw new Error('Intelcom API not configured');
            }
            const shippingAddress = transaction.shippingAddress;
            const sellerAddress = transaction.sellerAddress || {};
            // Step 1: Create booking via Intelcom Booking API
            const booking = await intelcom.createBooking({
                clientCode: process.env.INTELCOM_CLIENT_CODE || '',
                trackingNumberPrefix: process.env.INTELCOM_TRACKING_PREFIX || '',
                parcels: [
                    {
                        referenceNumber: transactionId,
                        recipient: {
                            name: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.name) || '',
                            address: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.street) || '',
                            city: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.city) || '',
                            postalCode: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.postalCode) || '',
                            province: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.province) || 'QC',
                            country: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.country) || 'CA',
                            phone: (shippingAddress === null || shippingAddress === void 0 ? void 0 : shippingAddress.phoneNumber) || '',
                        },
                        sender: {
                            name: (sellerAddress === null || sellerAddress === void 0 ? void 0 : sellerAddress.name) || 'Vendeur',
                            address: (sellerAddress === null || sellerAddress === void 0 ? void 0 : sellerAddress.street) || '',
                            city: (sellerAddress === null || sellerAddress === void 0 ? void 0 : sellerAddress.city) || '',
                            postalCode: (sellerAddress === null || sellerAddress === void 0 ? void 0 : sellerAddress.postalCode) || '',
                            province: (sellerAddress === null || sellerAddress === void 0 ? void 0 : sellerAddress.province) || 'QC',
                            country: (sellerAddress === null || sellerAddress === void 0 ? void 0 : sellerAddress.country) || 'CA',
                        },
                        weight: ((_a = transaction.shippingEstimate) === null || _a === void 0 ? void 0 : _a.weight) || 0.5,
                        length: ((_b = transaction.dimensions) === null || _b === void 0 ? void 0 : _b.length) || 30,
                        width: ((_c = transaction.dimensions) === null || _c === void 0 ? void 0 : _c.width) || 25,
                        height: ((_d = transaction.dimensions) === null || _d === void 0 ? void 0 : _d.height) || 10,
                        serviceLevel: ((_e = transaction.shippingEstimate) === null || _e === void 0 ? void 0 : _e.intelcomServiceLevel) || 'STANDARD',
                    },
                ],
            });
            // Check if booking was accepted
            if (!((_g = (_f = booking.data) === null || _f === void 0 ? void 0 : _f.accepted) === null || _g === void 0 ? void 0 : _g.length)) {
                const rejection = (_j = (_h = booking.data) === null || _h === void 0 ? void 0 : _h.rejected) === null || _j === void 0 ? void 0 : _j[0];
                throw new Error(`Intelcom booking rejected: ${(rejection === null || rejection === void 0 ? void 0 : rejection.errorMessage) || 'Unknown error'}`);
            }
            const acceptedParcel = booking.data.accepted[0];
            const trackingNumber = acceptedParcel.trackingNumber;
            // Step 2: Generate shipping label via Intelcom Label API
            const label = await intelcom.getLabel(trackingNumber, 'PDF');
            // Build tracking URL
            const trackingUrl = intelcom.getTrackingUrl(trackingNumber);
            // Update transaction with shipping info
            await firebase_1.db.collection('transactions').doc(transactionId).update({
                status: 'paid',
                paidAt: firebase_1.FieldValue.serverTimestamp(),
                intelcomBookingId: acceptedParcel.trackingNumber,
                shippingLabelUrl: label.labelUrl,
                trackingNumber: trackingNumber,
                trackingUrl: trackingUrl,
                trackingStatus: 'TRANSIT',
            });
            // Mark article as sold
            await firebase_1.db.collection('articles').doc(articleId).update({
                isSold: true,
                soldAt: firebase_1.FieldValue.serverTimestamp(),
            });
            // Add amount to seller's pending balance
            const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
            const sellerBalanceDoc = await sellerBalanceRef.get();
            const saleTransaction = {
                id: transactionId,
                type: 'sale',
                amount: transaction.amount,
                description: `Vente de l'article`,
                createdAt: firebase_1.FieldValue.serverTimestamp(),
                status: 'pending',
            };
            if (!sellerBalanceDoc.exists) {
                await sellerBalanceRef.set({
                    userId: sellerId,
                    availableBalance: 0,
                    pendingBalance: transaction.amount,
                    totalEarnings: 0,
                    transactions: [saleTransaction],
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            else {
                await sellerBalanceRef.update({
                    pendingBalance: firebase_1.FieldValue.increment(transaction.amount),
                    transactions: firebase_1.FieldValue.arrayUnion(saleTransaction),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            // Send system message in chat with shipping label
            const chatQuery = await firebase_1.db
                .collection('chats')
                .where('articleId', '==', articleId)
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
                    content: `📦 Paiement confirmé ! Étiquette d'expédition Intelcom générée.\n\nNuméro de suivi: ${trackingNumber}\n\nLe vendeur peut maintenant expédier l'article.`,
                    timestamp: firebase_1.FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                    shippingLabel: {
                        labelUrl: label.labelUrl,
                        trackingNumber: trackingNumber,
                        trackingUrl: trackingUrl,
                    },
                });
            }
            console.log(`Payment confirmed and Intelcom label created for transaction ${transactionId}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Error processing payment webhook:', message);
        }
    }
    res.json({ received: true });
});
//# sourceMappingURL=webhooks.js.map