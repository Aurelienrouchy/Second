/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 *
 * Shipping via ShipEngine (Intelcom + Canada Post)
 * Payment via Stripe Connect Standard (destination charges)
 * Commission via service fee calculation (application_fee_amount)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine, ShipEngineClient, ShipEngineAddress } from '../config/shipEngine';
import { getStripe } from '../config/stripe';
import { calculateFees, calculateServiceFee, getServiceFeeConfig, calculateTaxOnServiceFee, getTaxConfig } from '../utils/fees';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { applyTrackingOutcome, DELIVERABLE_STATUSES } from '../utils/trackingTransition';
import { issueTransactionRefund } from '../utils/refund';
import { sendPushNotification } from '../utils/notifications';
import { captureServerEvent } from '../lib/analytics';
import { deriveStripeAccountState, stripeAccountFirestoreFields } from '../utils/stripeAccount';
import { isShippingEnabled } from '../config/featureFlags';

// Rate limiting: financial callables share a 1-minute sliding window.
// maxCallsUnauthenticated is 0 everywhere — these endpoints require auth.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * F24: Stripe's minimum card charge for CAD is 50 cents. A mixed wallet+card
 * payment whose card remainder falls below this would create an invalid
 * PaymentIntent, so we reject such a split before debiting the wallet.
 */
const STRIPE_MIN_CHARGE_CENTS = 50;

// =============================================================================
// HELPERS — Shop tier → buyer-fee reduction (Paid shop model)
// =============================================================================

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
function feeReductionForShopTier(tier: unknown): number {
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
function isShopTierActive(tierPaidUntil: unknown): boolean {
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
function reductionForShopDoc(shop: Record<string, any> | undefined): number {
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
async function resolveBuyerFeeReduction(params: {
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

const CA_POSTAL_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

// The 13 Canadian province / territory codes (Stripe + Canada Post standard).
const CA_PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/**
 * Validates a buyer shipping address server-side for a Canadian shipping label.
 *
 * Mirrors the strictness of the seller onboarding postal-code check
 * (createStripeConnectAccount): a label must carry a real, deliverable
 * destination or `createLabel` will fail AFTER the buyer has been charged.
 *
 * Returns the normalized fields on success, or throws HttpsError
 * 'invalid-argument' (the caller validates BEFORE locking the article /
 * capturing payment).
 *
 * NOTE: never trust the client `country` — we force CA and reject anything else.
 */
function validateBuyerShippingAddress(raw: unknown): {
  street: string;
  city: string;
  province: string;
  postalCode: string;
} {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'L\'adresse de livraison est requise');
  }
  const addr = raw as Record<string, unknown>;

  // Country must be Canada (default + only supported destination).
  const country = (addr.country ?? 'CA').toString().trim().toUpperCase();
  if (country !== 'CA') {
    throw new HttpsError(
      'invalid-argument',
      'Seules les adresses de livraison canadiennes sont prises en charge'
    );
  }

  const street = (addr.street ?? '').toString().trim();
  if (street.length === 0) {
    throw new HttpsError('invalid-argument', 'La rue de livraison est requise');
  }

  const city = (addr.city ?? '').toString().trim();
  if (city.length === 0) {
    throw new HttpsError('invalid-argument', 'La ville de livraison est requise');
  }

  const province = (addr.province ?? '').toString().trim().toUpperCase();
  if (!CA_PROVINCE_CODES.has(province)) {
    throw new HttpsError(
      'invalid-argument',
      'La province de livraison est invalide (code a 2 lettres requis, ex: QC)'
    );
  }

  const postalCode = (addr.postalCode ?? '').toString().replace(/\s/g, '').toUpperCase();
  if (!CA_POSTAL_RE.test(postalCode)) {
    throw new HttpsError(
      'invalid-argument',
      'Le code postal de livraison est invalide (format A1A 1A1)'
    );
  }

  return { street, city, province, postalCode };
}

/**
 * Resolves the seller's real shipping origin address from their profile,
 * with a last-resort fallback to the article's denormalized `location`.
 *
 * Resolution order:
 *   1. Seller `addresses[]` entry flagged `isDefault` (must have street + postal)
 *   2. First seller `addresses[]` entry with a street + postal code
 *   3. Article `location` (postal code only) — uses seller display name as
 *      shipper name and a minimal line1 so ShipEngine can still rate by postal.
 *
 * Returns `null` when no usable origin (i.e. no valid Canadian postal code)
 * can be found — the caller must then reject the transaction. There is NO
 * Montreal fallback: a label must ship from the seller's real address.
 */
export function resolveSellerOriginAddress(
  sellerData: Record<string, any>,
  articleData: Record<string, any>
): ShipEngineAddress | null {
  const sellerName = sellerData.displayName || 'Vendeur';
  const sellerPhone =
    typeof sellerData.phoneNumber === 'string' && sellerData.phoneNumber.trim().length > 0
      ? sellerData.phoneNumber.trim()
      : undefined;

  const normalizePostal = (raw: unknown): string | null => {
    const cleaned = (raw ?? '').toString().replace(/\s/g, '').toUpperCase();
    return CA_POSTAL_RE.test(cleaned) ? cleaned : null;
  };

  const addresses: any[] = Array.isArray(sellerData.addresses) ? sellerData.addresses : [];
  const candidate =
    addresses.find((a) => a?.isDefault && a?.street && a?.postalCode) ||
    addresses.find((a) => a?.street && a?.postalCode) ||
    null;

  if (candidate) {
    const postal = normalizePostal(candidate.postalCode);
    const street =
      typeof candidate.street === 'string' ? candidate.street.trim() : '';
    const city = (candidate.city ?? '').toString().trim();
    const province = (candidate.province ?? '').toString().trim();
    // P2-f: NO Montreal/QC fallback. A real origin requires postal + street +
    // city + province from the seller's actual address; fabricating
    // 'Montreal'/'QC' produces a wrong rate for any seller outside Montreal,
    // which then diverges from the authoritative server re-pricing. If any
    // component is missing we fall through and ultimately reject (return null).
    if (postal && street.length > 0 && city.length > 0 && province.length > 0) {
      return {
        name: sellerName,
        addressLine1: street,
        cityLocality: city,
        stateProvince: province,
        postalCode: postal,
        countryCode: 'CA',
        phone: sellerPhone,
      };
    }
  }

  // Last resort: article.location (denormalized). No street is stored, so we
  // use the city as line1 to let ShipEngine rate by zone — but city AND
  // province must be present alongside a valid postal code. NO Montreal/QC
  // fallback (P2-f): reject rather than fabricate.
  const loc = articleData.location;
  if (loc && typeof loc === 'object') {
    const postal = normalizePostal(loc.postalCode);
    const city = (loc.city ?? '').toString().trim();
    const province = (loc.province ?? '').toString().trim();
    if (postal && city.length > 0 && province.length > 0) {
      return {
        name: sellerName,
        addressLine1: city,
        cityLocality: city,
        stateProvince: province,
        postalCode: postal,
        countryCode: 'CA',
        phone: sellerPhone,
      };
    }
  }

  return null;
}

/**
 * Verifies, server-side, that a negotiated (off-list) purchase amount is backed
 * by a real accepted offer for THIS buyer + article.
 *
 * Why (P1 — negotiated amount must be bound to an accepted offer):
 * `createTransaction` previously accepted ANY positive `amount <= articleData.price`
 * as a "negotiated price", trusting that the chat offer/accept flow had validated
 * it. A malicious or buggy client could therefore pay an arbitrary lower amount
 * (e.g. 1$ on a 500$ article) without any seller-accepted offer. We now require,
 * for every off-list amount, the existence of an offer message that:
 *   - lives in a chat for THIS article (chat.articleId === articleId),
 *   - was SENT by the buyer (senderId === buyerId — the buyer proposes, the
 *     seller accepts by flipping offer.status to 'accepted'),
 *   - has offer.status === 'accepted',
 *   - has offer.amount === the requested amount (exact match).
 *
 * Reads happen OUTSIDE runTransaction (no I/O inside a Firestore transaction).
 * The article price invariant is still re-checked atomically inside the tx.
 *
 * Throws HttpsError('failed-precondition') when no matching accepted offer is
 * found. Returns the matched offer message id (for logging / linkage).
 */
async function verifyAcceptedOfferForNegotiatedAmount(params: {
  articleId: string;
  buyerId: string;
  amount: number;
  chatId: unknown;
}): Promise<string> {
  const { articleId, buyerId, amount, chatId } = params;

  if (typeof chatId !== 'string' || chatId.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      'Un prix négocié nécessite une offre acceptée. Veuillez passer par la conversation pour faire une offre.'
    );
  }

  // Bind the chat to this article: the offer must belong to a conversation about
  // the article being purchased, and the buyer must be a participant.
  const chatSnap = await db.collection('chats').doc(chatId).get();
  if (!chatSnap.exists) {
    throw new HttpsError('failed-precondition', 'Conversation introuvable pour cette offre.');
  }
  const chatData = chatSnap.data()!;
  if (chatData.articleId !== articleId) {
    throw new HttpsError(
      'failed-precondition',
      'L\'offre acceptée ne correspond pas à cet article.'
    );
  }
  const participants: unknown = chatData.participants;
  if (!Array.isArray(participants) || !participants.includes(buyerId)) {
    throw new HttpsError(
      'permission-denied',
      'Vous n\'êtes pas autorisé à utiliser cette offre.'
    );
  }

  // Query accepted offers in this chat (composite index:
  // messages(chatId ASC, type ASC, offer.status ASC) already exists).
  const offersSnap = await db
    .collection('messages')
    .where('chatId', '==', chatId)
    .where('type', '==', 'offer')
    .where('offer.status', '==', 'accepted')
    .get();

  const matched = offersSnap.docs.find((d) => {
    const m = d.data();
    return m.senderId === buyerId && typeof m.offer?.amount === 'number' && m.offer.amount === amount;
  });

  if (!matched) {
    throw new HttpsError(
      'failed-precondition',
      'Aucune offre acceptée ne correspond à ce montant. Veuillez faire ou confirmer une offre dans la conversation.'
    );
  }

  return matched.id;
}

// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================

export const getShippingEstimate = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
  // Rate limit: this endpoint hits the paid ShipEngine rating API on every
  // call. Keep the unauthenticated cap at 0 (estimates are requested from the
  // authenticated checkout flow) and bound authenticated callers to a sane
  // browsing rate.
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, {
    functionName: 'getShippingEstimate',
    maxCallsAuthenticated: 30,
    maxCallsUnauthenticated: 0,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  const { fromAddress, toAddress, weight, dimensions } = request.data;

  if (!fromAddress || !toAddress) {
    throw new HttpsError('invalid-argument', 'From and to addresses are required');
  }

  const shipEngine = getShipEngine();
  if (!shipEngine) {
    throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
  }

  // P1-9: an ESTIMATE only needs a valid Canadian postal code on each endpoint.
  // ShipEngine rates by zone (postal → postal), so a missing street/city must
  // NOT block a quote — the client completes the full address later, before the
  // authoritative server re-pricing in createTransaction (which DOES require a
  // complete, deliverable address). When street/city are absent we fall back to
  // the postal code as a placeholder line1/city so ShipEngine can still rate.
  // NO Montreal fallback (P2-f): we never fabricate a QC/Montreal location —
  // only the buyer/seller-provided postal code drives the zone.
  const normalizePostal = (raw: unknown): string | null => {
    const cleaned = (raw ?? '').toString().replace(/\s/g, '').toUpperCase();
    return CA_POSTAL_RE.test(cleaned) ? cleaned : null;
  };

  const fromPostal = normalizePostal(fromAddress.postalCode);
  if (!fromPostal) {
    throw new HttpsError(
      'invalid-argument',
      'Le code postal d\'expedition (vendeur) est invalide. Un code postal canadien valide (format A1A 1A1) est requis pour estimer la livraison.'
    );
  }
  // Fallback when street/city are not yet known: use the postal code so the
  // ShipEngine address shape stays valid and rating-by-zone still works.
  const fromStreet = (fromAddress.street ?? '').toString().trim() || fromPostal;
  const fromCity = (fromAddress.city ?? '').toString().trim() || fromPostal;

  const toPostal = normalizePostal(toAddress.postalCode);
  if (!toPostal) {
    throw new HttpsError(
      'invalid-argument',
      'Le code postal de livraison (acheteur) est invalide. Un code postal canadien valide (format A1A 1A1) est requis pour estimer la livraison.'
    );
  }
  const toCity = (toAddress.city ?? '').toString().trim() || toPostal;

  try {
    const parcelWeight = parseFloat(weight) || 0.5;
    const parcelLength = parseFloat(dimensions?.length) || 30;
    const parcelWidth = parseFloat(dimensions?.width) || 25;
    const parcelHeight = parseFloat(dimensions?.height) || 10;

    logger.info('Getting ShipEngine multi-carrier rates', {
      from: fromPostal,
      to: toPostal,
      weight: parcelWeight,
    });

    // Rate shopping across Intelcom + Canada Post via ShipEngine
    const rates = await shipEngine.getRates(
      {
        name: fromAddress.name || 'Vendeur',
        addressLine1: fromStreet,
        cityLocality: fromCity,
        stateProvince: (fromAddress.province || 'QC').toString().trim(),
        postalCode: fromPostal,
        countryCode: 'CA',
        phone: fromAddress.phone || undefined,
      },
      {
        name: toAddress.name || 'Acheteur',
        addressLine1: (toAddress.street ?? '').toString().trim() || toCity,
        cityLocality: toCity,
        stateProvince: (toAddress.province || 'QC').toString().trim(),
        postalCode: toPostal,
        countryCode: 'CA',
        phone: toAddress.phone || undefined,
      },
      {
        weight: { value: parcelWeight, unit: 'kilogram' },
        dimensions: {
          length: parcelLength,
          width: parcelWidth,
          height: parcelHeight,
          unit: 'centimeter',
        },
      }
    );

    // Format rates for the client
    const formattedRates = rates
      .sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount)
      .slice(0, 5)
      .map((rate) => ({
        rateId: rate.rateId,
        carrier: rate.carrierFriendlyName,
        carrierCode: rate.carrierCode,
        serviceName: rate.serviceType,
        deliveryDays: `${rate.estimatedDeliveryDays} jour${rate.estimatedDeliveryDays > 1 ? 's' : ''} ouvrable${rate.estimatedDeliveryDays > 1 ? 's' : ''}`,
        amount: rate.shippingAmount.amount,
        currency: rate.shippingAmount.currency,
        deliveryType: rate.deliveryType,
      }));

    logger.info(`Retrieved ${formattedRates.length} shipping rates from ShipEngine`);

    return {
      success: true,
      rates: formattedRates,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error getting shipping estimate:', error);
    throw new HttpsError('internal', `Failed to get shipping estimate: ${message}`);
  }
});

// =============================================================================
// GET SERVICE FEE — Returns fee info for client display
// =============================================================================

export const getServiceFee = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
  // Light rate limit: no external API here (pure fee computation), so the cap
  // is generous — it only guards against abusive bursts. Unauthenticated cap 0.
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, {
    functionName: 'getServiceFee',
    maxCallsAuthenticated: 60,
    maxCallsUnauthenticated: 0,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  const { articlePrice, articleId } = request.data;

  if (!articlePrice || articlePrice <= 0) {
    throw new HttpsError('invalid-argument', 'Article price is required');
  }

  // F96 — honest display of the paid-shop buyer-fee reduction.
  // When the caller provides the `articleId`, resolve the SELLER's active shop
  // tier reduction server-side (same authority as createStripeCheckout) so the
  // displayed fee matches what will actually be charged. Without `articleId`
  // (legacy callers), we fall back to the full fee (reduction 0). The reduction
  // is NEVER trusted from the client — it is read from the shop doc here exactly
  // like createTransaction. On any lookup failure we degrade to the full fee
  // (resolveBuyerFeeReduction is best-effort and returns 0 on error).
  let feeReduction = 0;
  if (typeof articleId === 'string' && articleId.length > 0) {
    try {
      const articleSnap = await db.collection('articles').doc(articleId).get();
      if (articleSnap.exists) {
        const articleData = articleSnap.data()!;
        if (typeof articleData.sellerId === 'string') {
          feeReduction = await resolveBuyerFeeReduction({
            shopId: articleData.shopId,
            sellerId: articleData.sellerId,
          });
        }
      }
    } catch {
      // Best-effort: a shop lookup failure must never break the fee display.
      feeReduction = 0;
    }
  }

  const serviceFee = calculateServiceFee(articlePrice, feeReduction);
  const config = getServiceFeeConfig();
  // Tax detail (additive, 0 when TAX_ENABLED=false) so the app can render a tax
  // line in PriceBreakdown (vague app) without changing the total when OFF.
  const tax = calculateTaxOnServiceFee(serviceFee);
  const taxConfig = getTaxConfig();

  return {
    success: true,
    serviceFee,
    // The reduction fraction applied (0 = full fee). Lets the client surface the
    // discount honestly. Defaults to 0 when no articleId / no active shop tier.
    feeReduction,
    serviceFeePercent: config.percent,
    serviceFeeFixed: config.fixed,
    serviceFeeMin: config.min,
    taxEnabled: taxConfig.enabled,
    taxGst: tax.gst,
    taxQst: tax.qst,
    taxTotal: tax.taxTotal,
  };
});

