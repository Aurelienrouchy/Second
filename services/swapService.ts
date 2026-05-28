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
  SwapPartyParticipant,
  SwapPartyItem,
  SwapPartyItemExtended,
  Swap,
  SwapExchangeMode,
  Article,
  SwapItemInfo,
} from '@/types';

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
// SWAP PARTIES
// ============================================

/**
 * Get all swap parties (upcoming and active)
 */
export async function getSwapParties(): Promise<SwapParty[]> {
  const partiesRef = collection(firestore, 'swapParties');
  const q = query(
    partiesRef,
    where('status', 'in', ['upcoming', 'active']),
    orderBy('startDate', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    startDate: doc.data().startDate?.toDate(),
    endDate: doc.data().endDate?.toDate(),
    createdAt: doc.data().createdAt?.toDate(),
    updatedAt: doc.data().updatedAt?.toDate(),
  })) as SwapParty[];
}

/**
 * Get a single swap party by ID
 */
export async function getSwapParty(partyId: string): Promise<SwapParty | null> {
  const docRef = doc(firestore, 'swapParties', partyId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    startDate: data?.startDate?.toDate(),
    endDate: data?.endDate?.toDate(),
    createdAt: data?.createdAt?.toDate(),
    updatedAt: data?.updatedAt?.toDate(),
  } as SwapParty;
}

/**
 * Get active swap party (currently running)
 */
export async function getActiveSwapParty(): Promise<SwapParty | null> {
  const partiesRef = collection(firestore, 'swapParties');
  const q = query(
    partiesRef,
    where('status', '==', 'active'),
    limit(1)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    startDate: data?.startDate?.toDate(),
    endDate: data?.endDate?.toDate(),
    createdAt: data?.createdAt?.toDate(),
    updatedAt: data?.updatedAt?.toDate(),
  } as SwapParty;
}

/**
 * Get ended swap parties
 */
export async function getEndedSwapParties(count: number = 10): Promise<SwapParty[]> {
  const partiesRef = collection(firestore, 'swapParties');
  const q = query(
    partiesRef,
    where('status', '==', 'ended'),
    orderBy('endDate', 'desc'),
    limit(count)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    startDate: d.data().startDate?.toDate(),
    endDate: d.data().endDate?.toDate(),
    createdAt: d.data().createdAt?.toDate(),
    updatedAt: d.data().updatedAt?.toDate(),
  })) as SwapParty[];
}

/**
 * Get upcoming swap parties
 */
export async function getUpcomingSwapParties(count: number = 5): Promise<SwapParty[]> {
  const partiesRef = collection(firestore, 'swapParties');
  const q = query(
    partiesRef,
    where('status', '==', 'upcoming'),
    orderBy('startDate', 'asc'),
    limit(count)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    startDate: doc.data().startDate?.toDate(),
    endDate: doc.data().endDate?.toDate(),
    createdAt: doc.data().createdAt?.toDate(),
    updatedAt: doc.data().updatedAt?.toDate(),
  })) as SwapParty[];
}

// ============================================
// PARTY PARTICIPATION
// ============================================

/**
 * Join a swap party (delegates to Cloud Function for atomic counter update)
 */
export async function joinSwapParty(
  partyId: string,
  userId: string,
  userName: string,
  userImage?: string
): Promise<string> {
  const joinFn = httpsCallable<
    { partyId: string; userName: string; userImage?: string },
    { participantId: string; success: boolean }
  >(functions, 'joinSwapPartySecure');

  const result = await joinFn({
    partyId,
    userName,
    ...(userImage ? { userImage } : {}),
  });
  return result.data.participantId;
}

/**
 * Leave a swap party (delegates to Cloud Function for atomic counter update)
 */
export async function leaveSwapParty(partyId: string, _userId: string): Promise<void> {
  const leaveFn = httpsCallable<{ partyId: string }, { success: boolean }>(
    functions,
    'leaveSwapPartySecure'
  );
  await leaveFn({ partyId });
}

/**
 * Check if user is participant in a party
 */
export async function isParticipant(partyId: string, userId: string): Promise<boolean> {
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const q = query(
    participantsRef,
    where('partyId', '==', partyId),
    where('userId', '==', userId)
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * Get all party IDs a user participates in (batch query, avoids N+1)
 */
export async function getUserParticipatingPartyIds(userId: string): Promise<Set<string>> {
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const q = query(
    participantsRef,
    where('userId', '==', userId)
  );
  const snapshot = await getDocs(q);
  return new Set(snapshot.docs.map((d) => d.data().partyId as string));
}

/**
 * Get participants of a party
 */
export async function getPartyParticipants(partyId: string): Promise<SwapPartyParticipant[]> {
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const q = query(participantsRef, where('partyId', '==', partyId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    joinedAt: doc.data().joinedAt?.toDate(),
  })) as SwapPartyParticipant[];
}

// ============================================
// PARTY ITEMS
// ============================================

/**
 * Add an article to a swap party (delegates to Cloud Function for atomic counter update)
 */
export async function addItemToParty(
  partyId: string,
  article: Article,
  userId: string,
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
 * Remove an article from a swap party (delegates to Cloud Function for atomic counter update)
 */
export async function removeItemFromParty(partyId: string, articleId: string, _userId: string): Promise<void> {
  const removeFn = httpsCallable<
    { partyId: string; articleId: string },
    { success: boolean }
  >(functions, 'removeItemFromPartySecure');

  await removeFn({ partyId, articleId });
}

/**
 * Get all items in a party
 */
export async function getPartyItems(partyId: string): Promise<SwapPartyItem[]> {
  const itemsRef = collection(firestore, 'swapPartyItems');
  const q = query(
    itemsRef,
    where('partyId', '==', partyId),
    where('isSwapped', '==', false),
    orderBy('addedAt', 'desc')
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    addedAt: doc.data().addedAt?.toDate(),
  })) as SwapPartyItem[];
}

