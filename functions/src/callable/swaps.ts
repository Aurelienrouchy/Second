/**
 * Swap callable functions
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * ============================================================
 * SWAP ZONE MODEL — single permanent generalist zone
 * ============================================================
 * The Swap Zone is ONE permanent, generalist, always-open zone. There is no
 * join/leave model, no participants, no theme, no time window. Any authenticated
 * user can deposit an item, browse, and propose a swap. The zone document lives
 * at a deterministic id (see GENERALIST_ZONE_ID) and is bootstrapped idempotently
 * via ensureGeneralistZone.
 *
 * cashTopUp (money adjustment) is paid for real via Stripe with the SAME buyer
 * protection fee as a normal purchase (0% seller commission). The plumbing is
 * calqued on the purchase flow (createStripeCheckout / stripeWebhook):
 *  - proposeMultiSwap persists cashTopUp { amount (cents), payerId }
 *  - acceptSwap on a top-up swap transitions to 'payment_pending'
 *  - createSwapTopUpCheckout creates a Stripe destination-charge PaymentIntent
 *    for the payer → payee's connected account, with application_fee_amount
 *  - stripeWebhook (payment_intent.succeeded, type=swap_topup) advances the swap
 *    to 'accepted' (exchange mode flow) and credits the payee wallet pendingBalance
 *  - confirmSwapReception moves the payee funds pending → held with a 7-day
 *    release deadline (topUpFundsReleaseAt), EXACTLY like a delivered purchase —
 *    NOT straight to withdrawable balance
 *  - releaseHeldFunds (scheduled) moves held → balance once the window elapses
 *    and stamps topUpReleasedAt
 *  - cancel/dispute BEFORE release (topUpReleasedAt unset: funds in pending OR
 *    held) refund the payer via Stripe (charge.refunded webhook claws the
 *    complement back from the right bucket). This makes the POST-RECEPTION
 *    dispute window effective.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { getStripe } from '../config/stripe';
import { calculateFees } from '../utils/fees';
import { getOrCreateSellerWallet } from './wallet';
import { updateUserRating } from './reviews';
import { sendPushNotification } from '../utils/notifications';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';

/** Rate-limit sliding window (1 min), aligned with payments.ts. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Deterministic document id for the single permanent generalist Swap Zone.
 * Using a fixed id guarantees uniqueness (a second zone can never be created by
 * accident) and gives O(1) reads instead of a query.
 */
export const GENERALIST_ZONE_ID = 'generalist';

/** Strip undefined values (Firestore rejects undefined) */
const stripUndefined = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

/**
 * Validate that all articles in a list are available (exist, isActive, not isSold)
 * AND, when `expectedOwnerId` is provided, that each article belongs to that user
 * (article.sellerId === expectedOwnerId).
 *
 * The ownership check is a HARD financial/integrity invariant: a swap engages a
 * party's OWN items only. Without it, the initiator could stage someone else's
 * articles on either side (privilege escalation / corruption of third-party
 * articles when the swap completes and marks them sold, plus spoofed reviews on
 * an unrelated user). The article's `sellerId` is the sole source of truth for
 * ownership — never the client-supplied item payload.
 *
 * Must be called inside a transaction; reads via the transaction handle.
 */
async function validateArticlesAvailable(
  tx: FirebaseFirestore.Transaction,
  items: { articleId: string; title?: string }[],
  label: string,
  expectedOwnerId?: string
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const item of items) {
    const articleRef = db.collection('articles').doc(item.articleId);
    const articleSnap = await tx.get(articleRef);

    if (!articleSnap.exists) {
      throw new HttpsError(
        'not-found',
        `${label} : l'article "${item.title || item.articleId}" n'existe plus`
      );
    }

    const data = articleSnap.data()!;
    // Ownership invariant — checked against the article's authoritative sellerId,
    // not the client payload. Use the same 'not-found' wording as a missing item
    // so an attacker cannot probe which articles belong to which user.
    if (expectedOwnerId != null && data.sellerId !== expectedOwnerId) {
      throw new HttpsError(
        'permission-denied',
        `${label} : l'article "${item.title || item.articleId}" n'appartient pas au participant attendu`
      );
    }
    if (data.isActive === false) {
      throw new HttpsError(
        'failed-precondition',
        `${label} : l'article "${item.title || item.articleId}" n'est plus actif`
      );
    }
    if (data.isSold === true) {
      throw new HttpsError(
        'failed-precondition',
        `${label} : l'article "${item.title || item.articleId}" a déjà été vendu`
      );
    }
    // Authoritative server price — never the client payload (P1-6).
    prices[item.articleId] = typeof data.price === 'number' ? data.price : 0;
  }
  return prices;
}

/**
 * Swap statuses that still ENGAGE the articles on both sides (the exchange is
 * live and the items are reserved). Used to enforce the "one article = one
 * active swap" lock (P1-7): an article already engaged in any of these states
 * may not be staged into a new proposal. Terminal states ('completed',
 * 'cancelled', 'declined') release the articles.
 */
const ACTIVE_SWAP_STATUSES = [
  'proposed',
  'payment_pending',
  'accepted',
  'photos_pending',
  'shipping',
  'disputed',
] as const;

/**
 * Reject the proposal if ANY of the given articles is already engaged in another
 * active swap (P1-7 — prevents double-engagement of the same item in concurrent
 * swaps). Must run inside the transaction so the transactional query participates
 * in serializable isolation: a competing proposal that committed first is seen on
 * retry and the second proposal is rejected.
 *
 * Each swap doc carries a denormalized flat `articleIds` array (written at
 * proposal time) so a single `array-contains` query suffices — auto-indexed by
 * Firestore single-field indexing, no composite index required. Active-status
 * filtering is done in memory (array-contains + status `in` cannot be combined).
 */
async function assertArticlesNotEngaged(
  tx: FirebaseFirestore.Transaction,
  articleIds: string[],
  titleById: Record<string, string | undefined>
): Promise<void> {
  for (const articleId of articleIds) {
    const q = db.collection('swaps').where('articleIds', 'array-contains', articleId);
    const snap = await tx.get(q);
    const engaged = snap.docs.some((d) =>
      (ACTIVE_SWAP_STATUSES as readonly string[]).includes(d.data().status)
    );
    if (engaged) {
      throw new HttpsError(
        'failed-precondition',
        `L'article "${titleById[articleId] || articleId}" est déjà engagé dans un autre échange en cours`
      );
    }
  }
}

