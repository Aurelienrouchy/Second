import { collection, doc, getDocFromServer } from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { firestore, functions } from '../../config/firebaseConfig';
import { MeetupSpot, ShippingAddress, ShippingEstimate } from '../../types';
import { stripUndefined } from './internal';
import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { assertTradeSessionCurrent, captureTradeSession, isDefinitiveTradeRefusal, staleTradeOperation } from '../tradeOperation';
import { PAYMENTS_ENABLED, SHIPPING_ENABLED } from '@/config/featureFlags';

export interface ProposalOptions {
  deferAdoption?: boolean;
  /** Only a new request may need new admission. Exact stored attempts replay first. */
  beforeNewDispatch?: () => Promise<void>;
  recoveryOnly?: boolean;
  expectedRequestId?: string;
}
interface ProposalAttempt { requestId: string; payload: Record<string, unknown>; fingerprint: string }
interface KnownProposal extends ProposalAttempt { messageId: string; proofId: string }
const runtimeAdoptions = new Map<string, { uid: string; generation: number; proofId: string }>();
const received = new Map<string, { uid: string; generation: number; receipt: KnownProposal }>();
const journalQueues = new Map<string, Promise<unknown>>();
interface ProposalReceipt { messageId: string; requestId: string; key: string; chatId: string }
const inFlight = new Map<string, Promise<ProposalReceipt>>();
const proposalDispatches = new Map<string, Promise<ProposalReceipt>>();
const acceptanceInFlight = new Map<string, Promise<void>>();
/** Re-observe one idempotent intention after a lost reply, without minting a new ID. */
async function confirmSameIntention<T>(dispatch: () => Promise<T>, assertCurrent: () => void): Promise<T> {
  try { return await dispatch(); }
  catch (error) {
    assertCurrent();
    if (isDefinitiveTradeRefusal(error)) throw error;
    return dispatch();
  }
}
function serialize(input: Record<string, unknown>): string {
  return JSON.stringify(input, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
}
function journal<T>(key: string, action: () => Promise<T>): Promise<T> {
  const pending = (journalQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
  journalQueues.set(key, pending);
  void pending.finally(() => { if (journalQueues.get(key) === pending) journalQueues.delete(key); }).catch(() => undefined);
  return pending;
}
async function readRecords(key: string, chatId: string, known = false): Promise<KnownProposal[] | ProposalAttempt[]> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((item: KnownProposal) => !item ||
    typeof item.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.requestId) ||
    !item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload) ||
    typeof item.fingerprint !== 'string' || serialize(item.payload) !== item.fingerprint ||
    'requestId' in item.payload || item.payload.chatId !== chatId ||
    (known && (typeof item.messageId !== 'string' || !item.messageId || typeof item.proofId !== 'string' || !item.proofId)))) throw new Error('La tentative enregistrée doit être examinée avant un nouvel envoi.');
  const records = parsed as KnownProposal[];
  if (new Set(records.map(item => item.requestId)).size !== records.length ||
      (!known && new Set(records.map(item => item.fingerprint)).size !== records.length)) {
    throw new Error('La tentative enregistrée est ambiguë et doit être examinée.');
  }
  return records;
}
const readAttempts = (key: string, chatId: string) => readRecords(key, chatId) as Promise<ProposalAttempt[]>;
const readReceipts = (key: string, chatId: string) => readRecords(`${key}:receipts`, chatId, true) as Promise<KnownProposal[]>;

