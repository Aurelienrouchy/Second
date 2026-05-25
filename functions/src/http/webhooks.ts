/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 *
 * Helcim webhook: payment confirmation + ShipEngine label creation
 * Replaces the previous Stripe webhook flow.
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
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
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
 * 1. Verify webhook signature (HMAC-SHA256)
 * 2. Atomic transaction: idempotence check + mark paid + mark sold + credit seller
 * 3. Create shipping label via ShipEngine (non-atomic, retry-safe)
 * 4. Send system message with tracking info
 */
export const helcimWebhook = onRequest(
  {
    region: 'northamerica-northeast1',
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
        logger.info('Helcim webhook: payment not approved', { status });
        res.json({ received: true, processed: false });
        return;
      }

      if (!invoiceNumber) {
        logger.error('Helcim webhook: missing invoiceNumber');
        res.status(400).send('Missing invoiceNumber');
        return;
      }

      // Sanity bounds: Firestore doc IDs are 1-1500 chars and cannot
      // contain '/'. Reject anything outside that envelope before we
      // round-trip Firestore — keeps log noise down for malformed
      // payloads (and bots).
      if (
        typeof invoiceNumber !== 'string' ||
        invoiceNumber.length === 0 ||
        invoiceNumber.length > 200 ||
        invoiceNumber.includes('/')
      ) {
        logger.error('Helcim webhook: invalid invoiceNumber shape', { invoiceNumber });
        res.status(400).send('Invalid invoiceNumber');
        return;
      }

      const transactionId = invoiceNumber;

      // Get transaction (outside runTransaction for signature verification)
      const transactionDoc = await db.collection('transactions').doc(transactionId).get();
      if (!transactionDoc.exists) {
        logger.error('Helcim webhook: transaction not found', { transactionId });
        res.status(404).send('Transaction not found');
        return;
      }

      const transaction = transactionDoc.data()!;

      // SECURITY: Webhook signature verification is MANDATORY.
      // Falls back to HELCIM_WEBHOOK_SECRET env var if the per-transaction
      // secretToken was not stored (older flow), so legitimate webhooks
      // for legacy transactions can still be authenticated.
      const secretToken =
        transaction.helcimSecretToken || process.env.HELCIM_WEBHOOK_SECRET;
      if (!secretToken) {
        logger.error('Helcim webhook: no secret token', { transactionId });
        res.status(401).send('Unauthorized: missing secret');
        return;
      }

      const signature = req.headers['x-helcim-signature'] as string | undefined;
      if (!signature) {
        logger.error('Helcim webhook: missing x-helcim-signature header');
        res.status(401).send('Unauthorized: missing signature');
        return;
      }

      const isValid = HelcimClient.verifyWebhookSignature(
        (req as any).rawBody.toString('utf8'),
        signature,
        secretToken
      );
      if (!isValid) {
        logger.error('Helcim webhook: invalid signature', { transactionId });
        res.status(401).send('Unauthorized: invalid signature');
        return;
      }

      // =====================================================================
      // ATOMIC TRANSACTION: idempotence + mark paid + mark sold + credit seller
      // All financial mutations happen atomically. If the webhook replays
      // concurrently, only the first execution will mutate — subsequent
      // ones see status === 'paid' inside the transaction and short-circuit.
      // =====================================================================

      const transactionRef = db.collection('transactions').doc(transactionId);

      const wasAlreadyProcessed = await db.runTransaction(async (tx) => {
        // Re-read inside transaction for consistency (optimistic locking)
        const txSnap = await tx.get(transactionRef);
        const txData = txSnap.data();

        if (!txData) {
          throw new Error(`Transaction ${transactionId} disappeared mid-processing`);
        }

        // IDEMPOTENCE: If already paid/shipped/delivered, do nothing (replay protection).
        // Also reject cancelled transactions — a late webhook must NOT resurrect a
        // cancelled order by re-marking the article as sold and crediting the seller.
        const currentStatus = txData.status;
        if (currentStatus === 'paid' || currentStatus === 'shipped' || currentStatus === 'delivered' || currentStatus === 'cancelled') {
          logger.info(`[helcimWebhook] Transaction ${transactionId} already in status ${currentStatus}, skipping`);
          return true; // already processed or cancelled
        }

        // --- Mark transaction as paid ---
        tx.update(transactionRef, {
          status: 'paid',
          paidAt: FieldValue.serverTimestamp(),
          helcimTransactionId,
          helcimApprovalCode: approvalCode,
          helcimCardLast4: cardNumber, // Masked by Helcim: ****1234
          helcimCardType: cardType,
        });

        // --- Mark article as sold ---
        if (txData.articleId) {
          const articleRef = db.collection('articles').doc(txData.articleId);
          tx.update(articleRef, {
            isSold: true,
            soldAt: FieldValue.serverTimestamp(),
          });
        }

        // --- Credit seller's pending balance ---
        const sellerId = txData.sellerId;
        const sellerPayout = txData.sellerPayout || txData.amount;
        const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
        const sellerBalanceSnap = await tx.get(sellerBalanceRef);

        const saleTransaction = {
          id: transactionId,
          type: 'sale',
          amount: sellerPayout,
          description: `Vente de l'article`,
          createdAt: FieldValue.serverTimestamp(),
          status: 'pending',
        };

        if (!sellerBalanceSnap.exists) {
          tx.set(sellerBalanceRef, {
            userId: sellerId,
            availableBalance: 0,
            pendingBalance: sellerPayout,
            totalEarnings: 0,
            transactions: [saleTransaction],
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          tx.update(sellerBalanceRef, {
            pendingBalance: FieldValue.increment(sellerPayout),
            transactions: FieldValue.arrayUnion(saleTransaction),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return false; // not previously processed
      });

      // If the transaction was already processed, respond 200 (idempotent)
      if (wasAlreadyProcessed) {
        logger.info('Helcim webhook: transaction already processed (idempotent)', { transactionId });
        res.json({ received: true, processed: false });
        return;
      }

      logger.info('Helcim webhook: payment confirmed, atomic mutations committed', {
        transactionId,
        amount,
      });

      // =====================================================================
      // SHIPPING LABEL (non-atomic, external call — safe to retry separately)
      // Runs AFTER the transaction. If this fails, the payment is still valid
      // and the label can be created manually later.
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

          logger.info('ShipEngine label created', {
            transactionId,
            trackingNumber,
            carrierCode,
          });
        } catch (labelError) {
          logger.error('Error creating ShipEngine label (will retry manually)', {
            transactionId,
            error: labelError instanceof Error ? labelError.message : labelError,
          });
          // Payment is still valid — label can be created manually later
        }
      }

      // =====================================================================
      // SYSTEM MESSAGE: Send shipping/tracking info to chat
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
          logger.warn('Could not load chat participants', {
            chatId,
            error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
          });
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

      logger.info('Helcim webhook: fully processed', { transactionId });
      res.json({ received: true, processed: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error processing Helcim webhook', { error: message });
      res.status(500).send(`Webhook processing error: ${message}`);
    }
  }
);
