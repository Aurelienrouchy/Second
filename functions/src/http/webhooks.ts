/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 *
 * Helcim webhook: payment confirmation + ShipEngine label creation
 * Replaces the previous Stripe webhook flow.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine } from '../config/shipEngine';
import { HelcimClient } from '../config/helcim';

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
export const helcimWebhook = onRequest(
  {
    cors: false,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const payload = req.body;
      const {
        transactionId: helcimTransactionId,
        status,
        amount,
        invoiceNumber, // This is our Firestore transactionId
        approvalCode,
        cardNumber,
        cardType,
      } = payload;

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

      const transactionId = invoiceNumber;

      // Get transaction
      const transactionDoc = await db.collection('transactions').doc(transactionId).get();
      if (!transactionDoc.exists) {
        console.error(`Helcim webhook: transaction ${transactionId} not found`);
        res.status(404).send('Transaction not found');
        return;
      }

      const transaction = transactionDoc.data()!;

      // Verify webhook signature if secret token is stored
      if (transaction.helcimSecretToken) {
        const signature = req.headers['x-helcim-signature'] as string;
        if (signature) {
          const isValid = HelcimClient.verifyWebhookSignature(
            JSON.stringify(req.body),
            signature,
            transaction.helcimSecretToken
          );
          if (!isValid) {
            console.error('Helcim webhook: invalid signature');
            res.status(401).send('Invalid signature');
            return;
          }
        }
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

      await db.collection('transactions').doc(transactionId).update({
        status: 'paid',
        paidAt: FieldValue.serverTimestamp(),
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

      const shipEngine = getShipEngine();
      if (shipEngine && transaction.shipEngineRateId) {
        try {
          const label = await shipEngine.createLabel(transaction.shipEngineRateId);
          trackingNumber = label.trackingNumber;
          labelUrl = label.labelDownload.href;
          trackingUrl = label.trackingUrl;
          carrierCode = label.carrierCode;

          await db.collection('transactions').doc(transactionId).update({
            trackingNumber,
            shippingLabelUrl: labelUrl,
            trackingUrl,
            carrierCode,
            trackingStatus: 'TRANSIT',
            shipEngineLabelId: label.labelId,
          });

          console.log(`📦 ShipEngine label created: ${trackingNumber} via ${carrierCode}`);
        } catch (labelError) {
          console.error('Error creating ShipEngine label:', labelError);
          // Payment is still valid — label can be created manually later
        }
      }

      // =====================================================================
      // STEP 3: Mark article as sold
      // =====================================================================

      if (transaction.articleId) {
        await db.collection('articles').doc(transaction.articleId).update({
          isSold: true,
          soldAt: FieldValue.serverTimestamp(),
        });
      }

      // =====================================================================
      // STEP 4: Add to seller's pending balance (seller payout, not full amount)
      // =====================================================================

      const sellerId = transaction.sellerId;
      const sellerPayout = transaction.sellerPayout || transaction.amount;

      const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
      const sellerBalanceDoc = await sellerBalanceRef.get();

      const saleTransaction = {
        id: transactionId,
        type: 'sale',
        amount: sellerPayout,
        description: `Vente de l'article`,
        createdAt: FieldValue.serverTimestamp(),
        status: 'pending',
      };

      if (!sellerBalanceDoc.exists) {
        await sellerBalanceRef.set({
          userId: sellerId,
          availableBalance: 0,
          pendingBalance: sellerPayout,
          totalEarnings: 0,
          transactions: [saleTransaction],
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        await sellerBalanceRef.update({
          pendingBalance: FieldValue.increment(sellerPayout),
          transactions: FieldValue.arrayUnion(saleTransaction),
          updatedAt: FieldValue.serverTimestamp(),
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
        let participants: string[] = [];
        try {
          const chatSnap = await db.collection('chats').doc(chatId).get();
          if (chatSnap.exists) {
            participants = (chatSnap.data()?.participants as string[]) || [];
          }
        } catch (lookupErr) {
          console.warn('[webhooks] Could not load chat participants:', lookupErr);
        }

        await db.collection('messages').add({
          chatId,
          senderId: 'system',
          receiverId: 'system',
          type: 'system',
          content: `Paiement confirmé !${labelInfo}\n\nLe vendeur peut maintenant expédier l'article.`,
          participants,
          timestamp: FieldValue.serverTimestamp(),
          status: 'sent',
          isRead: true,
          ...(trackingNumber && {
            shippingLabel: {
              labelUrl,
              trackingNumber,
              trackingUrl,
            },
          }),
        });
      }

      console.log(`✅ Transaction ${transactionId} fully processed`);
      res.json({ received: true, processed: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error processing Helcim webhook:', message);
      res.status(500).send(`Webhook processing error: ${message}`);
    }
  }
);
