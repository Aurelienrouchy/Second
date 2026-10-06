import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock(); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: { auth: { uid: string } }) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  return { HttpsError, onCall: (_options: unknown, handler: unknown) => handler };
});
import { sendMeetupProposal, rejectMeetupProposal } from './offers';
import { meetupThreadId } from '../utils/meetupOffers';
type Request = { auth: { uid: string } | null; data: Record<string, unknown> };
const send = sendMeetupProposal as unknown as (r: Request) => Promise<{ messageId: string; reused: boolean; replaced: boolean }>;
const reject = rejectMeetupProposal as unknown as (r: Request) => Promise<unknown>;
const spot = { name: 'Café X', category: 'cafe', neighborhood: { id: 'n1', name: 'Plateau', borough: 'Plateau' } };
function setup(chatId = 'chat1', buyer = 'buyer') {
  fs.setDoc(`chats/${chatId}`, { participants: ['seller', buyer], articleId: 'article1' });
  fs.setDoc('articles/article1', { sellerId: 'seller', price: 100, isSold: false, isActive: true });
}
function propose(requestId: string, amount = 80, chatId = 'chat1', buyer = 'buyer') {
  return send({ auth: { uid: buyer }, data: { chatId, requestId, amount, location: spot } });
}
const pending = (id: string) => (fs.getDoc(`messages/${id}`)?.offer as { status: string } | undefined)?.status;
beforeEach(() => { fs.reset(); setup(); });
describe('atomic meetup proposals', () => {
  it('replaces the previous buyer/article proposal from any entry point', async () => {
    await propose('first');
    const second = await propose('second', 75);
    expect(second.replaced).toBe(true);
    expect(pending('first')).toBe('expired'); expect(pending('second')).toBe('pending');
    expect(fs.getDoc(`meetup_offer_threads/${meetupThreadId('article1', 'buyer')}`)?.messageId).toBe('second');
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
    setup('duplicate'); await propose('one'); await propose('two', 70, 'duplicate');
    expect(pending('one')).toBe('expired'); expect(pending('two')).toBe('pending');
  });
  it('different buyers keep separate pending negotiations', async () => {
    setup('chat2', 'otherBuyer');
    await Promise.all([propose('one'), propose('two', 80, 'chat2', 'otherBuyer')]);
    expect(pending('one')).toBe('pending'); expect(pending('two')).toBe('pending');
  });
  it('countering is one atomic replacement; stale responses cannot create another offer', async () => {
    await propose('one');
    await send({ auth: { uid: 'seller' }, data: { chatId: 'chat1', requestId: 'counter', originalMessageId: 'one', counterKind: 'price', amount: 90 } });
    expect(pending('one')).toBe('counter_price'); expect(pending('counter')).toBe('pending');
    await expect(send({ auth: { uid: 'seller' }, data: { chatId: 'chat1', requestId: 'stale', originalMessageId: 'one', counterKind: 'price', amount: 95 } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('messages/stale')).toBeUndefined();
  });
  it('rejecting an old proposal never cancels an accepted transaction', async () => {
    await propose('old'); await propose('new', 70);
    fs.setDoc('transactions/accepted', { articleId: 'article1', chatId: 'chat1', status: 'meetup_confirmed', offerMessageId: 'new' });
    await expect(reject({ auth: { uid: 'seller' }, data: { chatId: 'chat1', messageId: 'old' } })).rejects.toMatchObject({ code: 'failed-precondition' });
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
    const r = { auth: { uid: 'seller' }, data: { chatId: 'chat1', messageId: 'one' } };
    await reject(r); await reject(r);
    expect(pending('one')).toBe('rejected'); expect(fs.getDoc('articles/article1')?.isSold).toBe(false);
    expect(fs.writeOps.filter((op) => op.path.startsWith('transactions/'))).toEqual([]);
  });
  it('rejects blocked, outsider, invalid amounts and invalid locations without writes', async () => {
    await expect(propose('bad', 110)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(send({ auth: { uid: 'outsider' }, data: { chatId: 'chat1', requestId: 'bad', amount: 70, location: spot } })).rejects.toMatchObject({ code: 'permission-denied' });
    fs.setDoc('users/seller', { blockedUserIds: ['buyer'] });
    await expect(propose('blocked')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toEqual([]);
  });
  it('the deferred location is normalized and decimal CAD amounts are accepted', async () => {
    await send({ auth: { uid: 'buyer' }, data: { chatId: 'chat1', requestId: 'one', amount: 1.1, location: { toArrange: true } } });
    expect((fs.getDoc('messages/one')?.offer as any).meetup.location.name).toBe('À convenir par messagerie');
  });
});


it('an invalid counter-proposal leaves the original pending agreement intact', async () => {
  await propose('one');
  await expect(send({ auth: { uid: 'seller' }, data: { chatId: 'chat1', requestId: 'badCounter', originalMessageId: 'one', counterKind: 'price', amount: 101 } })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(pending('one')).toBe('pending');
  expect(fs.getDoc('messages/badCounter')).toBeUndefined();
});

it('expired proposals cannot be countered or rejected', async () => {
  await propose('one');
  await fs.db.collection('messages').doc('one').update({ 'offer.expiresAt': new Date(Date.now() - 1000) });
  await expect(send({ auth: { uid: 'seller' }, data: { chatId: 'chat1', requestId: 'counter', originalMessageId: 'one', counterKind: 'price', amount: 90 } })).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(reject({ auth: { uid: 'seller' }, data: { chatId: 'chat1', messageId: 'one' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.getDoc('messages/counter')).toBeUndefined();
});
