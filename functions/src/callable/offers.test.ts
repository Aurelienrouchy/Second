import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldValue as NativeFieldValue, Timestamp } from 'firebase-admin/firestore';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = await vi.hoisted(async () => ({ fs: null as MockFirestore | null, recovery: (await import('../utils/testHelpers/recoveryStorageFixture')).createRecoveryStorageFixture() }));
vi.mock('@google-cloud/storage', () => ({ Storage: holder.recovery.Storage }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
const native = fs.db.runTransaction.bind(fs.db);
const persisted = (v: any): any => v instanceof NativeFieldValue && v.isEqual(NativeFieldValue.delete()) ? fs.FieldValue.delete() :
  Array.isArray(v) ? v.map(persisted) : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ?
    Object.fromEntries(Object.entries(v).map(([key, value]) => [key, persisted(value)])) : v;
fs.db.runTransaction = (fn: any) => native(async (tx: any) => {
  for (const method of ['create', 'set', 'update']) { const write = tx[method].bind(tx); tx[method] = (ref: any, value: any, ...rest: any[]) => write(ref, persisted(value), ...rest); }
  const get = tx.get.bind(tx);
  tx.get = async (ref: any) => { const snap = await get(ref); const timed = (row: any) => ({ ...row, updateTime: Timestamp.fromMillis(10000 + fs.writeOps.findLastIndex(v => v.path === row.ref.path)) }); return snap.docs ? { ...snap, docs: snap.docs.map(timed) } : snap.exists ? timed(snap) : snap; };
  return fn(tx);
});
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return { ...holder.fs!.FieldValue, serverTimestamp: () => Timestamp.now(), delete: () => NativeFieldValue.delete() }; }, auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString() }) } }));
vi.mock('../utils/articleMedia', async original => ({ ...await original<typeof import('../utils/articleMedia')>(), promoteArticleImages: async (images: unknown) => images }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: { auth: { uid: string } }) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  return { HttpsError, onCall: (_options: unknown, handler: unknown) => handler };
});
import { createArticle } from './products';
import { installFinancialSubjectTransactions } from '../utils/financialSubjectTransaction';
installFinancialSubjectTransactions(fs.db as any);
import { sendMeetupProposal, rejectMeetupProposal } from './offers';
import { meetupThreadId } from '../utils/meetupOffers';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
type Request = { auth: { uid: string; token: { auth_time: number } } | null; data: Record<string, unknown> };
const send = sendMeetupProposal as unknown as (r: Request) => Promise<{ messageId: string; reused: boolean; replaced: boolean }>;
const reject = rejectMeetupProposal as unknown as (r: Request) => Promise<unknown>;
const session = (uid: string) => ({ uid, token: { auth_time: Math.floor(Date.now() / 1000) } });
let articleId: string;
const spot = { name: 'Café X', category: 'cafe', neighborhood: { id: 'n1', name: 'Plateau', borough: 'Plateau' } };
async function setup(chatId = 'chat1', buyer = 'buyer', price = 100) {
  fs.setDoc('users/seller', { dateOfBirth: '2000-01-01' });
  fs.setDoc(`users/${buyer}`, { dateOfBirth: '2000-01-01' });
  fs.setDoc('eligibility_profiles/seller', { version: 1, activityDeclaration: { kind: 'personal', actorUid: 'seller',
    recordedAt: new Date(), declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
  {
    const result = await (createArticle as any)({ auth: { ...session('seller'), token: { ...session('seller').token, email_verified: true } }, data: {
      expectedUid: 'seller', clientRequestId: `offer_article_${Math.round(price * 100)}`, quantity: 1, title: 'Pull en coton', description: 'Un pull bleu en coton', price,
      images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/drafts%2Fseller%2Ffixture%2Fa.jpg?alt=media' }],
      categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'], condition: 'très bon état',
      size: { value: 'M', system: 'EU' }, isHandDelivery: true, isShipping: false, neighborhoods: [spot.neighborhood],
    } });
    articleId = result.articleId;
  }
  fs.setDoc(`chats/${chatId}`, { participants: ['seller', buyer], articleId });
}
function propose(requestId: string, amount = 80, chatId = 'chat1', buyer = 'buyer') {
  return send({ auth: session(buyer), data: { chatId, requestId, amount, location: spot } });
}
const pending = (id: string) => (fs.getDoc(`messages/${id}`)?.offer as { status: string } | undefined)?.status;
beforeEach(async () => { fs.reset(); articleId = ''; holder.recovery.reset(); for (const [key, value] of Object.entries(holder.recovery.environment)) vi.stubEnv(key, value); await setup(); });
afterEach(() => vi.unstubAllEnvs());
describe('atomic meetup proposals', () => {
  it('replaces the previous buyer/article proposal from any entry point', async () => {
    await propose('first');
    const second = await propose('second', 75);
    expect(second.replaced).toBe(true);
    expect(pending('first')).toBe('expired'); expect(pending('second')).toBe('pending');
    expect(fs.getDoc(`meetup_offer_threads/${meetupThreadId(articleId, 'buyer')}`)?.messageId).toBe('second');
    expect(fs.writeOps.filter((op) => op.path.startsWith('transactions/'))).toEqual([]);
  });
  it('equal simultaneous taps return one pending message and retry the original result', async () => {
    const [a, b] = await Promise.all([propose('one'), propose('two')]);
    expect(a.messageId).toBe(b.messageId);
    await propose('newTerms', 70);
    const replay = await propose('two');
    expect(replay.messageId).toBe(a.messageId);
    expect(pending('newTerms')).toBe('pending');
    expect(pending(a.messageId)).toBe('expired');
  });
  it('simultaneous different terms converge to one pending offer', async () => {
    await Promise.all([propose('one', 80), propose('two', 70)]);
    expect([pending('one'), pending('two')].sort()).toEqual(['expired', 'pending']);
  });
  it('duplicate legacy chats share one buyer/article negotiation', async () => {
    await setup('duplicate'); await propose('one'); await propose('two', 70, 'duplicate');
    expect(pending('one')).toBe('expired'); expect(pending('two')).toBe('pending');
  });
  it('identical terms in another legacy chat create a visible replacement in that chat', async () => {
    await setup('duplicate');
    await propose('one');
    const result = await propose('two', 80, 'duplicate');
    expect(result).toMatchObject({ messageId: 'two', replaced: true, reused: false });
    expect(fs.getDoc('messages/two')?.chatId).toBe('duplicate');
    expect(pending('one')).toBe('expired');
    expect(pending('two')).toBe('pending');
  });
  it('allows a cheap article at its full price without lowering the negotiation floor', async () => {
    await setup('cheap-chat', 'buyer', 0.5);
    await expect(propose('discount', 0.49, 'cheap-chat')).rejects.toMatchObject({ code: 'invalid-argument' });
    await propose('full-price', 0.5, 'cheap-chat');
    expect((fs.getDoc('messages/full-price')?.offer as { amount: number }).amount).toBe(0.5);
    await setup('expensive-chat');
    await expect(propose('sub-minimum', 0.5, 'expensive-chat')).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('different buyers keep separate pending negotiations', async () => {
    await setup('chat2', 'otherBuyer');
    await Promise.all([propose('one'), propose('two', 80, 'chat2', 'otherBuyer')]);
    expect(pending('one')).toBe('pending'); expect(pending('two')).toBe('pending');
  });
  it('countering is one atomic replacement; stale responses cannot create another offer', async () => {
    await propose('one');
    await send({ auth: session('seller'), data: { chatId: 'chat1', requestId: 'counter', originalMessageId: 'one', counterKind: 'price', amount: 90 } });
    expect(pending('one')).toBe('counter_price'); expect(pending('counter')).toBe('pending');
    await expect(send({ auth: session('seller'), data: { chatId: 'chat1', requestId: 'stale', originalMessageId: 'one', counterKind: 'price', amount: 95 } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('messages/stale')).toBeUndefined();
  });
  it('rejecting an old proposal never cancels an accepted transaction', async () => {
    await propose('old'); await propose('new', 70);
    fs.setDoc('transactions/accepted', { articleId, chatId: 'chat1', status: 'meetup_confirmed', offerMessageId: 'new' });
    await expect(reject({ auth: session('seller'), data: { chatId: 'chat1', messageId: 'old' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('transactions/accepted')?.status).toBe('meetup_confirmed');
  });
  it('cannot overwrite an accepted agreement; explicit cancellation permits a new proposal', async () => {
    await propose('one');
    await fs.db.collection('messages').doc('one').update({ 'offer.status': 'accepted', 'offer.transactionId': 'tx1' });
    fs.setDoc('transactions/tx1', { status: 'meetup_pending' });
    await expect(propose('two', 75)).rejects.toMatchObject({ code: 'failed-precondition' });
    fs.setDoc('transactions/tx1', { status: 'cancelled' });
    expect((await propose('two', 75)).messageId).toBe('two');
  });
  it('reject is idempotent and never changes article or transaction', async () => {
    await propose('one');
    const r = { auth: session('seller'), data: { chatId: 'chat1', messageId: 'one' } };
    await reject(r); await reject(r);
    expect(pending('one')).toBe('rejected'); expect(fs.getDoc(`articles/${articleId}`)?.isSold).toBe(false);
    expect(fs.writeOps.filter((op) => op.path.startsWith('transactions/'))).toEqual([]);
  });
  it('rejects blocked, outsider, invalid amounts and invalid locations without writes', async () => {
    const writes = fs.writeOps.length;
    await expect(propose('bad', 110)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(send({ auth: session('outsider'), data: { chatId: 'chat1', requestId: 'bad', amount: 70, location: spot } })).rejects.toMatchObject({ code: 'permission-denied' });
    fs.setDoc('users/seller', { blockedUserIds: ['buyer'] });
    await expect(propose('blocked')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('the deferred location is normalized and decimal CAD amounts are accepted', async () => {
    await send({ auth: session('buyer'), data: { chatId: 'chat1', requestId: 'one', amount: 1.1, location: { toArrange: true } } });
    expect((fs.getDoc('messages/one')?.offer as any).meetup.location.name).toBe('À convenir par messagerie');
  });
});


it('an invalid counter-proposal leaves the original pending agreement intact', async () => {
  await propose('one');
  await expect(send({ auth: session('seller'), data: { chatId: 'chat1', requestId: 'badCounter', originalMessageId: 'one', counterKind: 'price', amount: 101 } })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(pending('one')).toBe('pending');
  expect(fs.getDoc('messages/badCounter')).toBeUndefined();
});

it('expired proposals cannot be countered or rejected', async () => {
  await propose('one');
  await fs.db.collection('messages').doc('one').update({ 'offer.expiresAt': new Date(Date.now() - 1000) });
  await expect(send({ auth: session('seller'), data: { chatId: 'chat1', requestId: 'counter', originalMessageId: 'one', counterKind: 'price', amount: 90 } })).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(reject({ auth: session('seller'), data: { chatId: 'chat1', messageId: 'one' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.getDoc('messages/counter')).toBeUndefined();
});
