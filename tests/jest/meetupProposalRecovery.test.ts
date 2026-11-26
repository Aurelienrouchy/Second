import {meetupFirestoreFixture} from '@/tests/jest/helpers/meetupFirestoreFixture';
jest.mock('firebase/firestore', () => ({
 Timestamp: class TimestampFixture {time: number; constructor(mockTime: number) {this.time=mockTime;} static fromDate(value: Date) {return new this(value.getTime());} toDate() {return new Date(this.time);} toMillis() {return this.time;}},
 doc: jest.fn(), collection: jest.fn((_db: unknown, name: string) => ({name})), query: jest.fn(), where: jest.fn(), orderBy: jest.fn(), limit: jest.fn(),
 getDoc: jest.fn(), getDocFromServer: (...args: unknown[]) => require('firebase/firestore').getDoc(...args),
 getDocs: jest.fn(async () => ({docs: [], size: 0})), getDocsFromServer: (...args: unknown[]) => require('firebase/firestore').getDocs(...args),
}));
import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import { auth } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, getDocs } from 'firebase/firestore';

let mockUid: string | null = 'A';
let mockGeneration = 1;
const mockData = new Map<string, string>();
const mockGet = jest.fn(async (key: string) => mockData.get(key) ?? null);
const mockSet = jest.fn(async (key: string, value: string) => { mockData.set(key, value); });
const mockRemove = jest.fn(async (key: string) => { mockData.delete(key); });
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: (key: string) => mockGet(key), setItem: (key: string, value: string) => mockSet(key, value), removeItem: (key: string) => mockRemove(key),
} }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), { getState: () => ({ authenticatedUid: mockUid, user: null }) }),
}));
jest.mock('@/services/chat/primitives', () => ({ sendSystemMessage: jest.fn() }));
jest.mock('@/services/transactionService', () => ({ TransactionService: { updateTransactionStatus: jest.fn() } }));
import { sendMeetupProposal, counterOfferPrice, acceptOffer, rejectOffer, hasMeetupAcceptanceAttempt } from '@/services/chat/offers';
import { completeMeetup, confirmMeetup, reportNoShow, cancelMeetup } from '@/services/chat/meetup';
import { sendSystemMessage } from '@/services/chat/primitives';
import { TransactionService } from '@/services/transactionService';

interface Sent { name: string; payload: Record<string, unknown> }
let sent: Sent[];
let send: jest.Mock; let native: ReturnType<typeof meetupFirestoreFixture>; let nativeA: ReturnType<typeof meetupFirestoreFixture>;
function session(uid: string | null, generation = mockGeneration + 1) {
  mockUid = uid; mockGeneration = generation;
  (auth as unknown as { currentUser: { uid: string } | null }).currentUser = uid ? { uid } : null;
}
const input = (amount = 35) => ({ chatId: 'chat-A', originalMessageId: 'message-A', counterKind: 'price', amount, message: 'À conserver' });
const key = getEnvironmentStorageKey('meetup-proposal:v1:A:chat-A');
const lost = () => Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => {
  jest.clearAllMocks(); mockData.clear(); mockGet.mockImplementation(async key => mockData.get(key) ?? null);
  mockSet.mockImplementation(async (key, value) => { mockData.set(key, value); });
  mockRemove.mockImplementation(async key => { mockData.delete(key); });
  session('A', 1); sent = []; let n = 0;
  (doc as jest.Mock).mockImplementation((_first: unknown, col?: string, id?: string) => col ? {col, id} : {id: `request-${++n}`});
  native = meetupFirestoreFixture({uid:'A',chatId:'c',messageId:'m',articleId:'article-c',amount:20,actorRole:'seller'});
  nativeA = meetupFirestoreFixture({uid:'A',chatId:'chat-A',messageId:'message-A',articleId:'article-a',amount:35});
  (getDoc as jest.Mock).mockReset().mockImplementation((ref: {col: string; id: string}) => (['message-A','chat-A','article-a'].includes(ref.id) ? nativeA : native).read(ref));
  send = jest.fn(async (name: string, payload: Record<string, unknown>) => {
    sent.push({ name, payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown> });
    if (name === 'reportMeetupNoShow') native.commitStory(String(payload.reason), String(payload.details));
    return { data: { success: true, messageId: 'receipt-A', transactionId: 'tx-A', chatId:'c', notificationCommitted:true, deviceDeliveryVerified:false, readingVerified:false, disputeId:'case-meetup', currentStatus:'cancelled', cancellationCommitted:true, walletRefundCommitted:true } };
  });
  (httpsCallable as jest.Mock).mockImplementation((_functions, name: string) => (payload: Record<string, unknown>) => send(name, payload));
});

