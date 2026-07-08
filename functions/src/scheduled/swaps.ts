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
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';
import { refundSwapTopUpIfPaid } from '../callable/swaps';
import { writeAdminAlert } from '../utils/failedOperations';
import { captureServerEvent } from '../lib/analytics';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function swapDaysOpen(swap: FirebaseFirestore.DocumentData): number {
  const createdAt = swap.createdAt;
  if (createdAt && typeof createdAt.toMillis === 'function') {
    return Math.round(((Date.now() - createdAt.toMillis()) / MS_PER_DAY) * 100) / 100;
  }
  return 0;
}

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
      // F81: bound each query (a large backlog must not load unboundedly).
      const [proposedSnap, paymentPendingSnap] = await Promise.all([
        db
          .collection('swaps')
          .where('status', '==', 'proposed')
          .where('createdAt', '<', cutoff)
          .limit(MAX_PER_STATUS)
          .get(),
        db
          .collection('swaps')
          .where('status', '==', 'payment_pending')
          .where('createdAt', '<', cutoff)
          .limit(MAX_PER_STATUS)
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

      // F78: cancel each swap TRANSACTIONALLY with a status re-check. A blind
      // batch.update would clobber a 'payment_pending' swap whose top-up was paid
      // (webhook → 'accepted') between the query and the write, trapping the
      // payer's funds. The per-doc tx only cancels if the status is STILL one we
      // queried, so a state change between read and write is never overwritten.
      const cancelled: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
      for (const doc of staleDocs) {
        try {
          const swap = await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            if (!snap.exists) return null;
            const data = snap.data()!;
            // Re-verify the status is still expirable (not paid into 'accepted').
            if (data.status !== 'proposed' && data.status !== 'payment_pending') {
              return null;
            }
            tx.update(doc.ref, {
              status: 'cancelled',
              cancelReason: data.status === 'payment_pending'
                ? 'payment_pending_expired_7d'
                : 'proposed_expired_7d',
              updatedAt: FieldValue.serverTimestamp(),
            });
            return data;
          });
          if (swap) cancelled.push({ id: doc.id, data: swap });
        } catch (cancelErr) {
          logger.error('[expireStaleProposedSwaps] failed to cancel swap', {
            swapId: doc.id,
            error: cancelErr instanceof Error ? cancelErr.message : cancelErr,
          });
        }
      }

      // 2. Release items + notify initiators (non-critical side-effects). Only for
      // the swaps actually cancelled above (status re-check passed).
      for (const { id: swapId, data: swap } of cancelled) {
        try {
          await releaseSwapPartyItems(swap);
        } catch (releaseErr) {
          logger.error('[expireStaleProposedSwaps] Failed to release party items', {
            swapId,
            error: releaseErr instanceof Error ? releaseErr.message : releaseErr,
          });
        }

        if (swap.initiatorId) {
          try {
            await sendPushNotification(
              swap.initiatorId,
              'Échange expiré',
              'Ta proposition d\'échange est restée sans suite et a été annulée.',
              { swapId },
              'swap_update'
            );
          } catch (notifErr) {
            logger.warn('[expireStaleProposedSwaps] Failed to notify initiator', {
              swapId,
              error: notifErr instanceof Error ? notifErr.message : notifErr,
            });
          }
        }
      }

      logger.info(`[expireStaleProposedSwaps] Expired ${cancelled.length} stale swaps`);
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

/**
 * B9 — Dispute aging surveillance (swaps + transactions).
 *
 * A `disputed` swap (openSwapDispute) or a `disputed` transaction
 * (reportTransactionProblem / failed delivery / chargeback) has NO automatic
 * exit: the only resolution is an ADMIN callable (resolveSwapDispute /
 * resolveDispute). We MUST NOT auto-decide — the direction of a dispute is not
 * machine-derivable. But "never resolved" cannot mean "frozen forever, unseen":
 * funds + engaged articles stay locked sine die if a dispute is forgotten.
 *
 * This job gives OPS VISIBILITY without touching the dispute: it scans disputes
 * older than DISPUTE_AGING_THRESHOLD and writes ONE `swap_dispute_aging` /
 * `transaction_dispute_aging` admin_alert per dispute. Idempotent + non-spammy
 * via a `disputeAlertedAt` stamp (CF-only — both collections' update rules are
 * strict allowlists that cannot write this field client-side): once stamped, the
 * dispute is no longer re-alerted. The stamp write is transactional and re-checks
 * the dispute is still open + not already alerted, so two overlapping runs cannot
 * double-alert.
 *
 * Runs every 6 hours. Requires composite indexes:
 *   swaps        (status ASC, disputeOpenedAt ASC)
 *   transactions (status ASC, disputedAt ASC)
 */
