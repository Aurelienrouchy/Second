import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { firestore, functions } from '@/config/firebaseConfig';
import {
  SwapParty,
  SwapPartyItem,
  SwapPartyItemExtended,
  Swap,
  SwapStatus,
  SwapExchangeMode,
  Article,
  SwapItemInfo,
} from '@/types';

// ============================================
// CONSTANTS
// ============================================

/**
 * Deterministic id of the single, always-active generalist Swap Zone.
 * Mirrors GENERALIST_ZONE_ID on the backend (swapParties/generalist).
 * Use this everywhere a partyId is required on the client.
 */
export const GENERALIST_ZONE_ID = 'generalist';

// ============================================
// HELPERS
// ============================================

/** Resolve items arrays with backward compat for legacy single-item swaps */
export function getSwapItems(swap: Swap, side: 'initiator' | 'receiver'): SwapItemInfo[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

// ============================================
// SWAP ZONE
// ============================================

/**
 * Get the (single) generalist Swap Zone by ID.
 * The backend self-heals the doc via ensureGeneralistZone, so this should
 * always resolve once the zone has been displayed at least once.
 */
export async function getSwapParty(partyId: string): Promise<SwapParty | null> {
  const docRef = doc(firestore, 'swapParties', partyId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: data?.createdAt?.toDate(),
    updatedAt: data?.updatedAt?.toDate(),
  } as SwapParty;
}

/**
 * Ensure the generalist zone exists (idempotent, self-healing).
 * Returns the zone id ('generalist').
 */
export async function ensureGeneralistZone(): Promise<{ id: string }> {
  const ensureFn = httpsCallable<void, { id: string }>(functions, 'ensureGeneralistZone');
  const result = await ensureFn();
  return result.data;
}

// ============================================
// PARTY ITEMS
// ============================================

/**
 * Add an article to the Swap Zone — delegates to the secured Cloud Function
 * (atomic counter update). NEVER writes the item doc directly client-side to
 * avoid counter drift.
 */
export async function addItemToParty(
  partyId: string,
  article: Article,
  _userId: string,
  userName: string,
  userImage?: string
): Promise<string> {
  type AddItemPayload = {
    partyId: string;
    articleId: string;
    title: string;
    price: number;
    imageUrl?: string;
    userName: string;
    userImage?: string;
  };

  const addFn = httpsCallable<AddItemPayload, { itemId: string; success: boolean }>(
    functions,
    'addItemToPartySecure'
  );

  const payload: AddItemPayload = {
    partyId,
    articleId: article.id,
    title: article.title,
    price: article.price,
    userName,
  };
  if (article.images?.[0]?.url) {
    payload.imageUrl = article.images[0].url;
  }
  if (userImage) {
    payload.userImage = userImage;
  }

  const result = await addFn(payload);
  return result.data.itemId;
}

/**
 * Remove an article from the Swap Zone — delegates to the secured Cloud
 * Function (atomic counter update).
 */
export async function removeItemFromParty(
  partyId: string,
  articleId: string,
  _userId: string
): Promise<void> {
  const removeFn = httpsCallable<
    { partyId: string; articleId: string },
    { success: boolean }
  >(functions, 'removeItemFromPartySecure');

  await removeFn({ partyId, articleId });
}

/**
 * Get all available (not swapped) items in a party.
 */
async function getPartyItems(partyId: string): Promise<SwapPartyItem[]> {
  const itemsRef = collection(firestore, 'swapPartyItems');
  const q = query(
    itemsRef,
    where('partyId', '==', partyId),
    where('isSwapped', '==', false),
    orderBy('addedAt', 'desc')
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    addedAt: d.data().addedAt?.toDate(),
  })) as SwapPartyItem[];
}

/**
 * Get the most recent available items in a party (limited).
 * Reuses the composite index swapPartyItems(partyId + isSwapped + addedAt desc).
 * Used by the home Swap Zone card to preview real stock.
 */
