import { httpsCallable } from '@react-native-firebase/functions';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { firestore, functions } from '@/config/firebaseConfig';
import {
  SwapParty,
  SwapPartyParticipant,
  SwapPartyItem,
  SwapPartyItemExtended,
  Swap,
  SwapStatus,
  SwapExchangeMode,
  Article,
} from '@/types';

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
 * Join a swap party
 */
export async function joinSwapParty(
  partyId: string,
  userId: string,
  userName: string,
  userImage?: string
): Promise<string> {
  // Check if already joined
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const existingQuery = query(
    participantsRef,
    where('partyId', '==', partyId),
    where('userId', '==', userId)
  );
  const existing = await getDocs(existingQuery);

  if (!existing.empty) {
    return existing.docs[0].id; // Already joined
  }

  // Join party - filter out undefined values (Firestore doesn't accept undefined)
  const participantData: Record<string, any> = {
    partyId,
    userId,
    userName,
    itemIds: [],
    joinedAt: serverTimestamp(),
  };

  // Only add userImage if it's defined
  if (userImage) {
    participantData.userImage = userImage;
  }

  const docRef = await addDoc(participantsRef, participantData);

  // Increment participant count
  const partyRef = doc(firestore, 'swapParties', partyId);
  await updateDoc(partyRef, {
    participantsCount: (await getDoc(partyRef)).data()?.participantsCount + 1 || 1,
  });

  return docRef.id;
}

/**
 * Leave a swap party
 */