const DISPUTE_AGING_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const MAX_AGING_PER_COLLECTION = 300;

export const alertAgingDisputes = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - DISPUTE_AGING_THRESHOLD_MS);

    try {
      const [swapSnap, txSnap] = await Promise.all([
        db
          .collection('swaps')
          .where('status', '==', 'disputed')
          .where('disputeOpenedAt', '<', cutoff)
          .limit(MAX_AGING_PER_COLLECTION)
          .get(),
        db
          .collection('transactions')
          .where('status', '==', 'disputed')
          .where('disputedAt', '<', cutoff)
          .limit(MAX_AGING_PER_COLLECTION)
          .get(),
      ]);

      let alerted = 0;
      let skipped = 0;

      // Stamp `disputeAlertedAt` transactionally (re-check open + not-yet-alerted)
      // BEFORE writing the alert, so an overlapping run cannot double-alert.
      async function claimAlert(
        ref: FirebaseFirestore.DocumentReference
      ): Promise<FirebaseFirestore.DocumentData | null> {
        return db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const data = snap.data()!;
          if (data.status !== 'disputed' || data.disputeAlertedAt) return null;
          tx.update(ref, { disputeAlertedAt: FieldValue.serverTimestamp() });
          return data;
        });
      }

      for (const doc of swapSnap.docs) {
        const data = await claimAlert(doc.ref);
        if (!data) {
          skipped++;
          continue;
        }
        await writeAdminAlert({
          kind: 'swap_dispute_aging',
          severity: 'warning',
          refId: doc.id,
          message: `Litige d'échange ouvert depuis plus de ${DISPUTE_AGING_THRESHOLD_MS / 86400000} jours sans résolution. Articles engagés et complément éventuel gelés — revue admin requise.`,
          context: {
            disputeReason: typeof data.disputeReason === 'string' ? data.disputeReason : null,
            disputeOpenedBy: typeof data.disputeOpenedBy === 'string' ? data.disputeOpenedBy : null,
            statusBeforeDispute:
              typeof data.statusBeforeDispute === 'string' ? data.statusBeforeDispute : null,
            initiatorId: typeof data.initiatorId === 'string' ? data.initiatorId : null,
            receiverId: typeof data.receiverId === 'string' ? data.receiverId : null,
          },
        });
        alerted++;
      }

      for (const doc of txSnap.docs) {
        const data = await claimAlert(doc.ref);
        if (!data) {
          skipped++;
          continue;
        }
        await writeAdminAlert({
          kind: 'transaction_dispute_aging',
          severity: 'warning',
          refId: doc.id,
          message: `Litige d'achat ouvert depuis plus de ${DISPUTE_AGING_THRESHOLD_MS / 86400000} jours sans résolution. Fonds gelés en fenêtre de litige — revue admin requise.`,
          context: {
            statusBeforeDispute:
              typeof data.statusBeforeDispute === 'string' ? data.statusBeforeDispute : null,
            buyerId: typeof data.buyerId === 'string' ? data.buyerId : null,
            sellerId: typeof data.sellerId === 'string' ? data.sellerId : null,
            deliveryType: typeof data.deliveryType === 'string' ? data.deliveryType : null,
          },
        });
        alerted++;
      }

      logger.info('[alertAgingDisputes] run complete', {
        swaps: swapSnap.size,
        transactions: txSnap.size,
        alerted,
        skipped,
      });
    } catch (error) {
      logger.error('[alertAgingDisputes] Error scanning aging disputes', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);