export async function getRecentPartyItems(
  partyId: string,
  max: number = 6
): Promise<SwapPartyItem[]> {
  const itemsRef = collection(firestore, 'swapPartyItems');
  const q = query(
    itemsRef,
    where('partyId', '==', partyId),
    where('isSwapped', '==', false),
    orderBy('addedAt', 'desc'),
    limit(max)
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    addedAt: d.data().addedAt?.toDate(),
  })) as SwapPartyItem[];
}

/**
 * Get party items enriched with full Article metadata for filtering.
 */
export async function getPartyItemsExtended(partyId: string): Promise<SwapPartyItemExtended[]> {
  const items = await getPartyItems(partyId);

  // Fetch full article data for each item. Items whose backing article no
  // longer exists, has been sold, or has been deactivated are dropped so the
  // zone never surfaces stale/unavailable stock (a server-side cleanup trigger
  // is the durable fix; this is the client-side safety net).
  const enrichedItems = await Promise.all(
    items.map(async (item): Promise<SwapPartyItemExtended | null> => {
      try {
        const articleRef = doc(firestore, 'articles', item.articleId);
        const articleSnap = await getDoc(articleRef);

        if (!articleSnap.exists()) {
          return null;
        }

        const articleData = articleSnap.data();
        if (articleData.isSold === true || articleData.isActive === false) {
          return null;
        }

        return {
          ...item,
          categoryIds: articleData.categoryIds,
          size: articleData.size,
          brand: articleData.brand,
          color: articleData.color,
          material: articleData.material,
          pattern: articleData.pattern,
          condition: articleData.condition,
        } as SwapPartyItemExtended;
      } catch (error) {
        if (__DEV__) console.error(`Error enriching item ${item.id}:`, error);
        // On a transient read error, keep the item rather than hiding valid stock.
        return item as SwapPartyItemExtended;
      }
    })
  );

  return enrichedItems.filter((item): item is SwapPartyItemExtended => item !== null);
}

// ============================================
// SWAPS
// ============================================

/**
 * Propose a swap (supports multi-article + optional cash top-up paid via Stripe).
 * Delegates to Cloud Function `proposeMultiSwap` which validates article
 * availability and user blocking atomically via runTransaction.
 *
 * `cashTopUp.amount` is expected IN CENTS (>0, max 500000).
 * `partyId` defaults to the generalist zone.
 */
export async function proposeSwap(params: {
  initiatorId: string;
  initiatorName: string;
  initiatorImage?: string;
  initiatorItems: SwapItemInfo[];
  receiverId: string;
  receiverName: string;
  receiverImage?: string;
  receiverItems: SwapItemInfo[];
  message?: string;
  cashTopUp?: { amount: number; payerId: string };
  partyId?: string;
}): Promise<string> {
  const payload = {
    ...params,
    partyId: params.partyId ?? GENERALIST_ZONE_ID,
  };
  const proposeMultiSwapFn = httpsCallable<typeof payload, { swapId: string; success: boolean }>(
    functions,
    'proposeMultiSwap'
  );
  const result = await proposeMultiSwapFn(payload);
  return result.data.swapId;
}

/**
 * Accept a swap — delegates to Cloud Function `acceptSwap` which validates
 * article availability atomically via runTransaction before accepting.
 *
 * If the swap carries a cash top-up, the swap moves to `payment_pending` and
 * `requiresPayment` is true: the payer must then settle via Stripe before the
 * swap can advance (the webhook flips it to `accepted`).
 */
export async function acceptSwap(
  swapId: string
): Promise<{ status: 'accepted' | 'payment_pending'; requiresPayment: boolean }> {
  const acceptSwapFn = httpsCallable<
    { swapId: string },
    { success: boolean; status: 'accepted' | 'payment_pending'; requiresPayment: boolean }
  >(functions, 'acceptSwap');
  const result = await acceptSwapFn({ swapId });
  return { status: result.data.status, requiresPayment: result.data.requiresPayment };
}