// =============================================================================
// CREATE TRANSACTION — Atomic article check + transaction creation
// =============================================================================

/**
 * Atomically verifies that an article is still available (not sold, not
 * inactive, not deleted) and creates a transaction for it.
 *
 * Why this is a Cloud Function rather than a client-side write:
 * - The buyer cannot update `isSold` on the article (Firestore rules
 *   restrict article updates to the seller). Only the Admin SDK can set
 *   isSold from the buyer's context.
 * - A client-side `addDoc` followed by a separate `updateDoc` is NOT
 *   atomic — two buyers can race and both succeed.
 * - Using `runTransaction` with the Admin SDK guarantees exactly one
 *   buyer wins.
 *
 * Supports both delivery types: 'shipping' and 'meetup'.
 */
export const createTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'createTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const {
      articleId,
      deliveryType,
      amount,
      shippingCost,
      shippingAddress,
      meetupSpot,
      chatId,
      shipEngineRateId,
    } = request.data ?? {};

    const buyerId = request.auth.uid;

    // --- Input validation ---------------------------------------------------

    if (typeof articleId !== 'string' || articleId.length === 0) {
      throw new HttpsError('invalid-argument', 'articleId is required');
    }
    if (deliveryType !== 'shipping' && deliveryType !== 'meetup') {
      throw new HttpsError('invalid-argument', 'deliveryType must be "shipping" or "meetup"');
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be a positive number');
    }

    // Holds the strictly-validated buyer shipping address (shipping mode only).
    let validatedShippingAddress: {
      street: string;
      city: string;
      province: string;
      postalCode: string;
    } | null = null;

    if (deliveryType === 'shipping') {
      // F137: server-authoritative shipping flag. The client UI hides shipping,
      // but the callable stays invocable by a direct call — so we gate the
      // financial shipping rail HERE. Meetup is never gated by this flag (handled
      // below, no early return). Default OFF; enable with SHIPPING_ENABLED=true.
      if (!isShippingEnabled()) {
        throw new HttpsError(
          'failed-precondition',
          'La livraison n\'est pas disponible pour le moment. Veuillez utiliser la remise en main propre.'
        );
      }

      // NOTE: the client-supplied `shippingCost` is intentionally NOT trusted.
      // It is re-priced server-side below via ShipEngine. We only require the
      // address and a valid (non-fallback) ShipEngine rateId to re-tarify.
      //
      // Strict server-side address validation (P1-18): a Canadian shipping
      // label needs a deliverable destination (valid CA postal code, province
      // in the 13 codes, non-empty street/city, country=CA) or createLabel
      // would fail AFTER the buyer is charged. We reject BEFORE locking the
      // article / capturing payment.
      validatedShippingAddress = validateBuyerShippingAddress(shippingAddress);

      if (typeof shipEngineRateId !== 'string' || shipEngineRateId.length === 0) {
        throw new HttpsError(
          'invalid-argument',
          'shipEngineRateId is required for shipping. Veuillez rafraichir l\'estimation de livraison.'
        );
      }
      if (shipEngineRateId.startsWith('fallback_')) {
        // A fallback rateId means ShipEngine was unreachable when the buyer
        // requested an estimate. We cannot purchase a real label from it, so
        // we refuse to create a paid order that could never ship.
        throw new HttpsError(
          'failed-precondition',
          'Le tarif de livraison n\'est pas disponible pour le moment. Veuillez rafraichir l\'estimation de livraison.'
        );
      }
    }

    const articleRef = db.collection('articles').doc(articleId);

    // --- Negotiated-amount guard (P1) ---------------------------------------
    //
    // If the buyer pays anything other than the exact listed price, the amount
    // MUST be backed by a seller-accepted offer for this buyer + article. We
    // read the article price pre-transaction to decide whether this is a
    // negotiated purchase, then verify the accepted offer exists. Both the
    // accepted-offer check and the article price invariant are re-validated
    // atomically inside runTransaction below (the offer cannot change the price
    // invariant; this only blocks fabricated low amounts).
    //
    // Reads are OUTSIDE runTransaction (no I/O inside a Firestore transaction).
    //
    // Buyer-fee reduction (Paid shop model, P1-1): resolved here, server-side,
    // from the SELLER's approved shop tier (never the client). The reduction
    // lowers ONLY the buyer protection fee — the seller still receives 100% of
    // the article price. It is deterministic once resolved, so it is applied
    // inside runTransaction below without any further I/O. Defaults to 0 (full
    // fee) when the seller has no approved shop / on any lookup failure.
    let buyerFeeReduction = 0;
    // F136: tracks whether a seller-accepted offer was verified for THIS amount
    // pre-transaction. It gates the atomic price re-check below: an off-list
    // amount is accepted inside runTransaction ONLY when this is true. This closes
    // the price-raise-mid-checkout hole — if the seller raises the article price
    // between this pre-read and the runTransaction, `amount !== livePrice` would
    // otherwise be (mis)treated as a legitimate negotiated price even though no
    // offer was ever verified (the pre-read saw amount == listedPrice, so the
    // verify branch never ran).
    let negotiatedOfferVerified = false;
    {
      const articlePriceSnap = await articleRef.get();
      if (!articlePriceSnap.exists) {
        throw new HttpsError('not-found', 'Cet article n\'existe plus');
      }
      const articlePriceData = articlePriceSnap.data()!;
      const listedPrice = articlePriceData.price;
      if (typeof listedPrice === 'number' && amount !== listedPrice) {
        const matchedOfferId = await verifyAcceptedOfferForNegotiatedAmount({
          articleId,
          buyerId,
          amount,
          chatId,
        });
        negotiatedOfferVerified = true;
        logger.info('createTransaction: negotiated amount backed by accepted offer', {
          articleId, buyerId, amount, listedPrice, matchedOfferId,
        });
      }

      buyerFeeReduction = await resolveBuyerFeeReduction({
        shopId: articlePriceData.shopId,
        sellerId: articlePriceData.sellerId,
      });
    }

    // --- Server-side shipping re-pricing (never trust client shippingCost) ----
    //
    // The buyer-supplied `shippingCost` / `shipEngineRateId` cannot be trusted:
    // a malicious or buggy client could send shippingCost=0.01 with a real
    // rateId, then the platform pays the true ~14$ label at the webhook.
    //
    // We re-quote the exact same origin (seller profile address) / destination
    // (buyer shipping address) / parcel server-side, locate the rate matching
    // the supplied rateId, and use ITS amount as the authoritative shipping
    // cost. If the rateId can no longer be found (expired / tampered), we
    // reject and force the client to re-fetch a fresh estimate.
    //
    // This network call is done OUTSIDE runTransaction (no I/O inside a
    // Firestore transaction). The amount/availability invariants are still
    // re-checked atomically below.
    let serverShippingCost = 0;

    if (deliveryType === 'shipping') {
      const shipEngine = getShipEngine();
      if (!shipEngine) {
        throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
      }

      // Read article (parcel + seller) and seller (origin address) for re-pricing.
      const articlePreSnap = await articleRef.get();
      if (!articlePreSnap.exists) {
        throw new HttpsError('not-found', 'Cet article n\'existe plus');
      }
      const articlePreData = articlePreSnap.data()!;

      const sellerPreSnap = await db.collection('users').doc(articlePreData.sellerId).get();
      if (!sellerPreSnap.exists) {
        throw new HttpsError('not-found', 'Vendeur introuvable');
      }
      const sellerPreData = sellerPreSnap.data()!;

      // Resolve the seller's origin address from their profile — NO Montreal
      // fallback. A real label must ship from the seller's real address.
      const origin = resolveSellerOriginAddress(sellerPreData, articlePreData);
      if (!origin) {
        throw new HttpsError(
          'failed-precondition',
          'Le vendeur n\'a pas renseigne d\'adresse d\'expedition valide. La commande ne peut pas etre creee.'
        );
      }

      // Destination = buyer shipping address. Already strictly validated above
      // (validatedShippingAddress is guaranteed non-null in shipping mode).
      const validatedAddr = validatedShippingAddress!;
      const destination: ShipEngineAddress = {
        name: shippingAddress.name || 'Acheteur',
        addressLine1: validatedAddr.street,
        cityLocality: validatedAddr.city,
        stateProvince: validatedAddr.province,
        postalCode: validatedAddr.postalCode,
        countryCode: 'CA',
        phone: shippingAddress.phone || origin.phone,
      };

      // Parcel from article metadata (same defaults as getShippingEstimate).
      const parcelWeight = parseFloat(articlePreData.weight) || 0.5;
      const dims = articlePreData.dimensions || {};
      const parcel = {
        weight: { value: parcelWeight, unit: 'kilogram' as const },
        dimensions: {
          length: parseFloat(dims.length) || 30,
          width: parseFloat(dims.width) || 25,
          height: parseFloat(dims.height) || 10,
          unit: 'centimeter' as const,
        },
      };

      let rates;
      try {
        rates = await shipEngine.getRates(origin, destination, parcel);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('createTransaction: ShipEngine re-pricing failed', {
          articleId, shipEngineRateId, message,
        });
        throw new HttpsError(
          'unavailable',
          'Impossible de verifier le tarif de livraison pour le moment. Veuillez reessayer.'
        );
      }

      const matchedRate = rates.find((r) => r.rateId === shipEngineRateId);
      if (!matchedRate) {
        // rateId expired or never belonged to this origin/destination/parcel.
        logger.warn('createTransaction: supplied rateId not found in fresh rates', {
          articleId, shipEngineRateId, ratesReturned: rates.length,
        });
        throw new HttpsError(
          'failed-precondition',
          'Le tarif de livraison selectionne a expire. Veuillez rafraichir l\'estimation de livraison.'
        );
      }

      serverShippingCost = matchedRate.shippingAmount.amount;

      logger.info('createTransaction: shipping re-priced server-side', {
        articleId,
        shipEngineRateId,
        clientShippingCost: shippingCost,
        serverShippingCost,
        carrier: matchedRate.carrierCode,
      });
    }

    try {
      const created = await db.runTransaction(async (tx) => {
        const articleSnap = await tx.get(articleRef);

        if (!articleSnap.exists) {
          throw new HttpsError('not-found', 'Cet article n\'existe plus');
        }

        const articleData = articleSnap.data()!;

        if (articleData.isSold === true) {
          throw new HttpsError('failed-precondition', 'Cet article a déjà été vendu');
        }

        if (articleData.isActive === false) {
          throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible');
        }

        if (articleData.sellerId === buyerId) {
          throw new HttpsError('invalid-argument', 'Vous ne pouvez pas acheter votre propre article');
        }

        // Verify the amount is valid:
        // - Exact listed price (live, re-read here) is always accepted.
        // - A negotiated (off-list) price is accepted ONLY when a seller-accepted
        //   offer for this buyer + article + amount was verified pre-transaction
        //   (negotiatedOfferVerified). This block re-checks the price invariant
        //   atomically against the LIVE article.
        // - Amounts above listed price are rejected (overpay protection).
        if (amount > articleData.price) {
          throw new HttpsError(
            'failed-precondition',
            'Le montant dépasse le prix de l\'article.'
          );
        }
        if (amount !== articleData.price && amount <= 0) {
          throw new HttpsError(
            'invalid-argument',
            'Le montant doit être supérieur à zéro.'
          );
        }
        // F136: an off-list amount against the LIVE price MUST be backed by a
        // verified accepted offer. If the seller raised the price between the
        // pre-read and this transaction, `amount !== articleData.price` becomes
        // true without `negotiatedOfferVerified` (the pre-read saw amount ==
        // listedPrice, so the offer check never ran). Reject — the buyer is
        // trying to pay a stale lower price not covered by any accepted offer.
        if (amount !== articleData.price && !negotiatedOfferVerified) {
          throw new HttpsError(
            'failed-precondition',
            'Le prix de l\'article a changé. Veuillez rafraichir la page et reessayer.'
          );
        }

        // For shipping transactions, verify seller has active Stripe Connect
        // before locking the article. This prevents articles from being marked
        // sold for a seller who can't receive payment.
        //
        // Sellers must complete full onboarding via createStripeConnectAccount
        // before their articles can be purchased for shipping. No on-the-fly
        // account creation — Custom accounts require identity + bank info.
        if (deliveryType === 'shipping') {
          const sellerRef = db.collection('users').doc(articleData.sellerId);
          const sellerSnap = await tx.get(sellerRef);
          if (!sellerSnap.exists) {
            throw new HttpsError('not-found', 'Vendeur introuvable');
          }
          const sellerData = sellerSnap.data()!;

          if (!sellerData.stripeAccountId) {
            throw new HttpsError(
              'failed-precondition',
              'Le vendeur n\'a pas encore configure son compte de paiement. Il doit completer son inscription vendeur.'
            );
          }

          if (sellerData.stripeChargesEnabled !== true) {
            throw new HttpsError(
              'failed-precondition',
              'Le compte de paiement du vendeur n\'est pas encore actif. Veuillez reessayer plus tard.'
            );
          }
        }

        // Mark article as sold
        tx.update(articleRef, { isSold: true });

        // Build transaction data — server-side fee calculation (never trust client)
        // Meetup transactions have NO platform fee (aligned with frontend
        // messaging "Aucun frais de plateforme") and no shipping cost.
        // Shipping transactions apply the seller's paid-shop tier reduction to
        // the buyer protection fee (resolved server-side above; deterministic
        // here). `calculateServiceFee` clamps the reduction into [0, 1] and the
        // seller payout is unaffected (still 100% of `amount`).
        const fee = deliveryType === 'meetup'
          ? 0
          : calculateServiceFee(amount, buyerFeeReduction);
        // Shipping cost is the SERVER re-priced value, never the client input.
        const shipping = deliveryType === 'shipping' ? serverShippingCost : 0;
        // Tax on the service fee (0 when TAX_ENABLED=false → totalAmount
        // unchanged; meetup has no fee, so no tax either). Persisted so the
        // webhook's platform_ledger remittance register can reuse the figure.
        const tax = deliveryType === 'meetup'
          ? { taxTotal: 0 }
          : calculateTaxOnServiceFee(fee);
        const totalAmount = Math.round((amount + shipping + fee + tax.taxTotal) * 100) / 100;

        const transactionData: Record<string, any> = {
          articleId,
          buyerId,
          sellerId: articleData.sellerId,
          amount,
          shippingCost: shipping,
          serviceFee: fee,
          // Tax on service fee (0 when OFF). Additive — never undefined.
          taxTotal: tax.taxTotal,
          // Persisted so createStripeCheckout re-applies the SAME reduction when
          // it recomputes the authoritative charge (otherwise it would revert to
          // the full buyer fee). Always a bounded number (0 = full fee), never
          // undefined. Meetup has no fee, so 0 there too.
          buyerFeeReduction: deliveryType === 'meetup' ? 0 : buyerFeeReduction,
          totalAmount,
          sellerPayout: amount,
          deliveryType,
          status: deliveryType === 'shipping' ? 'pending_payment' : 'meetup_pending',
          createdAt: FieldValue.serverTimestamp(),
        };

        if (chatId && typeof chatId === 'string') {
          transactionData.chatId = chatId;
        }

        if (deliveryType === 'shipping') {
          transactionData.shippingAddress = shippingAddress;
          if (shipEngineRateId && typeof shipEngineRateId === 'string') {
            transactionData.shipEngineRateId = shipEngineRateId;
          }
        }

        if (deliveryType === 'meetup' && meetupSpot && typeof meetupSpot === 'object') {
          const cleanSpot: Record<string, any> = {
            name: meetupSpot.name,
            category: meetupSpot.category,
            neighborhood: meetupSpot.neighborhood,
          };
          if (meetupSpot.id) cleanSpot.id = meetupSpot.id;
          if (meetupSpot.address) cleanSpot.address = meetupSpot.address;
          if (meetupSpot.coordinates) cleanSpot.coordinates = meetupSpot.coordinates;
          transactionData.meetupSpot = cleanSpot;
        }

        const newTxRef = db.collection('transactions').doc();
        tx.set(newTxRef, transactionData);

        return {
          id: newTxRef.id,
          sellerId: articleData.sellerId,
          amount,
          totalAmount,
        };
      });

      const transactionId = created.id;

      logger.info('Transaction created', {
        transactionId, articleId, deliveryType, buyerId,
      });

      // Analytics (§12): order_created is the SERVER source of truth for tx
      // creation. Fires once per tx (shipping checkout OR the direct-checkout
      // meetup pre-creation). $insert_id keyed by tx id dedups against the
      // acceptMeetupOffer path (which reuses this tx). distinct_id = buyer.
      await captureServerEvent(buyerId, 'order_created', {
        transaction_id: transactionId,
        article_id: articleId,
        buyer_id: buyerId,
        seller_id: created.sellerId,
        delivery_type: deliveryType,
        amount_cents: Math.round((created.amount ?? 0) * 100),
        negotiated: negotiatedOfferVerified,
        source: deliveryType === 'shipping' ? 'shipping_checkout' : 'meetup_accept',
        $insert_id: `order_created_${transactionId}`,
      });

      return { success: true, transactionId };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating transaction:', error);
      throw new HttpsError('internal', `Failed to create transaction: ${message}`);
    }
  }
);