/** Owner-only local witness, never an operation permission. Optional input requires the exact tuple. */
export async function readMeetupProposalRecovery(uid: string, chatId: string, assertContext: () => void, input?: Record<string, unknown>): Promise<ProposalAttempt | null> {
  const session = captureTradeSession(uid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent();
  const key = `meetup-proposal:v1:${encodeURIComponent(uid)}:${encodeURIComponent(chatId)}`;
  const attempts = await readAttempts(key, chatId); assertCurrent();
  const receipts = await readReceipts(key, chatId); assertCurrent();
  const fingerprint = input ? serialize(input) : null;
  const pending = [...attempts].reverse().find(item => !fingerprint || item.fingerprint === fingerprint);
  if (pending) return JSON.parse(JSON.stringify(pending)) as ProposalAttempt;
  const receipt = [...receipts].reverse().find(item => {
    if (fingerprint && item.fingerprint !== fingerprint) return false;
    const adoption = runtimeAdoptions.get(item.requestId);
    return !adoption || adoption.uid !== uid || adoption.generation !== session.generation || adoption.proofId !== item.proofId;
  });
  return receipt ? { requestId: receipt.requestId, payload: JSON.parse(JSON.stringify(receipt.payload)) as Record<string, unknown>, fingerprint: receipt.fingerprint } : null;
}

function previousAttemptError(error: unknown, proposal?: { uid: string; chatId: string; requestId: string; payload: Record<string, unknown> }): unknown {
  // Keep the original code/details for the final consumer; only unknown outcomes get the CTA.
  if (error && typeof error === 'object' && Object.isExtensible(error)) return Object.assign(error, { tradeRecovery: true, ...(proposal ? { proposalRecovery: proposal } : {}) });
  return Object.assign(new Error(error instanceof Error ? error.message : String(error)), { cause: error, tradeRecovery: true, ...(proposal ? { proposalRecovery: proposal } : {}) });
}

const acceptanceKey = (uid: string, chatId: string, messageId: string) => `meetup-acceptance:v1:${encodeURIComponent(uid)}:${encodeURIComponent(chatId)}:${encodeURIComponent(messageId)}`;
export async function hasMeetupAcceptanceAttempt(uid: string, chatId: string, messageId: string, assertContext: () => void): Promise<boolean> {
  const session = captureTradeSession(uid); assertContext();
  const raw = await AsyncStorage.getItem(acceptanceKey(uid, chatId, messageId));
  assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return false;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('chatId' in parsed) || !('messageId' in parsed) || parsed.chatId !== chatId || parsed.messageId !== messageId) throw new Error('La tentative d’acceptation doit être examinée.');
  return true;
}
async function persistReceipt(key: string, chatId: string, receipt: Omit<KnownProposal, 'proofId'>): Promise<void> {
  await journal(key, async () => {
    const saved = await readReceipts(key, chatId);
    const old = saved.find(item => item.requestId === receipt.requestId);
    if (old) {
      if (old.messageId !== receipt.messageId || old.fingerprint !== receipt.fingerprint) throw new Error('La réception enregistrée est incohérente.');
      return;
    }
    await AsyncStorage.setItem(`${key}:receipts`, JSON.stringify([...saved, { ...receipt, proofId: randomUUID() }]));
  });
}
/** Acknowledges only a receipt already durably recorded. No IO or authority is granted here. */
export function acknowledgeMeetupProposal(messageId: string, assertContext: () => void): void {
  const session = captureTradeSession(); assertContext();
  const matches = [...received.values()].filter(value => value.uid === session.uid && value.generation === session.generation && value.receipt.messageId === messageId);
  if (!matches.length) throw new Error('La réception de cette proposition doit être vérifiée.');
  for (const match of matches) runtimeAdoptions.set(match.receipt.requestId, { ...session, proofId: match.receipt.proofId });
}
async function removeAttempt(key: string, requestId: string, chatId: string): Promise<void> {
  await journal(key, async () => {
    const saved = await readAttempts(key, chatId);
    const remaining = saved.filter(item => item.requestId !== requestId);
    if (remaining.length) await AsyncStorage.setItem(key, JSON.stringify(remaining));
    else await AsyncStorage.removeItem(key);
  });
}

export async function sendOffer(
    chatId: string, senderId: string, receiverId: string, amount: number,
    message?: string, _shippingAddress?: ShippingAddress, _shippingEstimate?: ShippingEstimate,
    assertContext?: () => void, options?: ProposalOptions,
  ): Promise<string> {
    if (!senderId || !receiverId || senderId === receiverId) throw staleTradeOperation();
    return sendMeetupProposal({ chatId, deliveryType: 'shipping', amount, ...(message ? { message } : {}) }, senderId, assertContext, options);
  }

/** The current protected message selects the protocol, never a caller-supplied price. */
async function offerIsShipping(chatId: string, messageId: string, uid: string, assertCurrent: () => void): Promise<boolean> {
  assertCurrent();
  const snapshot = await getDocFromServer(doc(firestore, 'messages', messageId));
  assertCurrent();
  const message = snapshot.data();
  if (!message || message.chatId !== chatId || message.type !== 'offer' || !message.offer ||
      ![message.senderId, message.receiverId].includes(uid)) throw new Error('Cette offre n’est pas accessible dans cette conversation.');
  if (message.offer.deliveryType === 'shipping') {
    if (message.offer.meetup) throw new Error('Les modalités de cette offre doivent être vérifiées.');
    return true;
  }
  if (!message.offer.meetup) throw new Error('Cette ancienne offre ne permet pas de confirmer une nouvelle vente.');
  return false;
}

