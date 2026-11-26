import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID , CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { assertTradeSessionCurrent, captureTradeSession, isDefinitiveTradeRefusal } from '@/services/tradeOperation';
import type { SwapAgreementAcknowledgement, SwapAgreementPreview, SwapProposalPreviewInput, SwapExchangePreviewInput } from '@/types/swap';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
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

interface SwapSessionOptions {expectedUid?: string; assertCurrent?: () => void}
async function existingSwapAction<I extends object, O>(name: string, payload: I, options?: SwapSessionOptions): Promise<O> {
  const session = captureTradeSession(options?.expectedUid);
  const assertCurrent = () => {assertTradeSessionCurrent(session); options?.assertCurrent?.();};
  assertCurrent();
  const result = await httpsCallable<I & {expectedUid: string}, O>(functions, name)({...payload, expectedUid: session.uid});
  assertCurrent();
  if (!result.data || typeof result.data !== 'object' || !('success' in result.data) || result.data.success !== true) {
    throw new Error('Impossible de confirmer le résultat. Actualisez cet échange.');
  }
  return result.data;
}

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

/** Re-read only the current public listing; a proposal grants no private-image rights. */
export async function readSwapProposalImage(uid: string, articleId: string, sellerId: string, reference: string, assertContext: () => void): Promise<string | null> {
  const session = captureTradeSession(uid);
  const current = () => {assertTradeSessionCurrent(session); assertContext();};
  current();
  const snapshot = await getDocFromServer(doc(firestore, 'articles', articleId)); current();
  if (!snapshot.exists()) return null;
  const article = snapshot.data();
  return article.isActive === true && article.isSold !== true && article.sellerId === sellerId &&
    !article.privacyWithdrawal && (article.moderationStatus == null || article.moderationStatus === 'approved') &&
    Array.isArray(article.images) && article.images.some((image: unknown) => !!image && typeof image === 'object' && 'url' in image && image.url === reference) ? reference : null;
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
  if (result.data?.id !== GENERALIST_ZONE_ID) throw new Error('Le Troc est indisponible pour le moment.');
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
  userImage?: string,
  assertContext?: () => void
): Promise<string> {
  const session = captureTradeSession(_userId);
  type AddItemPayload = {
    expectedUid: string;
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
    expectedUid: session.uid,
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

  assertTradeSessionCurrent(session);
  assertContext?.();
  const result = await addFn(payload);
  assertTradeSessionCurrent(session);
  assertContext?.();
  if (result.data?.success !== true || typeof result.data.itemId !== 'string' || !result.data.itemId) {
    throw new Error('L’ajout ne peut pas être confirmé. Actualisez Le Troc.');
  }
  return result.data.itemId;
}

/**
 * Remove an article from the Swap Zone — delegates to the secured Cloud
 * Function (atomic counter update).
 */
export async function removeItemFromParty(
  partyId: string,
  articleId: string,
  _userId: string,
  assertContext?: () => void,
): Promise<void> {
  const session = captureTradeSession(_userId);
  const current = () => {assertTradeSessionCurrent(session); assertContext?.();};
  const removeFn = httpsCallable<
    { partyId: string; articleId: string; expectedUid: string },
    { success: boolean }
  >(functions, 'removeItemFromPartySecure');

  current();
  const result = await removeFn({ partyId, articleId, expectedUid: session.uid });
  current();
  if (result.data?.success !== true) throw new Error('Le retrait ne peut pas être confirmé. Actualisez Le Troc.');
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

        // FR15 : tant que la règle ne vérifiait pas l'appartenance, un compte
        // pouvait déposer l'article d'un autre. Un item dont l'article ne lui
        // appartient pas ne s'affiche pas dans la zone.
        if (articleData.sellerId !== item.sellerId) {
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
export interface SwapProposalCommand {
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
  expectedUid: string;
  exchangeMode: SwapExchangeMode;
  arrangements: string;
  agreementProtocol: 'swap_exchange_agreement_v1';
  expectedSourceHash: string;
  clientRequestId?: string;
}
const proposalJournalKey = (uid: string) => `second:swap-proposal:v1:${encodeURIComponent(uid)}`;
const proposalLocks = new Set<string>();
export async function getPendingSwapProposal(uid: string, assertContext: () => void): Promise<SwapProposalCommand | null> {
  const session = captureTradeSession(uid); assertContext();
  const value = await AsyncStorage.getItem(proposalJournalKey(uid)); assertTradeSessionCurrent(session); assertContext();
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('Votre proposition en cours ne peut pas être relue.');
  const command = parsed as SwapProposalCommand;
  if (command.expectedUid !== uid || command.initiatorId !== uid || typeof command.receiverId !== 'string' || command.receiverId === uid ||
      typeof command.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(command.clientRequestId) ||
      command.agreementProtocol !== 'swap_exchange_agreement_v1' || typeof command.expectedSourceHash !== 'string' ||
      !Array.isArray(command.initiatorItems) || !Array.isArray(command.receiverItems) || command.initiatorItems.length < 1 || command.receiverItems.length < 1)
    throw new Error('Votre proposition en cours ne peut pas être relue.');
  return command;
}
export async function proposeSwap(params: SwapProposalCommand, assertContext?: () => void): Promise<string> {
  const session = captureTradeSession(params.expectedUid);
  const current = () => {assertTradeSessionCurrent(session); assertContext?.();};
  current();
  if (proposalLocks.has(session.uid)) throw new Error('Votre proposition est déjà en cours d’envoi.');
  proposalLocks.add(session.uid);
  try {
    const payload = {...params, partyId: params.partyId ?? GENERALIST_ZONE_ID, clientRequestId: params.clientRequestId ?? randomUUID()};
    const pending = await getPendingSwapProposal(session.uid, current); current();
    if (pending && JSON.stringify(pending) !== JSON.stringify(payload)) throw new Error('Retrouvez votre proposition en cours avant d’en préparer une autre.');
    await AsyncStorage.setItem(proposalJournalKey(session.uid), JSON.stringify(payload)); current();
    const proposeMultiSwapFn = httpsCallable<typeof payload, {swapId: string; success: boolean}>(functions, 'proposeMultiSwap');
    let result;
    try {result = await proposeMultiSwapFn(payload);}
    catch (error) {
      current();
      if (isDefinitiveTradeRefusal(error) && await AsyncStorage.getItem(proposalJournalKey(session.uid)) === JSON.stringify(payload)) {current(); await AsyncStorage.removeItem(proposalJournalKey(session.uid)); current();}
      throw error;
    }
    current();
    if (result.data?.success !== true || typeof result.data.swapId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.data.swapId)) {
      throw new Error('L’envoi ne peut pas être confirmé. Consultez Mes échanges.');
    }
    const saved = await AsyncStorage.getItem(proposalJournalKey(session.uid)); current();
    if (saved === JSON.stringify(payload)) {await AsyncStorage.removeItem(proposalJournalKey(session.uid)); current();}
    return result.data.swapId;
  } finally {proposalLocks.delete(session.uid);}
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
  swapId: string, acknowledgement: SwapAgreementAcknowledgement, assertContext?: () => void
): Promise<{ status: SwapStatus; requiresPayment: boolean; replay: boolean }> {
  const session = captureTradeSession(acknowledgement.expectedUid);
  const acceptSwapFn = httpsCallable<
    { swapId: string } & SwapAgreementAcknowledgement,
    { success: boolean; status: SwapStatus; requiresPayment: boolean; replay: boolean }
  >(functions, 'acceptSwap');
  assertContext?.();
  const result = await acceptSwapFn({ swapId, ...acknowledgement });
  assertTradeSessionCurrent(session);
  assertContext?.();
  if (result.data?.success !== true || !['accepted', 'payment_pending', 'photos_pending', 'shipping', 'completed', 'cancelled', 'disputed', 'expired'].includes(result.data.status) ||
      typeof result.data.replay !== 'boolean' || typeof result.data.requiresPayment !== 'boolean' || result.data.requiresPayment !== (result.data.status === 'payment_pending') ||
      (!result.data.replay && !['accepted', 'photos_pending', 'payment_pending'].includes(result.data.status))) {
    throw new Error('La confirmation doit être relue dans ce dossier.');
  }
  return { status: result.data.status, requiresPayment: result.data.requiresPayment, replay: result.data.replay };
}

/**
 * Decline a swap — delegates to Cloud Function which handles
 * status transition + party item release via Admin SDK.
 */
export async function declineSwap(swapId: string, options?: SwapSessionOptions): Promise<void> {
  await existingSwapAction('declineSwap', {swapId}, options);
}

/**
 * Cancel a swap (by initiator) — delegates to Cloud Function which handles
 * status transition + party item release via Admin SDK.
 */
export async function cancelSwap(swapId: string, options?: SwapSessionOptions): Promise<void> {
  await existingSwapAction('cancelSwap', {swapId}, options);
}

/**
 * Set exchange mode for a swap — delegates to Cloud Function which handles
 * the accepted -> photos_pending transition via Admin SDK.
 */
export async function setExchangeMode(swapId: string, mode: SwapExchangeMode,
  acknowledgement: SwapAgreementAcknowledgement & { arrangements: string }, assertContext?: () => void): Promise<{success: true; status: 'accepted' | 'photos_pending'; waitingForCounterpart: boolean}> {
  const session = captureTradeSession(acknowledgement.expectedUid);
  const setModeFn = httpsCallable<{ swapId: string; exchangeMode: string } & typeof acknowledgement,
    {success: true; status: 'accepted' | 'photos_pending'; waitingForCounterpart: boolean}>(
    functions,
    'setSwapExchangeMode'
  );
  assertContext?.();
  const result = await setModeFn({ swapId, exchangeMode: mode, ...acknowledgement });
  assertTradeSessionCurrent(session);
  assertContext?.();
  if (result.data?.success !== true || !['accepted', 'photos_pending'].includes(result.data.status) ||
      typeof result.data.waitingForCounterpart !== 'boolean') throw new Error('Résultat à relire dans cet échange.');
  return result.data;
}

/** Strict GET protocol: an older server's ordinary eligibility DTO is never an agreement. */
export function decodeSwapAgreementPreview(value: unknown): SwapAgreementPreview {
  const invalid = () => new Error('Les conditions ne peuvent pas être relues. Actualisez avant de confirmer.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  const itemsValid = (items: unknown): boolean => Array.isArray(items) && items.length >= 1 && items.length <= 20 &&
    items.every(item => item && typeof item === 'object' && typeof item.articleId === 'string' && item.articleId.length > 0 &&
      typeof item.title === 'string' && typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 &&
      (item.description === undefined || typeof item.description === 'string')) &&
    new Set(items.map(item => item.articleId)).size === items.length;
  if (data.protocol !== 'swap_exchange_agreement_v1' || !['new_proposal', 'legacy_preparation'].includes(String(data.scope)) ||
      typeof data.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceHash) || data.termsVersion !== '2026-10-17.v1' ||
      typeof data.termsText !== 'string' || !data.termsText.trim() || !['hand_delivery', 'shipping'].includes(String(data.exchangeMode)) ||
      typeof data.arrangements !== 'string' || !data.arrangements.trim() || data.arrangements.length > 2000 ||
      !(data.message === null || typeof data.message === 'string') ||
      typeof data.initiatorId !== 'string' || !data.initiatorId || typeof data.receiverId !== 'string' || !data.receiverId ||
      data.initiatorId === data.receiverId || !itemsValid(data.initiatorItems) || !itemsValid(data.receiverItems)) throw invalid();
  if (data.cashTopUp !== null) {
    const cash = data.cashTopUp as {amount?: unknown; payerId?: unknown} | undefined;
    if (!cash || typeof cash.amount !== 'number' || !Number.isSafeInteger(cash.amount) || cash.amount <= 0 ||
        typeof cash.payerId !== 'string' || ![data.initiatorId, data.receiverId].includes(cash.payerId)) throw invalid();
  }
  return data as unknown as SwapAgreementPreview;
}

export async function getSwapAgreementPreview(input: SwapProposalPreviewInput | SwapExchangePreviewInput): Promise<SwapAgreementPreview> {
  const session = captureTradeSession(input.expectedUid);
  const result = await httpsCallable<typeof input, unknown>(functions, 'getMyEligibility')(input);
  assertTradeSessionCurrent(session);
  const envelope = result.data as { swapProposalPreview?: unknown } | null;
  const preview = decodeSwapAgreementPreview(envelope?.swapProposalPreview);
  if (preview.exchangeMode !== input.exchangeMode || preview.arrangements !== input.arrangements ||
      (input.operation === 'swap_proposal_preview' && (preview.scope !== 'new_proposal' || preview.initiatorId !== session.uid ||
        preview.receiverId !== input.receiverId || JSON.stringify(preview.initiatorItems.map(item => item.articleId)) !== JSON.stringify(input.initiatorArticleIds) ||
        JSON.stringify(preview.receiverItems.map(item => item.articleId)) !== JSON.stringify(input.receiverArticleIds) ||
        JSON.stringify(preview.cashTopUp) !== JSON.stringify(input.cashTopUp ?? null) ||
        preview.message !== (input.message?.trim() || null)))) throw new Error('La proposition a changé. Relisez ses conditions.');
  return preview;
}

/**
 * Upload photo proof for a swap — delegates to Cloud Function which handles
 * writing photos + auto-transition to 'shipping' when both sides upload.
 */
export async function uploadSwapPhotos(
  swapId: string,
  _userId: string,
  photoUrls: string[], assertCurrent?: () => void
): Promise<void> {
  await existingSwapAction('uploadSwapPhotos', {swapId, photoUrls}, {expectedUid: _userId, assertCurrent});
}

/**
 * Confirm shipping for a swap — delegates to Cloud Function.
 */
export async function confirmShipping(swapId: string, _userId: string, assertCurrent?: () => void): Promise<void> {
  await existingSwapAction('confirmSwapShipping', {swapId}, {expectedUid: _userId, assertCurrent});
}

/**
 * Confirm reception for a swap — delegates to Cloud Function which handles
 * the completion transition + party item marking when both sides receive.
 */
export async function confirmReception(swapId: string, _userId: string, assertCurrent?: () => void): Promise<void> {
  await existingSwapAction('confirmSwapReception', {swapId}, {expectedUid: _userId, assertCurrent});
}

/**
 * Rate a swap — delegates to Cloud Function which verifies
 * status == 'completed' before writing the rating.
 */
export async function rateSwap(
  swapId: string,
  _userId: string,
  score: number,
  comment?: string, assertCurrent?: () => void
): Promise<void> {
  await existingSwapAction('rateSwap', {swapId, score, ...(comment !== undefined ? {comment} : {})}, {expectedUid: _userId, assertCurrent});
}

/**
 * Open a dispute on a swap — delegates to Cloud Function `openSwapDispute`.
 * Callable by either participant while the swap is in `accepted`,
 * `photos_pending`, `shipping`, or `completed` (within the 7-day window). The
 * function FREEZES the swap (status `disputed`) but no longer refunds anything
 * on its own — the money decision is reserved for the admin callable
 * `resolveSwapDispute` (F48 hardening). Opening a dispute from `accepted`/
 * `photos_pending` is the exit for a top-up payer stuck waiting on a silent
 * counterparty (F51).
 */
export async function openSwapDispute(swapId: string, reason: string, options?: SwapSessionOptions): Promise<void> {
  await existingSwapAction('openSwapDispute', {swapId, reason}, options);
}

export type SwapDisputeIssue = 'refund_payer' | 'release_payee';
export interface SwapDisputeDecisionReceipt {
  mode: 'resolve' | 'observe';
  observationState: 'unrecorded' | 'recorded' | 'historical_unqualified';
  success: boolean;
  swapId: string;
  adminUid: string;
  issue: SwapDisputeIssue;
  noteHash: string;
  protocol: 'swap_dispute_notice_v1' | null;
  sourceHash: string | null;
  decisionKey: string | null;
  initiatorId: string | null;
  receiverId: string | null;
  committedAt: string | null;
  notificationIds: string[] | null;
  movedCents: number | null;
  financialInstruction: SwapDisputeIssue | null;
  decisionCommitted: boolean;
  notificationCommitted: boolean;
  refundConfirmed: false;
  deviceDeliveryVerified: false;
  readingVerified: false;
  nonExecutionVerified: false;
  replay: boolean;
}

/** A decision receipt confirms the native instruction and notices, never a
 * refund or current spendable funds. Unknown outcomes are read with observe;
 * this service never retries a mutation to obtain its result. */
export async function resolveSwapDispute(
  swapId: string,
  issue: SwapDisputeIssue,
  note?: string,
  options?: { mode: 'resolve' | 'observe'; expectedAdminUid: string; assertCurrent: () => void }
): Promise<SwapDisputeDecisionReceipt> {
  const session = captureTradeSession(options?.expectedAdminUid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); options?.assertCurrent(); };
  assertCurrent();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(swapId) || !['refund_payer', 'release_payee'].includes(issue)) {
    throw new Error('Référence ou instruction de litige invalide.');
  }
  const mode = options?.mode ?? 'resolve';
  const normalizedNote = note?.trim().substring(0, 500) || null;
  const resolveFn = httpsCallable<
    { mode: 'resolve' | 'observe'; expectedAdminUid: string; swapId: string; issue: SwapDisputeIssue; note?: string },
    unknown
  >(functions, 'resolveSwapDispute');
  const result = await resolveFn({ mode, expectedAdminUid: session.uid, swapId, issue,
    ...(normalizedNote ? { note: normalizedNote } : {}) });
  assertCurrent();
  const digest = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
  const expectedNoteHash = await digest(normalizedNote); assertCurrent();
  const value = result.data;
  const invalidReceipt = () => new Error('Résultat non qualifié : relisez la même instruction sans la renvoyer.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidReceipt();
  const data = value as Record<string, unknown>;
  if (data.mode !== mode || data.swapId !== swapId || data.adminUid !== session.uid || data.issue !== issue ||
      data.noteHash !== expectedNoteHash || typeof data.observationState !== 'string' || !['recorded', 'unrecorded', 'historical_unqualified'].includes(data.observationState) ||
      typeof data.replay !== 'boolean' || (mode === 'observe' && data.replay !== false) || data.refundConfirmed !== false || data.deviceDeliveryVerified !== false ||
      data.readingVerified !== false || data.nonExecutionVerified !== false) throw invalidReceipt();
  const recorded = data.observationState === 'recorded';
  if (data.success !== recorded || data.decisionCommitted !== recorded || data.notificationCommitted !== recorded) throw invalidReceipt();
  if (recorded) {
    if (data.protocol !== 'swap_dispute_notice_v1' || typeof data.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceHash) ||
        typeof data.decisionKey !== 'string' || !/^[a-f0-9]{64}$/.test(data.decisionKey) ||
        typeof data.initiatorId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.initiatorId) ||
        typeof data.receiverId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.receiverId) || data.initiatorId === data.receiverId ||
        typeof data.committedAt !== 'string' || !Number.isFinite(Date.parse(data.committedAt)) || new Date(data.committedAt).toISOString() !== data.committedAt ||
        !Array.isArray(data.notificationIds) || data.notificationIds.length !== 2 ||
        typeof data.movedCents !== 'number' || !Number.isSafeInteger(data.movedCents) || data.movedCents < 0 || data.financialInstruction !== issue) throw invalidReceipt();
    const expectedKey = await digest([data.sourceHash, session.uid, issue, normalizedNote]); assertCurrent();
    const eventKey = `swap_dispute_decision:${swapId}:${expectedKey}`;
    const expectedNoticeIds = await Promise.all([data.initiatorId, data.receiverId].map(async uid =>
      `operational_${await digest([eventKey, uid])}`)); assertCurrent();
    if (data.decisionKey !== expectedKey || data.notificationIds.some((id, index) => id !== expectedNoticeIds[index])) throw invalidReceipt();
  } else if (['protocol', 'sourceHash', 'decisionKey', 'initiatorId', 'receiverId', 'committedAt', 'notificationIds', 'movedCents', 'financialInstruction']
    .some(field => data[field] !== null)) throw invalidReceipt();
  // All fields above are qualified; no omitted, malformed, or legacy field is
  // promoted to a documentary success or a non-execution proof.
  return data as unknown as SwapDisputeDecisionReceipt;
}

