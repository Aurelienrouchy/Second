"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helcimWebhook = void 0;
/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 *
 * Helcim webhook: payment confirmation + ShipEngine label creation
 * Replaces the previous Stripe webhook flow.
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const shipEngine_1 = require("../config/shipEngine");
const helcim_1 = require("../config/helcim");
// =============================================================================
// HELCIM WEBHOOK — Payment confirmed → Create shipping label
// =============================================================================
/**
 * Helcim calls this endpoint after a successful HelcimPay.js payment.
 *
 * Flow:
 * 1. Verify webhook signature
 * 2. Find transaction by invoiceNumber
 * 3. Mark as paid
 * 4. Create shipping label via ShipEngine
 * 5. Update seller balance
 * 6. Send system message with tracking info
 */
exports.helcimWebhook = (0, https_1.onRequest)({
    cors: false,
    memory: '512MiB',
}, async (req, res) => {
    var _a;
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    try {
        const payload = req.body;
        const { transactionId: helcimTransactionId, status, amount, invoiceNumber, // This is our Firestore transactionId
        approvalCode, cardNumber, cardType, } = payload;
        // Only process successful payments
        if (status !== 'APPROVED') {
            console.log(`Helcim webhook: payment not approved (status: ${status})`);
            res.json({ received: true, processed: false });
            return;
        }
        if (!invoiceNumber) {
            console.error('Helcim webhook: missing invoiceNumber');
            res.status(400).send('Missing invoiceNumber');
            return;
        }
        // Sanity bounds: Firestore doc IDs are 1–1500 chars and cannot
        // contain '/'. Reject anything outside that envelope before we
        // round-trip Firestore — keeps log noise down for malformed
        // payloads (and bots).
        if (typeof invoiceNumber !== 'string' ||
            invoiceNumber.length === 0 ||
            invoiceNumber.length > 200 ||
            invoiceNumber.includes('/')) {
            console.error('Helcim webhook: invalid invoiceNumber shape');
            res.status(400).send('Invalid invoiceNumber');
            return;
        }
        const transactionId = invoiceNumber;
        // Get transaction
        const transactionDoc = await firebase_1.db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            console.error(`Helcim webhook: transaction ${transactionId} not found`);
            res.status(404).send('Transaction not found');
            return;
        }
        const transaction = transactionDoc.data();
        // SECURITY: Webhook signature verification is MANDATORY.
        // Falls back to HELCIM_WEBHOOK_SECRET env var if the per-transaction
        // secretToken was not stored (older flow), so legitimate webhooks
        // for legacy transactions can still be authenticated.
        const secretToken = transaction.helcimSecretToken || process.env.HELCIM_WEBHOOK_SECRET;
        if (!secretToken) {
            console.error(`Helcim webhook: no secret token for transaction ${transactionId}`);
            res.status(401).send('Unauthorized: missing secret');
            return;
        }
        const signature = req.headers['x-helcim-signature'];
        if (!signature) {
            console.error('Helcim webhook: missing x-helcim-signature header');
            res.status(401).send('Unauthorized: missing signature');
            return;
        }
        const isValid = helcim_1.HelcimClient.verifyWebhookSignature(JSON.stringify(req.body), signature, secretToken);
        if (!isValid) {
            console.error('Helcim webhook: invalid signature');
            res.status(401).send('Unauthorized: invalid signature');
            return;
        }
        // Skip if already processed
        if (transaction.status === 'paid' || transaction.status === 'shipped') {
            console.log(`Transaction ${transactionId} already processed`);
            res.json({ received: true, processed: false });
            return;
        }
        console.log(`💳 Helcim payment confirmed for transaction ${transactionId} — $${amount}`);
        // =====================================================================
        // STEP 1: Mark transaction as paid
        // =====================================================================
        await firebase_1.db.collection('transactions').doc(transactionId).update({
            status: 'paid',
            paidAt: firebase_1.FieldValue.serverTimestamp(),
            helcimTransactionId,
            helcimApprovalCode: approvalCode,
            helcimCardLast4: cardNumber, // Masked by Helcim: ****1234
            helcimCardType: cardType,
        });
        // =====================================================================
        // STEP 2: Create shipping label via ShipEngine
        // =====================================================================
        let trackingNumber = '';
        let labelUrl = '';
        let trackingUrl = '';
        let carrierCode = '';
        const shipEngine = (0, shipEngine_1.getShipEngine)();
        if (shipEngine && transaction.shipEngineRateId) {
            try {
                const label = await shipEngine.createLabel(transaction.shipEngineRateId);
                trackingNumber = label.trackingNumber;
                labelUrl = label.labelDownload.href;
                trackingUrl = label.trackingUrl;
                carrierCode = label.carrierCode;
                await firebase_1.db.collection('transactions').doc(transactionId).update({
                    trackingNumber,
                    shippingLabelUrl: labelUrl,
                    trackingUrl,
                    carrierCode,
                    trackingStatus: 'TRANSIT',
                    shipEngineLabelId: label.labelId,
                });
                console.log(`📦 ShipEngine label created: ${trackingNumber} via ${carrierCode}`);
            }
            catch (labelError) {
                console.error('Error creating ShipEngine label:', labelError);
                // Payment is still valid — label can be created manually later
            }
        }
        // =====================================================================
        // STEP 3: Mark article as sold
        // =====================================================================
        if (transaction.articleId) {
            await firebase_1.db.collection('articles').doc(transaction.articleId).update({
                isSold: true,
                soldAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
        // =====================================================================
        // STEP 4: Add to seller's pending balance (seller payout, not full amount)
        // =====================================================================
        const sellerId = transaction.sellerId;
        const sellerPayout = transaction.sellerPayout || transaction.amount;
        const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
        const sellerBalanceDoc = await sellerBalanceRef.get();
        const saleTransaction = {
            id: transactionId,
            type: 'sale',
            amount: sellerPayout,
            description: `Vente de l'article`,
            createdAt: firebase_1.FieldValue.serverTimestamp(),
            status: 'pending',
        };
        if (!sellerBalanceDoc.exists) {
            await sellerBalanceRef.set({
                userId: sellerId,
                availableBalance: 0,
                pendingBalance: sellerPayout,
                totalEarnings: 0,
                transactions: [saleTransaction],
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
        else {
            await sellerBalanceRef.update({
                pendingBalance: firebase_1.FieldValue.increment(sellerPayout),
                transactions: firebase_1.FieldValue.arrayUnion(saleTransaction),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
        // =====================================================================
        // STEP 5: Send system message with shipping info
        // =====================================================================
        const chatId = transaction.chatId;
        if (chatId) {
            const labelInfo = trackingNumber
                ? `\n\nNuméro de suivi: ${trackingNumber}\nÉtiquette: disponible dans les détails de la commande.`
                : '\n\nL\'étiquette d\'expédition sera disponible sous peu.';
            // Look up chat participants so the message is visible to listeners
            // that filter messages by participants and respects rules.
            let participants = [];
            try {
                const chatSnap = await firebase_1.db.collection('chats').doc(chatId).get();
                if (chatSnap.exists) {
                    participants = ((_a = chatSnap.data()) === null || _a === void 0 ? void 0 : _a.participants) || [];
                }
            }
            catch (lookupErr) {
                console.warn('[webhooks] Could not load chat participants:', lookupErr);
            }
            await firebase_1.db.collection('messages').add(Object.assign({ chatId, senderId: 'system', receiverId: 'system', type: 'system', content: `Paiement confirmé !${labelInfo}\n\nLe vendeur peut maintenant expédier l'article.`, participants, timestamp: firebase_1.FieldValue.serverTimestamp(), status: 'sent', isRead: true }, (trackingNumber && {
                shippingLabel: {
                    labelUrl,
                    trackingNumber,
                    trackingUrl,
                },
            })));
        }
        console.log(`✅ Transaction ${transactionId} fully processed`);
        res.json({ received: true, processed: true });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error processing Helcim webhook:', message);
        res.status(500).send(`Webhook processing error: ${message}`);
    }
});
//# sourceMappingURL=webhooks.js.map