/**
 * Check if either user has blocked the other.
 * Reads user docs to inspect blockedUsers arrays.
 */
async function areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
  const [user1Snap, user2Snap] = await Promise.all([
    db.collection('users').doc(userId1).get(),
    db.collection('users').doc(userId2).get(),
  ]);

  const blockedBy1 = user1Snap.data()?.blockedUsers || [];
  const blockedBy2 = user2Snap.data()?.blockedUsers || [];

  return (
    blockedBy1.some((u: any) => u.userId === userId2 || u === userId2) ||
    blockedBy2.some((u: any) => u.userId === userId1 || u === userId1)
  );
}

// ============================================================
// GENERALIST ZONE BOOTSTRAP
// ============================================================

/**
 * Idempotently ensure the single permanent generalist Swap Zone exists.
 *
 * Upserts ONE document at the deterministic id GENERALIST_ZONE_ID. Counters
 * (itemsCount, swapsCount) are NEVER overwritten if the document already exists
 * — the upsert only sets descriptive fields + updatedAt. This makes the call
 * safe to invoke repeatedly (e.g. on app boot) without resetting live counters.
 *
 * No theme / startDate / endDate / status / participantsCount: the zone is
 * generalist, permanent and open to all.
 *
 * Returns { id } so the client can route to the zone without a query.
 */
