"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhook = void 0;
/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const stripe_1 = require("../config/stripe");
const shippo_1 = require("../config/shippo");
/**
 * Stripe Webhook - Confirm payment and create shipping label
 */
exports.stripeWebhook = (0, https_1.onRequest)({
    cors: false,
    memory: '512MiB',
}, async (req, res) => {
    var _a;
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
            const shippo = (0, shippo_1.getShippo)();
            if (!shippo) {
                throw new Error('Shippo API not configured');
            }
            // Create shipping label via Shippo
            const shipment = await shippo.transactions.create({
                rate: (_a = transaction.shippingEstimate) === null || _a === void 0 ? void 0 : _a.shippoRateId,
                labelFileType: 'PDF',
                async: false,
            });
            // Update transaction with shipping info
            await firebase_1.db.collection('transactions').doc(transactionId).update({
                status: 'paid',
                paidAt: firebase_1.FieldValue.serverTimestamp(),
                shippoTransactionId: shipment.objectId,
                shippingLabelUrl: shipment.labelUrl,
                trackingNumber: shipment.trackingNumber,
                trackingUrl: shipment.trackingUrlProvider,
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
                    content: `📦 Paiement confirmé ! Étiquette d'expédition générée.\n\nNuméro de suivi: ${shipment.trackingNumber}\n\nLe vendeur peut maintenant expédier l'article.`,
                    timestamp: firebase_1.FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                    shippingLabel: {
                        labelUrl: shipment.labelUrl,
                        trackingNumber: shipment.trackingNumber,
                        trackingUrl: shipment.trackingUrlProvider,
                    },
                });
            }
            console.log(`Payment confirmed and label created for transaction ${transactionId}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Error processing payment webhook:', message);
        }
    }
    res.json({ received: true });
});
//# sourceMappingURL=webhooks.js.map