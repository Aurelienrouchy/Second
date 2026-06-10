/**
 * F134 — Paid shop tier encashment rail.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `feeReductionForShopTier` (payments.ts) already LOWERS the buyer protection fee
 * for pro/premium shops, but nothing ever CHARGED the forfait and no expiry was
 * enforced — a tier, once set, granted a perpetual fee reduction (lost revenue).
 *
 * This callable is the missing encashment rail:
 *   1. The shop OWNER buys a tier for a number of months.
 *   2. We create a DIRECT PLATFORM CHARGE PaymentIntent (no transfer_data /
 *      on_behalf_of — consistent with vague 1 single-rail model; the forfait
 *      revenue is platform revenue, kept on the platform account).
 *   3. The webhook (`metadata.type === 'shop_tier'`) stamps `tier` +
 *      `tierPaidUntil` on the shop AFTER payment succeeds — the tier is NEVER
 *      granted before money lands. `tier`/`tierPaidUntil` are CF-only in
 *      firestore.rules so a client cannot self-attribute a tier.
 *   4. `resolveBuyerFeeReduction` (payments.ts) only honours a tier while
 *      `tierPaidUntil > now`; an expired forfait reverts to basic (reduction 0).
 *
 * v2, region northamerica-northeast1, memory 512MiB, STRIPE_SECRET_KEY secret,
 * auth + checkRateLimit, structured logging, never writes `undefined`.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';

const REGION = 'northamerica-northeast1';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export type PaidShopTier = 'pro' | 'premium';

/**
 * Monthly forfait price per paid tier, in CENTS (CAD). Server-owned config —
 * never trusted from the client. Override via env (SHOP_TIER_PRO_MONTHLY_CENTS /
 * SHOP_TIER_PREMIUM_MONTHLY_CENTS) without a code change. Pricing is a fondateur
 * business decision; these are placeholder defaults to calibrate.
 *   - pro     (Le Comptoir) → ~half the standard buyer fee reduction
 *   - premium (La Maison)   → 0% buyer fee (Second monetizes via the forfait)
 */
const TIER_MONTHLY_PRICE_CENTS: Record<PaidShopTier, number> = {
  pro: parseInt(process.env.SHOP_TIER_PRO_MONTHLY_CENTS || '2999', 10), // 29,99 $/mois
  premium: parseInt(process.env.SHOP_TIER_PREMIUM_MONTHLY_CENTS || '7999', 10), // 79,99 $/mois
};

/** Returns the total forfait price (cents) for a tier over `periodMonths`. */
export function shopTierPriceCents(tier: PaidShopTier, periodMonths: number): number {
  return TIER_MONTHLY_PRICE_CENTS[tier] * periodMonths;
}

/**
 * purchaseShopTier — shop OWNER buys a paid tier (pro|premium) for N months.
 *
 * Input:
 *   shopId       (string, required) — the shop the caller owns
 *   tier         ('pro' | 'premium', required)
 *   periodMonths (integer 1..12, required)
 *
 * Output: { success, clientSecret, paymentIntentId, tier, periodMonths, amountCents }
 *
 * The tier is NOT applied here — only after payment succeeds (webhook). This
 * callable creates the PaymentIntent (idempotent on the active forfait PI) and
 * returns the clientSecret for the client to confirm.
 */
export const purchaseShopTier = onCall(
  { region: REGION, memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'purchaseShopTier',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const data = (request.data ?? {}) as {
      shopId?: unknown;
      tier?: unknown;
      periodMonths?: unknown;
    };

    if (typeof data.shopId !== 'string' || data.shopId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'shopId is required');
    }
    if (data.tier !== 'pro' && data.tier !== 'premium') {
      throw new HttpsError('invalid-argument', 'tier must be "pro" or "premium"');
    }
    if (
      typeof data.periodMonths !== 'number' ||
      !Number.isInteger(data.periodMonths) ||
      data.periodMonths < 1 ||
      data.periodMonths > 12
    ) {
      throw new HttpsError('invalid-argument', 'periodMonths must be an integer between 1 and 12');
    }

    const shopId = data.shopId.trim();
    const tier = data.tier as PaidShopTier;
    const periodMonths = data.periodMonths;
    const ownerUid = request.auth.uid;

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const shopRef = db.collection('shops').doc(shopId);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Boutique introuvable');
    }
    const shop = shopSnap.data()!;
    if (shop.ownerId !== ownerUid) {
      throw new HttpsError('permission-denied', 'Vous n\'êtes pas le propriétaire de cette boutique');
    }
    // B10: only an APPROVED shop earns the buyer-fee reduction (reductionForShopDoc
    // returns 0 otherwise). Refuse the purchase for pending/rejected/suspended shops
    // so we never encash a forfait that grants no benefit (no auto-refund exists).
    if (shop.status !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        'Votre boutique doit être approuvée avant de souscrire à un forfait.'
      );
    }

    const amountCents = shopTierPriceCents(tier, periodMonths);
    if (!Number.isInteger(amountCents) || amountCents < 50) {
      // Stripe minimum charge is 50¢; a sub-minimum config is a misconfiguration.
      throw new HttpsError('failed-precondition', 'Le prix du forfait est invalide');
    }

    // DIRECT PLATFORM CHARGE — no transfer_data / on_behalf_of (vague 1 model):
    // forfait revenue stays on the platform account.
    //
    // B11: the idempotency key includes the shop's CURRENT tierPaidUntil so a
    // LEGITIMATE renewal (which extends tierPaidUntil once the previous PI is
    // applied) produces a DISTINCT key — Stripe no longer dedups it inside the 24h
    // window. A true retry of the SAME attempt (before the webhook stamps the new
    // tierPaidUntil) keeps the same key and is still deduped, so no double-charge.
    const currentUntilMs =
      shop.tierPaidUntil && typeof shop.tierPaidUntil.toMillis === 'function'
        ? shop.tierPaidUntil.toMillis()
        : 0;
    const idempotencyKey = `shop_tier_${shopId}_${tier}_${periodMonths}_${currentUntilMs}`;
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'cad',
          metadata: {
            type: 'shop_tier',
            shopId,
            ownerId: ownerUid,
            tier,
            periodMonths: String(periodMonths),
          },
        },
        { idempotencyKey }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[purchaseShopTier] PaymentIntent creation failed', { shopId, tier, error: message });
      throw new HttpsError('internal', `Failed to create shop tier payment: ${message}`);
    }

    logger.info('[purchaseShopTier] PaymentIntent created', {
      shopId,
      tier,
      periodMonths,
      amountCents,
      paymentIntentId: paymentIntent.id,
    });

    return {
      success: true as const,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      tier,
      periodMonths,
      amountCents,
    };
  }
);