// =============================================================================
// CREATE STRIPE CHECKOUT — Initialize Stripe PaymentIntent (platform charge)
// =============================================================================

/**
 * Creates a Stripe PaymentIntent for the transaction.
 *
 * Single-rail model (separate charges & transfers): the buyer's card always
 * lands on the PLATFORM account (no transfer_data / no application_fee_amount).
 * The platform keeps the funds — which include the shippingCost (used to pay the
 * ShipEngine label) and the serviceFee. The seller is credited only through the
 * wallet ledger (pendingBalance -> heldBalance -> balance) and paid out by the
 * single platform->connected transfer in walletWithdraw.
 *
 * Two modes (both are platform charges):
 * 1. **No wallet** (walletAmount === 0 or absent): the full buyerTotal is charged
 *    to the card.
 * 2. **Mixed wallet+card** (0 < walletAmount < totalCharge): the wallet portion is
 *    debited from the buyer atomically; the card covers the remaining charge.
 *
 * Returns the PaymentIntent clientSecret for the client to confirm payment.
 *
 * Idempotent: if a PaymentIntent already exists for this transaction,
 * returns the existing clientSecret without creating a new one.
 */
export const createStripeCheckout = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'createStripeCheckout',
      maxCallsAuthenticated: 10,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, walletAmount: rawWalletAmount } = request.data ?? {};

    if (!transactionId || typeof transactionId !== 'string') {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    // walletAmount is optional, in cents, must be a non-negative integer
    const walletAmount = typeof rawWalletAmount === 'number' && Number.isInteger(rawWalletAmount) && rawWalletAmount > 0
      ? rawWalletAmount
      : 0;

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    try {
      const txRef = db.collection('transactions').doc(transactionId);

      // Atomically read, validate, and update fee fields inside a transaction
      // to prevent races where concurrent calls both see no PaymentIntent and
      // double-create.
      const txResult = await db.runTransaction(async (tx) => {
        const transactionDoc = await tx.get(txRef);

        if (!transactionDoc.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }

        const transaction = transactionDoc.data()!;

        // Verify the user is the buyer
        if (transaction.buyerId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'You are not authorized for this transaction');
        }

        // Only allow checkout creation from valid statuses
        const checkoutableStatuses = new Set(['pending_payment']);
        if (!checkoutableStatuses.has(transaction.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot create checkout for transaction in status ${transaction.status}`
          );
        }

        // F137: gate the shipping financial rail server-side. A SHIPPING
        // transaction's checkout charges the buyer a total that includes the
        // ShipEngine label cost — refuse it while shipping is disabled. Only
        // pending_payment (shipping) reaches here; meetup transactions never go
        // through createStripeCheckout, so meetup is unaffected. Default OFF;
        // enable with SHIPPING_ENABLED=true.
        if (transaction.deliveryType === 'shipping' && !isShippingEnabled()) {
          throw new HttpsError(
            'failed-precondition',
            'La livraison n\'est pas disponible pour le moment. Veuillez utiliser la remise en main propre.'
          );
        }

        // Idempotent: if a PaymentIntent already exists, retrieve clientSecret from Stripe
        // (never store client_secret in Firestore — it's a sensitive credential)
        if (transaction.stripePaymentIntentId) {
          const existingFees = calculateFees(
            transaction.amount,
            transaction.shippingCost || 0,
            transaction.buyerFeeReduction,
          );
          return {
            existingCheckout: true,
            fees: existingFees,
            existingPaymentIntentId: transaction.stripePaymentIntentId as string,
            sellerId: transaction.sellerId as string,
            sellerStripeAccountId: '' as string,
            walletDebited: false,
            effectiveWalletAmount: 0,
          };
        }

        // Always recalculate fees server-side for correctness. Re-apply the
        // paid-shop buyer-fee reduction persisted by createTransaction so the
        // authoritative charge matches the reduced fee (clamped into [0, 1] by
        // calculateFees; defaults to full fee when absent). Seller payout is
        // unaffected (still 100% of amount).
        const calculatedFees = calculateFees(
          transaction.amount,
          transaction.shippingCost || 0,
          transaction.buyerFeeReduction,
        );

        // B3: validate the seller's Stripe Connect account BEFORE the wallet debit,
        // inside this transaction (reads-before-writes preserved). Previously the
        // lookup ran AFTER the runTransaction had already debited the wallet, so a
        // seller disabled between createTransaction and checkout threw without
        // reverting — the wallet portion stayed immobilised until cancel/expiry.
        // Doing it here means a missing account aborts the tx with NO debit at all.
        const sellerIdForCheckout = transaction.sellerId as string;
        const sellerSnap = await tx.get(db.collection('users').doc(sellerIdForCheckout));
        if (!sellerSnap.exists) {
          throw new HttpsError('not-found', 'Seller not found');
        }
        const sellerStripeAccountId = sellerSnap.data()!.stripeAccountId;
        if (!sellerStripeAccountId) {
          throw new HttpsError(
            'failed-precondition',
            'Le vendeur n\'a pas encore configuré son compte de paiement'
          );
        }

        // --- Wallet debit (if applicable) ---
        // P2-10 (idempotence): the wallet debit lives INSIDE this runTransaction,
        // but `stripePaymentIntentId` (the existing-checkout guard above) is only
        // stamped AFTER this transaction commits, when the Stripe PI is created
        // out-of-band. That leaves a window where a retry / double-tap re-enters
        // here with no PaymentIntent yet recorded. Without a second guard the
        // wallet would be debited TWICE. We therefore treat an already-recorded
        // `walletAmountUsed` (set atomically alongside the first debit below) as
        // proof the debit already happened: we skip a fresh debit and RE-USE the
        // recorded amount so the downstream Stripe charge math stays consistent.
        let walletDebited = false;
        const totalChargeCents = Math.round(calculatedFees.buyerTotal * 100);
        const alreadyDebitedAmount =
          typeof transaction.walletAmountUsed === 'number' && transaction.walletAmountUsed > 0
            ? transaction.walletAmountUsed
            : 0;

        if (alreadyDebitedAmount > 0) {
          // A previous (committed) call already debited the wallet for this
          // transaction. Do NOT debit again — re-use the recorded amount. The
          // requested walletAmount must match the recorded one (a mismatched
          // retry is a client bug, not a new authorization to debit more).
          if (walletAmount > 0 && walletAmount !== alreadyDebitedAmount) {
            throw new HttpsError(
              'failed-precondition',
              'Un paiement partiel par porte-monnaie a déjà été enregistré pour cette transaction avec un montant différent.'
            );
          }
          walletDebited = true;
        } else if (walletAmount > 0) {
          if (walletAmount >= totalChargeCents) {
            throw new HttpsError(
              'invalid-argument',
              'walletAmount must be less than totalCharge for mixed payment. Use payWithWallet for 100% wallet payments.'
            );
          }

          // F24: Stripe rejects card charges below the CAD minimum (50¢). A mixed
          // payment whose CARD remainder is 1–49¢ would create an invalid
          // PaymentIntent AFTER the wallet was already debited (then the F05 revert
          // fires — a confusing round-trip). Reject cleanly BEFORE debiting: the
          // buyer should pay 100% via wallet (their balance covers all but a few
          // cents) or reduce the wallet amount so the card portion clears 50¢.
          const cardRemainderCents = totalChargeCents - walletAmount;
          if (cardRemainderCents > 0 && cardRemainderCents < STRIPE_MIN_CHARGE_CENTS) {
            throw new HttpsError(
              'failed-precondition',
              'Le montant restant à payer par carte est trop faible. Payez la totalité avec votre porte-monnaie ou réduisez le montant du porte-monnaie utilisé.'
            );
          }

          // Verify buyer has wallet with sufficient balance
          const buyerWalletRef = db.collection('wallets').doc(request.auth!.uid);
          const buyerWalletSnap = await tx.get(buyerWalletRef);

          if (!buyerWalletSnap.exists) {
            throw new HttpsError('failed-precondition', 'Aucun porte-monnaie trouve');
          }
          const buyerWallet = buyerWalletSnap.data()!;
          if (buyerWallet.status !== 'active') {
            throw new HttpsError('failed-precondition', 'Le porte-monnaie n\'est pas actif');
          }
          if (buyerWallet.balance < walletAmount) {
            throw new HttpsError('failed-precondition', 'Solde insuffisant dans le porte-monnaie');
          }

          // Debit buyer wallet
          const newBalance = buyerWallet.balance - walletAmount;
          tx.update(buyerWalletRef, {
            balance: FieldValue.increment(-walletAmount),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Create buyer ledger entry
          const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
          tx.set(buyerLedgerRef, {
            type: 'purchase_debit',
            amount: walletAmount,
            balanceAfter: newBalance,
            description: 'Paiement partiel (porte-monnaie)',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
          });

          walletDebited = true;
        }

        // The authoritative wallet amount for the downstream Stripe charge: the
        // freshly-debited amount, or the previously-recorded one on a retry.
        const effectiveWalletAmount = alreadyDebitedAmount > 0 ? alreadyDebitedAmount : walletAmount;

        // Update fee fields atomically + wallet info. taxTotal is additive (0
        // when TAX_ENABLED=false) and persisted so the webhook's platform_ledger
        // remittance register reuses the authoritative figure.
        const updateData: Record<string, any> = {
          serviceFee: calculatedFees.serviceFee,
          serviceFeePercent: calculatedFees.serviceFeePercent,
          taxTotal: calculatedFees.taxTotal,
          totalAmount: calculatedFees.buyerTotal,
          sellerPayout: calculatedFees.sellerPayout,
        };

        // Only (re)stamp the wallet fields on a FRESH debit. On a retry the
        // fields are already persisted — re-writing them is harmless but
        // unnecessary, and we never overwrite with a smaller/zero value.
        if (walletDebited && alreadyDebitedAmount === 0) {
          updateData.walletAmountUsed = effectiveWalletAmount;
          updateData.paidVia = 'wallet_and_card';
        }

        tx.update(txRef, updateData);

        return {
          existingCheckout: false,
          fees: calculatedFees,
          existingPaymentIntentId: null as string | null,
          sellerId: transaction.sellerId as string,
          sellerStripeAccountId: sellerStripeAccountId as string,
          walletDebited,
          effectiveWalletAmount,
        };
      });

      // Idempotent return: PaymentIntent already existed — retrieve clientSecret from Stripe
      if (txResult.existingCheckout) {
        const existingPI = await stripe.paymentIntents.retrieve(txResult.existingPaymentIntentId!);
        logger.info('Returning existing Stripe PaymentIntent', {
          transactionId,
          paymentIntentId: existingPI.id,
        });
        return {
          success: true,
          clientSecret: existingPI.client_secret,
          feeBreakdown: {
            articlePrice: txResult.fees.articlePrice,
            shippingCost: txResult.fees.shippingCost,
            serviceFee: txResult.fees.serviceFee,
            serviceFeePercent: txResult.fees.serviceFeePercent,
            taxTotal: txResult.fees.taxTotal,
            taxGst: txResult.fees.taxGst,
            taxQst: txResult.fees.taxQst,
            buyerTotal: txResult.fees.buyerTotal,
          },
        };
      }

      // B3: the seller's Stripe Connect account was already validated INSIDE the
      // runTransaction (before the wallet debit) — no money moves on a seller with
      // no account, and the wallet is never left debited on that precondition.

      // Convert dollars to cents for Stripe (all Stripe amounts are in smallest currency unit)
      const totalChargeCents = Math.round(txResult.fees.buyerTotal * 100);

      // P2-10: use the AUTHORITATIVE wallet amount returned by the transaction
      // (freshly-debited, or the previously-recorded amount on a retry) — never
      // the raw request `walletAmount`. A retry that omits walletAmount would
      // otherwise fall into the full card-charge branch while the wallet stays
      // debited, double-charging the buyer.
      const effectiveWalletAmount = txResult.effectiveWalletAmount;

      if (txResult.walletDebited && effectiveWalletAmount > 0) {
        // --- MIXED WALLET + CARD PAYMENT ---
        // Platform receives the card portion (no destination charge).
        // The wallet portion was already debited. Seller will be credited
        // after delivery via explicit transfer.
        const stripeChargeCents = totalChargeCents - effectiveWalletAmount;

        // The application fee applies to the full purchase, but since the
        // wallet portion was already collected, the Stripe portion just needs
        // to cover the remaining charge. The platform fee is effectively
        // collected from the combined wallet+card amount.
        // We do NOT set application_fee_amount here because the platform
        // receives the entire card payment (no transfer_data), so the fee
        // is implicitly captured.
        let paymentIntent;
        try {
          paymentIntent = await stripe.paymentIntents.create(
            {
              amount: stripeChargeCents,
              currency: 'cad',
              metadata: {
                transactionId,
                sellerId: txResult.sellerId,
                buyerId: request.auth!.uid,
                walletAmountUsed: String(effectiveWalletAmount),
                paymentType: 'wallet_and_card',
              },
            },
            // Deterministic key so a retry (same transaction) never creates a
            // second PaymentIntent — Stripe returns the original PI instead.
            { idempotencyKey: `pi_${transactionId}` }
          );
        } catch (stripeError) {
          // F05: Stripe PI creation failed — revert the wallet debit
          logger.error('Stripe PaymentIntent creation failed (mixed) — reverting wallet debit', {
            transactionId,
            walletAmount: effectiveWalletAmount,
            error: stripeError instanceof Error ? stripeError.message : stripeError,
          });

          // F23: re-credit the wallet AND clear walletAmountUsed/paidVia on the
          // transaction in ONE atomic runTransaction. Previously these were two
          // separate operations: if the process died between them, the wallet was
          // refunded but the tx still showed paidVia='wallet_and_card' +
          // walletAmountUsed>0, so a later refund path would re-credit the wallet
          // a second time. Fusing them removes that window entirely.
          const buyerWalletRef = db.collection('wallets').doc(request.auth!.uid);
          await db.runTransaction(async (revertTx) => {
            const walletSnap = await revertTx.get(buyerWalletRef);

            // Always clear the wallet markers on the tx — even if the wallet doc
            // is gone — so no refund path can re-credit a phantom wallet portion.
            revertTx.update(txRef, {
              walletAmountUsed: FieldValue.delete(),
              paidVia: FieldValue.delete(),
            });

            if (!walletSnap.exists) return;

            const walletData = walletSnap.data()!;
            revertTx.update(buyerWalletRef, {
              balance: FieldValue.increment(effectiveWalletAmount),
              updatedAt: FieldValue.serverTimestamp(),
            });

            const revertLedgerRef = buyerWalletRef.collection('ledger').doc();
            revertTx.set(revertLedgerRef, {
              type: 'refund_credit',
              amount: effectiveWalletAmount,
              balanceAfter: (walletData.balance || 0) + effectiveWalletAmount,
              description: 'Remboursement — echec creation paiement',
              transactionId,
              createdAt: FieldValue.serverTimestamp(),
            });
          });

          throw stripeError;
        }

        // Store PaymentIntent ID in the transaction doc
        await txRef.update({
          stripePaymentIntentId: paymentIntent.id,
          stripeCheckoutCreatedAt: FieldValue.serverTimestamp(),
        });

        logger.info('Stripe PaymentIntent created (mixed wallet+card)', {
          transactionId,
          paymentIntentId: paymentIntent.id,
          totalCents: totalChargeCents,
          walletCents: effectiveWalletAmount,
          stripeCents: stripeChargeCents,
        });

        return {
          success: true,
          clientSecret: paymentIntent.client_secret,
          feeBreakdown: {
            articlePrice: txResult.fees.articlePrice,
            shippingCost: txResult.fees.shippingCost,
            serviceFee: txResult.fees.serviceFee,
            serviceFeePercent: txResult.fees.serviceFeePercent,
            taxTotal: txResult.fees.taxTotal,
            taxGst: txResult.fees.taxGst,
            taxQst: txResult.fees.taxQst,
            buyerTotal: txResult.fees.buyerTotal,
            walletAmountUsed: effectiveWalletAmount,
            stripeAmount: stripeChargeCents,
          },
        };
      } else {
        // --- PLATFORM CHARGE (card only, no wallet) ---
        // Separate charges & transfers: the FULL buyerTotal is charged to the
        // platform account (NO transfer_data.destination, NO application_fee_amount).
        // The platform keeps the funds — which include the shippingCost used to pay
        // the ShipEngine label and the serviceFee. The seller is credited ONLY via
        // the wallet (pendingBalance -> heldBalance -> balance) and paid out by the
        // single platform->connected transfer in walletWithdraw. This is the same
        // single-rail model as the mixed wallet+card branch above and the swap
        // top-up. Using transfer_data here would double-finance every sale (the
        // funds would sit stranded on the connected account AND walletWithdraw
        // would transfer again).
        const amountInCents = totalChargeCents;

        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: amountInCents,
            currency: 'cad',
            metadata: {
              transactionId,
              sellerId: txResult.sellerId,
              buyerId: request.auth!.uid,
            },
          },
          // Deterministic key so a retry (same transaction) never creates a
          // second PaymentIntent — Stripe returns the original PI instead.
          { idempotencyKey: `pi_${transactionId}` }
        );

        // Store PaymentIntent ID in the transaction doc (never store client_secret)
        await txRef.update({
          stripePaymentIntentId: paymentIntent.id,
          stripeCheckoutCreatedAt: FieldValue.serverTimestamp(),
        });

        logger.info('Stripe PaymentIntent created (platform charge, card only)', {
          transactionId,
          paymentIntentId: paymentIntent.id,
          amountCents: amountInCents,
        });

        return {
          success: true,
          clientSecret: paymentIntent.client_secret,
          feeBreakdown: {
            articlePrice: txResult.fees.articlePrice,
            shippingCost: txResult.fees.shippingCost,
            serviceFee: txResult.fees.serviceFee,
            serviceFeePercent: txResult.fees.serviceFeePercent,
            taxTotal: txResult.fees.taxTotal,
            taxGst: txResult.fees.taxGst,
            taxQst: txResult.fees.taxQst,
            buyerTotal: txResult.fees.buyerTotal,
          },
        };
      }
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating Stripe checkout', { transactionId, error: message });
      throw new HttpsError('internal', `Failed to create checkout: ${message}`);
    }
  }
);

// =============================================================================
// CREATE STRIPE CONNECT ACCOUNT — Custom account, full in-app onboarding
// =============================================================================

/**
 * Creates a Stripe Connect Custom account for the authenticated seller with
 * ALL required information submitted in a single call so that
 * `charges_enabled` becomes `true` immediately (or very shortly after).
 *
 * The client collects:
 *   - Personal info: firstName, lastName, dob (day/month/year)
 *   - Address: line1, city, province, postalCode
 *   - Banking: transitNumber (5 digits), institutionNumber (3 digits),
 *     accountNumber (7-12 digits)
 *   - ToS acceptance IP (caller's public IP address)
 *
 * No Stripe hosted UI, no Account Links, no redirects.
 *
 * Idempotent: if the seller already has a stripeAccountId, returns it
 * along with current charges_enabled / requirements status.
 */
export const createStripeConnectAccount = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'createStripeConnectAccount',
      maxCallsAuthenticated: 3,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;
    const data = request.data ?? {};

    // ── Input validation ────────────────────────────────────────────────────

    // Personal info
    if (typeof data.firstName !== 'string' || data.firstName.trim().length < 1) {
      throw new HttpsError('invalid-argument', 'Le prenom est requis');
    }
    if (typeof data.lastName !== 'string' || data.lastName.trim().length < 1) {
      throw new HttpsError('invalid-argument', 'Le nom est requis');
    }

    // Date of birth
    if (!data.dob || typeof data.dob !== 'object') {
      throw new HttpsError('invalid-argument', 'La date de naissance est requise');
    }
    const dobDay = Number(data.dob.day);
    const dobMonth = Number(data.dob.month);
    const dobYear = Number(data.dob.year);
    if (!Number.isInteger(dobDay) || dobDay < 1 || dobDay > 31) {
      throw new HttpsError('invalid-argument', 'Jour de naissance invalide (1-31)');
    }
    if (!Number.isInteger(dobMonth) || dobMonth < 1 || dobMonth > 12) {
      throw new HttpsError('invalid-argument', 'Mois de naissance invalide (1-12)');
    }
    if (!Number.isInteger(dobYear) || dobYear < 1900 || dobYear > new Date().getFullYear()) {
      throw new HttpsError('invalid-argument', 'Annee de naissance invalide');
    }
    // F64 — verify the seller is at least 18 to the EXACT day, not just the
    // year. A year-only check let a 17-year-old born earlier this calendar year
    // (e.g. born in `currentYear - 18` but the birthday hasn't occurred yet)
    // pass. Compute the real age from day/month/year server-side.
    {
      const now = new Date();
      let age = now.getFullYear() - dobYear;
      const hasHadBirthdayThisYear =
        now.getMonth() + 1 > dobMonth ||
        (now.getMonth() + 1 === dobMonth && now.getDate() >= dobDay);
      if (!hasHadBirthdayThisYear) {
        age -= 1;
      }
      if (age < 18) {
        throw new HttpsError(
          'failed-precondition',
          'Vous devez avoir au moins 18 ans pour vendre sur Second.'
        );
      }
    }

    // Address
    if (!data.address || typeof data.address !== 'object') {
      throw new HttpsError('invalid-argument', 'L\'adresse est requise');
    }
    if (typeof data.address.line1 !== 'string' || data.address.line1.trim().length < 1) {
      throw new HttpsError('invalid-argument', 'L\'adresse (ligne 1) est requise');
    }
    if (typeof data.address.city !== 'string' || data.address.city.trim().length < 1) {
      throw new HttpsError('invalid-argument', 'La ville est requise');
    }
    if (typeof data.address.province !== 'string' || data.address.province.trim().length < 1) {
      throw new HttpsError('invalid-argument', 'La province est requise');
    }
    // Canadian postal code: A1A 1A1 or A1A1A1
    const postalCodeClean = (data.address.postalCode || '').toString().replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postalCodeClean)) {
      throw new HttpsError('invalid-argument', 'Le code postal canadien est invalide (format A1A 1A1)');
    }

    // Bank account
    const transitNumber = String(data.transitNumber || '').trim();
    const institutionNumber = String(data.institutionNumber || '').trim();
    const accountNumber = String(data.accountNumber || '').trim();

    if (!/^\d{5}$/.test(transitNumber)) {
      throw new HttpsError('invalid-argument', 'Le numero de transit doit contenir exactement 5 chiffres');
    }
    if (!/^\d{3}$/.test(institutionNumber)) {
      throw new HttpsError('invalid-argument', 'Le numero d\'institution doit contenir exactement 3 chiffres');
    }
    if (!/^\d{7,12}$/.test(accountNumber)) {
      throw new HttpsError('invalid-argument', 'Le numero de compte doit contenir entre 7 et 12 chiffres');
    }

    // ToS acceptance IP — extracted from request context (more secure than client-provided)
    const callerIp = request.rawRequest?.ip
      || (request.rawRequest?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || data.ip
      || '0.0.0.0';


    // ── Fetch user doc ──────────────────────────────────────────────────────

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;

      // Idempotent: if account already exists, retrieve current status and return.
      // F67 — derive the canonical state via the single source of truth
      // (deriveStripeAccountState) so the status string written here matches the
      // webhook / getStripeAccountStatus / addBankAccount writers exactly,
      // instead of an ad-hoc 3-way mapping that omitted 'restricted' /
      // 'partially_active' and the requirements.
      if (userData.stripeAccountId) {
        const existingAccount = await stripe.accounts.retrieve(userData.stripeAccountId, {
          expand: ['external_accounts'],
        });
        const state = deriveStripeAccountState(existingAccount);
        await userRef.update(stripeAccountFirestoreFields(state));

        logger.info('Stripe Custom account already exists — returning status', {
          userId,
          stripeAccountId: userData.stripeAccountId,
          chargesEnabled: state.chargesEnabled,
          status: state.status,
        });

        return {
          success: true,
          stripeAccountId: userData.stripeAccountId,
          chargesEnabled: state.chargesEnabled,
          payoutsEnabled: state.payoutsEnabled,
          detailsSubmitted: state.detailsSubmitted,
          requirements: state.requirementsCurrentlyDue,
          status: state.status,
        };
      }

      // F69 — claim account creation ATOMICALLY to prevent two concurrent calls
      // each creating a Custom account (one becomes a KYC+bank-bearing orphan).
      // We re-read inside a transaction: the winner stamps a creation lock and
      // proceeds; any concurrent caller sees either the stripeAccountId (a faster
      // call already finished) or the in-progress lock and bails with 'aborted'.
      // A stale lock (>2 min, e.g. a crash mid-create) is reclaimable so a real
      // failure never blocks the seller forever.
      const CREATION_LOCK_STALE_MS = 2 * 60 * 1000;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const d = snap.data() || {};
        if (d.stripeAccountId) {
          throw new HttpsError(
            'aborted',
            'Un compte de paiement a deja ete cree. Veuillez rafraichir.'
          );
        }
        const startedAt = d.stripeAccountCreationStartedAt;
        const startedMs =
          startedAt && typeof startedAt.toMillis === 'function' ? startedAt.toMillis() : 0;
        if (startedMs > 0 && Date.now() - startedMs < CREATION_LOCK_STALE_MS) {
          throw new HttpsError(
            'aborted',
            'La creation de votre compte de paiement est deja en cours. Veuillez patienter.'
          );
        }
        tx.update(userRef, { stripeAccountCreationStartedAt: FieldValue.serverTimestamp() });
      });

      // ── Create the full Custom account ──────────────────────────────────

      const email = userData.email || request.auth.token.email || '';

      // Canadian routing_number = transit (5) + institution (3) = 8 digits
      const routingNumber = `${transitNumber}${institutionNumber}`;

      const account = await stripe.accounts.create({
        type: 'custom',
        country: 'CA',
        email,
        business_type: 'individual',
        individual: {
          first_name: data.firstName.trim(),
          last_name: data.lastName.trim(),
          dob: {
            day: dobDay,
            month: dobMonth,
            year: dobYear,
          },
          address: {
            line1: data.address.line1.trim(),
            line2: data.address.line2 ? String(data.address.line2).trim() : undefined,
            city: data.address.city.trim(),
            state: data.address.province.trim(),
            postal_code: postalCodeClean,
            country: 'CA',
          },
        },
        tos_acceptance: {
          date: Math.floor(Date.now() / 1000),
          ip: callerIp,
        },
        external_account: {
          object: 'bank_account' as const,
          country: 'CA',
          currency: 'cad',
          routing_number: routingNumber,
          account_number: accountNumber,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          product_description: 'Vente de vetements et accessoires de seconde main',
        },
        settings: {
          payouts: {
            schedule: {
              interval: 'manual' as const,
            },
          },
        },
        metadata: {
          firebaseUserId: userId,
        },
      }, {
        // F69 — belt-and-braces: a deterministic idempotency key means that even
        // if two requests somehow slipped past the Firestore creation lock,
        // Stripe returns the SAME account object instead of minting two.
        idempotencyKey: `connect_account_${userId}`,
      });

      // Derive the canonical state from the freshly created account so the
      // initial requirements (F59a) are persisted alongside the booleans.
      const state = deriveStripeAccountState(account);

      // Store everything in the user document and release the creation lock.
      await userRef.update({
        stripeAccountId: account.id,
        ...stripeAccountFirestoreFields(state),
        stripeBankAccountAdded: true,
        stripeBankAccountLast4: accountNumber.slice(-4),
        stripeAccountCreatedAt: FieldValue.serverTimestamp(),
        stripeAccountCreationStartedAt: FieldValue.delete(),
      });

      logger.info('Stripe Custom account created with full onboarding', {
        userId,
        stripeAccountId: account.id,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        status: state.status,
      });

      return {
        success: true,
        stripeAccountId: account.id,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        requirements: state.requirementsCurrentlyDue,
        status: state.status,
      };
    } catch (error: unknown) {
      // F69 — release the creation lock so a failed Stripe create does not block
      // the seller's retry for the staleness window. Best-effort; never masks the
      // original error. The 'aborted' lock-contention path already threw above
      // (it is an HttpsError) and never set the lock, so it is unaffected.
      if (!(error instanceof HttpsError)) {
        try {
          await db
            .collection('users')
            .doc(userId)
            .update({ stripeAccountCreationStartedAt: FieldValue.delete() });
        } catch {
          // ignore — staleness reclaim covers a failed unlock
        }
      }
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      // Log full Stripe error details (type, code, statusCode, param) for debugging
      const stripeDetails: Record<string, unknown> = { userId, error: message };
      if (error && typeof error === 'object') {
        const e = error as any;
        if (e.type) stripeDetails.stripeErrorType = e.type;
        if (e.code) stripeDetails.stripeErrorCode = e.code;
        if (e.statusCode) stripeDetails.stripeStatusCode = e.statusCode;
        if (e.param) stripeDetails.stripeParam = e.param;
        if (e.raw) stripeDetails.stripeRaw = JSON.stringify(e.raw).substring(0, 500);
      }
      logger.error('Error creating Stripe Custom account', stripeDetails);
      throw new HttpsError('internal', `Failed to create Connect account: ${message}`);
    }
  }
);

// =============================================================================
// ADD BANK ACCOUNT — Attach Canadian bank account to seller's Custom account
// =============================================================================

/**
 * Updates / replaces the bank account on the seller's Stripe Connect Custom
 * account. The primary bank account is now set during account creation
 * (createStripeConnectAccount), but sellers may need to change their
 * bank account later.
 *
 * The seller provides transit number (5 digits), institution
 * number (3 digits), and account number directly in the app UI.
 *
 * Canadian routing_number format for Stripe:
 * transit (5 digits) + institution (3 digits) = 8 digits total
 *
 * Payout schedule is always set to manual (platform-controlled).
 */
export const addBankAccount = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;
    const { transitNumber, institutionNumber, accountNumber, accountHolderName } = request.data ?? {};

    // ── Input validation ──
    if (typeof transitNumber !== 'string' || !/^\d{5}$/.test(transitNumber)) {
      throw new HttpsError(
        'invalid-argument',
        'Le numero de transit doit contenir exactement 5 chiffres'
      );
    }
    if (typeof institutionNumber !== 'string' || !/^\d{3}$/.test(institutionNumber)) {
      throw new HttpsError(
        'invalid-argument',
        'Le numero d\'institution doit contenir exactement 3 chiffres'
      );
    }
    if (typeof accountNumber !== 'string' || !/^\d{7,12}$/.test(accountNumber)) {
      throw new HttpsError(
        'invalid-argument',
        'Le numero de compte doit contenir entre 7 et 12 chiffres'
      );
    }

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;
      const stripeAccountId = userData.stripeAccountId;

      if (!stripeAccountId) {
        throw new HttpsError(
          'failed-precondition',
          'Aucun compte de paiement trouve. Publiez un article d\'abord.'
        );
      }

      // Canadian routing_number = transit (5) + institution (3) = 8 digits
      const routingNumber = `${transitNumber}${institutionNumber}`;

      // Create external bank account on the Custom connected account.
      // F60a — REPLACEMENT support: mark the new account as the default for CAD
      // so an existing (e.g. closed) bank account is superseded as the payout
      // destination. Stripe demotes the previous default automatically.
      const newBank = (await stripe.accounts.createExternalAccount(stripeAccountId, {
        external_account: {
          object: 'bank_account',
          country: 'CA',
          currency: 'cad',
          routing_number: routingNumber,
          account_number: accountNumber,
          ...(accountHolderName && typeof accountHolderName === 'string'
            ? { account_holder_name: accountHolderName.trim().substring(0, 200) }
            : {}),
        },
        default_for_currency: true,
      })) as any;

      // Best-effort cleanup: delete any other (now non-default) external bank
      // accounts so a closed account can no longer be selected. Never let this
      // fail the call — the new default is already set above.
      try {
        const externals = await stripe.accounts.listExternalAccounts(stripeAccountId, {
          object: 'bank_account',
          limit: 10,
        });
        for (const ext of (externals as any).data ?? []) {
          if (ext.id && ext.id !== newBank.id) {
            await stripe.accounts.deleteExternalAccount(stripeAccountId, ext.id);
          }
        }
      } catch (cleanupErr) {
        logger.warn('addBankAccount: could not prune old external accounts', {
          userId,
          stripeAccountId,
          error: cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
        });
      }

      // Configure manual payouts — the platform controls disbursement
      // via the requestWithdrawal callable (Stripe Payouts API)
      await stripe.accounts.update(stripeAccountId, {
        settings: {
          payouts: {
            schedule: {
              interval: 'manual' as const,
            },
          },
        },
      });

      const bankAccountLast4 =
        typeof newBank.last4 === 'string' ? newBank.last4 : accountNumber.slice(-4);
      const bankAccountStatus = typeof newBank.status === 'string' ? newBank.status : null;

      // Update user document with bank account status (CF-only fields).
      await userRef.update({
        stripeBankAccountAdded: true,
        stripeBankAccountLast4: bankAccountLast4,
        ...(bankAccountStatus !== null ? { stripeBankAccountStatus: bankAccountStatus } : {}),
      });

      logger.info('Bank account added to Stripe Custom account', {
        userId,
        stripeAccountId,
        routingNumber,
        accountLast4: bankAccountLast4,
        bankAccountStatus,
      });

      return {
        success: true,
        bankAccountLast4,
        bankAccountStatus,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding bank account', { userId, error: message });
      throw new HttpsError('internal', `Echec de l'ajout du compte bancaire: ${message}`);
    }
  }
);

// =============================================================================
// UPLOAD STRIPE IDENTITY DOCUMENT — KYC continuous remediation (white-label)
// =============================================================================

/**
 * F59b — Lets a seller satisfy a Stripe identity-verification requirement
 * entirely in-app (white-label: the seller never visits Stripe). The client
 * sends a base64-encoded image; we create a Stripe `File` with
 * purpose='identity_document', then attach it to the seller's Custom account
 * via individual.verification.document.{front,back}.
 *
 * Auth: the caller must own the Stripe account (its uid carries stripeAccountId).
 * Rate-limited (file uploads hit Stripe + Storage of the document on Stripe's
 * side). Returns the refreshed requirements so the app can update its UI.
 *
 * Input: { frontImageBase64: string, backImageBase64?: string }
 *   - base64 WITHOUT data-URI prefix; JPEG/PNG; capped at ~8 MB decoded.
 */
export const uploadStripeIdentityDocument = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'uploadStripeIdentityDocument',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;
    const { frontImageBase64, backImageBase64 } = request.data ?? {};

    // ── Input validation ──
    if (typeof frontImageBase64 !== 'string' || frontImageBase64.length < 1) {
      throw new HttpsError('invalid-argument', 'L\'image recto du document est requise');
    }
    if (backImageBase64 !== undefined && typeof backImageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'L\'image verso est invalide');
    }

    // ~8 MB decoded cap (base64 is ~4/3 the byte size).
    const MAX_BYTES = 8 * 1024 * 1024;
    const decodeImage = (b64: string, label: string): Buffer => {
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch {
        throw new HttpsError('invalid-argument', `Image ${label} invalide`);
      }
      if (buf.length < 1) {
        throw new HttpsError('invalid-argument', `Image ${label} vide`);
      }
      if (buf.length > MAX_BYTES) {
        throw new HttpsError('invalid-argument', `Image ${label} trop volumineuse (max 8 Mo)`);
      }
      return buf;
    };

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const stripeAccountId = userDoc.data()!.stripeAccountId;
      if (!stripeAccountId) {
        throw new HttpsError(
          'failed-precondition',
          'Aucun compte de paiement trouve. Publiez un article d\'abord.'
        );
      }

      const frontBuffer = decodeImage(frontImageBase64, 'recto');

      // Create the identity_document File on the connected account.
      const frontFile = await stripe.files.create(
        {
          purpose: 'identity_document',
          file: {
            data: frontBuffer,
            name: 'identity_front.jpg',
            type: 'application/octet-stream',
          },
        },
        { stripeAccount: stripeAccountId }
      );

      let backFileId: string | null = null;
      if (typeof backImageBase64 === 'string' && backImageBase64.length > 0) {
        const backBuffer = decodeImage(backImageBase64, 'verso');
        const backFile = await stripe.files.create(
          {
            purpose: 'identity_document',
            file: {
              data: backBuffer,
              name: 'identity_back.jpg',
              type: 'application/octet-stream',
            },
          },
          { stripeAccount: stripeAccountId }
        );
        backFileId = backFile.id;
      }

      // Attach the document to the individual's verification on the account.
      await stripe.accounts.update(stripeAccountId, {
        individual: {
          verification: {
            document: {
              front: frontFile.id,
              ...(backFileId ? { back: backFileId } : {}),
            },
          },
        },
      });

      // Re-read the account to return fresh requirements + persist them.
      const account = await stripe.accounts.retrieve(stripeAccountId, {
        expand: ['external_accounts'],
      });
      const state = deriveStripeAccountState(account);
      await userRef.update(stripeAccountFirestoreFields(state));

      logger.info('Stripe identity document uploaded', {
        userId,
        stripeAccountId,
        hasBack: backFileId !== null,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        status: state.status,
      });

      return {
        success: true,
        status: state.status,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        requirementsPastDue: state.requirementsPastDue,
        disabledReason: state.disabledReason,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error uploading Stripe identity document', { userId, error: message });
      throw new HttpsError('internal', `Echec de l'envoi du document: ${message}`);
    }
  }
);