/**
 * Get swaps for a user (as initiator or receiver)
 */
export async function getUserSwaps(userId: string, options?: SwapSessionOptions): Promise<Swap[]> {
  const session = captureTradeSession(userId);
  const nativeDate = (value: unknown): Date | undefined => {
    if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') return undefined;
    try {
      const date: unknown = value.toDate();
      return date instanceof Date && Number.isFinite(date.getTime()) ? date : undefined;
    } catch {return undefined;}
  };
  if (options?.expectedUid !== undefined && options.expectedUid !== session.uid) throw new Error('Relisez les échanges avec votre connexion actuelle.');
  const current = () => {assertTradeSessionCurrent(session); options?.assertCurrent?.();};
  current();
  const swapsRef = collection(firestore, 'swaps');

  // Get swaps where user is initiator
  const initiatorQuery = query(
    swapsRef,
    where('initiatorId', '==', session.uid),
    orderBy('createdAt', 'desc')
  );
  current();
  const initiatorSnapshot = await getDocsFromServer(initiatorQuery);
  current();

  // Get swaps where user is receiver
  const receiverQuery = query(
    swapsRef,
    where('receiverId', '==', session.uid),
    orderBy('createdAt', 'desc')
  );
  current();
  const receiverSnapshot = await getDocsFromServer(receiverQuery);
  current();

  const swaps: Swap[] = [];

  initiatorSnapshot.docs.forEach((d) => {
    const data = d.data();
    if (data.initiatorId !== session.uid && data.receiverId !== session.uid) throw new Error('Les participants de cet échange doivent être relus.');
    swaps.push({
      ...data,
      id: d.id,
      createdAt: nativeDate(data?.createdAt),
      updatedAt: nativeDate(data?.updatedAt),
      acceptedAt: nativeDate(data?.acceptedAt),
      completedAt: nativeDate(data?.completedAt),
      paidAt: nativeDate(data?.paidAt),
    } as Swap);
  });

  receiverSnapshot.docs.forEach((d) => {
    // Avoid duplicates (shouldn't happen but just in case)
    if (!swaps.find((s) => s.id === d.id)) {
      const data = d.data();
      if (data.initiatorId !== session.uid && data.receiverId !== session.uid) throw new Error('Les participants de cet échange doivent être relus.');
      swaps.push({
        ...data,
        id: d.id,
        createdAt: nativeDate(data?.createdAt),
        updatedAt: nativeDate(data?.updatedAt),
        acceptedAt: nativeDate(data?.acceptedAt),
        completedAt: nativeDate(data?.completedAt),
        paidAt: nativeDate(data?.paidAt),
      } as Swap);
    }
  });

  // Sort by createdAt
  const createdAtMillis = (swap: Swap) => swap.createdAt instanceof Date && Number.isFinite(swap.createdAt.getTime()) ? swap.createdAt.getTime() : -Infinity;
  swaps.sort((a, b) => {const left = createdAtMillis(a), right = createdAtMillis(b); return left === right ? 0 : right - left;});

  current();
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
  callback: (swap: Swap | null) => void,
  servicing?: { expectedUid: string; assertContext: () => void; onChecking?: () => void }
): () => void {
  const session = servicing ? captureTradeSession(servicing.expectedUid) : null;
  const current = () => {if (session) assertTradeSessionCurrent(session); servicing?.assertContext();};
  current();
  const swapRef = doc(firestore, 'swaps', swapId);

  return onSnapshot(
    swapRef,
    {includeMetadataChanges: !!servicing},
    (snap) => {
      try {current();} catch {return;}
      // Servicing reads require current server authorization, never an old private cache.
      if (servicing && snap.metadata.fromCache) {servicing.onChecking?.(); return;}
      if (!snap.exists()) {
        callback(null);
        return;
      }

      const data = snap.data();
      if (servicing && data.initiatorId !== servicing.expectedUid && data.receiverId !== servicing.expectedUid) {callback(null); return;}
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
      try {current();} catch {return;}
      // Permission denied (non-participant) or session expired: surface to the
      // screen so it can render an error/empty state instead of an infinite skeleton.
      if (__DEV__) console.error(`Error subscribing to swap ${swapId}:`, error);
      callback(null);
    }
  );
}
