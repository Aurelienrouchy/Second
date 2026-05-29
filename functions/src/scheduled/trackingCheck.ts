/**
 * Scheduled tracking check (safety-net poller)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * The PRIMARY tracking path is now the ShipEngine webhook (http/shipEngineWebhook.ts).
 * This poller is a SPACED-OUT safety net: it runs every 12 hours and reconciles
 * any parcel whose webhook was missed, by polling ShipEngine directly.
 *
 * For each SHIPPING transaction in `label_created` or `shipped`:
 *   - DELIVERED  -> applyTrackingOutcome moves pendingBalance -> heldBalance and
 *                   stamps fundsReleaseAt = +7d (held-funds contract); status
 *                   becomes 'delivered' (release handled by releaseHeldFunds).
 *   - FAILURE    -> status 'delivery_failed', funds frozen, both parties notified
 *                   (refund resolved by the admin refund callable).
 *   - TRANSIT/IN_TRANSIT (first real carrier scan) -> label_created becomes
 *                   'shipped' (decouples label printing from actual shipment).
 *
 * It also nudges sellers whose label_created parcel has had NO carrier scan for
 * LABEL_STALE_DAYS (printed a label but never dropped it off).
 *
 * Pagination: orderBy('createdAt','asc') + startAfter cursor, looping until the
 * collection is exhausted, with a per-call ShipEngine throttle to respect rate
 * limits. Uses the existing composite index (status ASC, createdAt ASC).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { getShipEngine, ShipEngineClient } from '../config/shipEngine';
import { sendPushNotification } from '../utils/notifications';
import { applyTrackingOutcome } from '../utils/trackingTransition';
import { processReturnDelivered } from '../utils/returnRefund';

/** Page size per Firestore query. */
const PAGE_SIZE = 200;

/** Hard cap on parcels processed per run (across both statuses) to bound time. */
const MAX_TRANSACTIONS_PER_RUN = 600;

/** Throttle between ShipEngine tracking calls (ms) to respect rate limits. */
const SHIPENGINE_THROTTLE_MS = 150;

/** A label_created parcel with no carrier scan after this many days nudges the seller. */
const LABEL_STALE_DAYS = 3;
const LABEL_STALE_MS = LABEL_STALE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Statuses whose parcels we poll.
 *   - label_created / shipped: forward leg (buyer-bound), polled via trackingNumber.
 *   - return_requested: reverse leg (seller-bound), polled via returnTrackingNumber.
 * All three reuse the SAME composite index (status ASC, createdAt ASC).
 */
const TRACKED_STATUSES = ['label_created', 'shipped', 'return_requested'] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const checkShippedTracking = onSchedule(
  {
    schedule: 'every 12 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'],
  },
  async () => {
    const shipEngine = getShipEngine();
    if (!shipEngine) {
      logger.warn('[checkShippedTracking] ShipEngine not configured, skipping');
      return;
    }

    let deliveredCount = 0;
    let shippedCount = 0;
    let failedCount = 0;
    let staleNudged = 0;
    let errorCount = 0;
    let processed = 0;

    const now = Date.now();

    // Paginate each tracked status independently with a stable orderBy + cursor.
    for (const status of TRACKED_STATUSES) {
      let lastCreatedAt: Timestamp | null = null;
      let keepGoing = true;

      while (keepGoing && processed < MAX_TRANSACTIONS_PER_RUN) {
        let query = db
          .collection('transactions')
          .where('status', '==', status)
          .orderBy('createdAt', 'asc')
          .limit(PAGE_SIZE);

        if (lastCreatedAt) {
          query = query.startAfter(lastCreatedAt);
        }

        const snap = await query.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
          if (processed >= MAX_TRANSACTIONS_PER_RUN) break;

          const data = doc.data();
          const transactionId = doc.id;
          lastCreatedAt = (data.createdAt as Timestamp) ?? lastCreatedAt;
          processed++;

          // No tracking number yet (label_created may have one already).
          if (!data.trackingNumber) {
            // Nudge sellers who printed a label but never got a carrier scan.
            if (status === 'label_created') {
              await maybeNudgeStaleLabel(doc.ref, data, transactionId, now).then(
                (nudged) => {
                  if (nudged) staleNudged++;
                }
              );
            }
            continue;
          }

          try {
            await sleep(SHIPENGINE_THROTTLE_MS);
            const carrierCode = data.carrierCode || 'intelcom_ca';
            const tracking = await shipEngine.getTracking(carrierCode, data.trackingNumber);
            const mapped = ShipEngineClient.mapStatus(tracking.statusCode);

            const result = await applyTrackingOutcome(transactionId, mapped, 'poller');

            if (result.kind === 'delivered' && result.changed) deliveredCount++;
            else if (result.kind === 'shipped' && result.changed) shippedCount++;
            else if (result.kind === 'failed' && result.changed) failedCount++;

            // Stale-label nudge for label_created parcels still without a scan.
            if (status === 'label_created' && result.kind !== 'shipped') {
              const nudged = await maybeNudgeStaleLabel(doc.ref, data, transactionId, now);
              if (nudged) staleNudged++;
            }
          } catch (err) {
            errorCount++;
            logger.error('[checkShippedTracking] error checking tracking', {
              transactionId,
              trackingNumber: data.trackingNumber,
              error: err instanceof Error ? err.message : err,
            });
          }
        }

        keepGoing = snap.size === PAGE_SIZE;
      }
    }

    logger.info('[checkShippedTracking] run complete', {
      processed,
      shipped: shippedCount,
      delivered: deliveredCount,
      failed: failedCount,
      staleNudged,
      errors: errorCount,
    });
  }
);

/**
 * If a label_created parcel has had no carrier scan for LABEL_STALE_DAYS and we
 * haven't nudged in the last window, send the seller a "drop off your parcel"
 * reminder. Idempotent via `labelStaleNudgedAt`.
 */
async function maybeNudgeStaleLabel(
  ref: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  transactionId: string,
  nowMs: number
): Promise<boolean> {
  const labelAt =
    data.labelCreatedAt instanceof Timestamp
      ? data.labelCreatedAt.toMillis()
      : data.shippedAt instanceof Timestamp
        ? data.shippedAt.toMillis()
        : null;

  if (labelAt === null || nowMs - labelAt < LABEL_STALE_MS) {
    return false;
  }

  // Only nudge once per stale window.
  const lastNudge =
    data.labelStaleNudgedAt instanceof Timestamp ? data.labelStaleNudgedAt.toMillis() : 0;
  if (nowMs - lastNudge < LABEL_STALE_MS) {
    return false;
  }

  try {
    await ref.update({ labelStaleNudgedAt: FieldValue.serverTimestamp() });
    if (data.sellerId) {
      await sendPushNotification(
        data.sellerId,
        'Pensez a expedier votre colis',
        `L'etiquette de "${data.articleTitle || 'votre vente'}" a ete creee mais le transporteur n'a pas encore scanne le colis. Deposez-le rapidement.`,
        { transactionId, articleId: data.articleId || '' },
        'label_stale_reminder'
      );
    }
    return true;
  } catch (err) {
    logger.warn('[checkShippedTracking] stale-label nudge failed', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}