// =============================================================================
// GET STRIPE ACCOUNT STATUS — Check if seller's Connect account is active
// =============================================================================

/**
 * Retrieves the current status of the seller's Stripe Connect account
 * (charges_enabled, payouts_enabled, details_submitted) and updates
 * the status in Firestore.
 */
export const getStripeAccountStatus = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;
      const stripeAccountId = userData.stripeAccountId;

      if (!stripeAccountId) {
        return {
          success: true,
          hasAccount: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          status: 'none',
          requirementsCurrentlyDue: [],
          requirementsPastDue: [],
          disabledReason: null,
          currentDeadline: null,
          bankAccountLast4: null,
        };
      }

      // Retrieve the account from Stripe (expand external accounts so we can
      // surface the default bank account last4 + verification status, F60b).
      const account = await stripe.accounts.retrieve(stripeAccountId, {
        expand: ['external_accounts'],
      });

      const state = deriveStripeAccountState(account);

      // Persist the canonical state — requirements + bank status included
      // (F59a/F60b), all CF-only & never undefined.
      await userRef.update(stripeAccountFirestoreFields(state));

      logger.info('Stripe account status checked', {
        userId,
        stripeAccountId,
        status: state.status,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        disabledReason: state.disabledReason,
      });

      // Full contract consumed by the app (wallet ↔ onboarding loop, F62/F117).
      return {
        success: true,
        hasAccount: true,
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        status: state.status,
        requirementsCurrentlyDue: state.requirementsCurrentlyDue,
        requirementsPastDue: state.requirementsPastDue,
        disabledReason: state.disabledReason,
        currentDeadline: state.currentDeadline,
        bankAccountLast4: state.bankAccountLast4,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error checking Stripe account status', { userId, error: message });
      throw new HttpsError('internal', `Failed to check account status: ${message}`);
    }
  }
);

