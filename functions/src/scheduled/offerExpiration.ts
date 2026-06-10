/**
 * Scheduled offer expiration
 * Firebase Functions v7 - using onSchedule
 *
 * Expires stale offer messages whose expiresAt has passed but whose
 * status is still 'pending' in Firestore. The client calculates
 * expiresAt (48h from creation) and displays "Expired" locally, but
 * this job ensures the Firestore status is authoritative so that
 * other readers (triggers, other clients) see the correct state.
 *
 * Runs every hour.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/**
 * F80: bound the stale-offer query per run. An unbounded .get() loads every
 * stale offer into memory (OOM/timeout at scale). The next hourly run picks up
 * any remainder, so capping per run never loses work.
 */
const MAX_OFFERS_PER_RUN = 1000;

/**
 * F135: grace window after an offer is ACCEPTED before it is force-expired when
 * never consumed (no transaction created). 48h mirrors the 48h pending-offer TTL
 * — a buyer who accepted but never paid within two days has abandoned the deal,
 * and we must NOT let an accepted offer lock a negotiated price forever
 * (verifyAcceptedOfferForNegotiatedAmount in payments.ts matches accepted offers
 * by amount with no time bound).
 */
const ACCEPTED_OFFER_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * Transaction statuses that count as having CONSUMED an accepted offer. Any
 * non-cancelled transaction for the buyer + chat means the negotiated price was
 * used (or is in flight), so the accepted offer must be left untouched. A
 * 'cancelled' transaction does NOT consume the offer (the buyer may legitimately
 * retry), so it is excluded — but a cancelled-then-stale offer still expires via
 * the grace window below.
 */
const LIVE_TRANSACTION_STATUSES = new Set<string>([
  'pending_payment',
  'meetup_pending',
  'meetup_confirmed',
  'meetup_completed',
  'paid',
  'label_created',
  'shipped',
  'delivered',
  'completed',
  'disputed',
  'refunded',
  'refund_in_progress',
  'delivery_failed',
  'lost',
  'return_requested',
]);

