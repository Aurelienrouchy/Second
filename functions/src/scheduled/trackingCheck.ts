/**
 * Scheduled tracking check
 * Firebase Functions v7 - using onSchedule
 *
 * Polls ShipEngine for tracking updates on all shipped transactions.
 * Runs every 6 hours.
 *
 * For each transaction with status 'shipped' and a trackingNumber:
 * - Queries ShipEngine for the current tracking status
 * - If delivered: atomically marks the transaction as 'delivered',
 *   transfers seller funds from pending to available, and notifies buyer
 * - Otherwise: updates the trackingStatus field
 *
 * This replaces the previous manual-only tracking approach where buyers
 * had to call checkTrackingStatus to trigger delivery detection.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine, ShipEngineClient } from '../config/shipEngine';
import { sendPushNotification } from '../utils/notifications';

/** Process at most this many transactions per run to avoid timeouts */
const MAX_TRANSACTIONS_PER_RUN = 200;

export const checkShippedTracking = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['SHIPENGINE_API_KEY'],
  },
  async () => {
    const shipEngine = getShipEngine();
    if (!shipEngine) {
      logger.warn('[checkShippedTracking] ShipEngine not configured, skipping');
      return;
    }

    // Query all shipped transactions that have a tracking number
    const shippedSnap = await db
      .collection('transactions')
      .where('status', '==', 'shipped')
      .limit(MAX_TRANSACTIONS_PER_RUN)
      .get();

    if (shippedSnap.empty) {
      logger.info('[checkShippedTracking] No shipped transactions to check');
      return;
    }

    logger.info(`[checkShippedTracking] Checking ${shippedSnap.size} shipped transactions`);

    let deliveredCount = 0;
    let errorCount = 0;

    for (const doc of shippedSnap.docs) {
      const data = doc.data();
      const transactionId = doc.id;

      if (!data.trackingNumber) {
        // No tracking number yet — skip
        continue;
      }

      try {
        const carrierCode = data.carrierCode || 'intelcom_ca';
        const tracking = await shipEngine.getTracking(carrierCode, data.trackingNumber);
        const trackingStatus = ShipEngineClient.mapStatus(tracking.statusCode);

        if (trackingStatus === 'DELIVERED') {
          // Atomically mark delivered + transfer seller funds
          const sellerId = data.sellerId;
          const sellerPayout = data.sellerPayout || data.amount;
          const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);

          await db.runTransaction(async (tx) => {
            const [txSnap, sellerBalanceDoc] = await Promise.all([
              tx.get(doc.ref),
              tx.get(sellerBalanceRef),
            ]);

            // Guard: if already delivered, skip (idempotent)
            if (txSnap.exists && txSnap.data()!.status === 'delivered') {
              return;
            }

            // 1. Update transaction
            tx.update(doc.ref, {
              trackingStatus,
              status: 'delivered',
              deliveredAt: FieldValue.serverTimestamp(),
            });

            // 2. Credit seller balance: pending -> available
            if (sellerBalanceDoc.exists) {
              const balanceData = sellerBalanceDoc.data()!;
              const txns = balanceData.transactions || [];

              // Guard against negative pendingBalance
              const currentPending = balanceData.pendingBalance || 0;
              let actualPayout = sellerPayout;
              if (currentPending < sellerPayout) {
                logger.warn(`[checkShippedTracking] pendingBalance (${currentPending}) < sellerPayout (${sellerPayout}) for seller ${sellerId}`);
                actualPayout = Math.min(sellerPayout, Math.max(0, currentPending));
              }

              const updatedTransactions = txns.map((txn: any) => {
                if (txn.id === transactionId) {
                  return { ...txn, status: 'completed' };
                }
                return txn;
              });

              tx.update(sellerBalanceRef, {
                pendingBalance: FieldValue.increment(-actualPayout),
                availableBalance: FieldValue.increment(actualPayout),
                totalEarnings: FieldValue.increment(actualPayout),
                transactions: updatedTransactions,
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
          });

          deliveredCount++;

          // Send system message to chat (non-critical)
          if (data.chatId) {
            try {
              let participants: string[] = [];
              const chatSnap = await db.collection('chats').doc(data.chatId).get();
              if (chatSnap.exists) {
                participants = (chatSnap.data()?.participants as string[]) || [];
              }

              await db.collection('messages').add({
                chatId: data.chatId,
                senderId: 'system',
                receiverId: 'system',
                type: 'system',
                content: 'Colis livre ! La transaction est terminee. Les fonds ont ete transferes au vendeur.',
                participants,
                timestamp: FieldValue.serverTimestamp(),
                status: 'sent',
                isRead: true,
              });
            } catch (msgErr) {
              logger.warn('[checkShippedTracking] Failed to send system message', {
                transactionId,
                error: msgErr instanceof Error ? msgErr.message : msgErr,
              });
            }
          }

          // Push notification to buyer
          try {
            const articleTitle = data.articleTitle || 'votre commande';
            await sendPushNotification(
              data.buyerId,
              'Colis livre !',
              `Votre commande ${articleTitle} a ete livree.`,
              { transactionId, articleId: data.articleId || '' },
              'order_delivered'
            );
          } catch (notifErr) {
            logger.warn('[checkShippedTracking] Failed to send buyer notification', {
              transactionId,
              error: notifErr instanceof Error ? notifErr.message : notifErr,
            });
          }

          logger.info('[checkShippedTracking] Transaction delivered', {
            transactionId,
            trackingNumber: data.trackingNumber,
          });
        } else {
          // Just update tracking status if changed
          if (trackingStatus !== data.trackingStatus) {
            await doc.ref.update({ trackingStatus });
          }
        }
      } catch (err) {
        errorCount++;
        logger.error('[checkShippedTracking] Error checking tracking', {
          transactionId,
          trackingNumber: data.trackingNumber,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    logger.info('[checkShippedTracking] Run complete', {
      checked: shippedSnap.size,
      delivered: deliveredCount,
      errors: errorCount,
    });
  }
);