// =============================================================================
// FIND PICKUP POINTS — ShipEngine PUDO search
// =============================================================================

export const findPickupPoints = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
  // Rate limit: PUDO search hits the paid ShipEngine API on every call.
  // Unauthenticated cap stays at 0; authenticated callers get a browsing rate.
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, {
    functionName: 'findPickupPoints',
    maxCallsAuthenticated: 30,
    maxCallsUnauthenticated: 0,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  const { postalCode } = request.data;

  if (!postalCode) {
    throw new HttpsError('invalid-argument', 'Postal code is required');
  }

  const shipEngine = getShipEngine();
  if (!shipEngine) {
    throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
  }

  try {
    const locations = await shipEngine.findPUDOLocations(postalCode, 'CA', 10);

    return {
      success: true,
      locations,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error finding pickup points:', error);
    throw new HttpsError('internal', `Failed to find pickup points: ${message}`);
  }
});

// =============================================================================
// CHECK TRACKING STATUS — Via ShipEngine
// =============================================================================

export const checkTrackingStatus = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { transactionId } = request.data;

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'Transaction ID is required');
  }

  try {
    const transactionDoc = await db.collection('transactions').doc(transactionId).get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transaction = transactionDoc.data()!;

    // SECURITY: only the buyer or seller can trigger tracking status checks.
    // Without this, any authenticated user could force DELIVERED status and
    // trigger fund transfer to the seller.
    const callerUid = request.auth.uid;
    if (transaction.buyerId !== callerUid && transaction.sellerId !== callerUid) {
      throw new HttpsError(
        'permission-denied',
        'You are not authorized for this transaction'
      );
    }

    if (!transaction.trackingNumber) {
      throw new HttpsError('failed-precondition', 'No tracking number available');
    }

    const shipEngine = getShipEngine();
    if (!shipEngine) {
      throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
    }

    const carrierCode = transaction.carrierCode || 'intelcom_ca';
    const tracking = await shipEngine.getTracking(carrierCode, transaction.trackingNumber);

    const trackingStatus = ShipEngineClient.mapStatus(tracking.statusCode);

    // Explicit status guard (P1-21): a DELIVERED scan must only move funds when
    // the transaction is in a deliverable state. A DELIVERED scan arriving on a
    // refunded / disputed / cancelled / already-delivered / meetup_* transaction
    // would otherwise drive pendingBalance negative or double-credit the seller.
    // applyTrackingOutcome re-checks this invariant atomically inside its own
    // runTransaction; this early note keeps the intent explicit for readers.
    if (trackingStatus === 'DELIVERED' && !DELIVERABLE_STATUSES.has(transaction.status)) {
      logger.warn('[checkTrackingStatus] DELIVERED scan ignored — non-deliverable status', {
        transactionId,
        currentStatus: transaction.status,
      });
      return {
        success: true,
        trackingStatus,
        trackingHistory: tracking.events || [],
      };
    }

    // Apply the tracking outcome via the shared state-machine helper:
    //  - DELIVERED -> pendingBalance -> heldBalance + fundsReleaseAt (+7d)
    //  - FAILURE   -> delivery_failed, funds frozen, both parties notified
    //  - TRANSIT   -> label_created becomes 'shipped' (first carrier scan)
    //  - else      -> trackingStatus refresh only
    await applyTrackingOutcome(transactionId, trackingStatus, 'manual');

    return {
      success: true,
      trackingStatus,
      trackingHistory: tracking.events || [],
    };
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error checking tracking status:', error);
    throw new HttpsError('internal', `Failed to check tracking: ${message}`);
  }
});