export async function leaveSwapParty(partyId: string, userId: string): Promise<void> {
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const q = query(
    participantsRef,
    where('partyId', '==', partyId),
    where('userId', '==', userId)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  // Remove all items from party first
  const itemsRef = collection(firestore, 'swapPartyItems');
  const itemsQuery = query(
    itemsRef,
    where('partyId', '==', partyId),
    where('sellerId', '==', userId)
  );
  const itemsSnapshot = await getDocs(itemsQuery);
  for (const itemDoc of itemsSnapshot.docs) {
    await deleteDoc(doc(firestore, 'swapPartyItems', itemDoc.id));
  }

  // Delete participation
  await deleteDoc(doc(firestore, 'swapPartyParticipants', snapshot.docs[0].id));

  // Decrement counts
  const partyRef = doc(firestore, 'swapParties', partyId);
  const partyDoc = await getDoc(partyRef);
  await updateDoc(partyRef, {
    participantsCount: Math.max(0, (partyDoc.data()?.participantsCount || 1) - 1),
    itemsCount: Math.max(0, (partyDoc.data()?.itemsCount || itemsSnapshot.size) - itemsSnapshot.size),
  });
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
 * Add an article to a swap party
 */
export async function addItemToParty(
  partyId: string,
  article: Article,
  userId: string,
  userName: string,
  userImage?: string
): Promise<string> {
  // Build item data - only include defined values (Firestore doesn't accept undefined)
  const itemData: Record<string, any> = {
    partyId,
    articleId: article.id,
    sellerId: userId,
    sellerName: userName,
    title: article.title,
    price: article.price,
    isSwapped: false,
    addedAt: serverTimestamp(),
  };

  // Only add optional fields if defined
  if (userImage) {
    itemData.sellerImage = userImage;
  }
  if (article.images?.[0]?.url) {
    itemData.imageUrl = article.images[0].url;
  }

  const itemsRef = collection(firestore, 'swapPartyItems');
  const docRef = await addDoc(itemsRef, itemData);

  // Update participant's items list
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const participantQuery = query(
    participantsRef,
    where('partyId', '==', partyId),
    where('userId', '==', userId)
  );
  const participantSnapshot = await getDocs(participantQuery);
  if (!participantSnapshot.empty) {
    const participantDoc = participantSnapshot.docs[0];
    const currentItems = participantDoc.data().itemIds || [];
    await updateDoc(doc(firestore, 'swapPartyParticipants', participantDoc.id), {
      itemIds: [...currentItems, article.id],
    });
  }

  // Increment items count
  const partyRef = doc(firestore, 'swapParties', partyId);
  const partyDoc = await getDoc(partyRef);
  await updateDoc(partyRef, {
    itemsCount: (partyDoc.data()?.itemsCount || 0) + 1,
  });

  return docRef.id;
}

/**
 * Remove an article from a swap party
 */
export async function removeItemFromParty(partyId: string, articleId: string, userId: string): Promise<void> {
  const itemsRef = collection(firestore, 'swapPartyItems');
  const q = query(
    itemsRef,
    where('partyId', '==', partyId),
    where('articleId', '==', articleId),
    where('sellerId', '==', userId)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  await deleteDoc(doc(firestore, 'swapPartyItems', snapshot.docs[0].id));

  // Update participant's items list
  const participantsRef = collection(firestore, 'swapPartyParticipants');
  const participantQuery = query(
    participantsRef,
    where('partyId', '==', partyId),
    where('userId', '==', userId)
  );
  const participantSnapshot = await getDocs(participantQuery);
  if (!participantSnapshot.empty) {
    const participantDoc = participantSnapshot.docs[0];
    const currentItems = participantDoc.data().itemIds || [];
    await updateDoc(doc(firestore, 'swapPartyParticipants', participantDoc.id), {
      itemIds: currentItems.filter((id: string) => id !== articleId),
    });
  }

  // Decrement items count
  const partyRef = doc(firestore, 'swapParties', partyId);
  const partyDoc = await getDoc(partyRef);
  await updateDoc(partyRef, {
    itemsCount: Math.max(0, (partyDoc.data()?.itemsCount || 1) - 1),
  });
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
 * Propose a swap
 */
export async function proposeSwap(
  initiatorId: string,
  initiatorName: string,
  initiatorImage: string | undefined,
  initiatorArticle: Article,
  receiverId: string,
  receiverName: string,
  receiverImage: string | undefined,
  receiverArticle: Article,
  message?: string,
  cashTopUp?: { amount: number; payerId: string },
  partyId?: string
): Promise<string> {
  // Build initiator item - only include defined values
  const initiatorItem: Record<string, any> = {
    articleId: initiatorArticle.id,
    title: initiatorArticle.title,
    price: initiatorArticle.price,
  };
  if (initiatorArticle.images?.[0]?.url) {
    initiatorItem.imageUrl = initiatorArticle.images[0].url;
  }

  // Build receiver item - only include defined values
  const receiverItem: Record<string, any> = {
    articleId: receiverArticle.id,
    title: receiverArticle.title,
    price: receiverArticle.price,
  };
  if (receiverArticle.images?.[0]?.url) {
    receiverItem.imageUrl = receiverArticle.images[0].url;
  }

  // Build swap data - only include defined values (Firestore doesn't accept undefined)
  const swapData: Record<string, any> = {
    initiatorId,
    initiatorName,
    initiatorItemId: initiatorArticle.id,
    initiatorItem,
    receiverId,
    receiverName,
    receiverItemId: receiverArticle.id,
    receiverItem,
    status: 'proposed',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Only add optional fields if defined
  if (partyId) swapData.partyId = partyId;
  if (initiatorImage) swapData.initiatorImage = initiatorImage;
  if (receiverImage) swapData.receiverImage = receiverImage;
  if (message) swapData.message = message;
  if (cashTopUp) swapData.cashTopUp = cashTopUp;

  const swapsRef = collection(firestore, 'swaps');
  const docRef = await addDoc(swapsRef, swapData);

  return docRef.id;
}

/**
 * Accept a swap
 */
export async function acceptSwap(swapId: string): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  await updateDoc(swapRef, {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Decline a swap
 */
export async function declineSwap(swapId: string): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  await updateDoc(swapRef, {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Cancel a swap (by initiator)
 */
export async function cancelSwap(swapId: string): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  await updateDoc(swapRef, {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Set exchange mode for a swap
 */
export async function setExchangeMode(swapId: string, mode: SwapExchangeMode): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  await updateDoc(swapRef, {
    exchangeMode: mode,
    status: 'photos_pending',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Upload photo proof for a swap
 */
export async function uploadSwapPhotos(
  swapId: string,
  userId: string,
  photoUrls: string[]
): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  const swapDoc = await getDoc(swapRef);
  const swap = swapDoc.data() as Swap;

  const photoProof = {
    userId,
    photos: photoUrls,
    uploadedAt: new Date(),
    isValidated: false,
  };

  const updateData: any = {
    updatedAt: serverTimestamp(),
  };

  if (swap.initiatorId === userId) {
    updateData.initiatorPhotos = {
      ...photoProof,
      uploadedAt: serverTimestamp(),
    };
  } else {
    updateData.receiverPhotos = {
      ...photoProof,
      uploadedAt: serverTimestamp(),
    };
  }

  // Check if both have uploaded photos -> move to shipping status
  const updatedSwap = { ...swap, ...updateData };
  if (updatedSwap.initiatorPhotos && updatedSwap.receiverPhotos) {
    updateData.status = 'shipping';
  }

  await updateDoc(swapRef, updateData);
}

/**
 * Confirm shipping for a swap
 */
export async function confirmShipping(swapId: string, userId: string): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  const swapDoc = await getDoc(swapRef);
  const swap = swapDoc.data() as Swap;

  const updateData: any = {
    updatedAt: serverTimestamp(),
  };

  if (swap.initiatorId === userId) {
    updateData.initiatorShippedAt = serverTimestamp();
  } else {
    updateData.receiverShippedAt = serverTimestamp();
  }

  await updateDoc(swapRef, updateData);
}

/**
 * Confirm reception for a swap
 */
export async function confirmReception(swapId: string, userId: string): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  const swapDoc = await getDoc(swapRef);
  const swap = swapDoc.data() as Swap;

  const updateData: any = {
    updatedAt: serverTimestamp(),
  };

  if (swap.initiatorId === userId) {
    updateData.initiatorReceivedAt = serverTimestamp();
  } else {
    updateData.receiverReceivedAt = serverTimestamp();
  }

  // Check if both received -> complete swap
  const updatedSwap = { ...swap, ...updateData };
  if (
    (updatedSwap.initiatorReceivedAt || swap.initiatorReceivedAt) &&
    (updatedSwap.receiverReceivedAt || swap.receiverReceivedAt)
  ) {
    updateData.status = 'completed';
    updateData.completedAt = serverTimestamp();

    // Mark items as swapped in party if applicable
    if (swap.partyId) {
      const itemsRef = collection(firestore, 'swapPartyItems');

      // Mark initiator item as swapped
      const initiatorItemQuery = query(
        itemsRef,
        where('partyId', '==', swap.partyId),
        where('articleId', '==', swap.initiatorItemId)
      );
      const initiatorItemSnapshot = await getDocs(initiatorItemQuery);
      if (!initiatorItemSnapshot.empty) {
        await updateDoc(doc(firestore, 'swapPartyItems', initiatorItemSnapshot.docs[0].id), {
          isSwapped: true,
        });
      }

      // Mark receiver item as swapped
      const receiverItemQuery = query(
        itemsRef,
        where('partyId', '==', swap.partyId),
        where('articleId', '==', swap.receiverItemId)
      );
      const receiverItemSnapshot = await getDocs(receiverItemQuery);
      if (!receiverItemSnapshot.empty) {
        await updateDoc(doc(firestore, 'swapPartyItems', receiverItemSnapshot.docs[0].id), {
          isSwapped: true,
        });
      }

      // Increment swaps count on party
      const partyRef = doc(firestore, 'swapParties', swap.partyId);
      const partyDoc = await getDoc(partyRef);
      await updateDoc(partyRef, {
        swapsCount: (partyDoc.data()?.swapsCount || 0) + 1,
      });
    }
  }

  await updateDoc(swapRef, updateData);
}

/**
 * Rate a swap
 */
export async function rateSwap(
  swapId: string,
  userId: string,
  score: number,
  comment?: string
): Promise<void> {
  const swapRef = doc(firestore, 'swaps', swapId);
  const swapDoc = await getDoc(swapRef);
  const swap = swapDoc.data() as Swap;

  const rating = { score, comment };
  const updateData: any = {
    updatedAt: serverTimestamp(),
  };

  if (swap.initiatorId === userId) {
    updateData.initiatorRating = rating;
  } else {
    updateData.receiverRating = rating;
  }

  await updateDoc(swapRef, updateData);
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