export const ensureGeneralistZone = onCall(
  // 512MiB: same reason as getActiveSwapPartyInfo — 256MiB OOMs on cold start
  // with the grown shared bundle (this is why its first deploy failed readiness).
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async () => {
    const zoneRef = db.collection('swapParties').doc(GENERALIST_ZONE_ID);

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(zoneRef);

        if (!snap.exists) {
          // First-time creation: initialise counters to zero.
          tx.set(zoneRef, {
            name: 'Swap Zone',
            isGeneralist: true,
            itemsCount: 0,
            swapsCount: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        // Idempotent upsert: refresh descriptive fields + ensure isGeneralist,
        // but DO NOT touch itemsCount / swapsCount (live counters).
        tx.set(
          zoneRef,
          {
            name: 'Swap Zone',
            isGeneralist: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      logger.info('Generalist swap zone ensured', { id: GENERALIST_ZONE_ID });
      return { id: GENERALIST_ZONE_ID };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error ensuring generalist swap zone', { error: message });
      throw new HttpsError('internal', 'Failed to ensure swap zone: ' + message);
    }
  }
);

/**
 * Get the single, always-on generalist Swap Zone for the homepage.
 *
 * Reads the deterministic generalist document directly (O(1)). If the document
 * does not exist yet, it is created on the fly (idempotent bootstrap) so the
 * feature can never be "dead" because the seeder was never run.
 *
 * Exposes only live counters — no theme / startDate / endDate / status /
 * participantsCount. The front derives "nouveautés cette semaine" from the
 * items themselves.
 */
export const getActiveSwapPartyInfo = onCall(
  // 512MiB: the shared functions bundle grew (Stripe/ShipEngine/scheduled), so a
  // 256MiB instance now OOMs (~312MiB) on cold start → readiness fails → 500.
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async () => {
    try {
      const zoneRef = db.collection('swapParties').doc(GENERALIST_ZONE_ID);
      let snap = await zoneRef.get();

      // Self-healing bootstrap: create the zone if it is missing.
      if (!snap.exists) {
        await zoneRef.set({
          name: 'Swap Zone',
          isGeneralist: true,
          itemsCount: 0,
          swapsCount: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        snap = await zoneRef.get();
      }

      const data = snap.data()!;
      return {
        hasActiveParty: true,
        party: {
          id: snap.id,
          name: data.name || 'Swap Zone',
          itemsCount: data.itemsCount || 0,
          swapsCount: data.swapsCount || 0,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting active swap party info', { error: message });
      throw new HttpsError('internal', 'Failed to get swap party info: ' + message);
    }
  }
);

// ============================================================
// PROPOSE / ACCEPT
// ============================================================

/**
 * Propose a multi-article swap.
 * Supports swapping multiple items on each side, plus an optional cashTopUp
 * (money adjustment paid via Stripe). Uses runTransaction to atomically verify
 * article availability before creating the swap.
 *
 * cashTopUp: { amount: number (CENTS, > 0), payerId: string }
 *   - payerId MUST be either initiatorId or receiverId.
 *   - The payer pays `amount` + buyer protection fee via Stripe to the OTHER
 *     party (the payee). Nothing is charged at proposal time — the charge
 *     happens after acceptance via createSwapTopUpCheckout.
 */
export const proposeMultiSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const {
      initiatorId,
      initiatorName,
      initiatorImage,
      initiatorItems,
      receiverItems,
      receiverId,
      receiverName,
      receiverImage,
      message,
      cashTopUp,
      partyId,
    } = request.data;

    // Auth: initiatorId must match the authenticated user
    if (initiatorId !== request.auth.uid) {
      throw new HttpsError(
        'permission-denied',
        'L\'initiateur doit correspondre à l\'utilisateur authentifié'
      );
    }

    // Validate required fields
    if (!initiatorId || !initiatorName || !receiverId || !receiverName) {
      throw new HttpsError('invalid-argument', 'Missing required user information');
    }

    if (initiatorId === receiverId) {
      throw new HttpsError('invalid-argument', 'Impossible de proposer un échange avec soi-même');
    }

    if (!Array.isArray(initiatorItems) || initiatorItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Initiator must provide at least one item');
    }

    if (!Array.isArray(receiverItems) || receiverItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Receiver must provide at least one item');
    }

    // --- Validate cashTopUp (optional) -------------------------------------
    let validatedTopUp: { amount: number; payerId: string } | null = null;
    if (cashTopUp != null) {
      if (typeof cashTopUp !== 'object') {
        throw new HttpsError('invalid-argument', 'cashTopUp doit être un objet { amount, payerId }');
      }
      const { amount, payerId } = cashTopUp;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        throw new HttpsError('invalid-argument', 'cashTopUp.amount doit être un entier de cents > 0');
      }
      // Sanity cap: $5000 = 500000 cents (mirrors offer ceiling in messages rules)
      if (amount > 500000) {
        throw new HttpsError('invalid-argument', 'cashTopUp.amount dépasse le plafond autorisé');
      }
      if (typeof payerId !== 'string' || (payerId !== initiatorId && payerId !== receiverId)) {
        throw new HttpsError(
          'invalid-argument',
          'cashTopUp.payerId doit être l\'initiateur ou le destinataire'
        );
      }
      validatedTopUp = { amount, payerId };
    }

    try {
      // Check user blocking BEFORE the transaction (social feature, not a
      // financial invariant)
      const blocked = await areUsersBlocked(initiatorId, receiverId);
      if (blocked) {
        throw new HttpsError(
          'failed-precondition',
          'Impossible de proposer un échange avec cet utilisateur'
        );
      }

      // Atomically verify all articles and create the swap.
      // OWNERSHIP: the initiator may only engage articles they own; the items
      // requested from the receiver must actually belong to the receiver.
      const swapId = await db.runTransaction(async (tx) => {
        // NOTE: run ALL transactional reads (validation + engagement lock) BEFORE
        // any write — the Firestore transaction API forbids reads after a write.
        const initiatorPrices = await validateArticlesAvailable(
          tx, initiatorItems, 'Article proposé', initiatorId
        );
        const receiverPrices = await validateArticlesAvailable(
          tx, receiverItems, 'Article demandé', receiverId
        );

        // P1-7: refuse to engage an article already live in another swap.
        const titleById: Record<string, string | undefined> = {};
        for (const it of [...initiatorItems, ...receiverItems]) {
          if (it?.articleId) titleById[it.articleId] = it.title;
        }
        const allArticleIds = [
          ...initiatorItems.map((i: any) => i.articleId),
          ...receiverItems.map((i: any) => i.articleId),
        ].filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
        await assertArticlesNotEngaged(tx, allArticleIds, titleById);

        // P1-6: value the swap from authoritative server prices, never the
        // client-supplied item.price (which is manipulable).
        const initiatorTotalValue = initiatorItems.reduce(
          (sum: number, item: any) => sum + (initiatorPrices[item.articleId] || 0),
          0
        );
        const receiverTotalValue = receiverItems.reduce(
          (sum: number, item: any) => sum + (receiverPrices[item.articleId] || 0),
          0
        );

        const swapData = stripUndefined({
          initiatorId,
          initiatorName,
          initiatorImage,
          initiatorItems: initiatorItems.map(stripUndefined),
          initiatorTotalValue,
          receiverId,
          receiverName,
          receiverImage,
          receiverItems: receiverItems.map(stripUndefined),
          receiverTotalValue,
          // Denormalized flat article-id list powering the engagement lock query
          // (array-contains). Both sides combined.
          articleIds: allArticleIds,
          status: 'proposed',
          message,
          cashTopUp: validatedTopUp,
          partyId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const newSwapRef = db.collection('swaps').doc();
        tx.set(newSwapRef, swapData);

        return newSwapRef.id;
      });

      // Mark party items as pending AFTER transaction (non-critical side-effect)
      if (partyId) {
        await markPartyItemsPending(partyId, initiatorId, initiatorItems, true);
        await markPartyItemsPending(partyId, receiverId, receiverItems, true);
      }

      logger.info('Swap proposal created', {
        swapId, initiatorId, receiverId, hasTopUp: !!validatedTopUp,
      });

      return {
        swapId,
        success: true,
        message: 'Swap proposal created successfully',
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error proposing multi-swap', { error: errMsg, initiatorId, receiverId });
      throw new HttpsError('internal', 'Failed to propose swap: ' + errMsg);
    }
  }
);

/** Set isPending on every swapPartyItems doc matching a swap side. */
async function markPartyItemsPending(
  partyId: string,
  sellerId: string,
  items: { articleId?: string }[],
  pending: boolean
): Promise<void> {
  const partyItemsRef = db.collection('swapPartyItems');
  for (const item of items) {
    if (!item?.articleId) continue;
    const q = await partyItemsRef
      .where('partyId', '==', partyId)
      .where('articleId', '==', item.articleId)
      .where('sellerId', '==', sellerId)
      .get();
    for (const d of q.docs) {
      await d.ref.update({ isPending: pending });
    }
  }
}

/**
 * Accept a swap — callable by the receiver only.
 * Atomically verifies the swap is 'proposed' and all articles are still
 * available, then transitions.
 *
 * If the swap carries a cashTopUp, it transitions to 'payment_pending' (the
 * payer must complete the Stripe payment via createSwapTopUpCheckout before the
 * exchange proceeds). Otherwise it transitions to 'accepted' (unchanged flow).
 */
export const acceptSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const result = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        // Only the receiver can accept
        if (swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Seul le destinataire peut accepter cet échange');
        }

        // Status must be 'proposed'
        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'accepter un échange en statut "${swap.status}"`
          );
        }

        // Validate ALL articles on both sides are still available AND still owned
        // by the expected participant. Re-checking ownership at accept time closes
        // the window where an article changed hands (or never belonged to the
        // claimed party) between proposal and acceptance.
        const initiatorItems = getSwapItems(swap, 'initiator');
        const receiverItems = getSwapItems(swap, 'receiver');
        await validateArticlesAvailable(tx, initiatorItems, 'Article du proposant', swap.initiatorId);
        await validateArticlesAvailable(tx, receiverItems, 'Votre article', swap.receiverId);

        const hasTopUp = swap.cashTopUp != null && typeof swap.cashTopUp.amount === 'number';
        const newStatus = hasTopUp ? 'payment_pending' : 'accepted';

        tx.update(swapRef, {
          status: newStatus,
          acceptedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { hasTopUp, newStatus };
      });

      logger.info('Swap accepted', {
        swapId, receiverId: request.auth.uid, newStatus: result.newStatus,
      });

      return { success: true, status: result.newStatus, requiresPayment: result.hasTopUp };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error accepting swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'acceptation: ' + errMsg);
    }
  }
);

// ============================================================
// CASH TOP-UP CHECKOUT (Stripe)
// ============================================================

/**
 * Create a Stripe PaymentIntent for the cash top-up of an accepted swap.
 *
 * Only the payer (cashTopUp.payerId) can call this. The charge is a destination
 * charge to the PAYEE's connected account, with application_fee_amount = buyer
 * protection fee (same calculation as a purchase). The top-up base `amount`
 * (cents) is treated like an article price; shipping is 0.
 *
 * Returns { clientSecret } for the RN Stripe PaymentSheet — calqued on
 * createStripeCheckout.
 *
 * Idempotent: if a PaymentIntent already exists for this swap, the existing
 * clientSecret is returned.
 */
export const createSwapTopUpCheckout = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data ?? {};
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const callerUid = request.auth.uid;
    const swapRef = db.collection('swaps').doc(swapId);

    try {
      // Atomically read + validate + reserve (prevents double PI creation)
      const reserved = await db.runTransaction(async (tx) => {
        const swapSnap = await tx.get(swapRef);
        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }
        const swap = swapSnap.data()!;

        const topUp = swap.cashTopUp;
        if (topUp == null || typeof topUp.amount !== 'number' || topUp.amount <= 0) {
          throw new HttpsError('failed-precondition', 'Cet échange ne comporte pas de complément monétaire');
        }

        // Only the payer can pay
        if (topUp.payerId !== callerUid) {
          throw new HttpsError('permission-denied', 'Seul le payeur peut régler le complément');
        }

        // Must be awaiting payment
        if (swap.status !== 'payment_pending') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de payer le complément en statut "${swap.status}"`
          );
        }

        // The payee is the OTHER party
        const payeeId = topUp.payerId === swap.initiatorId ? swap.receiverId : swap.initiatorId;

        // Idempotent: PI already created
        if (swap.topUpPaymentIntentId) {
          return {
            existing: true as const,
            paymentIntentId: swap.topUpPaymentIntentId as string,
            amount: topUp.amount as number,
            payeeId,
          };
        }

        return {
          existing: false as const,
          paymentIntentId: null,
          amount: topUp.amount as number,
          payeeId,
        };
      });

      // Idempotent return — fetch existing PI's clientSecret
      if (reserved.existing) {
        const existingPI = await stripe.paymentIntents.retrieve(reserved.paymentIntentId);
        const fees = calculateFees(reserved.amount / 100, 0);
        logger.info('Returning existing swap top-up PaymentIntent', { swapId, paymentIntentId: existingPI.id });
        return {
          success: true,
          clientSecret: existingPI.client_secret,
          paymentIntentId: existingPI.id,
          feeBreakdown: {
            topUpAmount: reserved.amount,
            serviceFee: fees.serviceFee,
            serviceFeePercent: fees.serviceFeePercent,
            buyerTotal: fees.buyerTotal,
          },
        };
      }

      // Look up payee's Stripe Connect account
      const payeeDoc = await db.collection('users').doc(reserved.payeeId).get();
      if (!payeeDoc.exists) {
        throw new HttpsError('not-found', 'Bénéficiaire introuvable');
      }
      const payeeData = payeeDoc.data()!;
      if (!payeeData.stripeAccountId) {
        throw new HttpsError(
          'failed-precondition',
          'Le bénéficiaire n\'a pas encore configuré son compte de paiement.'
        );
      }
      if (payeeData.stripeChargesEnabled !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Le compte de paiement du bénéficiaire n\'est pas encore actif.'
        );
      }
      // P1: the payee must ALSO have payouts enabled. The top-up credits the
      // payee wallet pendingBalance (released to `balance` on reception), and
      // walletWithdraw refuses to pay out unless stripePayoutsEnabled === true.
      // Without this guard the payee would accumulate non-withdrawable funds.
      if (payeeData.stripePayoutsEnabled !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Le bénéficiaire ne peut pas encore recevoir de versements. Il doit finaliser la configuration de son compte de paiement.'
        );
      }

      // Fees: top-up base (cents → dollars) is the "article price", shipping 0
      const fees = calculateFees(reserved.amount / 100, 0);
      const totalChargeCents = Math.round(fees.buyerTotal * 100);
      const applicationFeeCents = Math.round(fees.serviceFee * 100);

      // SINGLE MONEY MOVEMENT PER TOP-UP.
      // We charge the platform directly (NO transfer_data / on_behalf_of), exactly
      // like the mixed wallet+card flow in payments.ts. The payee is credited via
      // the wallet ledger (pendingBalance) in handleSwapTopUpSucceeded, released to
      // `balance` once both parties confirm reception, then paid out through
      // walletWithdraw. Using transfer_data here would have Stripe auto-transfer the
      // net to the payee's Connect account AND the webhook would credit the wallet —
      // the payee would be paid twice. The wallet ledger is the single rail.
      // The platform fee is still captured: it keeps the full base amount on-platform
      // and only credits the wallet with `topUpAmount` (the service fee stays behind).
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: totalChargeCents,
          currency: 'cad',
          metadata: {
            type: 'swap_topup',
            swapId,
            payerId: callerUid,
            payeeId: reserved.payeeId,
            topUpAmount: String(reserved.amount),
            topUpFee: String(applicationFeeCents),
          },
        },
        // Deterministic key so a retry never creates a second top-up PI for the
        // same swap — Stripe returns the original PI instead.
        { idempotencyKey: `pi_swap_${swapId}` }
      );

      // Persist the PI id (never store client_secret)
      await swapRef.update({
        topUpPaymentIntentId: paymentIntent.id,
        topUpFee: applicationFeeCents,
        topUpCheckoutCreatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Swap top-up PaymentIntent created', {
        swapId,
        paymentIntentId: paymentIntent.id,
        totalCents: totalChargeCents,
        feeCents: applicationFeeCents,
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        feeBreakdown: {
          topUpAmount: reserved.amount,
          serviceFee: fees.serviceFee,
          serviceFeePercent: fees.serviceFeePercent,
          buyerTotal: fees.buyerTotal,
        },
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating swap top-up checkout', { swapId, error: message });
      throw new HttpsError('internal', 'Failed to create top-up checkout: ' + message);
    }
  }
);

// ============================================================
// POST-ACCEPTANCE SWAP LIFECYCLE CALLABLES
// ============================================================
// These operations MUST run server-side because firestore.rules only allows
// a narrow set of status transitions for client writes on swaps. All other
// field writes (exchangeMode, photos, shipping, reception, rating, payment
// transitions) go through the Admin SDK here.
// ============================================================

/**
 * Helper: release all party items (isPending = false) for both sides of a swap.
 */
async function releasePartyItems(swap: FirebaseFirestore.DocumentData): Promise<void> {
  if (!swap.partyId) return;
  await markPartyItemsPending(swap.partyId, swap.initiatorId, getSwapItems(swap, 'initiator'), false);
  await markPartyItemsPending(swap.partyId, swap.receiverId, getSwapItems(swap, 'receiver'), false);
}

/**
 * Issue a Stripe refund for a paid top-up and release the payer.
 * Refund reconciliation of the payee wallet happens via the charge.refunded
 * webhook (calqued on purchase refunds).
 */
async function refundSwapTopUpIfPaid(swap: FirebaseFirestore.DocumentData, swapId: string): Promise<void> {
  const topUp = swap.cashTopUp;
  if (topUp == null) return;
  if (!swap.topUpPaidAt || !swap.topUpPaymentIntentId) return; // never paid → nothing to refund

  const stripe = getStripe();
  if (!stripe) {
    logger.error('refundSwapTopUpIfPaid: Stripe not configured — manual refund needed', { swapId });
    return;
  }

  try {
    // Swap top-ups are DIRECT PLATFORM CHARGES (no transfer_data / on_behalf_of —
    // see createSwapTopUpCheckout above): the payee is credited via the wallet
    // ledger, not a Connect transfer. Stripe rejects reverse_transfer /
    // refund_application_fee on a charge that never used transfer_data
    // ("Cannot reverse a transfer for a charge that was not created with
    // transfer_data"). So we must NOT pass those flags here — unlike destination
    // charge refunds (purchases) which do. The application fee for a direct charge
    // is implicit (the platform kept the full amount), so a plain full refund of
    // the PaymentIntent returns everything the payer paid. Wallet reconciliation
    // of the payee's pendingBalance happens via the charge.refunded webhook.
    const refund = await stripe.refunds.create(
      {
        payment_intent: swap.topUpPaymentIntentId,
        metadata: { type: 'swap_topup_refund', swapId },
      },
      // Deterministic key tied to the swap so a re-trigger never issues a
      // second refund for the same top-up.
      { idempotencyKey: `rf_swap_${swapId}` }
    );
    await db.collection('swaps').doc(swapId).update({
      topUpRefundId: refund.id,
      topUpRefundedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info('Swap top-up refunded', { swapId, refundId: refund.id });
  } catch (err) {
    logger.error('CRITICAL: Failed to refund swap top-up — manual reconciliation needed', {
      swapId,
      paymentIntentId: swap.topUpPaymentIntentId,
      error: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Mark every article on both sides of a swap as sold + inactive, and flag the
 * matching swapPartyItems as swapped + increment the zone swapsCount. This is the
 * "the exchange stands" side-effect set, shared by confirmSwapReception (both
 * received) and resolveSwapDispute (admin rules in favor of the payee). Idempotent
 * enough for reruns: setting isSold/isSwapped twice is harmless; swapsCount is
 * incremented by the single caller that transitions to a terminal "stands" state.
 */
async function markSwapArticlesSold(
  swap: FirebaseFirestore.DocumentData,
  swapId: string,
  opts: { incrementZoneCount: boolean } = { incrementZoneCount: true }
): Promise<void> {
  const allArticleIds: string[] = [];
  for (const item of [
    ...getSwapItems(swap, 'initiator'),
    ...getSwapItems(swap, 'receiver'),
  ]) {
    if (item.articleId) allArticleIds.push(item.articleId);
  }

  for (const articleId of allArticleIds) {
    try {
      await db.collection('articles').doc(articleId).update({
        isSold: true,
        isActive: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.warn('Failed to mark article as sold after swap completion', {
        articleId,
        swapId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  if (!swap.partyId) return;

  const partyItemsRef = db.collection('swapPartyItems');
  for (const side of ['initiator', 'receiver'] as const) {
    const sellerId = side === 'initiator' ? swap.initiatorId : swap.receiverId;
    for (const item of getSwapItems(swap, side)) {
      if (!item.articleId) continue;
      const q = await partyItemsRef
        .where('partyId', '==', swap.partyId)
        .where('articleId', '==', item.articleId)
        .where('sellerId', '==', sellerId)
        .get();
      for (const d of q.docs) {
        await d.ref.update({ isSwapped: true });
      }
    }
  }

  if (opts.incrementZoneCount) {
    await db.collection('swapParties').doc(swap.partyId).update({
      swapsCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Decline a swap — either participant can decline while status is 'proposed'.
 * (Top-up swaps are never paid at 'proposed' stage, so no refund needed.)
 */
export const declineSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        if (swap.initiatorId !== request.auth!.uid && swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de décliner un échange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          status: 'declined',
          declinedBy: request.auth!.uid,
          declinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return swap;
      });

      await releasePartyItems(swapData);

      logger.info('Swap declined', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error declining swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors du refus: ' + errMsg);
    }
  }
);

/**
 * Cancel a swap — ONLY the initiator can cancel.
 * Cancellable while status is 'proposed' or 'payment_pending'. If a top-up has
 * already been paid (i.e. the swap reached 'accepted' via webhook), cancellation
 * is NOT allowed here — the exchange is in progress; use the dispute flow.
 * For a paid-but-still-payment_pending edge case the refund helper is invoked.
 */
export const cancelSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        if (swap.initiatorId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Seul l\'initiateur peut annuler cet échange');
        }

        if (swap.status !== 'proposed' && swap.status !== 'payment_pending') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'annuler un échange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          status: 'cancelled',
          cancelReason: 'cancelled_by_initiator',
          updatedAt: FieldValue.serverTimestamp(),
        });

        return swap;
      });

      // Refund any paid top-up (rare edge: paid while still payment_pending)
      await refundSwapTopUpIfPaid(swapData, swapId);
      await releasePartyItems(swapData);

      logger.info('Swap cancelled', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error cancelling swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'annulation: ' + errMsg);
    }
  }
);

/**
 * Set exchange mode for an accepted swap.
 * Transitions status from 'accepted' to 'photos_pending'.
 */
export const setSwapExchangeMode = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, exchangeMode } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!exchangeMode || typeof exchangeMode !== 'string') {
      throw new HttpsError('invalid-argument', 'exchangeMode requis');
    }

    try {
      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        if (swap.initiatorId !== request.auth!.uid && swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'accepted') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de définir le mode d'échange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          exchangeMode,
          status: 'photos_pending',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      logger.info('Swap exchange mode set', { swapId, exchangeMode, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error setting swap exchange mode', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la définition du mode: ' + errMsg);
    }
  }
);

/**
 * Upload photo proof for a swap. Transitions to 'shipping' when both sides have
 * uploaded.
 */
export const uploadSwapPhotos = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, photoUrls } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
      throw new HttpsError('invalid-argument', 'photoUrls requis (tableau non vide)');
    }

    try {
      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'photos_pending') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'uploader des photos en statut "${swap.status}"`
          );
        }

        const photoProof = {
          userId: uid,
          photos: photoUrls,
          uploadedAt: FieldValue.serverTimestamp(),
          isValidated: false,
        };

        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };

        const isInitiator = swap.initiatorId === uid;
        if (isInitiator) {
          updateData.initiatorPhotos = photoProof;
        } else {
          updateData.receiverPhotos = photoProof;
        }

        const otherSideHasPhotos = isInitiator ? !!swap.receiverPhotos : !!swap.initiatorPhotos;
        if (otherSideHasPhotos) {
          updateData.status = 'shipping';
        }

        tx.update(swapRef, updateData);
      });

      logger.info('Swap photos uploaded', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error uploading swap photos', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'upload des photos: ' + errMsg);
    }
  }
);

