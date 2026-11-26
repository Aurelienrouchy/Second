/**
 * Paiement — Frais acheteur et réduction liée au forfait boutique du vendeur.
 *
 * Éclaté depuis functions/src/callable/payments.ts (3881 lignes).
 * `callable/payments.ts` reste la façade : index.ts et sweepPendingLabels
 * importent depuis là, inchangés.
 */
import * as logger from 'firebase-functions/logger';
import { db } from '../../config/firebase';

// Rate limiting: financial callables share a 1-minute sliding window.
// maxCallsUnauthenticated is 0 everywhere — these endpoints require auth.

export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * F24: Stripe's minimum card charge for CAD is 50 cents. A mixed wallet+card
 * payment whose card remainder falls below this would create an invalid
 * PaymentIntent, so we reject such a split before debiting the wallet.
 */

/**
 * Maps a paid-shop `tier` to the buyer-fee reduction fraction applied at
 * checkout (Paid shop model). The reduction lowers ONLY the buyer protection
 * fee — the seller still receives 100% of the article price (0% seller
 * commission). The forfait pricing/percentages are not yet frozen ("à
 * calibrer"), so we map to round, bounded fractions that `normalizeFeeReduction`
 * (utils/fees) clamps into [0, 1]:
 *   - basic   (L'Atelier) → 0    (standard fees)
 *   - pro     (Le Comptoir) → 0.5 (~half the standard buyer fee)
 *   - premium (La Maison) → 1    (0% buyer fee — Second monetizes via the
 *                                  subscription only)
 *
 * Any unknown/absent tier yields 0 (full fee). Deterministic — no I/O — so it
 * is safe to call inside runTransaction.
 */

export function feeReductionForShopTier(tier: unknown): number {
  switch (tier) {
    case 'pro':
      return 0.5;
    case 'premium':
      return 1;
    default:
      return 0;
  }
}

/**
 * F134 — a paid tier only grants a reduction while the forfait is ACTIVE, i.e.
 * `tierPaidUntil` is in the future. An expired (or never-paid) forfait reverts to
 * basic (reduction 0). `tierPaidUntil` is CF-only (firestore.rules), stamped by
 * the shop_tier webhook after payment. Accepts a Firestore Timestamp, a Date, an
 * ISO string, or a millis number — anything unparseable / past → expired.
 */

/**
 * F134 — a paid tier only grants a reduction while the forfait is ACTIVE, i.e.
 * `tierPaidUntil` is in the future. An expired (or never-paid) forfait reverts to
 * basic (reduction 0). `tierPaidUntil` is CF-only (firestore.rules), stamped by
 * the shop_tier webhook after payment. Accepts a Firestore Timestamp, a Date, an
 * ISO string, or a millis number — anything unparseable / past → expired.
 */

export function isShopTierActive(tierPaidUntil: unknown): boolean {
  if (tierPaidUntil == null) return false;
  let untilMs: number;
  if (typeof (tierPaidUntil as any).toMillis === 'function') {
    untilMs = (tierPaidUntil as any).toMillis();
  } else if (tierPaidUntil instanceof Date) {
    untilMs = tierPaidUntil.getTime();
  } else if (typeof tierPaidUntil === 'number') {
    untilMs = tierPaidUntil;
  } else if (typeof tierPaidUntil === 'string') {
    untilMs = Date.parse(tierPaidUntil);
  } else {
    return false;
  }
  return Number.isFinite(untilMs) && untilMs > Date.now();
}

/**
 * Resolves the buyer-fee reduction from a shop doc: the tier reduction ONLY when
 * the shop is approved AND the paid forfait is still active (tierPaidUntil > now).
 * Expired or basic → 0.
 */

/**
 * Resolves the buyer-fee reduction from a shop doc: the tier reduction ONLY when
 * the shop is approved AND the paid forfait is still active (tierPaidUntil > now).
 * Expired or basic → 0.
 */

export function reductionForShopDoc(shop: Record<string, any> | undefined): number {
  if (!shop || shop.status !== 'approved') return 0;
  if (!isShopTierActive(shop.tierPaidUntil)) return 0;
  return feeReductionForShopTier(shop.tier);
}

/**
 * Resolves the buyer-fee reduction for a purchase from the SELLER's approved
 * shop tier, read 100% server-side (never trusted from the client). Resolution
 * order, both OUTSIDE runTransaction (no I/O inside a Firestore transaction):
 *   1. The article's denormalized `shopId` (stamped at creation in products.ts)
 *      → read that shop doc, use its `tier` only when `status === 'approved'`.
 *   2. Fallback: query the seller's shops by `ownerId`, pick the approved one.
 *
 * Best-effort: any lookup failure returns 0 (full fee) — a shop-tier read must
 * never block a paid order. Returns a bounded fraction in [0, 1].
 */

/**
 * Resolves the buyer-fee reduction for a purchase from the SELLER's approved
 * shop tier, read 100% server-side (never trusted from the client). Resolution
 * order, both OUTSIDE runTransaction (no I/O inside a Firestore transaction):
 *   1. The article's denormalized `shopId` (stamped at creation in products.ts)
 *      → read that shop doc, use its `tier` only when `status === 'approved'`.
 *   2. Fallback: query the seller's shops by `ownerId`, pick the approved one.
 *
 * Best-effort: any lookup failure returns 0 (full fee) — a shop-tier read must
 * never block a paid order. Returns a bounded fraction in [0, 1].
 */

export async function resolveBuyerFeeReduction(params: {
  shopId?: unknown;
  sellerId: string;
}): Promise<number> {
  const { shopId, sellerId } = params;
  try {
    if (typeof shopId === 'string' && shopId.length > 0) {
      const shopSnap = await db.collection('shops').doc(shopId).get();
      if (shopSnap.exists) {
        // Reduction only when approved AND the paid forfait is still active
        // (tierPaidUntil > now). Expired tier → 0 (basic).
        return reductionForShopDoc(shopSnap.data());
      }
      // shopId present but shop missing → no reduction.
      return 0;
    }

    // No denormalized shopId on the article: resolve via the seller's shops.
    // Single equality filter on ownerId → covered by the automatic single-field
    // index. Approved-status filtering is done in memory (no composite index).
    const shopsSnap = await db
      .collection('shops')
      .where('ownerId', '==', sellerId)
      .get();
    const approvedShop = shopsSnap.docs.find((d) => d.data()?.status === 'approved');
    if (approvedShop) {
      return reductionForShopDoc(approvedShop.data());
    }
  } catch (error) {
    logger.warn('createTransaction: shop tier lookup failed, applying full buyer fee', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return 0;
}

// =============================================================================
// HELPERS — Seller origin address resolution
// =============================================================================