// =============================================================================
// ACCEPT MEETUP OFFER — Seller accepts a buyer's meetup offer (atomic)
// =============================================================================

/**
 * P1-4 / P1-7 — server-authoritative meetup offer acceptance.
 *
 * Previously the offer accept + meetup transaction creation lived entirely on
 * the client (chatService.acceptOffer → createMeetupTransaction), which trusted
 * client-supplied buyerId/sellerId. Worse, any path deriving buyer/seller from
 * `request.auth.uid` would mislabel the seller (the accepter) as the buyer.
 *
 * F9 — buyer/seller are derived from the ARTICLE, never from the offer sender:
 *   - sellerId = article.sellerId (the article owner is always the seller),
 *   - buyerId  = the OTHER chat participant.
 * Deriving the buyer from `message.senderId` broke seller counter-offers: when
 * the seller emits a counter-offer, senderId is the seller, so the old code
 * mislabelled the seller as buyer and threw permission-denied. The caller must
 * be the participant who did NOT emit the offer (the accepter) — so either side
 * can accept the other side's offer/counter-offer.
 *
 * In ONE runTransaction it:
 *   1. re-reads the offer message (must be a pending meetup offer in this chat),
 *   2. re-reads the article (must exist, seller-owned),
 *   3. flips `offer.status` to 'accepted',
 *   4. marks the article sold,
 *   5. creates the linked `meetup_pending` transaction (NO platform fee).
 *
 * F8 — idempotency for the direct-checkout meetup flow. checkout/meetup
 * pre-creates the meetup_pending tx (locking the article) THEN sends the offer,
 * so acceptMeetupOffer would otherwise reject on `isSold === true` — a 48h
 * dead-end. If a non-cancelled meetup transaction already exists for this
 * chat+buyer+article, we accept the offer and return THAT transaction id
 * instead of rejecting / creating a duplicate (no re-lock, no second tx).
 */
export const acceptMeetupOffer = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'acceptMeetupOffer',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { chatId, messageId } = request.data ?? {};
    if (typeof chatId !== 'string' || chatId.length === 0) {
      throw new HttpsError('invalid-argument', 'chatId is required');
    }
    if (typeof messageId !== 'string' || messageId.length === 0) {
      throw new HttpsError('invalid-argument', 'messageId is required');
    }

    const callerUid = request.auth.uid;
    const messageRef = db.collection('messages').doc(messageId);
    const chatRef = db.collection('chats').doc(chatId);

    try {
      const result = await db.runTransaction(async (tx) => {
        // ── ALL READS FIRST ──
        const messageSnap = await tx.get(messageRef);
        if (!messageSnap.exists) {
          throw new HttpsError('not-found', 'Offre introuvable');
        }
        const message = messageSnap.data()!;

        if (message.type !== 'offer' || !message.offer || !message.offer.meetup) {
          throw new HttpsError('failed-precondition', 'Ce message n\'est pas une offre de rencontre');
        }
        if (message.chatId !== chatId) {
          throw new HttpsError('failed-precondition', 'L\'offre n\'appartient pas à cette conversation');
        }

        const offer = message.offer;
        // Only a pending offer can be accepted (idempotency / no re-accept).
        if (offer.status !== 'pending') {
          throw new HttpsError(
            'failed-precondition',
            `Cette offre ne peut plus être acceptée (statut ${offer.status})`
          );
        }

        // Enforce offer expiry server-side.
        if (offer.expiresAt) {
          const expiresAt = offer.expiresAt.toDate
            ? offer.expiresAt.toDate()
            : new Date(offer.expiresAt);
          if (expiresAt instanceof Date && !isNaN(expiresAt.getTime()) && expiresAt < new Date()) {
            tx.update(messageRef, { 'offer.status': 'expired' });
            throw new HttpsError('failed-precondition', 'Cette offre a expiré');
          }
        }

        const chatSnap = await tx.get(chatRef);
        if (!chatSnap.exists) {
          throw new HttpsError('not-found', 'Conversation introuvable');
        }
        const chat = chatSnap.data()!;
        const participants: unknown = chat.participants;
        if (!Array.isArray(participants) || participants.length < 2) {
          throw new HttpsError('failed-precondition', 'Conversation invalide');
        }

        const articleId = chat.articleId;
        if (typeof articleId !== 'string' || articleId.length === 0) {
          throw new HttpsError('failed-precondition', 'Article introuvable pour cette conversation');
        }
        const articleRef = db.collection('articles').doc(articleId);
        const articleSnap = await tx.get(articleRef);
        if (!articleSnap.exists) {
          throw new HttpsError('not-found', 'Cet article n\'existe plus');
        }
        const articleData = articleSnap.data()!;

        // F9: derive seller from the ARTICLE (owner = seller) and buyer from the
        // OTHER chat participant — NEVER from the offer sender (a seller
        // counter-offer would mislabel the seller as buyer).
        const sellerId = articleData.sellerId;
        if (typeof sellerId !== 'string' || !participants.includes(sellerId)) {
          throw new HttpsError('failed-precondition', 'Vendeur introuvable pour cette offre');
        }
        const buyerId = participants.find((p) => p !== sellerId);
        if (typeof buyerId !== 'string' || buyerId.length === 0) {
          throw new HttpsError('failed-precondition', 'Acheteur introuvable pour cette offre');
        }
        if (buyerId === sellerId) {
          throw new HttpsError('invalid-argument', 'Le vendeur ne peut pas acheter son propre article');
        }

        // The caller must be the party who did NOT emit the offer (the accepter):
        // either side can accept the other side's offer or counter-offer.
        if (typeof message.senderId !== 'string' || !participants.includes(message.senderId)) {
          throw new HttpsError('failed-precondition', 'Émetteur de l\'offre invalide');
        }
        if (callerUid === message.senderId) {
          throw new HttpsError('permission-denied', 'Vous ne pouvez pas accepter votre propre offre');
        }
        if (callerUid !== buyerId && callerUid !== sellerId) {
          throw new HttpsError('permission-denied', 'Vous ne participez pas à cette conversation');
        }

        const amount = offer.amount;
        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
          throw new HttpsError('failed-precondition', 'Montant de l\'offre invalide');
        }
        if (typeof articleData.price === 'number' && amount > articleData.price) {
          throw new HttpsError('failed-precondition', 'Le montant de l\'offre dépasse le prix de l\'article');
        }
        if (articleData.isActive === false) {
          throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible');
        }

        // F8: idempotency for the direct-checkout meetup flow. The checkout
        // pre-creates the meetup_pending tx (locking the article) THEN sends the
        // offer; without this an `isSold === true` would dead-end acceptance. If
        // a non-cancelled meetup transaction already exists for this
        // chat+buyer+article, accept the offer and return that tx instead of
        // creating a duplicate or re-locking the article.
        // Single-field equality query (chatId) — no composite index needed; the
        // remaining filters are applied in memory (a chat has few transactions).
        const existingTxSnap = await db
          .collection('transactions')
          .where('chatId', '==', chatId)
          .get();
        const liveExisting = existingTxSnap.docs.find((d) => {
          const t = d.data();
          const s = t.status;
          return (
            t.buyerId === buyerId &&
            t.articleId === articleId &&
            t.deliveryType === 'meetup' &&
            s !== 'cancelled' &&
            s !== 'refunded'
          );
        });

        if (liveExisting) {
          // ── WRITES: accept the offer, return the pre-existing tx. The article
          //    is already locked by that tx; do NOT touch it.
          tx.update(messageRef, { 'offer.status': 'accepted' });
          return {
            transactionId: liveExisting.id,
            buyerId,
            sellerId,
            amount,
            reused: true,
          };
        }

        // No pre-existing tx: this is the chat-flow path. The article must be
        // free to lock.
        if (articleData.isSold === true) {
          throw new HttpsError('failed-precondition', 'Cet article a déjà été vendu');
        }

        // ── ALL WRITES AFTER ALL READS ──
        // 1. Accept the offer.
        tx.update(messageRef, { 'offer.status': 'accepted' });

        // 2. Lock the article.
        tx.update(articleRef, { isSold: true });

        // 3. Create the linked meetup transaction (NO platform fee, no shipping).
        const transactionData: Record<string, any> = {
          articleId,
          buyerId,
          sellerId,
          amount,
          shippingCost: 0,
          serviceFee: 0,
          totalAmount: amount,
          sellerPayout: amount,
          deliveryType: 'meetup',
          status: 'meetup_pending',
          chatId,
          createdAt: FieldValue.serverTimestamp(),
        };

        const meetupSpot = offer.meetup?.location;
        if (meetupSpot && typeof meetupSpot === 'object') {
          const cleanSpot: Record<string, any> = {
            name: meetupSpot.name ?? null,
            category: meetupSpot.category ?? null,
            neighborhood: meetupSpot.neighborhood ?? null,
          };
          if (meetupSpot.id) cleanSpot.id = meetupSpot.id;
          if (meetupSpot.address) cleanSpot.address = meetupSpot.address;
          if (meetupSpot.coordinates) cleanSpot.coordinates = meetupSpot.coordinates;
          transactionData.meetupSpot = cleanSpot;
        }

        const newTxRef = db.collection('transactions').doc();
        tx.set(newTxRef, transactionData);

        const negotiated =
          typeof articleData.price === 'number' && amount < articleData.price;
        return {
          transactionId: newTxRef.id,
          buyerId,
          sellerId,
          amount,
          reused: false,
          negotiated,
          articleId,
        };
      });

      logger.info('Meetup offer accepted (server-authoritative)', {
        chatId,
        messageId,
        transactionId: result.transactionId,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
        reused: result.reused,
      });

      // Analytics (§12): a NEW meetup tx created via the chat flow (source=
      // offer_accept). The `reused` path was already created by createTransaction
      // (direct checkout), so skip it to avoid a double order_created. $insert_id
      // keyed by tx id is a second safety net. distinct_id = buyer.
      if (!result.reused) {
        await captureServerEvent(result.buyerId, 'order_created', {
          transaction_id: result.transactionId,
          article_id: 'articleId' in result ? result.articleId : null,
          buyer_id: result.buyerId,
          seller_id: result.sellerId,
          delivery_type: 'meetup',
          amount_cents: Math.round((result.amount ?? 0) * 100),
          negotiated: 'negotiated' in result ? result.negotiated : false,
          source: 'offer_accept',
          $insert_id: `order_created_${result.transactionId}`,
        });
      }

      return { success: true, transactionId: result.transactionId, reused: result.reused };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error accepting meetup offer:', error);
      throw new HttpsError('internal', `Failed to accept meetup offer: ${message}`);
    }
  }
);

// =============================================================================
// CONFIRM MEETUP TRANSACTION — Seller confirms the meetup appointment (atomic)
// =============================================================================

/**
 * P1-5 — server-authoritative meetup confirmation.
 *
 * Previously the client (chatService.confirmMeetup) wrote
 * `updateDoc(txRef, { status: 'meetup_confirmed' })` directly and relied on
 * Firestore rules to gate the seller. That left the message timestamp
 * (`offer.meetup.confirmedAt`) and the transaction status update as two
 * non-atomic client writes that could diverge.
 *
 * This callable performs the `meetup_pending → meetup_confirmed` transition
 * atomically together with the message confirmation timestamp, inside a single
 * runTransaction. buyer/seller are derived from the transaction document; only
 * the SELLER may confirm (they own the appointment slot). The matching Firestore
 * rule tightening is carried by be-firestore-rules.
 */