/**
 * Confirm shipping for a swap — participant confirms they sent their package.
 */
export const confirmSwapShipping = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'shipping') {
          throw new HttpsError('failed-precondition', 'Le swap n\'est pas en cours d\'expédition.');
        }

        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (swap.initiatorId === uid) {
          updateData.initiatorShippedAt = FieldValue.serverTimestamp();
        } else {
          updateData.receiverShippedAt = FieldValue.serverTimestamp();
        }

        tx.update(swapRef, updateData);
      });

      logger.info('Swap shipping confirmed', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming swap shipping', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la confirmation d\'envoi: ' + errMsg);
    }
  }
);

/**
 * Buyer-protection window for a swap cash top-up after reception, mirroring the
 * purchase dispute window (scheduled/releaseHeldFunds.ts DISPUTE_WINDOW_MS).
 * The payee's top-up complement sits in heldBalance during this window so a
 * post-reception dispute can still claw it back.
 */
const SWAP_TOPUP_HOLD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Confirm reception for a swap — participant confirms they received the package.
 * When BOTH sides have received: transitions to 'completed', marks articles
 * sold, marks party items swapped + increments swapsCount, and MOVES the top-up
 * funds to the payee's heldBalance (pending → held) with a 7-day release
 * deadline — EXACTLY like a delivered purchase (applyDeliveredHeldFunds). The
 * funds are released to withdrawable `balance` by the releaseHeldFunds scheduled
 * job once the window elapses, NOT here, so openSwapDispute can still refund the
 * payer during the window (post-reception recourse).
 */
