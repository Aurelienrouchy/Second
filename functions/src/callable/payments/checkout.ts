import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import { assertNewPaymentsEnabled } from '../../config/featureFlags';
import { reservePurchase } from '../../utils/shippingPurchase';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../../utils/privateAccountSession';
/**
 * Paiement — Tunnel d'achat : frais affichés, création de transaction, PaymentIntent.
 *
 * Éclaté depuis functions/src/callable/payments.ts (3881 lignes).
 * `callable/payments.ts` reste la façade : index.ts et sweepPendingLabels
 * importent depuis là, inchangés.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config/firebase';
import { calculateServiceFee, getServiceFeeConfig, calculateTaxOnServiceFee, getTaxConfig } from '../../utils/fees';
import { checkRateLimit, resolveCallerKey } from '../../utils/rateLimit';
import { captureServerEvent } from '../../lib/analytics';
import { RATE_LIMIT_WINDOW_MS, resolveBuyerFeeReduction } from './feeReduction';
import { isDevCommerceTestRuntime } from '../../config/runtimeEnvironment';

/**
 * F24: Stripe's minimum card charge for CAD is 50 cents. A mixed wallet+card
 * payment whose card remainder falls below this would create an invalid
 * PaymentIntent, so we reject such a split before debiting the wallet.
 */

export const STRIPE_MIN_CHARGE_CENTS = 50;

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

export async function verifyAcceptedOfferForNegotiatedAmount(params: {
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


export const getServiceFee = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/checkout.getServiceFee"}, async () => {
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
  const taxConfig = getTaxConfig();
  // A tax estimate uses the current SDK owner and its native primary address,
  // never a free tax jurisdiction supplied alongside a client price.
  let tax:ReturnType<typeof calculateTaxOnServiceFee>;
  if(isDevCommerceTestRuntime()&&!taxConfig.enabled){
    // Display-only test estimate, before the buyer has supplied a destination.
    // The payable quote still records its native address and test tax decision.
    tax=await withPrivateAccountSession(request,async()=>{
      await assertPrivateAccountSession(request);
      return {gst:0,qst:0,taxTotal:0,taxOnServiceFee:0};
    });
  }else if(serviceFee>0){
    tax=await withPrivateAccountSession(request,async()=>{
      return db.runTransaction(async tx=>{
        await assertPrivateAccountSession(request,tx);
        const uid=request.auth!.uid,user=(await tx.get(db.collection('users').doc(uid))).data();
        const primary=Array.isArray(user?.addresses)?user.addresses.filter((a:any)=>a?.isDefault===true):[];
        const result=calculateTaxOnServiceFee(serviceFee,{recipientUid:uid,source:'payer_declared_primary_address',
          address:primary.length===1?primary[0]:null,nativeSourceReference:'users_primary_address',transport:'none'});
        await assertPrivateAccountSession(request,tx);return result;
      });
    });
  }else tax=calculateTaxOnServiceFee(serviceFee);

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
    ...(isDevCommerceTestRuntime()?{testMode:'seconde_dev_commerce_v1'}:{}),
  };

    });
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
 * New reservations use an explicitly accepted shipping quote. Direct meetup
 * creation is refused; accepted meetup agreements use their dedicated handlers.
 */

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
 * New reservations use an explicitly accepted shipping quote. Direct meetup
 * creation is refused; accepted meetup agreements use their dedicated handlers.
 */

export const createTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'] },
  async request => withFinancialRecoveryScope({operation: "callable/payments/checkout.createTransaction"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, { functionName: 'createTransaction', maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    const result = await reservePurchase(request.auth!.uid, request.data, tx => assertPrivateAccountSession(request, tx));
    if (!result.replay) {
      await assertPrivateAccountSession(request);
      await captureServerEvent(request.auth.uid, 'order_created', {
      transaction_id: result.transactionId, delivery_type: 'shipping', source: 'shipping_checkout',
        $insert_id: `order_created_${result.transactionId}`,
      });
    }
    return result;
  }))
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
 * Creates a private manual-confirmation intention without a wallet debit.
 * Returns an allowlisted preparation/receipt; no autonomous client secret.
 */

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
 * Creates a private manual-confirmation intention without a wallet debit.
 * Returns an allowlisted preparation/receipt; no autonomous client secret.
 */

export const createStripeCheckout = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'] },
  async request => withFinancialRecoveryScope({operation: "callable/payments/checkout.createStripeCheckout"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
    if (typeof request.data?.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.data.transactionId)) {
      assertNewPaymentsEnabled();
      throw new HttpsError('invalid-argument', 'transactionId invalide');
    }
    const { checkoutId, prepareStripeCheckout } = await import('../../utils/stripeCheckout');
    const id = checkoutId(request.data?.transactionId);
    await checkRateLimit(request.auth.uid, true, { functionName: 'createStripeCheckout', maxCallsAuthenticated: 10, maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    return prepareStripeCheckout(request.auth!.uid, id, request.data?.walletAmount, tx => assertPrivateAccountSession(request, tx));
  }))
);

/** New manual-confirmation authorization; capture policy and webhook settlement stay unchanged. */
export const confirmStripeCheckout = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'] },
  async request => withFinancialRecoveryScope({operation: "callable/payments/checkout.confirmStripeCheckout"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
    const { checkoutId, confirmStripePurchase } = await import('../../utils/stripeCheckout');
    const id = checkoutId(request.data?.transactionId);
    await checkRateLimit(request.auth.uid, true, { functionName: 'confirmStripeCheckout', maxCallsAuthenticated: 10, maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    return confirmStripePurchase(request.auth!.uid, id, request.data, tx => assertPrivateAccountSession(request, tx));
  }))
);

/** Explicit retirement of legacy automatic card capability, preserving funds obligations. */
export const retireLegacyStripeCheckout = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async request => withFinancialRecoveryScope({operation: "callable/payments/checkout.retireLegacyStripeCheckout"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
    if(request.data?.capability==='relationship_purchase_retirement_v1'){
      const {retireRelationshipLegacyPurchase}=await import('../../utils/stripeCheckout');
      await checkRateLimit(request.auth.uid,true,{functionName:'retireLegacyStripeCheckout',maxCallsAuthenticated:10,maxCallsUnauthenticated:0,windowMs:RATE_LIMIT_WINDOW_MS});
      return retireRelationshipLegacyPurchase(request);
    }
    const { checkoutId, retireLegacyStripePurchase } = await import('../../utils/stripeCheckout');
    const id = checkoutId(request.data?.transactionId);
    await checkRateLimit(request.auth.uid, true, { functionName: 'retireLegacyStripeCheckout', maxCallsAuthenticated: 10, maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    return retireLegacyStripePurchase(request.auth!.uid, id, request.data, tx => assertPrivateAccountSession(request, tx));
  }))
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
