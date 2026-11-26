import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, promote: null as any, copies: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; }, storage: { bucket: () => ({ file: () => ({ delete: async () => {} }) }) } }));
vi.mock('../utils/articleMedia', () => ({ promoteArticleImages: async (images: any) => { holder.copies++; if (holder.promote) await holder.promote(); return images; } }));
vi.mock('../services/brands', () => ({ matchBrand: async () => ({ brandName: null }), BRAND_MATCHING: { autoSelectThreshold: 1 } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: any, handler: any) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: any) { super(message); } } }));
import { createArticle, updateArticle, toggleArticleSold } from './products';
import { sendMeetupProposal } from './offers';
import { acceptMeetupOffer, confirmMeetupTransaction, completeMeetupTransaction, reportMeetupNoShow } from './payments/meetup';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
import { normalizeMeetupLocation } from '../utils/meetupOffers';
const call = (fn: any, data: any, uid = 'seller') => fn({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000), email_verified: true } }, data });
const snapshotTime = { seconds: 1800000000, nanoseconds: 1 };
const originalTransaction = fs.db.runTransaction.bind(fs.db);
const soldInput = (desiredIsSold: boolean) => ({ operation: 'set', articleId: 'article', requestId: desiredIsSold ? 'sold-gesture' : 'relist-gesture', desiredIsSold,
  expectedIsSold: !desiredIsSold, expectedRevision: createHash('sha256').update(JSON.stringify(['article', 'seller', snapshotTime.seconds, snapshotTime.nanoseconds])).digest('hex') });
const location = { toArrange: true };
const image = 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fseller%2Fd%2Fa.jpg?alt=media';
const publishData = { title: 'Une robe', price: 50, images: [{ url: image }], categoryIds: ['women'], isHandDelivery: true,
  isShipping: false, neighborhoods: [{ id: 'n', name: 'Quartier', borough: 'Ville' }], clientRequestId: 'stable-publication' };