export async function acceptOffer(chatId: string, messageId: string, _offerId: string, userId: string, assertContext: () => void = () => undefined): Promise<void> {
    if (!userId) throw staleTradeOperation();
    const session = captureTradeSession(userId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    const key = acceptanceKey(userId, chatId, messageId);
    // Claim the tuple before the first async read. Two screens must not both
    // classify the same still-unknown intention as a first dispatch.
    const existing = acceptanceInFlight.get(key);
    const pending = existing ?? (async () => {
      const shipping = await offerIsShipping(chatId, messageId, userId, assertCurrent);
      const accept = httpsCallable<Record<string, string>, { success: boolean; transactionId?: string; accepted?: boolean; messageId?: string; chatId?: string }>(functions,
        shipping ? 'respondShippingOffer' : 'acceptMeetupOffer');
      const recovering = await hasMeetupAcceptanceAttempt(userId, chatId, messageId, assertCurrent);
      assertCurrent();
      await AsyncStorage.setItem(key, JSON.stringify({ chatId, messageId }));
      assertCurrent();
      try {
        const payload = { chatId, messageId, ...(shipping ? {action: 'accept'} : {}) };
        const result = await confirmSameIntention(() => accept(payload), assertCurrent);
        assertTradeSessionCurrent(session);
        if (result.data?.success !== true || (shipping
          ? result.data.accepted !== true || result.data.messageId !== messageId || result.data.chatId !== chatId
          : typeof result.data.transactionId !== 'string' || !result.data.transactionId)) throw new Error('La réception de cette acceptation doit être vérifiée.');
      } catch (error) {
        if (!recovering && isDefinitiveTradeRefusal(error)) { assertTradeSessionCurrent(session); await AsyncStorage.removeItem(key); assertTradeSessionCurrent(session); throw error; }
        throw previousAttemptError(error);
      }
    })();
    acceptanceInFlight.set(key, pending);
    try {
      await pending;
      // Sharing IO does not share another caller's navigation/session fence.
      assertCurrent();
      await AsyncStorage.removeItem(key);
      assertCurrent();
    } finally {
      if (acceptanceInFlight.get(key) === pending) acceptanceInFlight.delete(key);
    }
  }

export async function rejectOffer(chatId: string, messageId: string, _offerId: string, userId: string, assertContext: () => void = () => undefined): Promise<void> {
    if (!userId) throw staleTradeOperation();
    const session = captureTradeSession(userId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    const shipping = await offerIsShipping(chatId, messageId, userId, assertCurrent);
    const reject = httpsCallable<Record<string, string>, {success: boolean; accepted?: boolean; messageId?: string; chatId?: string}>(functions,
      shipping ? 'respondShippingOffer' : 'rejectMeetupProposal');
    const payload = { chatId, messageId, ...(shipping ? {action: 'reject'} : {}) };
    const result = await confirmSameIntention(() => reject(payload), assertCurrent);
    assertCurrent();
    if (result.data?.success !== true || shipping && (result.data.accepted !== false || result.data.messageId !== messageId || result.data.chatId !== chatId)) {
      throw new Error('Le refus de cette offre ne peut pas encore être confirmé. Actualisez la conversation.');
    }
  }

export async function sendMeetupProposal(input: Record<string, unknown>, expectedUid?: string, assertContext: () => void = () => undefined, options: ProposalOptions = {}): Promise<string> {
    const session = captureTradeSession(expectedUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    if (typeof input.chatId !== 'string' || !input.chatId || 'requestId' in input) throw new Error('Proposition invalide.');
    const fingerprint = serialize(input);
    const payload = JSON.parse(fingerprint) as Record<string, unknown>;
    const key = `meetup-proposal:v1:${encodeURIComponent(session.uid)}:${encodeURIComponent(input.chatId)}`;
    const flightKey = JSON.stringify([session.uid, session.generation, fingerprint, ...(options.expectedRequestId ? [options.expectedRequestId] : [])]);
    const existing = inFlight.get(flightKey);
    const chatId = input.chatId;
    const pending = existing ?? (async () => {
      const {attempt, recovering} = await journal(key, async () => {
        assertCurrent();
        const attempts = await readAttempts(key, chatId);
        assertCurrent();
        const receipts = await readReceipts(key, chatId);
        assertCurrent();
        const old = attempts.find(item => item.fingerprint === fingerprint && (!options.expectedRequestId || item.requestId === options.expectedRequestId));
        if (old) return {attempt: old, recovering: true};
        const receipt = [...receipts].reverse().find(item => item.fingerprint === fingerprint && (!options.expectedRequestId || item.requestId === options.expectedRequestId));
        if (receipt) {
          const adoption = runtimeAdoptions.get(receipt.requestId);
          if (!adoption || adoption.uid !== session.uid || adoption.generation !== session.generation || adoption.proofId !== receipt.proofId) {
            const recovered = { requestId: receipt.requestId, payload: receipt.payload, fingerprint: receipt.fingerprint };
            await AsyncStorage.setItem(key, JSON.stringify([...attempts, recovered]));
            return {attempt: recovered, recovering: true};
          }
        }
        if (options.recoveryOnly || options.expectedRequestId) throw new Error('Cette tentative n’est plus disponible à la vérification.');
        if (payload.deliveryType === 'shipping' && (!PAYMENTS_ENABLED || !SHIPPING_ENABLED)) {
          throw new Error('Les paiements et la livraison intégrés ne sont pas disponibles.');
        }
        if (options.beforeNewDispatch) { await options.beforeNewDispatch(); assertCurrent(); }
        const prepared = { requestId: doc(collection(firestore, 'messages')).id, payload, fingerprint };
        await AsyncStorage.setItem(key, JSON.stringify([...attempts, prepared]));
        return {attempt: prepared, recovering: false};
      });
      assertCurrent();
      // A new caller and an exact recovery may have different outer options,
      // but the native intention has one dispatch and one durable witness.
      const dispatchKey = JSON.stringify([session.uid, chatId, attempt.requestId]);
      const dispatch = proposalDispatches.get(dispatchKey) ?? (async () => {
        try {
          const shipping = attempt.payload.deliveryType === 'shipping';
          const send = httpsCallable<Record<string, unknown>, { success: boolean; messageId: string }>(functions, shipping ? 'sendShippingOffer' : 'sendMeetupProposal');
          // A protocol marker belongs to the local replay witness. The postal
          // callable has its own contract and never receives meetup fields.
          const { deliveryType: _localProtocol, counterKind: _counterKind, ...shippingPayload } = attempt.payload;
          const payload = { ...(shipping ? shippingPayload : attempt.payload), requestId: attempt.requestId };
          const result = await confirmSameIntention(() => send(payload), assertCurrent);
          if (result.data?.success !== true || typeof result.data.messageId !== 'string' || !result.data.messageId) {
            throw new Error('La réception de cette proposition doit être vérifiée.');
          }
          await persistReceipt(key, chatId, { ...attempt, messageId: result.data.messageId });
          // The durable witness is never removed by active-intent cleanup.
          return { messageId: result.data.messageId, requestId: attempt.requestId, key, chatId };
        } catch (error) {
          // A refusal of this retry cannot settle an earlier call's unknown outcome.
          const definitive = !recovering && isDefinitiveTradeRefusal(error);
          if (definitive) await removeAttempt(key, attempt.requestId, chatId);
          throw definitive ? error : previousAttemptError(error, { uid: session.uid, chatId, requestId: attempt.requestId, payload: attempt.payload });
        }
      })();
      proposalDispatches.set(dispatchKey, dispatch);
      try { return await dispatch; }
      finally {
        if (proposalDispatches.get(dispatchKey) === dispatch) proposalDispatches.delete(dispatchKey);
      }
    })();
    inFlight.set(flightKey, pending);
    try {
      const receipt = await pending;
      assertCurrent();
      await removeAttempt(receipt.key, receipt.requestId, receipt.chatId);
      assertCurrent();
      const persisted = await readReceipts(receipt.key, receipt.chatId);
      assertCurrent();
      const proof = persisted.find(item => item.requestId === receipt.requestId && item.messageId === receipt.messageId);
      if (!proof) throw new Error('La réception de cette proposition doit être vérifiée.');
      received.set(receipt.requestId, { uid: session.uid, generation: session.generation, receipt: proof });
      if (!options.deferAdoption) acknowledgeMeetupProposal(receipt.messageId, assertCurrent);
      return receipt.messageId;
    }
    finally { if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey); }
  }

export async function counterOfferPrice(chatId: string, originalMessageId: string, userId: string, _receiverId: string, newAmount: number, message?: string, assertContext?: () => void, options?: ProposalOptions): Promise<string> {
    if (!userId) throw staleTradeOperation();
    const session = captureTradeSession(userId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext?.(); };
    const shipping = await offerIsShipping(chatId, originalMessageId, userId, assertCurrent);
    return sendMeetupProposal({ chatId, originalMessageId, ...(shipping ? {deliveryType: 'shipping'} : {counterKind: 'price'}), amount: newAmount, ...(message ? { message } : {}) }, userId, assertCurrent, options);
  }

export async function counterOfferLocation(chatId: string, originalMessageId: string, userId: string, _receiverId: string, newLocation: MeetupSpot, message?: string, assertContext?: () => void, options?: ProposalOptions): Promise<string> {
    if (!userId) throw staleTradeOperation();
    return sendMeetupProposal({ chatId, originalMessageId, counterKind: 'location', location: stripUndefined(newLocation), ...(message ? { message } : {}) }, userId, assertContext, options);
  }

export async function counterOfferTime(chatId: string, originalMessageId: string, userId: string, _receiverId: string, newDateTime: Date, message?: string, assertContext?: () => void, options?: ProposalOptions): Promise<string> {
    if (!userId) throw staleTradeOperation();
    return sendMeetupProposal({ chatId, originalMessageId, counterKind: 'time', dateTime: newDateTime.toISOString(), ...(message ? { message } : {}) }, userId, assertContext, options);
  }