function loseBothReplies(assertPersisted = false) {
 const fail = async (name: string, payload: Record<string, unknown>) => {sent.push({name, payload: {...payload}}); if (assertPersisted) expect(mockData.get(key)).toContain(String(payload.requestId)); throw lost();};
 send.mockImplementationOnce(fail).mockImplementationOnce(fail);
}

it('persists the immutable payload before dispatch and reuses it after an unknown response', async () => {
  const intended = input();
  loseBothReplies(true);
  await expect(sendMeetupProposal(intended, 'A')).rejects.toThrow('response lost');
  const saved = mockData.get(key);
  await sendMeetupProposal(input(), 'A');
  expect(sent[1].payload).toEqual(sent[0].payload);
  expect(saved).toContain('À conserver');
  expect(mockData.has(key)).toBe(false);
});

it('restarts the service module with only the persisted journal and explicitly resumes the same receipt', async () => {
  loseBothReplies();
  await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow();
  let restarted: typeof sendMeetupProposal = sendMeetupProposal;
  jest.isolateModules(() => {
    const config = require('@/config/firebaseConfig') as { auth: { currentUser: { uid: string } | null } };
    config.auth.currentUser = { uid: 'A' };
    const callable = require('firebase/functions') as { httpsCallable: jest.Mock };
    callable.httpsCallable.mockImplementation((_functions: unknown, name: string) => (payload: Record<string, unknown>) => send(name, payload));
    const firestore = require('firebase/firestore') as { doc: jest.Mock };
    firestore.doc.mockImplementation(() => ({ id: 'must-not-be-used' }));
    restarted = (require('@/services/chat/offers') as { sendMeetupProposal: typeof sendMeetupProposal }).sendMeetupProposal;
  });
  session('A', 3);
  await restarted(input(), 'A');
  expect(sent).toHaveLength(3); expect(sent[2].payload).toEqual(sent[0].payload); expect(sent[1].payload).toEqual(sent[0].payload);
  expect(mockData.has(key)).toBe(false);
});

it('preserves a second unknown intention when the first receipt is removed', async () => {
  send.mockImplementation(async (name: string, payload: Record<string, unknown>) => { sent.push({ name, payload }); throw lost(); });
  await Promise.all([sendMeetupProposal(input(35), 'A').catch(() => undefined), sendMeetupProposal(input(29), 'A').catch(() => undefined)]);
  const original = sent.map(item => item.payload);
  expect(new Set(original.map(item => item.requestId)).size).toBe(2);
  const saved = JSON.parse(mockData.get(key)!) as { requestId: string }[];
  expect(saved).toHaveLength(2);
  send.mockImplementation(async (name: string, payload: Record<string, unknown>) => { sent.push({ name, payload }); return { data: { success: true, messageId: 'receipt' } }; });
  await sendMeetupProposal(input(35), 'A');
  const remaining = JSON.parse(mockData.get(key)!) as { payload: { amount: number }; requestId: string }[];
  expect(remaining).toHaveLength(1); expect(remaining[0].payload.amount).toBe(29);
  expect(sent.at(-1)!.payload).toEqual(original.find(item => item.amount === 35));
  expect(remaining[0].requestId).toBe(original.find(item => item.amount === 29)?.requestId);
});

it('coalesces two exact synchronous calls before journal read finishes', async () => {
  let release: () => void = () => undefined;
  send.mockImplementationOnce((name: string, payload: Record<string, unknown>) => {
    sent.push({ name, payload });
    return new Promise(resolve => { release = () => resolve({ data: { success: true, messageId: 'one' } }); });
  });
  const one = sendMeetupProposal(input(), 'A'); const two = sendMeetupProposal(input(), 'A');
  await tick(); expect(send).toHaveBeenCalledTimes(1); release();
  await expect(one).resolves.toBe('one'); await expect(two).resolves.toBe('one'); expect(mockData.has(key)).toBe(false); expect(mockData.get(`${key}:receipts`)).toContain('one');
});

it.each(['permission-denied', 'failed-precondition'])('a definitive %s retires only its intention; a new explicit intent gets a new key', async code => {
  send.mockImplementationOnce(async (name: string, payload: Record<string, unknown>) => { sent.push({ name, payload }); throw Object.assign(new Error('refused'), { code: `functions/${code}` }); });
  await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow('refused'); expect(mockData.size).toBe(0);
  await sendMeetupProposal(input(), 'A'); expect(sent[1].payload.requestId).not.toBe(sent[0].payload.requestId);
});

it.each(['read', 'write'])('journal %s failure prevents any new callable', async fault => {
  if (fault === 'read') mockGet.mockRejectedValueOnce(new Error('storage read failed'));
  else mockSet.mockRejectedValueOnce(new Error('storage write failed'));
  await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
});