const publish = () => call(createArticle, publishData);
const send = (extra = {}, uid = 'buyer') => call(sendMeetupProposal, { chatId: 'chat', requestId: 'new_proposal', amount: 40, location, ...extra }, uid);
const accept = (uid = 'seller', messageId = 'offer') => call(acceptMeetupOffer, { chatId: 'chat', messageId }, uid);
function personal(uid = 'seller', kind = 'personal') {
  fs.setDoc('eligibility_profiles/' + uid, { version: 1, activityDeclaration: { kind, actorUid: uid, recordedAt: new Date(),
    statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS[kind as 'personal' | 'professional'] } });
}
function sellerProblem(kind: string) {
  if (kind === 'minor') fs.setDoc('users/seller', { dateOfBirth: '2009-10-10' });
  if (kind === 'missing') fs.setDoc('users/seller', {});
  if (kind === 'invalid') fs.setDoc('users/seller', { dateOfBirth: '2000-02-30' });
  if (kind === 'professional') personal('seller', 'professional');
  if (kind === 'undeclared') fs.setDoc('eligibility_profiles/seller', null);
  if (kind === 'review') fs.setDoc('eligibility_profiles/seller', { ...(fs.getDoc('eligibility_profiles/seller')!), activeReviews: { privateCase: { scope: 'sell', active: true } } });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
  vi.restoreAllMocks(); fs.reset(); holder.promote = null; holder.copies = 0;
  // Representative updateTime added to keep the existing admission assertions meaningful.
  vi.spyOn(fs.db, 'runTransaction').mockImplementation(handler => originalTransaction(async tx => handler({ ...tx,
    get: (async (target: any) => { const snap = await (tx.get as any)(target);
      return target.path && snap.exists ? { ...snap, updateTime: snapshotTime } : snap; }) as typeof tx.get,
  })));
  fs.setDoc('users/seller', { dateOfBirth: '2000-01-01', displayName: 'Seller', shopTier: 'pro', addresses: [{ province: 'ON' }] });
  fs.setDoc('users/buyer', { dateOfBirth: '2000-01-01', isActive: true }); personal();
  fs.setDoc('articles/article', { sellerId: 'seller', price: 50, isSold: false, isActive: true, isHandDelivery: true });
  fs.setDoc('chats/chat', { participants: ['seller', 'buyer'], articleId: 'article' });
  fs.setDoc('messages/offer', { type: 'offer', chatId: 'chat', senderId: 'buyer', offer: { amount: 40, status: 'pending',
    meetup: { location: normalizeMeetupLocation(location) }, expiresAt: new Date(Date.now() + 100000) } });
});
afterEach(() => vi.useRealTimers());
describe('03B1 actual handler admission and source roles', () => {
  for (const [name, run] of [
    ['publish', publish], ['commercial edit', () => call(updateArticle, { articleId: 'article', updates: { price: 45 } })],
    ['relist', () => { fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), isSold: true }); return call(toggleArticleSold, soldInput(false)); }],
    ['seller proposal', () => send({}, 'seller')], ['seller acceptance', accept],
    ['seller counter-proposal', () => send({ requestId: 'counter', originalMessageId: 'offer', counterKind: 'price', amount: 45 }, 'seller')],
  ] as const) it.each(['minor', 'missing', 'invalid', 'professional', 'undeclared', 'review'])(`${name} refuses seller %s before new commerce`, async problem => {
    sellerProblem(problem); const count = fs.writeOps.length;
    await expect(run()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(count); expect(holder.copies).toBe(0);
  });
  it.each(['minor', 'missing', 'invalid', 'review'])('buyer proposal and acceptance refuse own %s without exposing seller private proofs', async problem => {
    fs.setDoc('users/buyer', problem === 'minor' ? { dateOfBirth: '2009-10-10' } : problem === 'invalid' ? { dateOfBirth: '2000-02-30' } : { dateOfBirth: problem === 'missing' ? null : '2000-01-01' });
    if (problem === 'review') fs.setDoc('eligibility_profiles/buyer', { version: 1, signals: { secret: { scope: 'buy', active: true, internalNote: 'SECRET' } } });
    fs.setDoc('messages/offer', { ...fs.getDoc('messages/offer'), senderId: 'seller' });
    await expect(send()).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(accept('buyer')).rejects.toMatchObject({ code: 'permission-denied' }); expect(fs.writeOps).toHaveLength(0);
  });
  it('counter-offer sender is seller, buyer eligibility still belongs to the other participant', async () => {
    fs.setDoc('users/buyer', { dateOfBirth: '2009-10-10' });
    await expect(send({ requestId: 'counter', originalMessageId: 'offer', counterKind: 'price', amount: 45 }, 'seller')).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
    expect(fs.getDoc('messages/counter')).toBeUndefined(); expect((fs.getDoc('messages/offer')!.offer as any).status).toBe('pending');
  });
  it('counterparty refusal is generic and contains no age/date/activity/private signal', async () => {
    sellerProblem('minor');
    const error = await send({ amount: 39 }).catch(e => e);
    expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
    expect(JSON.stringify(error.details)).not.toMatch(/2009|underage|age_missing|activity|secret/i);
  });
  it('an adult buyer without a selling declaration accepts a seller counter-offer with real article roles', async () => {
    const proposal = await send({ requestId: 'counter', originalMessageId: 'offer', counterKind: 'price', amount: 45 }, 'seller');
    await accept('buyer', proposal.messageId);
    expect(fs.getDoc('transactions/meetup_' + proposal.messageId)).toMatchObject({ buyerId: 'buyer', sellerId: 'seller', amount: 45 });
  });
  it('new proposal refuses review-blocked counterpart without exposing its private case', async () => {
    sellerProblem('review'); const error = await send({ amount: 39 }).catch(e => e);
    expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
    expect(JSON.stringify(error.details)).not.toMatch(/privateCase|review_required/); expect(fs.writeOps).toHaveLength(0);
  });
  it('a legacy publication marker without fingerprint opens the owned document rather than silently admitting changed inputs', async () => {
    const created = await publish(), article = fs.getDoc('articles/' + created.articleId)!;
    delete article.publicationRequestHash; fs.setDoc('articles/' + created.articleId, article);
    const count = fs.writeOps.length;
    await expect(publish()).rejects.toMatchObject({ code: 'failed-precondition', details: { action: 'openExistingArticle', articleId: created.articleId } });
    expect(fs.writeOps).toHaveLength(count); expect(holder.copies).toBe(1);
  });
  it('legacy proposal marker is checked against the owned actual message before suggesting consultation', async () => {
    const sent = await send(), marker = fs.getDoc('meetup_offer_requests/new_proposal')!;
    delete marker.inputHash; fs.setDoc('meetup_offer_requests/new_proposal', marker);
    const count = fs.writeOps.length;
    await expect(send()).rejects.toMatchObject({ code: 'failed-precondition', details: { action: 'openExistingOffer', messageId: sent.messageId } });
    expect(fs.writeOps).toHaveLength(count);
    fs.setDoc('messages/' + sent.messageId, { ...fs.getDoc('messages/' + sent.messageId), senderId: 'other' });
    await expect(send()).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('existing pending terms are a read/alias replay; missing proof cannot turn changed terms into a new proposal', async () => {
    const created = await send(); fs.setDoc('users/buyer', {});
    const repeated = await send({ requestId: 'alias' });
    expect(repeated).toMatchObject({ messageId: created.messageId, reused: true });
    expect(fs.getDoc('messages/alias')).toBeUndefined();
    await expect(send({ requestId: 'new_terms', amount: 39 })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.getDoc('messages/new_terms')).toBeUndefined();
  });
  it('professional or undeclared adult buyer may buy a personal adult seller in Ontario', async () => {
    personal('buyer', 'professional');
    const sent = await send(); await accept('seller', sent.messageId);
    expect(fs.getDoc('transactions/meetup_' + sent.messageId)).toMatchObject({ sellerId: 'seller', buyerId: 'buyer' });
    expect(fs.getDoc('users/seller')!.shopTier).toBe('pro');
  });
  it.each(['minor', 'professional', 'review'])('source becomes seller %s during media preparation: commit refused, preliminary copy accurately counted', async problem => {
    holder.promote = () => sellerProblem(problem);
    await expect(publish()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(holder.copies).toBe(1); expect((await fs.db.collection('articles').get()).size).toBe(1);
    expect(fs.writeOps).toHaveLength(0);
  });
  it('commercial image edit repeats admission at final commit after provider work', async () => {
    holder.promote = () => sellerProblem('professional');
    await expect(call(updateArticle, { articleId: 'article', updates: { images: [{ url: image }] } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(holder.copies).toBe(1); expect(fs.getDoc('articles/article')!.images).toBeUndefined();
  });
  it('exact publication replay reads its existing article even after evidence missing; changed payload same key is refused', async () => {
    const created = await publish(); fs.setDoc('users/seller', {}); fs.setDoc('eligibility_profiles/seller', null);
    const count = fs.writeOps.length;
    expect(await publish()).toEqual(created); expect(fs.writeOps).toHaveLength(count); expect(holder.copies).toBe(1);
    await expect(call(createArticle, { ...publishData, price: 49 })).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('exact proposal replay survives missing proof, changed payload same ID never becomes another offer', async () => {
    const sent = await send(); fs.setDoc('users/buyer', {}); const count = fs.writeOps.length;
    expect((await send()).messageId).toBe(sent.messageId); expect(fs.writeOps).toHaveLength(count);
    await expect(send({ amount: 39 })).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('accepted exact linked agreement replays without evidence; confirmations/fulfilment remain available', async () => {
    const accepted = await accept(); fs.setDoc('users/buyer', {}); fs.setDoc('users/seller', {}); fs.setDoc('eligibility_profiles/seller', null);
    const count = fs.writeOps.length; expect((await accept()).transactionId).toBe(accepted.transactionId); expect(fs.writeOps).toHaveLength(count);
    await call(confirmMeetupTransaction, { transactionId: accepted.transactionId, messageId: 'offer' });
    await call(completeMeetupTransaction, { transactionId: accepted.transactionId }, 'buyer');
    expect(fs.getDoc('transactions/' + accepted.transactionId)!.status).toBe('meetup_completed');
  });
  it('pending legacy reservation alone cannot exempt the first bilateral acceptance', async () => {
    const spot = normalizeMeetupLocation(location);
    fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), isSold: true, activeTransactionId: 'legacy' });
    fs.setDoc('transactions/legacy', { articleId: 'article', buyerId: 'buyer', sellerId: 'seller', chatId: 'chat',
      deliveryType: 'meetup', status: 'meetup_pending', amount: 40, meetupSpot: spot });
    fs.setDoc('users/buyer', {});
    await expect(accept()).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
    expect(fs.getDoc('transactions/legacy')!.offerMessageId).toBeUndefined(); expect(fs.writeOps).toHaveLength(0);
  });
  it('standalone deactivation and marking sold preserve historical access without seller evidence', async () => {
    fs.setDoc('users/seller', {}); fs.setDoc('eligibility_profiles/seller', null);
    await call(updateArticle, { articleId: 'article', updates: { isActive: false } });
    fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), isActive: true });
    await call(toggleArticleSold, soldInput(true));
    expect(fs.getDoc('articles/article')!.isSold).toBe(true);
  });
  it.each([{ bankDispute: { id: 'du', state: 'closed', outcome: 'won', reconciliationRequired: true } }, { refundBlocked: true }])('a terminal-looking order with an independent unresolved obligation cannot be used to clear/relist its article %j', async obligation => {
    fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), isSold: true, activeTransactionId: 'old' });
    fs.setDoc('transactions/old', { articleId: 'article', status: 'refunded', ...obligation });
    await expect(call(toggleArticleSold, soldInput(false))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('articles/article')!.isSold).toBe(true); expect(fs.writeOps).toHaveLength(0);
  });
  it('an unresolved article pointer outside its article query cannot be stolen by a new acceptance', async () => {
    fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), activeTransactionId: 'missing_index' });
    fs.setDoc('transactions/missing_index', { status: 'meetup_pending', buyerId: 'different' });
    await expect(accept()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('articles/article')!.activeTransactionId).toBe('missing_index');
  });
  it.each([{ walletAmountUsed: 100 }, { walletAmountUsed: 'unknown' }, { stripePaymentIntentId: 'pi_unproven' }, { paidVia: 'mixed' }])('legacy cash adoption does not pretend a financial marker is safe %j', async marker => {
    fs.setDoc('transactions/legacy', { articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', deliveryType: 'meetup',
      status: 'meetup_pending', amount: 40, meetupSpot: normalizeMeetupLocation(location), ...marker });
    await expect(accept()).rejects.toMatchObject({ code: 'failed-precondition' }); expect(fs.writeOps).toHaveLength(0);
  });
  it('old no-show reporting is available without any new admission proof', async () => {
    fs.setDoc('users/seller', {}); fs.setDoc('users/buyer', {});
    fs.setDoc('transactions/old', { sellerId: 'seller', buyerId: 'buyer', articleId: 'article', chatId: 'chat',
      deliveryType: 'meetup', status: 'meetup_confirmed' });
    await call(reportMeetupNoShow, { transactionId: 'old', reason: 'not_present' }, 'buyer');
    expect(fs.getDoc('transactions/old')!.status).toBe('disputed');
  });
  it('publication and commercial edits do not create new activity for an inactive seller profile', async () => {
    fs.setDoc('users/seller', { dateOfBirth: '2000-01-01', isActive: false });
    await expect(publish()).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable' } });
    await expect(call(updateArticle, { articleId: 'article', updates: { price: 45 } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0); expect(holder.copies).toBe(0);
  });
  it('an exact request cannot reuse a previous offer after its chat article context changed', async () => {
    await send({ amount: 39 });
    fs.setDoc('articles/other_article', { sellerId: 'seller', price: 50, isActive: true, isSold: false });
    fs.setDoc('chats/chat', { articleId: 'other_article', participants: ['seller', 'buyer'] });
    const count = fs.writeOps.length;
    await expect(send({ amount: 39 })).rejects.toMatchObject({ code: 'failed-precondition' }); expect(fs.writeOps).toHaveLength(count);
  });
  it('acceptance rejects a stored offer whose explicit article or buyer contradicts the authoritative roles', async () => {
    fs.setDoc('messages/offer', { ...fs.getDoc('messages/offer'), offer: { ...(fs.getDoc('messages/offer')!.offer as any), articleId: 'different_article', buyerId: 'buyer' } });
    await expect(accept()).rejects.toMatchObject({ code: 'failed-precondition' }); expect(fs.writeOps).toHaveLength(0);
  });
});