export const confirmMeetupTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'confirmMeetupTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, messageId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);
    const messageRef =
      typeof messageId === 'string' && messageId.length > 0
        ? db.collection('messages').doc(messageId)
        : null;

    try {
      const result = await db.runTransaction(async (tx) => {
        // ── ALL READS FIRST ──
        const txSnap = await tx.get(txRef);
        if (!txSnap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = txSnap.data()!;

        // Only the SELLER (derived from the tx doc) may confirm the appointment.
        if (data.sellerId !== callerUid) {
          throw new HttpsError('permission-denied', 'Seul le vendeur peut confirmer la rencontre');
        }

        if (data.deliveryType !== 'meetup') {
          throw new HttpsError('failed-precondition', 'Cette transaction n\'est pas une rencontre');
        }

        // Gate on the TRANSACTION status, not a message field.
        if (data.status !== 'meetup_pending') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de confirmer la rencontre depuis le statut ${data.status}`
          );
        }

        // Validate the linked message belongs to this transaction's chat (if any).
        let messageSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (messageRef) {
          messageSnap = await tx.get(messageRef);
          if (messageSnap.exists) {
            const msg = messageSnap.data()!;
            if (data.chatId && msg.chatId && msg.chatId !== data.chatId) {
              throw new HttpsError('failed-precondition', 'Le message ne correspond pas à cette transaction');
            }
          }
        }

        // ── ALL WRITES AFTER ALL READS ──
        tx.update(txRef, {
          status: 'meetup_confirmed',
          meetupConfirmedAt: FieldValue.serverTimestamp(),
          meetupConfirmedBy: callerUid,
        });

        if (messageRef && messageSnap && messageSnap.exists) {
          tx.update(messageRef, {
            'offer.meetup.confirmedAt': FieldValue.serverTimestamp(),
          });
        }

        return { chatId: data.chatId ?? null };
      });

      logger.info('Meetup transaction confirmed (server-authoritative)', {
        transactionId,
        sellerId: callerUid,
      });

      return { success: true, chatId: result.chatId };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming meetup transaction:', error);
      throw new HttpsError('internal', `Failed to confirm meetup: ${message}`);
    }
  }
);

// =============================================================================
// COMPLETE MEETUP TRANSACTION — Buyer confirms receipt, credits seller
// =============================================================================

/**
 * Either party confirms the meetup exchange was completed. This transitions the
 * transaction from `meetup_confirmed` → `meetup_completed`, sets
 * `meetupCompletedAt`, and thereby unlocks review eligibility.
 *
 * Meetup is a pure cash-in-hand exchange: NO money flows through the platform,
 * so this NEVER credits the seller wallet and writes NO ledger entry.
 *
 * A3 FIX: completion was previously buyer-only. A meetup is a two-sided in-person
 * exchange — if the buyer ghosts after the seller confirmed the appointment, the
 * transaction would sit in `meetup_confirmed` forever (zombie) and the article
 * stays locked (toggleArticleSold/createTransaction block on meetup_confirmed).
 * Both the buyer AND the seller can now mark the meetup completed; the scheduler
 * additionally auto-cancels abandoned `meetup_confirmed` transactions (see
 * expireOrphanedTransactions), so the article can never be stuck unsellable.
 */
export const completeMeetupTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'completeMeetupTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      const transactionData = await db.runTransaction(async (tx) => {
        const txSnap = await tx.get(txRef);
        if (!txSnap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }

        const data = txSnap.data()!;

        // A3 FIX: either party (buyer or seller) can confirm the in-person
        // exchange happened. Both were physically present at the meetup, so
        // either can release it — this prevents a zombie transaction when one
        // side never taps "completed".
        if (data.buyerId !== callerUid && data.sellerId !== callerUid) {
          throw new HttpsError('permission-denied', 'Only the buyer or seller can complete the meetup');
        }

        // Must be in meetup_confirmed status
        if (data.status !== 'meetup_confirmed') {
          throw new HttpsError(
            'failed-precondition',
            `Cannot complete meetup from status ${data.status}`
          );
        }

        const sellerId = data.sellerId;

        // Meetup = paiement cash hors-ligne pur. AUCUN argent n'a transité par
        // la plateforme, donc on NE crédite JAMAIS le wallet vendeur
        // (balance / pendingBalance) et on n'écrit AUCUN ledger de vente.
        // Le runTransaction se limite à : passer le statut à meetup_completed,
        // poser meetupCompletedAt, et débloquer l'éligibilité à l'avis (review),
        // qui est dérivée du statut terminal + meetupCompletedAt dans reviews.ts.
        tx.update(txRef, {
          status: 'meetup_completed',
          completedAt: FieldValue.serverTimestamp(),
          meetupCompletedAt: FieldValue.serverTimestamp(),
          meetupCompletedBy: callerUid,
        });

        return {
          chatId: data.chatId,
          sellerId,
          buyerId: data.buyerId,
          sellerPayout: typeof data.sellerPayout === 'number' ? data.sellerPayout : data.amount,
          createdAt: data.createdAt,
        };
      });

      // Analytics (§12): order_completed follows the BUYER. Meetup is cash-in-
      // hand — seller_net_cents reflects the sale value (no platform ledger move).
      if (transactionData.buyerId) {
        let daysToComplete = 0;
        const createdAt = transactionData.createdAt;
        if (createdAt && typeof createdAt.toMillis === 'function') {
          daysToComplete =
            Math.round(((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000)) * 100) / 100;
        }
        await captureServerEvent(transactionData.buyerId, 'order_completed', {
          transaction_id: transactionId,
          delivery_type: 'meetup',
          seller_net_cents: Math.round((transactionData.sellerPayout ?? 0) * 100),
          days_to_complete: daysToComplete,
          $insert_id: `order_completed_${transactionId}`,
        });
      }

      // Send system message (non-critical, outside transaction)
      if (transactionData.chatId) {
        let participants: string[] = [];
        try {
          const chatSnap = await db.collection('chats').doc(transactionData.chatId).get();
          if (chatSnap.exists) {
            participants = (chatSnap.data()?.participants as string[]) || [];
          }
        } catch (lookupErr) {
          logger.warn('[completeMeetupTransaction] Could not load chat participants:', lookupErr);
        }

        await db.collection('messages').add({
          chatId: transactionData.chatId,
          senderId: 'system',
          receiverId: 'system',
          type: 'system',
          content: 'Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé en main propre entre l\'acheteur et le vendeur.',
          participants,
          timestamp: FieldValue.serverTimestamp(),
          status: 'sent',
          isRead: true,
        });
      }

      logger.info('Meetup transaction completed', { transactionId, sellerId: transactionData.sellerId });

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error completing meetup transaction:', error);
      throw new HttpsError('internal', `Failed to complete meetup: ${message}`);
    }
  }
);

// =============================================================================
// REPORT MEETUP NO-SHOW — A party signals the other never showed up
// =============================================================================

/** Reason codes accepted for a meetup no-show report. */
const MEETUP_NO_SHOW_REASONS = new Set([
  'other_party_no_show',
  'cancelled_last_minute',
  'unsafe_situation',
  'other',
]);

/** A meetup no-show can only be reported while the meetup is still open. */
const MEETUP_REPORTABLE_STATUSES = new Set(['meetup_pending', 'meetup_confirmed']);

/**
 * A2 FIX — server-side no-show handling for a meetup.
 *
 * Previously the client (chatService.reportNoShow) only wrote a cosmetic
 * `offer.meetup.noShow` field on a chat message that NOTHING consumed: the
 * article stayed locked (isSold=true), the transaction kept blocking re-listing
 * (meetup_pending / meetup_confirmed are "active" in toggleArticleSold), and
 * neither party had a real recourse.
 *
 * This callable gives the report teeth. A meetup is a PURE cash-in-hand exchange:
 * NO money flows through the platform, so there is nothing to refund here. What a
 * no-show needs is:
 *   1. Unlock the article (isSold=false) so the seller can re-list / re-sell it.
 *   2. Move the transaction to `disputed` (frozen, terminal-for-meetup) so it can
 *      no longer be completed and no longer counts as an "active" transaction
 *      blocking the article.
 *   3. Open a `disputes` doc for human review — this is the recourse for BOTH
 *      sides: the reporter states their case, and the accused party can contest
 *      with the admin (Loi 25 human-review path). The dispute records both
 *      parties + who reported whom.
 *
 * Either the buyer or the seller may file it (a no-show can be on either side).
 * Idempotent: refuses a second report on an already-disputed/cancelled tx.
 */
export const reportMeetupNoShow = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'reportMeetupNoShow',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, reason, details } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const reportReason =
      typeof reason === 'string' && MEETUP_NO_SHOW_REASONS.has(reason)
        ? reason
        : 'other_party_no_show';
    const trimmedDetails =
      typeof details === 'string' && details.trim().length > 0
        ? details.trim().substring(0, 1000)
        : null;

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;

        // Caller must be a party to the transaction.
        const isBuyer = data.buyerId === callerUid;
        const isSeller = data.sellerId === callerUid;
        if (!isBuyer && !isSeller) {
          throw new HttpsError('permission-denied', 'Only the buyer or seller can report a no-show');
        }

        // Only meetup transactions still in an open meetup state.
        if (data.deliveryType !== 'meetup') {
          throw new HttpsError(
            'failed-precondition',
            'Le signalement de no-show est réservé aux rencontres en personne.'
          );
        }
        if (!MEETUP_REPORTABLE_STATUSES.has(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de signaler un no-show pour une transaction au statut ${data.status}.`
          );
        }

        // Read the article BEFORE writing (Firestore: all reads first).
        let articleRef: FirebaseFirestore.DocumentReference | null = null;
        let articleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (typeof data.articleId === 'string' && data.articleId.length > 0) {
          articleRef = db.collection('articles').doc(data.articleId);
          articleSnap = await tx.get(articleRef);
        }

        const reportedAgainst = isBuyer ? data.sellerId : data.buyerId;

        // 1. Freeze the transaction in `disputed`. No money moves (meetup =
        //    cash-in-hand). statusBeforeDispute lets an admin restore context.
        tx.update(txRef, {
          status: 'disputed',
          disputed: true,
          statusBeforeDispute: data.status,
          noShowReport: {
            reportedBy: callerUid,
            reportedAgainst: typeof reportedAgainst === 'string' ? reportedAgainst : null,
            reason: reportReason,
            ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
            reportedAt: FieldValue.serverTimestamp(),
          },
          disputedAt: FieldValue.serverTimestamp(),
        });

        // 2. Unlock the article so the seller can re-list / re-sell it.
        if (articleRef && articleSnap && articleSnap.exists) {
          tx.update(articleRef, { isSold: false });
        }

        // 3. Open a dispute doc for admin (human-review) — the recourse for both
        //    sides. Records who reported whom so the accused can contest.
        const disputeRef = db.collection('disputes').doc();
        tx.set(disputeRef, {
          transactionId,
          type: 'meetup_no_show',
          buyerId: data.buyerId ?? null,
          sellerId: data.sellerId ?? null,
          articleId: data.articleId ?? null,
          articleTitle: data.articleTitle ?? null,
          reportedBy: callerUid,
          reportedAgainst: typeof reportedAgainst === 'string' ? reportedAgainst : null,
          reason: reportReason,
          ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
          status: 'open',
          statusBeforeDispute: data.status,
          createdAt: FieldValue.serverTimestamp(),
        });

        return {
          disputeId: disputeRef.id,
          buyerId: data.buyerId,
          sellerId: data.sellerId,
          articleId: data.articleId ?? '',
          articleTitle: data.articleTitle ?? 'la rencontre',
          reportedAgainst: typeof reportedAgainst === 'string' ? reportedAgainst : null,
          chatId: data.chatId ?? null,
        };
      });

      // Best-effort admin signal (ingested by the on-call dashboard).
      logger.warn('ADMIN_REVIEW — meetup no-show reported', {
        disputeId: result.disputeId,
        transactionId,
        reportedBy: callerUid,
        reason: reportReason,
      });

      // Analytics (§12): dispute_opened(type=no_show) — distinct_id = the
      // signaler. Meetup is cash-in-hand → no funds held on the platform.
      await captureServerEvent(callerUid, 'dispute_opened', {
        transaction_id: transactionId,
        type: 'no_show',
        reason_code: reportReason,
        held_cents: 0,
        $insert_id: `dispute_opened_${result.disputeId}`,
      });

      // Notify the reported party that a no-show was filed against them and that
      // they can contest it (recourse / human review). Best-effort, non-blocking.
      if (result.reportedAgainst) {
        sendPushNotification(
          result.reportedAgainst,
          'Signalement de rencontre manquée',
          `Un no-show a été signalé pour « ${result.articleTitle} ». Notre équipe va examiner la situation. Si vous contestez ce signalement, vous pouvez nous le signaler.`,
          { transactionId, articleId: result.articleId },
          'order_cancelled'
        ).catch((err) => {
          logger.warn('[reportMeetupNoShow] Failed to notify reported party', {
            transactionId,
            error: err instanceof Error ? err.message : err,
          });
        });
      }

      return { success: true, disputeId: result.disputeId };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error reporting meetup no-show:', error);
      throw new HttpsError('internal', `Failed to report no-show: ${message}`);
    }
  }
);

// =============================================================================
// ADMIN REFUND TRANSACTION — Resolve disputes / lost / failed deliveries
// =============================================================================

/**
 * Admin-only refund for a card/destination-charge or mixed transaction
 * (the wallet-only path is handled by refundWalletPayment). Used to resolve
 * `delivery_failed`, `lost`, `disputed`, `delivered` (within the dispute
 * window) and any still-paid order where the buyer must be reimbursed.
 *
 * Flow:
 *   1. Stripe refund OUTSIDE the runTransaction, with a deterministic
 *      idempotency key (`rf_admin_<txId>`) so re-invocations never double-refund.
 *      Single-rail model: every charge is a platform charge, so this is a plain
 *      refunds.create — no transfer to reverse, no application fee to claw back.
 *      The seller is debited via the wallet cascade in stage 2.
 *   2. Atomic Firestore reconciliation: re-credit any wallet portion to the
 *      buyer, debit the seller EXACTLY what was credited
 *      (pendingBalance -> heldBalance -> balance, shortfall -> sellerDebt),
 *      release the article, mark the transaction 'refunded'.
 *
 * Return-label cost policy: when the refund is the result of a dispute ruled
 * against the seller (`chargeReturnToSeller: true`), the return label cost
 * (if a return label was created) is also debited from the seller; by default
 * the buyer bears the return cost. The label itself is created via the
 * createReturnLabel ShipEngine method when requested.
 */