export const confirmSwapReception = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'shipping') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de confirmer la réception en statut "${swap.status}"`
          );
        }

        const isInitiator = swap.initiatorId === uid;
        const otherSideReceived = isInitiator ? !!swap.receiverReceivedAt : !!swap.initiatorReceivedAt;
        const bothReceived = otherSideReceived;

        // Determine top-up hold target (the payee) before any writes.
        // topUpFundsHeldAt is the idempotence marker for the pending → held move
        // performed here; topUpReleasedAt (held → balance) is set LATER by the
        // releaseHeldFunds scheduled job once the 7-day window elapses.
        const topUp = swap.cashTopUp;
        const topUpPaid =
          topUp != null && !!swap.topUpPaidAt && !swap.topUpFundsHeldAt && !swap.topUpReleasedAt;
        let payeeWalletRef: FirebaseFirestore.DocumentReference | null = null;
        let payeeWalletData: FirebaseFirestore.DocumentData | null = null;
        let payeeId: string | null = null;
        if (bothReceived && topUpPaid) {
          const resolvedPayeeId: string = topUp.payerId === swap.initiatorId
            ? swap.receiverId
            : swap.initiatorId;
          payeeId = resolvedPayeeId;
          const { walletRef, walletData } = await getOrCreateSellerWallet(tx, resolvedPayeeId);
          payeeWalletRef = walletRef;
          payeeWalletData = walletData;
        }

        // --- Writes ---
        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isInitiator) {
          updateData.initiatorReceivedAt = FieldValue.serverTimestamp();
        } else {
          updateData.receiverReceivedAt = FieldValue.serverTimestamp();
        }
        if (bothReceived) {
          updateData.status = 'completed';
          updateData.completedAt = FieldValue.serverTimestamp();
          if (topUpPaid) {
            // Mark the pending → held move + stamp the release deadline. NOTE:
            // we DO NOT set topUpReleasedAt here — that marks "released to
            // withdrawable balance" and is owned by releaseHeldFunds. Keeping it
            // unset is what makes the post-reception dispute window effective.
            updateData.topUpFundsHeldAt = FieldValue.serverTimestamp();
            updateData.topUpFundsReleaseAt = Timestamp.fromMillis(
              Date.now() + SWAP_TOPUP_HOLD_WINDOW_MS
            );
          }
        }

        // Move top-up funds pending → held on the payee wallet (delivered, inside
        // the 7-day dispute window), EXACTLY like a delivered purchase. The funds
        // become withdrawable (held → balance) only when releaseHeldFunds runs
        // after topUpFundsReleaseAt.
        if (bothReceived && topUpPaid && payeeWalletRef && payeeWalletData && payeeId) {
          const payoutCents = Math.round(topUp.amount); // top-up amount is already in cents, fee kept by platform
          tx.update(payeeWalletRef, {
            pendingBalance: FieldValue.increment(-payoutCents),
            heldBalance: FieldValue.increment(payoutCents),
            updatedAt: FieldValue.serverTimestamp(),
          });
          const ledgerRef = payeeWalletRef.collection('ledger').doc();
          tx.set(ledgerRef, {
            type: 'funds_held',
            amount: payoutCents,
            balanceAfter: (payeeWalletData.heldBalance || 0) + payoutCents,
            description: 'Complément d\'échange — fonds en attente (fenêtre de litige 7 jours)',
            swapId,
            createdAt: FieldValue.serverTimestamp(),
            status: 'held',
          });
        }

        tx.update(swapRef, updateData);

        return {
          bothReceived,
          partyId: swap.partyId as string | undefined,
          initiatorId: swap.initiatorId as string,
          receiverId: swap.receiverId as string,
          swap,
        };
      });

      // If completed, mark ALL articles on both sides as sold + inactive
      if (swapData.bothReceived) {
        const allArticleIds: string[] = [];
        for (const item of [
          ...getSwapItems(swapData.swap, 'initiator'),
          ...getSwapItems(swapData.swap, 'receiver'),
        ]) {
          if (item.articleId) allArticleIds.push(item.articleId);
        }

        for (const articleId of allArticleIds) {
          try {
            await db.collection('articles').doc(articleId).update({
              isSold: true,
              isActive: false,
              updatedAt: FieldValue.serverTimestamp(),
            });
          } catch (err) {
            logger.warn('Failed to mark article as sold after swap completion', {
              articleId,
              swapId,
              error: err instanceof Error ? err.message : 'Unknown',
            });
          }
        }
      }

      // If completed and has a partyId, mark items swapped + increment count
      if (swapData.bothReceived && swapData.partyId) {
        const partyItemsRef = db.collection('swapPartyItems');

        for (const item of getSwapItems(swapData.swap, 'initiator')) {
          if (!item.articleId) continue;
          const q = await partyItemsRef
            .where('partyId', '==', swapData.partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', swapData.initiatorId)
            .get();
          for (const d of q.docs) {
            await d.ref.update({ isSwapped: true });
          }
        }

        for (const item of getSwapItems(swapData.swap, 'receiver')) {
          if (!item.articleId) continue;
          const q = await partyItemsRef
            .where('partyId', '==', swapData.partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', swapData.receiverId)
            .get();
          for (const d of q.docs) {
            await d.ref.update({ isSwapped: true });
          }
        }

        const partyRef = db.collection('swapParties').doc(swapData.partyId);
        await partyRef.update({
          swapsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      logger.info('Swap reception confirmed', {
        swapId,
        userId: request.auth.uid,
        completed: swapData.bothReceived,
      });
      return { success: true, completed: swapData.bothReceived };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming swap reception', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la confirmation de réception: ' + errMsg);
    }
  }
);

/**
 * Rate a completed swap — participant rates the exchange.
 */
export const rateSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, score, comment } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (typeof score !== 'number' || score < 1 || score > 5) {
      throw new HttpsError('invalid-argument', 'score requis (1-5)');
    }

    try {
      let targetUserId = '';
      let reviewerName = '';
      let reviewerImage: string | null = null;
      let articleTitle: string | null = null;
      const trimmedComment = (comment != null && typeof comment === 'string' && comment.trim().length > 0)
        ? comment.trim()
        : null;

      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'completed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de noter un échange en statut "${swap.status}"`
          );
        }

        const isInitiator = swap.initiatorId === uid;
        targetUserId = isInitiator ? swap.receiverId : swap.initiatorId;
        reviewerName = isInitiator ? swap.initiatorName : swap.receiverName;
        reviewerImage = isInitiator ? (swap.initiatorImage || null) : (swap.receiverImage || null);

        const items = getSwapItems(swap, isInitiator ? 'initiator' : 'receiver');
        articleTitle = items.length > 0 ? (items[0].title || null) : null;

        const rating: Record<string, any> = { score };
        if (trimmedComment) {
          rating.comment = trimmedComment;
        }

        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isInitiator) {
          updateData.initiatorRating = rating;
        } else {
          updateData.receiverRating = rating;
        }

        tx.update(swapRef, updateData);

        const reviewDocId = `${uid}_swap_${swapId}`;
        const reviewRef = db.collection('avis').doc(reviewDocId);
        const existingReview = await tx.get(reviewRef);
        if (!existingReview.exists) {
          tx.set(reviewRef, {
            id: reviewDocId,
            reviewerId: uid,
            reviewerName: reviewerName || 'Utilisateur',
            reviewerImage: reviewerImage,
            vendeurId: targetUserId,
            transactionId: swapId,
            transactionType: 'swap',
            articleId: null,
            articleTitle: articleTitle,
            note: score,
            text: trimmedComment || '',
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      });

      if (targetUserId) {
        await updateUserRating(targetUserId);
        try {
          await sendPushNotification(
            targetUserId,
            'Nouvel avis reçu',
            `${reviewerName || 'Un utilisateur'} vous a laissé un avis ${score}/5`,
            { reviewId: `${request.auth.uid}_swap_${swapId}`, reviewerId: request.auth.uid },
            'review_received',
          );
        } catch (notifError) {
          logger.warn('Failed to send swap review notification', { error: notifError });
        }
      }

      logger.info('Swap rated', { swapId, score, userId: request.auth.uid, targetUserId });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error rating swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la notation: ' + errMsg);
    }
  }
);

