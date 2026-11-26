/** Real Admin SDK transactions; enabled only against the local demo emulator. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const recovery = await vi.hoisted(async () => (await import('../utils/testHelpers/recoveryStorageFixture')).createRecoveryStorageFixture('demo-second'));
vi.mock('@google-cloud/storage', () => ({ Storage: recovery.Storage }));
// Emulator-only tests do not need ADC's cloud metadata probe.
if (emulatorHost) process.env.METADATA_SERVER_DETECTION = 'none';
if (emulatorHost && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
  throw new Error('Meetup contention tests require a loopback Firestore emulator');
}
if (emulatorHost && process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== 'demo-second') {
  throw new Error('Meetup contention tests require the demo-second project');
}
vi.mock('../config/firebase', async () => {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const app = getApps().find((a) => a.name === 'meetup-contention-tests') ?? initializeApp({ projectId: 'demo-second' }, 'meetup-contention-tests');
  if (app.options.projectId !== 'demo-second') throw new Error('Cannot reuse a real project app in contention tests');
  return { db: getFirestore(app), FieldValue,
    auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString() }) } };
});
vi.mock('../utils/articleMedia', async original => ({ ...await original<typeof import('../utils/articleMedia')>(), promoteArticleImages: async (images: unknown) => images }));
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
import { createArticle } from './products';
import { installFinancialSubjectTransactions } from '../utils/financialSubjectTransaction';
installFinancialSubjectTransactions(db);
import { sendMeetupProposal, rejectMeetupProposal } from './offers';
import { acceptMeetupOffer } from './payments';
import { meetupThreadId } from '../utils/meetupOffers';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
type Request = { auth: { uid: string; token: { auth_time: number; email_verified: boolean } }; data: Record<string, unknown> };
const send = sendMeetupProposal as unknown as (r: Request) => Promise<{ messageId: string }>;
const accept = acceptMeetupOffer as unknown as (r: Request) => Promise<{ transactionId: string }>;
const reject = rejectMeetupProposal as unknown as (r: Request) => Promise<unknown>;
const location = { name: 'Lieu de test', category: 'cafe', neighborhood: { id: 'n1', name: 'Quartier test', borough: 'Arrondissement test' } };
let prefix: string;
let articleId: string;
let seller: string;
let buyer: string;
let secondBuyer: string;
const chats = () => [`${prefix}-chat-1`, `${prefix}-chat-2`];
const session = (uid: string) => ({ uid, token: { auth_time: Math.floor(Date.now()/1000), email_verified: true } });
const propose = (suffix: string, amount = 80, index = 0) => send({ auth: session(index === 0 ? buyer : secondBuyer), data: {
  expectedUid: index === 0 ? buyer : secondBuyer,
  chatId: chats()[index], requestId: `${prefix}-${suffix}`, amount, location,
} });

describe.skipIf(!emulatorHost)('meetup negotiation with real emulator contention', () => {
  beforeEach(async () => {
    recovery.reset();
    for(const [key,value]of Object.entries(recovery.environment))vi.stubEnv(key,value);
    prefix = `audit-meetup-${randomUUID()}`; articleId = `${prefix}-article`;
    seller = `${prefix}-seller`; buyer = `${prefix}-buyer`; secondBuyer = `${prefix}-buyer-2`;
    await Promise.all([seller, buyer, secondBuyer].map((uid) => db.collection('users').doc(uid).set({ blockedUserIds: [], dateOfBirth: '2000-01-01' })));
    await db.collection('eligibility_profiles').doc(seller).set({ version: 1, activityDeclaration: { kind: 'personal', actorUid: seller,
      recordedAt: new Date(), declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
    const created = await (createArticle as any)({auth:session(seller),data:{expectedUid:seller,clientRequestId:prefix+'-publish',quantity:1,
      title:'Pull en coton',description:'Un pull bleu en coton',price:100,images:[{url:`https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/${encodeURIComponent('drafts/'+seller+'/fixture/a.jpg')}?alt=media`}],
      categoryIds:['women','women_clothing','women_clothing_sweaters','women_clothing_sweaters_hoodies'],condition:'très bon état',size:{value:'M',system:'EU'},
      isHandDelivery:true,isShipping:false,neighborhoods:[location.neighborhood]}});
    articleId=created.articleId;
    await Promise.all(chats().map((chatId, index) => db.collection('chats').doc(chatId).set({ articleId, participants: [seller, index === 0 ? buyer : secondBuyer] })));
  });
  afterEach(async () => {
    const agreements = await db.collection('transactions').where('articleId', '==', articleId).get();
    const messages = await db.collection('messages').where('chatId', 'in', chats()).get();
    const requests = await db.collection('meetup_offer_requests').where('chatId', 'in', chats()).get();
    const refs = [...agreements.docs, ...messages.docs, ...requests.docs].map((d) => d.ref);
    refs.push(db.collection('articles').doc(articleId), ...chats().map((id) => db.collection('chats').doc(id)),
      db.collection('eligibility_profiles').doc(seller),
      ...[seller, buyer, secondBuyer].map((uid) => db.collection('users').doc(uid)),
      ...[buyer, secondBuyer].map((uid) => db.collection('meetup_offer_threads').doc(meetupThreadId(articleId, uid))));
    await Promise.all(refs.map((ref) => ref.delete()));
    vi.unstubAllEnvs();
  });
  it('racing different sends and replay leave exactly one pending proposal', async () => {
    await Promise.all([propose('one', 80), propose('two', 70)]);
    const messages = await db.collection('messages').where('chatId', '==', chats()[0]).get();
    expect(messages.docs.filter((d) => d.data().offer.status === 'pending')).toHaveLength(1);
    const winner = messages.docs.find((d) => d.data().offer.status === 'pending')!;
    const old = messages.docs.find((d) => d.id !== winner.id)!;
    await propose(old.id.endsWith('-one') ? 'one' : 'two', old.data().offer.amount);
    expect((await winner.ref.get()).data()?.offer.status).toBe('pending');
    await expect(reject({ auth: session(seller), data: { expectedUid:seller,chatId: chats()[0], messageId: old.id } })).rejects.toMatchObject({ code: 'failed-precondition' });
  }, 30000);
  it('two buyers racing acceptance create one agreement; double accept replays it', async () => {
    const [a, b] = await Promise.all([propose('one'), propose('two', 80, 1)]);
    const outcomes = await Promise.allSettled([
      accept({ auth: session(seller), data: { expectedUid:seller,chatId: chats()[0], messageId: a.messageId } }),
      accept({ auth: session(seller), data: { expectedUid:seller,chatId: chats()[1], messageId: b.messageId } }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const txs = await db.collection('transactions').where('articleId', '==', articleId).get();
    expect(txs.size).toBe(1);
    const agreement = txs.docs[0];
    const replay = await accept({ auth: session(seller), data: { expectedUid:seller,chatId: agreement.data().chatId, messageId: agreement.data().offerMessageId } });
    expect(replay.transactionId).toBe(agreement.id);
    expect((await db.collection('articles').doc(articleId).get()).data()?.activeTransactionId).toBe(agreement.id);
  }, 30000);
});