export const adminRefundTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Admin guard: custom claim OR users/{uid}.isAdmin fallback.
    let isAdmin = request.auth.token.admin === true;
    if (!isAdmin) {
      const adminSnap = await db.collection('users').doc(request.auth.uid).get();
      isAdmin = adminSnap.exists && adminSnap.data()?.isAdmin === true;
    }
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'Admin privileges required');
    }

    const { transactionId, reason } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const txRef = db.collection('transactions').doc(transactionId);

    // Pre-read for the Stripe call (outside the transaction).
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data()!;

    // Idempotence: already refunded.
    if (preData.status === 'refunded') {
      return { success: true, alreadyRefunded: true };
    }

    // Only refundable post-payment statuses.
    const refundableStatuses = new Set([
      'paid',
      'label_created',
      'shipped',
      'delivered',
      'delivery_failed',
      'lost',
      'disputed',
      'return_requested',
    ]);
    if (!refundableStatuses.has(preData.status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot refund transaction in status ${preData.status}`
      );
    }

    // Shared refund core (plain Stripe refund + atomic wallet/seller-debt
    // reconciliation). Admin disputes re-list the article by default.
    try {
      const result = await issueTransactionRefund(transactionId, preData, {
        reason: typeof reason === 'string' ? reason : 'admin_refund',
        idempotencyKey: `rf_admin_${transactionId}`,
        relistArticle: true,
        source: 'adminRefundTransaction',
      });

      // F27/F88: a refund resolves the linked human-review dispute(s). Without
      // this every dispute stays 'open' forever — the admin disputes list never
      // empties AND the deleteUserAccount gate blocks both parties' deletion for
      // life. Best-effort: the money has already moved, so a dispute-close
      // failure must never surface as a refund failure.
      await resolveOpenDisputesForTransaction(transactionId, {
        resolvedBy: request.auth.uid,
        resolution: 'refunded',
      }).catch((e) => {
        logger.error('[adminRefundTransaction] failed to close linked disputes', {
          transactionId,
          error: e instanceof Error ? e.message : e,
        });
      });

      logger.warn('[adminRefundTransaction] transaction refunded by admin', {
        transactionId,
        adminUid: request.auth.uid,
      });
      return result;
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[adminRefundTransaction] refund failed', { transactionId, error: message });
      throw new HttpsError('internal', `Refund failed: ${message}`);
    }
  }
);

// =============================================================================
// RESOLVE DISPUTE — Admin closes a dispute WITHOUT a refund (favor of seller)
// =============================================================================

/**
 * Mark every OPEN `disputes` doc linked to a transaction as resolved. Best-effort
 * batch update; never throws on a missing collection. Shared by adminRefundTransaction
 * (resolution: 'refunded') and resolveDispute (resolution: 'dismissed').
 */
async function resolveOpenDisputesForTransaction(
  transactionId: string,
  opts: { resolvedBy: string; resolution: 'refunded' | 'dismissed' }
): Promise<number> {
  const openSnap = await db
    .collection('disputes')
    .where('transactionId', '==', transactionId)
    .where('status', '==', 'open')
    .get();
  if (openSnap.empty) return 0;
  const batch = db.batch();
  for (const d of openSnap.docs) {
    batch.update(d.ref, {
      status: 'resolved',
      resolution: opts.resolution,
      resolvedBy: opts.resolvedBy,
      resolvedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return openSnap.size;
}

/**
 * F27/F88 + F10 + F26 — admin closes a dispute in favor of the SELLER (no
 * refund). This is the missing other half of adminRefundTransaction: a dispute
 * that the admin rules unfounded must be closeable WITHOUT moving money to the
 * buyer, otherwise every meetup no-show, contested return and chargeback inquiry
 * stays 'disputed' forever — freezing the seller's withdrawals (walletWithdraw
 * blocks on any disputed tx) and blocking both parties' account deletion.
 *
 * In one runTransaction it:
 *   1. closes the linked OPEN dispute doc(s) (status 'resolved', dismissed),
 *   2. restores `statusBeforeDispute` on the transaction (so the normal release
 *      cycle resumes), clears `disputed`,
 *   3. releases any chargeback hold: disputeFreezeCents from heldBalance ->
 *      balance (mirrors the dispute.closed WON path, F37). Meetup no-shows and
 *      returns carry no freeze (meetup = cash; return funds sit in the normal
 *      heldBalance release cycle), so this is a no-op for them.
 *
 * Admin-only, double guard + rate limited (aligned with adminRefundTransaction).
 */
export const resolveDispute = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    let isAdmin = request.auth.token.admin === true;
    if (!isAdmin) {
      const adminSnap = await db.collection('users').doc(request.auth.uid).get();
      isAdmin = adminSnap.exists && adminSnap.data()?.isAdmin === true;
    }
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'Admin privileges required');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'resolveDispute',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, note } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const adminUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      // Pre-query the linked OPEN disputes OUTSIDE the runTransaction (queries
      // are not transactionally locked); they are closed in a batch after the tx.
      const openDisputesSnap = await db
        .collection('disputes')
        .where('transactionId', '==', transactionId)
        .where('status', '==', 'open')
        .get();

      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;

        // Only a disputed/return_requested transaction can be dismissed here.
        if (data.status !== 'disputed' && data.status !== 'return_requested') {
          throw new HttpsError(
            'failed-precondition',
            `Cannot resolve a dispute for a transaction in status ${data.status}`
          );
        }

        const sellerId = data.sellerId;
        const freezeCents =
          typeof data.disputeFreezeCents === 'number' ? data.disputeFreezeCents : 0;

        // Read seller wallet BEFORE writes (only when there is a hold to release).
        const sellerWalletRef =
          freezeCents > 0 && typeof sellerId === 'string'
            ? db.collection('wallets').doc(sellerId)
            : null;
        const sellerWalletSnap = sellerWalletRef ? await tx.get(sellerWalletRef) : null;

        // Restore the pre-dispute status so the normal release cycle can resume.
        const restored =
          typeof data.statusBeforeDispute === 'string' && data.statusBeforeDispute.length > 0
            ? data.statusBeforeDispute
            : data.status === 'return_requested'
              ? 'delivered'
              : 'delivered';

        const txUpdate: Record<string, any> = {
          status: restored,
          disputed: false,
          disputeResolvedAt: FieldValue.serverTimestamp(),
          disputeOutcome: 'dismissed',
          disputeFreezeCents: 0,
        };
        if (typeof note === 'string' && note.trim().length > 0) {
          txUpdate.disputeResolutionNote = note.trim().substring(0, 500);
        }
        tx.update(txRef, txUpdate);

        // F37: release the chargeback hold back to withdrawable balance.
        let releasedCents = 0;
        if (
          freezeCents > 0 &&
          sellerWalletRef &&
          sellerWalletSnap &&
          sellerWalletSnap.exists
        ) {
          const walletData = sellerWalletSnap.data()!;
          const heldNow = walletData.heldBalance || 0;
          releasedCents = Math.min(freezeCents, heldNow);
          if (releasedCents > 0) {
            tx.update(sellerWalletRef, {
              heldBalance: FieldValue.increment(-releasedCents),
              balance: FieldValue.increment(releasedCents),
              updatedAt: FieldValue.serverTimestamp(),
            });
            const ledgerRef = sellerWalletRef.collection('ledger').doc();
            tx.set(ledgerRef, {
              type: 'dispute_hold_released',
              amount: releasedCents,
              balanceAfter: (walletData.balance || 0) + releasedCents,
              description: 'Litige clôturé (en faveur du vendeur) — fonds gelés restitués',
              transactionId,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
        }

        return { restored, releasedCents, sellerId, buyerId: data.buyerId };
      });

      // Close the linked dispute doc(s) in a batch (outside the tx).
      if (!openDisputesSnap.empty) {
        const batch = db.batch();
        for (const d of openDisputesSnap.docs) {
          batch.update(d.ref, {
            status: 'resolved',
            resolution: 'dismissed',
            resolvedBy: adminUid,
            resolvedAt: FieldValue.serverTimestamp(),
            ...(typeof note === 'string' && note.trim().length > 0
              ? { resolutionNote: note.trim().substring(0, 500) }
              : {}),
          });
        }
        await batch.commit();
      }

      logger.warn('[resolveDispute] dispute dismissed by admin (favor of seller)', {
        transactionId,
        adminUid,
        restored: result.restored,
        releasedCents: result.releasedCents,
        disputesClosed: openDisputesSnap.size,
      });

      // Notify both parties (best-effort).
      if (typeof result.sellerId === 'string') {
        sendPushNotification(
          result.sellerId,
          'Litige clôturé',
          'Le litige sur votre vente a été résolu en votre faveur. Vos fonds sont de nouveau disponibles.',
          { transactionId },
          'order_cancelled'
        ).catch(() => undefined);
      }

      // Analytics (§12): dispute_resolved — distinct_id = the dispute DECLARANT
      // (reportedBy for a no-show, otherwise the buyer). This resolution dismisses
      // in the seller's favour (release_seller); admin action → automated=false.
      {
        const firstDispute = openDisputesSnap.docs[0]?.data();
        const declarantId =
          (typeof firstDispute?.reportedBy === 'string' && firstDispute.reportedBy) ||
          (typeof firstDispute?.buyerId === 'string' && firstDispute.buyerId) ||
          (typeof result.buyerId === 'string' ? result.buyerId : null);
        let daysOpen = 0;
        const createdAt = firstDispute?.createdAt;
        if (createdAt && typeof createdAt.toMillis === 'function') {
          daysOpen =
            Math.round(((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000)) * 100) / 100;
        }
        if (declarantId) {
          await captureServerEvent(declarantId, 'dispute_resolved', {
            transaction_id: transactionId,
            resolution: 'release_seller',
            automated: false,
            days_open: daysOpen,
            $insert_id: `dispute_resolved_${transactionId}`,
          });
        }
      }

      return {
        success: true,
        restored: result.restored,
        releasedCents: result.releasedCents,
        disputesClosed: openDisputesSnap.size,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[resolveDispute] failed', { transactionId, error: message });
      throw new HttpsError('internal', `Failed to resolve dispute: ${message}`);
    }
  }
);

// =============================================================================
// SELLER CANCEL TRANSACTION — Seller cancels a paid order before it ships
// =============================================================================

/**
 * F74 — seller-initiated cancellation AFTER payment but BEFORE the first carrier
 * scan. A seller who can no longer ship (item lost/broken) previously had no way
 * to cancel + refund: the buyer stayed charged and had to wait out the 7-day
 * paid-not-shipped expiry. This callable refunds immediately.
 *
 * Authorization: caller MUST be the seller of the transaction. Rate-limited.
 *
 * Allowed statuses: 'paid' | 'label_created' ONLY. These are exactly the
 * pre-ship statuses (PRESHIP_STATUSES) — once a carrier scans the parcel the tx
 * moves to 'shipped' and this is refused (the item is already in transit; that
 * is a return/dispute, not a seller cancellation).
 *
 * Effect: issueTransactionRefund (key `rf_seller_<txId>` — full buyer refund via
 * Stripe + wallet portion, seller debited exactly what was credited via the
 * wallet cascade) + relist the article (isSold=false) + notify the buyer.
 */
export const sellerCancelTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'sellerCancelTransaction',
      maxCallsAuthenticated: 10,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, reason } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    // Pre-read (the Stripe refund must run outside the runTransaction).
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data()!;

    if (preData.sellerId !== callerUid) {
      throw new HttpsError('permission-denied', 'Seul le vendeur peut annuler cette commande');
    }

    // Idempotence: already refunded.
    if (preData.status === 'refunded') {
      return { success: true, alreadyRefunded: true };
    }

    // Only pre-ship statuses are seller-cancellable (before the first carrier
    // scan moves the tx to 'shipped').
    const SELLER_CANCELLABLE = new Set(['paid', 'label_created']);
    if (!SELLER_CANCELLABLE.has(preData.status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cette commande ne peut plus être annulée (statut ${preData.status}). Une commande déjà expédiée relève d'un retour.`
      );
    }

    try {
      const result = await issueTransactionRefund(transactionId, preData, {
        reason: typeof reason === 'string' ? reason : 'seller_cancelled',
        idempotencyKey: `rf_seller_${transactionId}`,
        relistArticle: true,
        source: 'sellerCancelTransaction',
      });

      logger.warn('[sellerCancelTransaction] order cancelled + refunded by seller', {
        transactionId,
        sellerUid: callerUid,
      });

      // Notify the buyer (best-effort).
      if (typeof preData.buyerId === 'string') {
        sendPushNotification(
          preData.buyerId,
          'Commande annulée',
          `Le vendeur a annulé « ${preData.articleTitle || 'votre commande'} ». Vous avez été intégralement remboursé(e).`,
          { transactionId, articleId: preData.articleId ?? null },
          'order_cancelled'
        ).catch(() => undefined);
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[sellerCancelTransaction] refund failed', { transactionId, error: message });
      throw new HttpsError('internal', `Cancellation failed: ${message}`);
    }
  }
);

// =============================================================================
// CANCEL PENDING TRANSACTION — Buyer cancels a non-paid transaction
// =============================================================================

/**
 * Buyer cancels a transaction that has not been paid yet (e.g. Stripe
 * checkout failed or was abandoned).
 *
 * Authorization: caller must be the buyer of the transaction. We refuse to
 * cancel transactions whose current status is anything beyond pending —
 * we cannot mark a paid/shipped/delivered transaction as cancelled this way.
 */
export const cancelPendingTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'cancelPendingTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const txRef = db.collection('transactions').doc(transactionId);
    const callerUid = request.auth.uid;

    try {
      // ── F73: cancel the Stripe PaymentIntent BEFORE the Firestore mutation ──
      // A mixed wallet+card 'pending_payment' tx holds an uncaptured PI whose
      // clientSecret the buyer still controls. If we only refund the wallet part
      // and leave the PI confirmable, a late capture -> handlePaymentIntentSucceeded
      // -> 'cancelled_needs_refund' -> issueTransactionRefund would re-credit the
      // wallet a SECOND time. Same pattern as expirePendingPayment: retrieve,
      // refuse to act while in flight/captured, then cancel.
      const preSnap = await txRef.get();
      if (!preSnap.exists) {
        throw new HttpsError('not-found', 'Transaction not found');
      }
      const preData = preSnap.data()!;

      if (preData.buyerId !== callerUid && preData.sellerId !== callerUid) {
        throw new HttpsError('permission-denied', 'Only buyer or seller can cancel');
      }

      const cancellableStatuses = new Set([
        'pending',
        'pending_payment',
        'meetup_pending',
        'meetup_confirmed',
      ]);
      if (!cancellableStatuses.has(preData.status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot cancel transaction in status ${preData.status}`
        );
      }

      const paymentIntentId =
        typeof preData.stripePaymentIntentId === 'string' ? preData.stripePaymentIntentId : null;
      if (paymentIntentId) {
        const stripe = getStripe();
        if (!stripe) {
          throw new HttpsError('failed-precondition', 'Stripe API not configured');
        }
        // PI statuses where money is in flight or already captured — never cancel.
        const STRIPE_PI_IN_FLIGHT = new Set(['requires_capture', 'processing', 'succeeded']);
        let piStatus: string | undefined;
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          piStatus = pi.status;
        } catch (retrieveErr) {
          throw new HttpsError(
            'unavailable',
            'Impossible de vérifier le paiement. Réessayez dans un instant.'
          );
        }
        if (piStatus && STRIPE_PI_IN_FLIGHT.has(piStatus)) {
          // The card payment is captured/in flight — cancelling here would risk a
          // double-refund. Refuse; the buyer keeps a paid transaction.
          throw new HttpsError(
            'failed-precondition',
            'Le paiement est en cours de traitement et ne peut plus être annulé.'
          );
        }
        if (piStatus !== 'canceled') {
          try {
            await stripe.paymentIntents.cancel(paymentIntentId);
            logger.info('cancelPendingTransaction: PaymentIntent cancelled', {
              transactionId,
              paymentIntentId,
              piStatusBefore: piStatus,
            });
          } catch (cancelErr) {
            // It may have just become uncancelable (e.g. just succeeded) — abort
            // rather than refund the wallet while the card could still capture.
            throw new HttpsError(
              'failed-precondition',
              'Le paiement n\'a pas pu être annulé. Réessayez dans un instant.'
            );
          }
        }
      }

      await db.runTransaction(async (tx) => {
        // ── ALL READS FIRST (Firestore requires reads before writes) ──
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;

        // Re-check inside the transaction (idempotent across concurrent calls).
        if (data.buyerId !== callerUid && data.sellerId !== callerUid) {
          throw new HttpsError(
            'permission-denied',
            'Only buyer or seller can cancel'
          );
        }
        if (!cancellableStatuses.has(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot cancel transaction in status ${data.status}`
          );
        }

        // Read the article doc BEFORE any writes (Firestore transaction rule)
        // D2: Guard against deleted article — only update if it still exists
        let articleSnap = null;
        let articleRef = null;
        if (data.articleId) {
          articleRef = db.collection('articles').doc(data.articleId);
          articleSnap = await tx.get(articleRef);
        }

        // F03: Read buyer wallet if wallet was used (all reads before writes)
        const walletAmountUsed = data.walletAmountUsed || 0; // in cents
        const hasWalletDebit = walletAmountUsed > 0 && (data.paidVia === 'wallet_and_card' || data.paidVia === 'wallet');
        let buyerWalletSnap = null;
        let buyerWalletRef = null;
        if (hasWalletDebit) {
          buyerWalletRef = db.collection('wallets').doc(data.buyerId);
          buyerWalletSnap = await tx.get(buyerWalletRef);
        }

        // ── ALL WRITES AFTER ALL READS ──
        const txUpdate: Record<string, any> = {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: callerUid,
        };
        // F73: purge the wallet markers so a late card capture (race between our
        // PI cancel and a confirm) cannot trigger a SECOND wallet re-credit in
        // issueTransactionRefund — it keys on walletAmountUsed/paidVia.
        if (hasWalletDebit) {
          txUpdate.walletAmountUsed = FieldValue.delete();
          txUpdate.paidVia = FieldValue.delete();
        }
        tx.update(txRef, txUpdate);

        // Release the article so it can be purchased again.
        // createTransaction marks isSold=true atomically at creation
        // time; cancelling must undo that.
        if (articleRef && articleSnap && articleSnap.exists) {
          tx.update(articleRef, { isSold: false });
        }

        // F03: Refund wallet portion if wallet was debited
        if (hasWalletDebit && buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
          const walletData = buyerWalletSnap.data()!;
          tx.update(buyerWalletRef, {
            balance: FieldValue.increment(walletAmountUsed),
            updatedAt: FieldValue.serverTimestamp(),
          });

          const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
          tx.set(buyerLedgerRef, {
            type: 'refund_credit',
            amount: walletAmountUsed,
            balanceAfter: (walletData.balance || 0) + walletAmountUsed,
            description: 'Remboursement — transaction annulee',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
          });

          logger.info('cancelPendingTransaction: wallet portion refunded', {
            transactionId,
            buyerId: data.buyerId,
            walletAmountRefunded: walletAmountUsed,
          });
        }
      });

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error cancelling transaction:', error);
      throw new HttpsError('internal', `Failed to cancel: ${message}`);
    }
  }
);