/**
 * Open a dispute on a swap — participant can dispute during shipping or after
 * completion (within the 7-day post-reception protection window). Transitions to
 * 'disputed'. If a top-up was paid AND not yet released to the payee's
 * withdrawable balance (topUpReleasedAt unset — i.e. the funds are still in
 * pendingBalance pre-reception or heldBalance during the window), it is refunded
 * to the payer. The charge.refunded webhook (handleSwapTopUpRefund) claws the
 * complement back from the correct bucket idempotently. Once releaseHeldFunds has
 * moved the funds to withdrawable balance (topUpReleasedAt set), no auto-refund
 * happens here — manual moderation handles that case.
 */
export const openSwapDispute = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, reason } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'reason requis (texte non vide)');
    }

    const trimmedReason = reason.trim();

    try {
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'etes pas participant de cet echange');
        }

        if (!['shipping', 'completed'].includes(swap.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'ouvrir un litige sur un echange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          status: 'disputed',
          disputeReason: trimmedReason,
          disputeOpenedBy: uid,
          disputeOpenedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return swap;
      });

      // Refund the payer if the top-up was paid and not yet released.
      if (!swapData.topUpReleasedAt) {
        await refundSwapTopUpIfPaid(swapData, swapId);
      }

      logger.info('Swap dispute opened', { swapId, userId: request.auth.uid, reason: trimmedReason });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error opening swap dispute', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'ouverture du litige: ' + errMsg);
    }
  }
);

