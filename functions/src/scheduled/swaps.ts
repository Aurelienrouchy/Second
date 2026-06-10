/**
 * Scheduled swap functions
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * SWAP ZONE MODEL: ONE permanent, generalist, always-open zone with NO time
 * window, NO themes, NO join/leave. The old thematic schedulers
 * (updateSwapPartystatuses / sendSwapZoneReminders) are gone.
 *
 * expireStaleProposedSwaps is the only swap cron. It frees items that would
 * otherwise stay locked (isPending: true) forever:
 *   - 'proposed' swaps never accepted/declined within the expiry window
 *   - 'payment_pending' swaps (top-up accepted but never paid) within the same
 *     window. No refund is needed because nothing was ever charged (the Stripe
 *     PaymentIntent for a top-up is only confirmed via the webhook on success).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';
import { refundSwapTopUpIfPaid } from '../callable/swaps';

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

/**
 * Release all `swapPartyItems` linked to a swap (isPending -> false) for both
 * sides.
 */
async function releaseSwapPartyItems(swap: FirebaseFirestore.DocumentData): Promise<void> {
  if (!swap.partyId) return;

  const partyItemsRef = db.collection('swapPartyItems');

  for (const side of ['initiator', 'receiver'] as const) {
    const sellerId = side === 'initiator' ? swap.initiatorId : swap.receiverId;
    for (const item of getSwapItems(swap, side)) {
      if (!item?.articleId) continue;
      const q = await partyItemsRef
        .where('partyId', '==', swap.partyId)
        .where('articleId', '==', item.articleId)
        .where('sellerId', '==', sellerId)
        .get();
      for (const d of q.docs) {
        await d.ref.update({ isPending: false });
      }
    }
  }
}

/**
 * Stale swaps expire after this delay. Applies to 'proposed' (never answered)
 * and 'payment_pending' (top-up accepted but never paid).
 */
const STALE_SWAP_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/**
 * Expire stale swaps that are still locking items.
 *
 * For each swap older than the expiry delay in status 'proposed' or
 * 'payment_pending':
 *   1. Flip it to 'cancelled' (cancelReason reflects the source state)
 *   2. Release its swapPartyItems (isPending -> false)
 *   3. Notify the initiator (the receiver is notified by the onSwapStatusUpdated
 *      trigger on the 'cancelled' transition)
 *
 * No Stripe refund is ever required here: a 'payment_pending' swap by definition
 * was never paid (payment success would have moved it to 'accepted' via webhook).
 *
 * Runs every hour. Requires composite index: swaps (status ASC, createdAt ASC).
 */
export const expireStaleProposedSwaps = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const cutoff = new Date(Date.now() - STALE_SWAP_EXPIRY_MS);

    try {
      const [proposedSnap, paymentPendingSnap] = await Promise.all([
        db
          .collection('swaps')
          .where('status', '==', 'proposed')
          .where('createdAt', '<', cutoff)
          .get(),
        db
          .collection('swaps')
          .where('status', '==', 'payment_pending')
          .where('createdAt', '<', cutoff)
          .get(),
      ]);

      const staleDocs = [...proposedSnap.docs, ...paymentPendingSnap.docs];

      if (staleDocs.length === 0) {
        logger.info('[expireStaleProposedSwaps] No stale swaps found');
        return;
      }

      logger.info('[expireStaleProposedSwaps] Cancelling stale swaps', {
        proposed: proposedSnap.size,
        paymentPending: paymentPendingSnap.size,
      });

      // 1. Cancel the swaps in batches.
      let batch = db.batch();
      let count = 0;
      for (const doc of staleDocs) {
        const fromStatus = doc.data().status;
        batch.update(doc.ref, {
          status: 'cancelled',
          cancelReason: fromStatus === 'payment_pending'
            ? 'payment_pending_expired_7d'
            : 'proposed_expired_7d',
          updatedAt: FieldValue.serverTimestamp(),
        });
        count++;
        if (count >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }

      // 2. Release items + notify initiators (non-critical side-effects).
      for (const doc of staleDocs) {
        const swap = doc.data();
        try {
          await releaseSwapPartyItems(swap);
        } catch (releaseErr) {
          logger.error('[expireStaleProposedSwaps] Failed to release party items', {
            swapId: doc.id,
            error: releaseErr instanceof Error ? releaseErr.message : releaseErr,
          });
        }

        if (swap.initiatorId) {
          try {
            await sendPushNotification(
              swap.initiatorId,
              'Échange expiré',
              'Ta proposition d\'échange est restée sans suite et a été annulée.',
              { swapId: doc.id },
              'swap_update'
            );
          } catch (notifErr) {
            logger.warn('[expireStaleProposedSwaps] Failed to notify initiator', {
              swapId: doc.id,
              error: notifErr instanceof Error ? notifErr.message : notifErr,
            });
          }
        }
      }

      logger.info(`[expireStaleProposedSwaps] Expired ${staleDocs.length} stale swaps`);
    } catch (error) {
      logger.error('[expireStaleProposedSwaps] Error expiring stale swaps', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);
