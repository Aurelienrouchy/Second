/** Real Admin SDK transactions; enabled only against the local demo emulator. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (emulatorHost && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
  throw new Error('Meetup contention tests require a loopback Firestore emulator');
}
vi.mock('../config/firebase', async () => {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const app = getApps().find((a) => a.name === 'meetup-contention-tests') ?? initializeApp({ projectId: 'demo-second' }, 'meetup-contention-tests');
  return { db: getFirestore(app), FieldValue };
});
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: { auth: { uid: string } }) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({}) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({}) }));
vi.mock('../utils/fees', () => ({ calculateFees: () => ({}), calculateServiceFee: () => 0, getServiceFeeConfig: () => ({}) }));
vi.mock('../utils/trackingTransition', () => ({ applyTrackingOutcome: () => {}, DELIVERABLE_STATUSES: new Set() }));
vi.mock('../utils/refund', () => ({ issueTransactionRefund: async () => ({ success: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  return { HttpsError, onCall: (_options: unknown, handler: unknown) => handler };
});
import { db } from '../config/firebase';
import { sendMeetupProposal, rejectMeetupProposal } from './offers';
import { acceptMeetupOffer } from './payments';
import { meetupThreadId } from '../utils/meetupOffers';
type Request = { auth: { uid: string }; data: Record<string, unknown> };
const send = sendMeetupProposal as unknown as (r: Request) => Promise<{ messageId: string }>;
const accept = acceptMeetupOffer as unknown as (r: Request) => Promise<{ transactionId: string }>;
const reject = rejectMeetupProposal as unknown as (r: Request) => Promise<unknown>;
const location = { name: 'Lieu de test', category: 'cafe', neighborhood: { id: 'n1', name: 'Quartier test', borough: 'Arrondissement test' } };
let prefix: string;
let articleId: string;
const seller = 'audit-meetup-seller';
const buyer = 'audit-meetup-buyer';
const secondBuyer = 'audit-meetup-buyer-2';
const chats = () => [`${prefix}-chat-1`, `${prefix}-chat-2`];
const propose = (suffix: string, amount = 80, index = 0) => send({ auth: { uid: index === 0 ? buyer : secondBuyer }, data: {
  chatId: chats()[index], requestId: `${prefix}-${suffix}`, amount, location,
} });

describe.skipIf(!emulatorHost)('meetup negotiation with real emulator contention', () => {
  beforeEach(async () => {
    prefix = `audit-meetup-${randomUUID()}`; articleId = `${prefix}-article`;
    await db.collection('articles').doc(articleId).set({ price: 100, sellerId: seller, isSold: false, isActive: true });
    await Promise.all(chats().map((chatId, index) => db.collection('chats').doc(chatId).set({ articleId, participants: [seller, index === 0 ? buyer : secondBuyer] })));
  });
  afterEach(async () => {
    const agreements = await db.collection('transactions').where('articleId', '==', articleId).get();
    const messages = await db.collection('messages').where('chatId', 'in', chats()).get();
    const requests = await db.collection('meetup_offer_requests').where('chatId', 'in', chats()).get();
    const refs = [...agreements.docs, ...messages.docs, ...requests.docs].map((d) => d.ref);
    refs.push(db.collection('articles').doc(articleId), ...chats().map((id) => db.collection('chats').doc(id)),
      ...[buyer, secondBuyer].map((uid) => db.collection('meetup_offer_threads').doc(meetupThreadId(articleId, uid))));
    await Promise.all(refs.map((ref) => ref.delete()));
  });
  it('racing different sends and replay leave exactly one pending proposal', async () => {
    await Promise.all([propose('one', 80), propose('two', 70)]);
    const messages = await db.collection('messages').where('chatId', '==', chats()[0]).get();
    expect(messages.docs.filter((d) => d.data().offer.status === 'pending')).toHaveLength(1);
    const winner = messages.docs.find((d) => d.data().offer.status === 'pending')!;
    const old = messages.docs.find((d) => d.id !== winner.id)!;
    await propose(old.id.endsWith('-one') ? 'one' : 'two', old.data().offer.amount);
    expect((await winner.ref.get()).data()?.offer.status).toBe('pending');
    await expect(reject({ auth: { uid: seller }, data: { chatId: chats()[0], messageId: old.id } })).rejects.toMatchObject({ code: 'failed-precondition' });
  }, 30000);
  it('two buyers racing acceptance create one agreement; double accept replays it', async () => {
    const [a, b] = await Promise.all([propose('one'), propose('two', 80, 1)]);
    const outcomes = await Promise.allSettled([
      accept({ auth: { uid: seller }, data: { chatId: chats()[0], messageId: a.messageId } }),
      accept({ auth: { uid: seller }, data: { chatId: chats()[1], messageId: b.messageId } }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const txs = await db.collection('transactions').where('articleId', '==', articleId).get();
    expect(txs.size).toBe(1);
    const agreement = txs.docs[0];
    const replay = await accept({ auth: { uid: seller }, data: { chatId: agreement.data().chatId, messageId: agreement.data().offerMessageId } });
    expect(replay.transactionId).toBe(agreement.id);
    expect((await db.collection('articles').doc(articleId).get()).data()?.activeTransactionId).toBe(agreement.id);
  }, 30000);
});