/**
 * Fee breakdown returned by createSwapTopUpCheckout (amounts in cents).
 */
export interface SwapTopUpFeeBreakdown {
  topUpAmount: number;
  serviceFee: number;
  serviceFeePercent: number;
  buyerTotal: number;
}

/**
 * Create the Stripe checkout for a swap cash top-up. Callable ONLY by the
 * payer (cashTopUp.payerId). Returns the PaymentIntent client secret + the
 * fee breakdown for display.
 */
export async function createSwapTopUpCheckout(
  swapId: string
): Promise<{
  clientSecret: string;
  paymentIntentId: string;
  feeBreakdown: SwapTopUpFeeBreakdown;
}> {
  const checkoutFn = httpsCallable<
    { swapId: string },
    {
      success: boolean;
      clientSecret: string;
      paymentIntentId: string;
      feeBreakdown: SwapTopUpFeeBreakdown;
    }
  >(functions, 'createSwapTopUpCheckout');
  const result = await checkoutFn({ swapId });
  return {
    clientSecret: result.data.clientSecret,
    paymentIntentId: result.data.paymentIntentId,
    feeBreakdown: result.data.feeBreakdown,
  };
}

/**
 * Decline a swap — delegates to Cloud Function which handles
 * status transition + party item release via Admin SDK.
 */
export async function declineSwap(swapId: string): Promise<void> {
  const declineSwapFn = httpsCallable<{ swapId: string }, { success: boolean }>(
    functions,
    'declineSwap'
  );
  await declineSwapFn({ swapId });
}

/**
 * Cancel a swap (by initiator) — delegates to Cloud Function which handles
 * status transition + party item release via Admin SDK.
 */
export async function cancelSwap(swapId: string): Promise<void> {
  const cancelSwapFn = httpsCallable<{ swapId: string }, { success: boolean }>(
    functions,
    'cancelSwap'
  );
  await cancelSwapFn({ swapId });
}

/**
 * Set exchange mode for a swap — delegates to Cloud Function which handles
 * the accepted -> photos_pending transition via Admin SDK.
 */
export async function setExchangeMode(swapId: string, mode: SwapExchangeMode): Promise<void> {
  const setModeFn = httpsCallable<{ swapId: string; exchangeMode: string }, { success: boolean }>(
    functions,
    'setSwapExchangeMode'
  );
  await setModeFn({ swapId, exchangeMode: mode });
}

/**
 * Upload photo proof for a swap — delegates to Cloud Function which handles
 * writing photos + auto-transition to 'shipping' when both sides upload.
 */
export async function uploadSwapPhotos(
  swapId: string,
  _userId: string,
  photoUrls: string[]
): Promise<void> {
  const uploadFn = httpsCallable<{ swapId: string; photoUrls: string[] }, { success: boolean }>(
    functions,
    'uploadSwapPhotos'
  );
  await uploadFn({ swapId, photoUrls });
}

/**
 * Confirm shipping for a swap — delegates to Cloud Function.
 */
export async function confirmShipping(swapId: string, _userId: string): Promise<void> {
  const confirmFn = httpsCallable<{ swapId: string }, { success: boolean }>(
    functions,
    'confirmSwapShipping'
  );
  await confirmFn({ swapId });
}

/**
 * Confirm reception for a swap — delegates to Cloud Function which handles
 * the completion transition + party item marking when both sides receive.
 */
export async function confirmReception(swapId: string, _userId: string): Promise<void> {
  const confirmFn = httpsCallable<{ swapId: string }, { success: boolean; completed: boolean }>(
    functions,
    'confirmSwapReception'
  );
  await confirmFn({ swapId });
}

/**
 * Rate a swap — delegates to Cloud Function which verifies
 * status == 'completed' before writing the rating.
 */
