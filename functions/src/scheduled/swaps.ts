/**
 * Scheduled swap functions
 * Firebase Functions v7 - using onSchedule
 *
 * ============================================================
 * SWAP ZONE MODEL CHANGE (single permanent generalist zone)
 * ============================================================
 * The Swap Zone moved from time-windowed thematic parties to ONE permanent,
 * generalist, always-active zone with NO endDate.
 *
 * As a result:
 *  - `updateSwapPartyStatuses` (upcoming -> active -> ended transitions) is
 *    OBSOLETE and disabled. It is NO LONGER exported from index.ts. The body
 *    is kept commented for reversibility, with a hard `isGeneralist` exclusion
 *    as double-safety so a permanent zone can never be flipped to `ended`.
 *  - `sendSwapZoneReminders` (3-days-before-start reminders) is OBSOLETE and
 *    disabled (no startDate window anymore). Kept commented for reversibility.
 *  - `cleanupEndedParty` was the ONLY mechanism freeing `isPending` items of
 *    stale `proposed` swaps. It is replaced by `expireStaleProposedSwaps`
 *    (time-window-agnostic, runs hourly) — see below.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

/**
 * Release all `swapPartyItems` linked to a swap (isPending -> false) for both
 * sides. Mirrors the item-release logic that used to live in cleanupEndedParty
 * and in the callable `releasePartyItems` helper.
 */
async function releaseSwapPartyItems(swap: FirebaseFirestore.DocumentData): Promise<void> {
  if (!swap.partyId) return;

  const partyItemsRef = db.collection('swapPartyItems');

  const initiatorItems = getSwapItems(swap, 'initiator');
  for (const item of initiatorItems) {
    if (!item?.articleId) continue;
    const q = await partyItemsRef
      .where('partyId', '==', swap.partyId)
      .where('articleId', '==', item.articleId)
      .where('sellerId', '==', swap.initiatorId)
      .get();
    for (const d of q.docs) {
      await d.ref.update({ isPending: false });
    }
  }

  const receiverItems = getSwapItems(swap, 'receiver');
  for (const item of receiverItems) {
    if (!item?.articleId) continue;
    const q = await partyItemsRef
      .where('partyId', '==', swap.partyId)
      .where('articleId', '==', item.articleId)
      .where('sellerId', '==', swap.receiverId)
      .get();
    for (const d of q.docs) {
      await d.ref.update({ isPending: false });
    }
  }
}

/**
 * Stale `proposed` swaps expire after this delay. A proposed swap that was
 * never accepted/declined within this window is cancelled and its party items
 * are freed. Easy to tune.
 */
const PROPOSED_SWAP_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/**
 * Expire stale proposed swaps (REPLACEMENT for cleanupEndedParty).
 *
 * Time-window-agnostic safety net for the permanent Swap Zone: without the old
 * party-ended cleanup, items locked by a `proposed` swap that is never accepted
 * or declined would stay `isPending: true` forever. This job:
 *   1. Finds every swap still in status 'proposed' older than the expiry delay
 *   2. Flips it to 'cancelled' (cancelReason: 'proposed_expired_7d')
 *   3. Releases its swapPartyItems (isPending -> false)
 *   4. Notifies the initiator (the receiver is notified by the existing
 *      onSwapStatusUpdated trigger on the 'cancelled' transition)
 *
 * Runs every hour. Works for swaps with or without a partyId.
 *
 * Requires composite index: swaps (status ASC, createdAt ASC).
 */
export const expireStaleProposedSwaps = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const cutoff = new Date(Date.now() - PROPOSED_SWAP_EXPIRY_MS);

    try {
      const staleSnap = await db
        .collection('swaps')
        .where('status', '==', 'proposed')
        .where('createdAt', '<', cutoff)
        .get();

      if (staleSnap.empty) {
        logger.info('[expireStaleProposedSwaps] No stale proposed swaps found');
        return;
      }

      logger.info('[expireStaleProposedSwaps] Cancelling stale proposed swaps', {
        count: staleSnap.size,
      });

      // 1. Cancel the swaps in batches.
      let batch = db.batch();
      let count = 0;
      for (const doc of staleSnap.docs) {
        batch.update(doc.ref, {
          status: 'cancelled',
          cancelReason: 'proposed_expired_7d',
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
      for (const doc of staleSnap.docs) {
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
              'Proposition d\'échange expirée',
              'Ta proposition d\'échange est restée sans réponse et a été annulée.',
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

      logger.info(`[expireStaleProposedSwaps] Expired ${staleSnap.size} stale proposed swaps`);
    } catch (error) {
      logger.error('[expireStaleProposedSwaps] Error expiring stale proposed swaps', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);

// ============================================================
// OBSOLETE — disabled with the single permanent Swap Zone model.
// Kept (commented) for reversibility. Not exported from index.ts.
// ============================================================
//
// `updateSwapPartyStatuses` transitioned parties upcoming -> active -> ended
// based on startDate/endDate and ran cleanupEndedParty on `ended`. The
// permanent generalist zone has no endDate, so there is nothing to transition.
// Double-safety: were this ever re-enabled, it MUST exclude isGeneralist zones
// from any transition to `ended` (a permanent zone must never end).
//
// export const updateSwapPartyStatuses = onSchedule(
//   { schedule: 'every 5 minutes', region: 'northamerica-northeast1', memory: '512MiB' },
//   async () => {
//     const now = new Date();
//     const partiesSnapshot = await db
//       .collection('swapParties')
//       .where('status', 'in', ['upcoming', 'active'])
//       .get();
//     for (const partyDoc of partiesSnapshot.docs) {
//       const party = partyDoc.data();
//       // DOUBLE-SAFETY: never transition the permanent generalist zone.
//       if (party.isGeneralist === true) continue;
//       const startDate = party.startDate?.toDate();
//       const endDate = party.endDate?.toDate();
//       let newStatus: string | null = null;
//       if (party.status === 'upcoming' && startDate && now >= startDate) newStatus = 'active';
//       else if (party.status === 'active' && endDate && now >= endDate) newStatus = 'ended';
//       if (newStatus) {
//         await partyDoc.ref.update({ status: newStatus, updatedAt: FieldValue.serverTimestamp() });
//         // if (newStatus === 'ended') await cleanupEndedParty(partyDoc.id, party.name || 'Swap Zone');
//       }
//     }
//   }
// );
//
// `sendSwapZoneReminders` sent a push 3 days before a party's startDate. The
// permanent zone has no startDate window, so reminders no longer make sense.
//
// export const sendSwapZoneReminders = onSchedule(
//   { schedule: '0 10 * * *', region: 'northamerica-northeast1', timeZone: 'America/Montreal', memory: '512MiB' },
//   async () => { /* obsolete: no startDate window in the permanent Swap Zone */ }
// );
