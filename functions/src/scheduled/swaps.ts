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

/** F81: bound each unfiltered status query so a backlog cannot OOM the run. */
const MAX_PER_STATUS = 300;

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

/**
 * Post-acceptance swaps stall after this delay. Applies to the intermediate
 * money-bearing statuses 'accepted' / 'photos_pending' / 'shipping' where one
 * party went silent (F51/F52). 14 days is intentionally longer than the
 * proposal expiry (7d): the parties already committed (top-up may be paid,
 * photos may be exchanged), so we give the exchange more room before forcibly
 * unwinding it.
 */
const STALE_POST_ACCEPTANCE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** Statuses an abandoned post-acceptance swap can be stuck in. */
const POST_ACCEPTANCE_STALE_STATUSES = ['accepted', 'photos_pending', 'shipping'] as const;

/**
 * Expire stalled post-acceptance swaps (F51/F52).
 *
 * For each swap in 'accepted' / 'photos_pending' / 'shipping' whose last update
 * is older than the delay:
 *   1. Refund the paid top-up, if any (idempotent rf_swap_${swapId}); the
 *      charge.refunded webhook claws the payee wallet complement back. Funds were
 *      NOT yet released to withdrawable balance (a released top-up implies a
 *      'completed' swap, which this query never matches).
 *   2. Release both sides' swapPartyItems (isPending -> false). The swap leaves
 *      ACTIVE_SWAP_STATUSES so the articles become eligible for new swaps.
 *   3. Transition the swap to 'expired'.
 *
 * Idempotent: the cancel write is transactional and re-checks the status, and the
 * refund key is deterministic per swap. Runs every hour.
 *
 * Requires composite index: swaps (status ASC, updatedAt ASC).
 */
export const expireStalePostAcceptanceSwaps = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async () => {
    const cutoff = new Date(Date.now() - STALE_POST_ACCEPTANCE_EXPIRY_MS);

    try {
      const snaps = await Promise.all(
        POST_ACCEPTANCE_STALE_STATUSES.map((status) =>
          db
            .collection('swaps')
            .where('status', '==', status)
            .where('updatedAt', '<', cutoff)
            .get()
        )
      );

      const staleDocs = snaps.flatMap((s) => s.docs);
      if (staleDocs.length === 0) {
        logger.info('[expireStalePostAcceptanceSwaps] No stale post-acceptance swaps found');
        return;
      }

      logger.info('[expireStalePostAcceptanceSwaps] Expiring stale post-acceptance swaps', {
        count: staleDocs.length,
      });

      let expired = 0;
      let skipped = 0;
      let errors = 0;

      for (const doc of staleDocs) {
        const swapId = doc.id;
        try {
          // Transition transactionally, re-checking the status for idempotence.
          const swap = await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            if (!snap.exists) return null;
            const data = snap.data()!;
            if (!(POST_ACCEPTANCE_STALE_STATUSES as readonly string[]).includes(data.status)) {
              return null; // status moved on between query and tx
            }
            tx.update(doc.ref, {
              status: 'expired',
              cancelReason: `post_acceptance_expired_14d_from_${data.status}`,
              updatedAt: FieldValue.serverTimestamp(),
            });
            return data;
          });

          if (!swap) {
            skipped++;
            continue;
          }

          // Refund the paid top-up (idempotent) + release items + notify.
          await refundSwapTopUpIfPaid(swap, swapId);
          await releaseSwapPartyItems(swap);

          for (const target of [swap.initiatorId, swap.receiverId]) {
            if (!target) continue;
            try {
              await sendPushNotification(
                target,
                'Échange expiré',
                'Un échange est resté sans progression et a été annulé. Tout complément payé a été remboursé.',
                { swapId },
                'swap_update'
              );
            } catch (notifErr) {
              logger.warn('[expireStalePostAcceptanceSwaps] notify failed', {
                swapId,
                error: notifErr instanceof Error ? notifErr.message : notifErr,
              });
            }
          }

          expired++;
        } catch (err) {
          errors++;
          logger.error('[expireStalePostAcceptanceSwaps] error expiring swap', {
            swapId,
            error: err instanceof Error ? err.message : err,
          });
        }
      }

      logger.info('[expireStalePostAcceptanceSwaps] run complete', { expired, skipped, errors });
    } catch (error) {
      logger.error('[expireStalePostAcceptanceSwaps] Error expiring post-acceptance swaps', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);