/** Coerces a Firestore Timestamp / Date / millis / ISO string to millis, or null. */
function toMillis(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof (raw as any).toMillis === 'function') {
    const ms = (raw as any).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Find all offer messages that are still pending but past their
 * expiresAt timestamp and flip them to 'expired'.
 */
export const expireStaleOffers = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const now = new Date();

    try {
      // Query all offer messages still pending past their expiry
      // Requires composite index: type ASC, offer.status ASC, offer.expiresAt ASC
      const pendingOffersSnap = await db
        .collection('messages')
        .where('type', '==', 'offer')
        .where('offer.status', '==', 'pending')
        .where('offer.expiresAt', '<', now)
        .limit(MAX_OFFERS_PER_RUN)
        .get();

      if (pendingOffersSnap.empty) {
        logger.info('[expireStaleOffers] No stale offers found');
        return;
      }

      // Batch update in chunks to respect Firestore 500-op limit
      let batch = db.batch();
      let count = 0;
      let totalExpired = 0;

      for (const doc of pendingOffersSnap.docs) {
        batch.update(doc.ref, { 'offer.status': 'expired' });
        count++;
        totalExpired++;

        if (count >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      logger.info(`[expireStaleOffers] Expired ${totalExpired} stale offers`);
    } catch (error) {
      logger.error('[expireStaleOffers] Error expiring stale offers', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);

/**
 * F135: expire ACCEPTED offers that were never consumed by a transaction.
 *
 * An offer flipped to `accepted` (non-meetup shipping offer; the buyer pays
 * separately via checkout) but never turned into a transaction locks the
 * negotiated price at perpetuity — `verifyAcceptedOfferForNegotiatedAmount`
 * matches accepted offers by amount with NO time bound, so the buyer could come
 * back weeks later and pay the stale negotiated price even if the article price
 * has since risen. We expire such offers after a 48h grace window.
 *
 * Consumption guard (cohérent avec F84 batch guard): the flip to `expired` runs
 * inside a per-offer runTransaction that RE-READS the offer (still `accepted`?)
 * and checks that NO live (non-cancelled) transaction exists for this buyer +
 * chat. A consumed offer (transaction created) is left untouched. The re-check
 * inside the transaction closes the race where a buyer pays between the query
 * and the write.
 *
 * Grace window source (most precise first):
 *   1. offer.acceptedAt (stamped by chatService.acceptOffer, F135)
 *   2. offer.expiresAt   (fallback for offers accepted before acceptedAt existed)
 *   3. message timestamp (last resort)
 *
 * Runs every hour.
 */
export const expireStaleAcceptedOffers = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const nowMs = Date.now();

    try {
      // Composite index: type ASC, offer.status ASC (existing chatId/type/status
      // index covers a superset; a dedicated type+offer.status index is added).
      const acceptedOffersSnap = await db
        .collection('messages')
        .where('type', '==', 'offer')
        .where('offer.status', '==', 'accepted')
        .limit(MAX_OFFERS_PER_RUN)
        .get();

      if (acceptedOffersSnap.empty) {
        logger.info('[expireStaleAcceptedOffers] No accepted offers found');
        return;
      }

      let totalExpired = 0;
      let totalConsumed = 0;
      let totalWithinGrace = 0;

      for (const offerDoc of acceptedOffersSnap.docs) {
        const data = offerDoc.data();
        const offer = data.offer ?? {};

        // Grace window: skip offers accepted too recently to be considered
        // abandoned. Pick the most precise available timestamp.
        const acceptedAtMs =
          toMillis(offer.acceptedAt) ?? toMillis(offer.expiresAt) ?? toMillis(data.timestamp);
        if (acceptedAtMs == null) {
          // No usable timestamp at all — skip (cannot decide it is stale).
          continue;
        }
        if (nowMs - acceptedAtMs < ACCEPTED_OFFER_GRACE_MS) {
          totalWithinGrace++;
          continue;
        }

        // Consumption check: any live transaction for this buyer + chat?
        // The buyer is the offer SENDER (the buyer proposes, the seller accepts).
        const buyerId: unknown = data.senderId;
        const chatId: unknown = data.chatId;
        if (typeof buyerId !== 'string' || typeof chatId !== 'string') {
          continue;
        }

        // Index: transactions(buyerId ASC, chatId ASC, status ASC) — preflight
        // read OUTSIDE the runTransaction (the in-tx re-read of the offer is the
        // authoritative guard against a pay-between-query-and-write race).
        const txSnap = await db
          .collection('transactions')
          .where('buyerId', '==', buyerId)
          .where('chatId', '==', chatId)
          .get();
        const consumed = txSnap.docs.some((t) =>
          LIVE_TRANSACTION_STATUSES.has(t.data()?.status)
        );
        if (consumed) {
          totalConsumed++;
          continue;
        }

        // Atomic flip: re-read the offer, re-confirm it is still 'accepted', and
        // expire it. If a concurrent checkout consumed it (status moved on) we
        // skip. We do NOT re-query transactions inside the tx (cross-collection
        // query is not transactional); the live-tx preflight above plus the
        // offer status re-read are the guard — once a transaction is created the
        // offer is never re-flipped here because a NEW run's preflight will see
        // the live transaction.
        try {
          const flipped = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(offerDoc.ref);
            if (!fresh.exists) return false;
            const freshOffer = fresh.data()?.offer ?? {};
            if (freshOffer.status !== 'accepted') return false;
            tx.update(offerDoc.ref, {
              'offer.status': 'expired',
              'offer.expiredReason': 'accepted_unconsumed',
              'offer.expiredAt': FieldValue.serverTimestamp(),
            });
            return true;
          });
          if (flipped) totalExpired++;
        } catch (txError) {
          logger.warn('[expireStaleAcceptedOffers] Failed to expire one offer', {
            messageId: offerDoc.id,
            error: txError instanceof Error ? txError.message : txError,
          });
        }
      }

      logger.info('[expireStaleAcceptedOffers] Run complete', {
        scanned: acceptedOffersSnap.size,
        expired: totalExpired,
        consumed: totalConsumed,
        withinGrace: totalWithinGrace,
      });
    } catch (error) {
      logger.error('[expireStaleAcceptedOffers] Error expiring accepted offers', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);