it.each(['{bad', '{}', '[{"requestId":"bad/id","payload":{},"fingerprint":"{}"}]', '[{"requestId":"x","payload":{"amount":20},"fingerprint":"{}"}]'])('rejects invalid saved journal %s without dispatch', async raw => {
  mockData.set(key, raw); await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow();
  expect(send).not.toHaveBeenCalled(); expect(mockData.get(key)).toBe(raw);
});

it('captures input before a delayed journal read even if the caller mutates its object', async () => {
  let release: (value: string | null) => void = () => undefined;
  mockGet.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const value = input(); const pending = sendMeetupProposal(value, 'A'); await tick(); value.amount = 9;
  release(null); await pending; expect(sent[0].payload.amount).toBe(35);
});

it('refuses an Auth/store mismatch before journal or callable', async () => {
  mockUid = 'B'; await expect(sendMeetupProposal(input(), 'A')).rejects.toMatchObject({ code: 'client/stale-operation' });
  expect(mockGet).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});

it('same UID with new generation during journal read cannot dispatch', async () => {
  let release: (value: string | null) => void = () => undefined;
  mockGet.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = sendMeetupProposal(input(), 'A'); await tick(); session('A', 3); release(null);
  await expect(pending).rejects.toMatchObject({ code: 'client/stale-operation' }); expect(send).not.toHaveBeenCalled();
});

it('a dossier invalidated during journal persistence cannot dispatch and preserves its prepared attempt', async () => {
  let current = true; const assertCurrent = () => { if (!current) throw new Error('dossier changed'); };
  mockSet.mockImplementationOnce(async (key, value) => { mockData.set(key, value); current = false; });
  await expect(sendMeetupProposal(input(), 'A', assertCurrent)).rejects.toThrow('dossier changed');
  expect(send).not.toHaveBeenCalled(); expect(mockData.get(key)).toContain('request-1');
});

it('a malformed success response keeps the exact journal for explicit recovery', async () => {
  send.mockResolvedValueOnce({ data: { success: true } }); await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow('réception');
  expect(mockData.get(key)).toContain('request-1'); await sendMeetupProposal(input(), 'A');
  expect((send.mock.calls[1][1] as Record<string, unknown>).requestId).toBe('request-1');
});

