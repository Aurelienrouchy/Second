/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 */
import { onRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { getShippo } from '../config/shippo';

/**
 * Stripe Webhook - Confirm payment and create shipping label
 */
export const stripeWebhook = onRequest(
  {
    cors: false,
    memory: '512MiB',
  },
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;

    const stripeClient = getStripe();
    if (!stripeClient) {
      res.status(500).send('Stripe API not configured');
      return;
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripeClient.webhooks.constructEvent(
        req.rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Webhook signature verification failed:', message);
      res.status(400).send(`Webhook Error: ${message}`);
      return;
    }

    // Handle payment_intent.succeeded event
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const { transactionId, sellerId, articleId } = paymentIntent.metadata;

      try {
        // Get transaction details
        const transactionDoc = await db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
          throw new Error('Transaction not found');
        }

        const transaction = transactionDoc.data()!;

        const shippo = getShippo();
        if (!shippo) {
          throw new Error('Shippo API not configured');
        }

        // Create shipping label via Shippo
        const shipment = await shippo.transactions.create({
          rate: transaction.shippingEstimate?.shippoRateId,
          labelFileType: 'PDF',
          async: false,
        });

        // Update transaction with shipping info
        await db.collection('transactions').doc(transactionId).update({
          status: 'paid',
          paidAt: FieldValue.serverTimestamp(),
          shippoTransactionId: shipment.objectId,
          shippingLabelUrl: shipment.labelUrl,
          trackingNumber: shipment.trackingNumber,
          trackingUrl: shipment.trackingUrlProvider,
          trackingStatus: 'TRANSIT',
        });

        // Mark article as sold
        await db.collection('articles').doc(articleId).update({
          isSold: true,
          soldAt: FieldValue.serverTimestamp(),
        });

        // Add amount to seller's pending balance
        const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
        const sellerBalanceDoc = await sellerBalanceRef.get();

        const saleTransaction = {
          id: transactionId,
          type: 'sale',
          amount: transaction.amount,
          description: `Vente de l'article`,
          createdAt: FieldValue.serverTimestamp(),
          status: 'pending',
        };

        if (!sellerBalanceDoc.exists) {
          await sellerBalanceRef.set({
            userId: sellerId,
            availableBalance: 0,
            pendingBalance: transaction.amount,
            totalEarnings: 0,
            transactions: [saleTransaction],
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          await sellerBalanceRef.update({
            pendingBalance: FieldValue.increment(transaction.amount),
            transactions: FieldValue.arrayUnion(saleTransaction),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // Send system message in chat with shipping label
        const chatQuery = await db
          .collection('chats')
          .where('articleId', '==', articleId)
          .where('participants', 'array-contains', transaction.buyerId)
          .limit(1)
          .get();

        if (!chatQuery.empty) {
          const chatId = chatQuery.docs[0].id;

          await db.collection('messages').add({
            chatId,
            senderId: 'system',
            receiverId: 'system',
            type: 'system',
            content: `📦 Paiement confirmé ! Étiquette d'expédition générée.\n\nNuméro de suivi: ${shipment.trackingNumber}\n\nLe vendeur peut maintenant expédier l'article.`,
            timestamp: FieldValue.serverTimestamp(),
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error processing payment webhook:', message);
      }
    }

    res.json({ received: true });
  }
);