// ============================================================
// SWAP ZONE ITEM MANAGEMENT (no participants — open to all)
// ============================================================
// Depositing / removing an item only requires authentication + ownership of the
// article (sellerId == uid, not sold, active). No join/leave model.
// itemsCount on the zone is kept in sync atomically.
// ============================================================

/**
 * Add an item to the Swap Zone — atomic item creation + itemsCount increment.
 * Requires only: auth + ownership of the article (no participant check).
 */
export const addItemToPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, articleId, title, price, imageUrl, userName, userImage } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }
    if (!title || typeof title !== 'string') {
      throw new HttpsError('invalid-argument', 'title requis');
    }
    if (typeof price !== 'number' || price < 0) {
      throw new HttpsError('invalid-argument', 'price invalide');
    }

    const userId = request.auth.uid;

    try {
      const itemId = await db.runTransaction(async (tx) => {
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Swap Zone introuvable');
        }

        // Verify the article exists and belongs to the user
        const articleRef = db.collection('articles').doc(articleId);
        const articleSnap = await tx.get(articleRef);
        if (!articleSnap.exists) {
          throw new HttpsError('not-found', 'Article introuvable');
        }
        const articleData = articleSnap.data()!;
        if (articleData.sellerId !== userId) {
          throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
        }
        if (articleData.isSold === true || articleData.isActive === false) {
          throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible.');
        }

        // Duplicate guard (inside tx to prevent race conditions)
        const duplicateQuery = await db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('articleId', '==', articleId)
          .get();
        if (!duplicateQuery.empty) {
          throw new HttpsError('already-exists', 'Cet article est déjà dans la Swap Zone.');
        }

        const itemRef = db.collection('swapPartyItems').doc();
        const itemData: Record<string, any> = {
          partyId,
          articleId,
          sellerId: userId,
          sellerName: userName || articleData.sellerName || '',
          title,
          price,
          isSwapped: false,
          isPending: false,
          addedAt: FieldValue.serverTimestamp(),
        };
        if (userImage && typeof userImage === 'string') {
          itemData.sellerImage = userImage;
        }
        if (imageUrl && typeof imageUrl === 'string') {
          itemData.imageUrl = imageUrl;
        }
        tx.set(itemRef, itemData);

        tx.update(partyRef, {
          itemsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return itemRef.id;
      });

      logger.info('Item added to swap zone', { partyId, articleId, userId });
      return { itemId, success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding item to swap zone', { error: errMsg, partyId, articleId, userId });
      throw new HttpsError('internal', 'Erreur lors de l\'ajout: ' + errMsg);
    }
  }
);