/**
 * Get party items enriched with full Article metadata for filtering
 */
export async function getPartyItemsExtended(partyId: string): Promise<SwapPartyItemExtended[]> {
  const items = await getPartyItems(partyId);
  
  // Fetch full article data for each item
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      try {
        const articleRef = doc(firestore, 'articles', item.articleId);
        const articleSnap = await getDoc(articleRef);
        
        if (!articleSnap.exists()) {
          return item as SwapPartyItemExtended;
        }
        
        const articleData = articleSnap.data();
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
        console.error(`Error enriching item ${item.id}:`, error);
        return item as SwapPartyItemExtended;
      }
    })
  );
  
  return enrichedItems;
}

/**
 * Get items that match for swap (within ±20% value)
 */
export async function getMatchingItems(
  partyId: string,
  targetPrice: number,
  excludeSellerId: string
): Promise<SwapPartyItem[]> {
  const items = await getPartyItems(partyId);
  const minPrice = targetPrice * 0.8;
  const maxPrice = targetPrice * 1.2;

  return items.filter(
    (item) =>
      item.sellerId !== excludeSellerId &&
      item.price >= minPrice &&
      item.price <= maxPrice &&
      !item.isSwapped
  );
}

// ============================================
// SWAPS
// ============================================

/**
 * Propose a swap (supports both single article and multi-article)
 * Delegates to Cloud Function `proposeMultiSwap` which validates article availability
 * and user blocking atomically via runTransaction.
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
  const proposeMultiSwapFn = httpsCallable<typeof params, { swapId: string; success: boolean }>(
    functions,
    'proposeMultiSwap'
  );
  const result = await proposeMultiSwapFn(params);
  return result.data.swapId;
}

/**
 * Accept a swap — delegates to Cloud Function `acceptSwap` which validates
 * article availability atomically via runTransaction before accepting.
 * Rejects if any article has been sold, deleted, or deactivated since the proposal.
 */
export async function acceptSwap(swapId: string): Promise<void> {
  const acceptSwapFn = httpsCallable<{ swapId: string }, { success: boolean }>(
    functions,
    'acceptSwap'
  );
  await acceptSwapFn({ swapId });
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
 * Get a swap by ID
 */
export async function getSwap(swapId: string): Promise<Swap | null> {
  const docRef = doc(firestore, 'swaps', swapId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: data?.createdAt?.toDate(),
    updatedAt: data?.updatedAt?.toDate(),
    acceptedAt: data?.acceptedAt?.toDate(),
    completedAt: data?.completedAt?.toDate(),
  } as Swap;
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

  initiatorSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    swaps.push({
      id: doc.id,
      ...data,
      createdAt: data?.createdAt?.toDate(),
      updatedAt: data?.updatedAt?.toDate(),
      acceptedAt: data?.acceptedAt?.toDate(),
      completedAt: data?.completedAt?.toDate(),
    } as Swap);
  });

  receiverSnapshot.docs.forEach((doc) => {
    // Avoid duplicates (shouldn't happen but just in case)
    if (!swaps.find((s) => s.id === doc.id)) {
      const data = doc.data();
      swaps.push({
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate(),
        updatedAt: data?.updatedAt?.toDate(),
        acceptedAt: data?.acceptedAt?.toDate(),
        completedAt: data?.completedAt?.toDate(),
      } as Swap);
    }
  });

  // Sort by createdAt
  swaps.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return swaps;
}

/**
 * Get pending swaps (proposals) for a user
 */
export async function getPendingSwaps(userId: string): Promise<Swap[]> {
  const swapsRef = collection(firestore, 'swaps');
  const q = query(
    swapsRef,
    where('receiverId', '==', userId),
    where('status', '==', 'proposed'),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data?.createdAt?.toDate(),
      updatedAt: data?.updatedAt?.toDate(),
    } as Swap;
  });
}

/**
 * Get active swaps (in progress) for a user
 */
export async function getActiveSwaps(userId: string): Promise<Swap[]> {
  const allSwaps = await getUserSwaps(userId);
  return allSwaps.filter((swap) =>
    ['accepted', 'photos_pending', 'shipping'].includes(swap.status)
  );
}

/**
 * Get user's available items in a party (not swapped and not pending)
 */
export async function getUserAvailablePartyItems(partyId: string, userId: string): Promise<SwapPartyItem[]> {
  const itemsRef = collection(firestore, 'swapPartyItems');
  const q = query(
    itemsRef,
    where('partyId', '==', partyId),
    where('sellerId', '==', userId),
    where('isSwapped', '==', false)
  );
  const snapshot = await getDocs(q);

  const items = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    addedAt: doc.data().addedAt?.toDate(),
  })) as SwapPartyItem[];

  // Filter out pending items (those in an active pending swap)
  return items.filter((item) => !(item as SwapPartyItem & { isPending?: boolean }).isPending);
}

/**
 * Subscribe to swap updates
 */
export function subscribeToSwap(
  swapId: string,
  callback: (swap: Swap | null) => void
): () => void {
  const swapRef = doc(firestore, 'swaps', swapId);

  return onSnapshot(swapRef, (doc) => {
    if (!doc.exists()) {
      callback(null);
      return;
    }

    const data = doc.data();
    callback({
      id: doc.id,
      ...data,
      createdAt: data?.createdAt?.toDate(),
      updatedAt: data?.updatedAt?.toDate(),
      acceptedAt: data?.acceptedAt?.toDate(),
      completedAt: data?.completedAt?.toDate(),
    } as Swap);
  });
}