it('direct acceptance and counter reject an old actor before IO', async () => {
  session('B'); await expect(counterOfferPrice('c', 'm', 'A', 'other', 20)).rejects.toThrow();
  await expect(acceptOffer('c', 'm', 'm', 'A')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
});

it('a late acceptance response cannot be adopted after A→B→A', async () => {
  let release: (value: unknown) => void = () => undefined;
  send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = acceptOffer('c', 'm', 'm', 'A'); session('B'); session('A'); release({ data: { success: true } });
  await expect(pending).rejects.toMatchObject({ code: 'client/stale-operation' });
});

it('old rejection remains callable for a coherent authenticated identity without a normal profile or new-sale admission', async () => {
  await rejectOffer('c', 'm', 'm', 'A'); expect(sent).toEqual([{ name: 'rejectMeetupProposal', payload: { chatId: 'c', messageId: 'm' } }]);
});

function acceptedMessage() { return { exists: () => true, data: () => ({ chatId: 'c', offer: { status: 'accepted', amount: 20, transactionId: 'old-tx', meetup: { location: { name: 'Lieu' } } } }) }; }
it.each(['confirm', 'noShow', 'complete', 'cancel'])('old %s exit has no new-sale admission prerequisite', async action => {
  if (action === 'confirm') await confirmMeetup('c', 'm', 'A');
  if (action === 'noShow') await reportNoShow('c', 'm', 'A', 'other_party_no_show', 'Détails');
  if (action === 'complete') await completeMeetup('c', 'm', 'A');
  if (action === 'cancel') { await cancelMeetup('c', 'm', 'A'); expect(TransactionService.updateTransactionStatus).not.toHaveBeenCalled(); expect(sent[0]).toEqual({name:'cancelPendingTransaction',payload:{transactionId:'old-tx',expectedUid:'A'}}); expect(sendSystemMessage).toHaveBeenCalledWith('c', 'meetup_cancelled'); }
  expect((getDocs as jest.Mock)).not.toHaveBeenCalled();
  if (action !== 'cancel') expect(sent[0].payload.transactionId).toBe('old-tx');
});

it('same UID generation change while resolving an old transaction prevents its subsequent callable', async () => {
  let release: (value: unknown) => void = () => undefined;
  (getDoc as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = completeMeetup('c', 'm', 'A'); session('A', 3); release(acceptedMessage());
  await expect(pending).rejects.toThrow('session'); expect(send).not.toHaveBeenCalled();
});

it('does not accept two saved intentions sharing the same requestId', async () => {
  const one = input(35); const two = input(29);
  const canonical = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  const raw = JSON.stringify([{ requestId: 'same-id', payload: one, fingerprint: canonical(one) }, { requestId: 'same-id', payload: two, fingerprint: canonical(two) }]);
  mockData.set(key, raw); await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow();
  expect(send).not.toHaveBeenCalled(); expect(mockData.get(key)).toBe(raw);
});

it('does not send from a journal whose payload belongs to another chat', async () => {
  const value = { ...input(), chatId: 'other-chat' };
  const fingerprint = JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  const raw = JSON.stringify([{ requestId: 'old-id', payload: value, fingerprint }]);
  mockData.set(key, raw); await expect(sendMeetupProposal(input(), 'A')).rejects.toThrow();
  expect(send).not.toHaveBeenCalled(); expect(mockData.get(key)).toBe(raw);
});

it('each consumer joining one dispatch checks its own dossier before adopting the receipt', async () => {
  let release: (value: unknown) => void = () => undefined;
  let firstCurrent = true;
  send.mockImplementationOnce((_name: string, _payload: Record<string, unknown>) => new Promise(resolve => { release = resolve; }));
  const first = sendMeetupProposal(input(), 'A', () => { if (!firstCurrent) throw new Error('first closed'); });
  await tick(); const second = sendMeetupProposal(input(), 'A', () => undefined);
  const firstOutcome = first.catch(error => error);
  firstCurrent = false; release({ data: { success: true, messageId: 'one-receipt' } });
  await expect(second).resolves.toBe('one-receipt');
  expect(await firstOutcome).toMatchObject({ message: 'first closed' });
  expect(send).toHaveBeenCalledTimes(1); expect(mockData.has(key)).toBe(false);
});

it('a receipt for a closed sole consumer keeps its saved key for a later explicit recovery', async () => {
  let release: (value: unknown) => void = () => undefined; let current = true;
  send.mockImplementationOnce((name: string, payload: Record<string, unknown>) => {
    sent.push({ name, payload }); return new Promise(resolve => { release = resolve; });
  });
  const pending = sendMeetupProposal(input(), 'A', () => { if (!current) throw new Error('closed'); });
  await tick(); current = false; release({ data: { success: true, messageId: 'old-receipt' } });
  await expect(pending).rejects.toThrow('closed'); expect(mockData.get(key)).toContain('request-1');
  send.mockImplementationOnce(async (name: string, payload: Record<string, unknown>) => { sent.push({ name, payload }); return { data: { success: true, messageId: 'old-receipt' } }; });
  await sendMeetupProposal(input(), 'A'); expect(sent[1].payload).toEqual(sent[0].payload);
});

it('R01 replays an existing exact tuple after changed admission, but refuses a new amount before any new request or dispatch', async () => {
  const beforeNewDispatch = jest.fn(async () => undefined);
  loseBothReplies();
  await expect(sendMeetupProposal(input(), 'A', () => undefined, { beforeNewDispatch, deferAdoption: true })).rejects.toThrow('response lost');
  const exact = sent[0].payload;
  beforeNewDispatch.mockRejectedValue(Object.assign(new Error('New sales refused'), { code: 'functions/permission-denied' }));
  await expect(sendMeetupProposal(input(), 'A', () => undefined, { beforeNewDispatch, recoveryOnly: true, expectedRequestId: String(exact.requestId), deferAdoption: true })).resolves.toBe('receipt-A');
  expect(sent[1].payload).toEqual(exact); expect(beforeNewDispatch).toHaveBeenCalledTimes(1);
  await expect(sendMeetupProposal(input(36), 'A', () => undefined, { beforeNewDispatch, deferAdoption: true })).rejects.toThrow('New sales refused');
  expect(sent).toHaveLength(3); expect(doc).toHaveBeenCalledTimes(1);
});

it('R01 acceptance persists the exact linked message after an unknown outcome and requires a real server transaction before resolving', async () => {
  loseBothReplies();
  await expect(acceptOffer('chat-A', 'message-A', 'message-A', 'A')).rejects.toThrow('response lost');
  expect(await hasMeetupAcceptanceAttempt('A', 'chat-A', 'message-A', () => undefined)).toBe(true);
  send.mockResolvedValueOnce({ data: { success: true } });
  await expect(acceptOffer('chat-A', 'message-A', 'message-A', 'A')).rejects.toThrow('doit être vérifiée');
  expect(await hasMeetupAcceptanceAttempt('A', 'chat-A', 'message-A', () => undefined)).toBe(true);
  await expect(acceptOffer('chat-A', 'message-A', 'message-A', 'A')).resolves.toBeUndefined();
  expect(await hasMeetupAcceptanceAttempt('A', 'chat-A', 'message-A', () => undefined)).toBe(false);
  expect(send.mock.calls.at(-1)?.[1]).toEqual(sent[0].payload);
});