export async function rateSwap(
  swapId: string,
  _userId: string,
  score: number,
  comment?: string
): Promise<void> {
  const rateFn = httpsCallable<
    { swapId: string; score: number; comment?: string },
    { success: boolean }
  >(functions, 'rateSwap');
  await rateFn({ swapId, score, comment });
}

/**
 * Open a dispute on a swap — delegates to Cloud Function `openSwapDispute`.
 * Callable by either participant while the swap is in `shipping` or
 * `completed`. The function transitions the swap to `disputed` (via
 * runTransaction) and refunds any paid cash top-up to the payer.
 */
export async function openSwapDispute(swapId: string, reason: string): Promise<void> {
  const disputeFn = httpsCallable<{ swapId: string; reason: string }, { success: boolean }>(
    functions,
    'openSwapDispute'
  );
  await disputeFn({ swapId, reason });
}

/**
 * Get swaps for a user (as initiator or receiver)
 */
export async function getUserSwaps(userId: string): Promise<Swap[]> {
  const swapsRef = collection(firestore, 'swaps');

  // Get swaps where user is initiator
  const initiatorQuery = query(
    swapsRef,
    where('initiatorId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const initiatorSnapshot = await getDocs(initiatorQuery);

  // Get swaps where user is receiver
  const receiverQuery = query(
    swapsRef,
    where('receiverId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const receiverSnapshot = await getDocs(receiverQuery);

  const swaps: Swap[] = [];

  initiatorSnapshot.docs.forEach((d) => {
    const data = d.data();
    swaps.push({
      id: d.id,
      ...data,
      createdAt: data?.createdAt?.toDate(),
      updatedAt: data?.updatedAt?.toDate(),
      acceptedAt: data?.acceptedAt?.toDate(),
      completedAt: data?.completedAt?.toDate(),
      paidAt: data?.paidAt?.toDate(),
    } as Swap);
  });

  receiverSnapshot.docs.forEach((d) => {
    // Avoid duplicates (shouldn't happen but just in case)
    if (!swaps.find((s) => s.id === d.id)) {
      const data = d.data();
      swaps.push({
        id: d.id,
        ...data,
        createdAt: data?.createdAt?.toDate(),
        updatedAt: data?.updatedAt?.toDate(),
        acceptedAt: data?.acceptedAt?.toDate(),
        completedAt: data?.completedAt?.toDate(),
        paidAt: data?.paidAt?.toDate(),
      } as Swap);
    }
  });

  // Sort by createdAt
  swaps.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return swaps;
}

const ACTIVE_SWAP_STATUSES: SwapStatus[] = [
  'payment_pending',
  'accepted',
  'photos_pending',
  'shipping',
];

/**
 * Get active swaps (in progress) for a user
 */
export async function getActiveSwaps(userId: string): Promise<Swap[]> {
  const allSwaps = await getUserSwaps(userId);
  return allSwaps.filter((swap) => ACTIVE_SWAP_STATUSES.includes(swap.status));
}

/**
 * Subscribe to swap updates
 */
export function subscribeToSwap(
  swapId: string,
  callback: (swap: Swap | null) => void
): () => void {
  const swapRef = doc(firestore, 'swaps', swapId);

  return onSnapshot(
    swapRef,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }

      const data = snap.data();
      callback({
        id: snap.id,
        ...data,
        createdAt: data?.createdAt?.toDate(),
        updatedAt: data?.updatedAt?.toDate(),
        acceptedAt: data?.acceptedAt?.toDate(),
        completedAt: data?.completedAt?.toDate(),
        paidAt: data?.paidAt?.toDate(),
      } as Swap);
    },
    (error) => {
      // Permission denied (non-participant) or session expired: surface to the
      // screen so it can render an error/empty state instead of an infinite skeleton.
      if (__DEV__) console.error(`Error subscribing to swap ${swapId}:`, error);
      callback(null);
    }
  );
}