/**
 * Remove an item from the Swap Zone — atomic item deletion + itemsCount
 * decrement. Requires only: auth + ownership of the item.
 */
export const removeItemFromPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, articleId } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }

    const userId = request.auth.uid;

    try {
      await db.runTransaction(async (tx) => {
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Swap Zone introuvable');
        }

        const itemQuery = await db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('articleId', '==', articleId)
          .where('sellerId', '==', userId)
          .get();

        if (itemQuery.empty) {
          // Item not found — no-op (idempotent)
          return;
        }

        tx.delete(itemQuery.docs[0].ref);

        tx.update(partyRef, {
          itemsCount: FieldValue.increment(-1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      logger.info('Item removed from swap zone', { partyId, articleId, userId });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error removing item from swap zone', { error: errMsg, partyId, articleId, userId });
      throw new HttpsError('internal', 'Erreur lors du retrait: ' + errMsg);
    }
  }
);

/**
 * Get swap leaderboard (top swappers) for the zone.
 */
export const getSwapPartyLeaderboard = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    const { partyId, limit: limitParam = 10 } = request.data;

    if (!partyId) {
      throw new HttpsError('invalid-argument', 'partyId is required');
    }

    try {
      const swapsSnapshot = await db
        .collection('swaps')
        .where('partyId', '==', partyId)
        .where('status', '==', 'completed')
        .get();

      const userSwapCounts: Record<string, { count: number; name: string; image?: string }> = {};

      swapsSnapshot.docs.forEach((doc) => {
        const swap = doc.data();
        if (!userSwapCounts[swap.initiatorId]) {
          userSwapCounts[swap.initiatorId] = {
            count: 0,
            name: swap.initiatorName,
            image: swap.initiatorImage,
          };
        }
        userSwapCounts[swap.initiatorId].count++;

        if (!userSwapCounts[swap.receiverId]) {
          userSwapCounts[swap.receiverId] = {
            count: 0,
            name: swap.receiverName,
            image: swap.receiverImage,
          };
        }
        userSwapCounts[swap.receiverId].count++;
      });

      const leaderboard = Object.entries(userSwapCounts)
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limitParam);

      return { leaderboard };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting swap leaderboard', { error: message });
      throw new HttpsError('internal', 'Failed to get leaderboard: ' + message);
    }
  }
);
