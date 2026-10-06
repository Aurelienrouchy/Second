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

      let totalExpired = 0;
      for (const candidate of pendingOffersSnap.docs) {
        const expired = await db.runTransaction(async (tx) => {
          const current = (await tx.get(candidate.ref)).data();
          const expiresAt = toMillis(current?.offer?.expiresAt);
          // A query snapshot can be stale after acceptance or replacement.
          if (current?.offer?.status !== 'pending' || expiresAt == null || expiresAt >= now.getTime()) return false;
          tx.update(candidate.ref, { 'offer.status': 'expired', 'offer.expiredAt': FieldValue.serverTimestamp() });
          return true;
        });
        if (expired) totalExpired++;
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

        try {
          const flipped = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(offerDoc.ref);
            if (!fresh.exists) return false;
            const freshOffer = fresh.data()?.offer ?? {};
            if (freshOffer.status !== 'accepted') return false;
            const freshData = fresh.data()!;
            const chatId = freshData.chatId;
            if (typeof chatId !== 'string') return false;
            // Transactional reads prevent checkout/acceptance from racing the
            // expiry write. Modern agreements use an exact message link.
            const agreements = await tx.get(db.collection('transactions').where('chatId', '==', chatId));
            const consumed = agreements.docs.some((d) => {
              const agreement = d.data();
              if (!LIVE_TRANSACTION_STATUSES.has(agreement.status)) return false;
              if (freshOffer.transactionId) return d.id === freshOffer.transactionId;
              if (agreement.offerMessageId) return agreement.offerMessageId === offerDoc.id;
              // Conservative legacy fallback when no link was ever persisted.
              return agreement.buyerId === (freshOffer.buyerId ?? freshData.senderId) &&
                (agreement.amount == null || agreement.amount === freshOffer.amount);
            });
            if (consumed) { totalConsumed++; return false; }
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
