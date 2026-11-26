import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const h = await vi.hoisted(async () => {
  const { createFirestoreMock } = await import('../utils/testHelpers/firestoreMock');
  return { fs: createFirestoreMock({ enforceReadBeforeWrite: true }) };
});
const fs = h.fs;
vi.mock('../config/firebase', () => ({ get db() { return h.fs!.db; }, get FieldValue() {
  return { ...h.fs!.FieldValue, serverTimestamp: () => Timestamp.now() };
} }));
vi.mock('../utils/privateAccountSession', () => ({ assertPrivateAccountSession: async () => {}, withPrivateAccountSession: async (_r: unknown, fn: () => unknown) => fn() }));
vi.mock('../utils/businessAdmission', () => ({ assertNewBusinessAdmission: async () => {} }));
vi.mock('../utils/financialRecoveryInterlock', async original => ({ ...await original<any>(), withFinancialRecoveryScope: async (_d: unknown, fn: () => unknown) => fn() }));
vi.mock('../utils/financialRecoverySources', () => ({ financialRecoveryCommitCheckpoint: () => async () => {} }));
vi.mock('../utils/inventoryUnit', () => ({ assertInventoryAvailable: async () => {} }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
import { sendShippingOffer, respondShippingOffer } from './shippingOffers';
import { readAcceptedShippingOffer, shippingPriceSourceHash, shippingOfferListingHash } from '../utils/shippingOffers';
import { recordArticleListingContent } from '../utils/articleSaleDeclaration';
import { assertNewMeetupAdmission } from '../utils/tradeAdmission';
import { captureSellerActivityAdmission } from '../utils/eligibility';
const call = (fn: any, data: any, uid = 'buyer') => fn.run({ auth: { uid, token: {} }, data });
const send = (requestId = 'offer1', amount = 40, extra = {}, uid = 'buyer') => call(sendShippingOffer, { chatId: 'chat1', requestId, amount, ...extra }, uid);
const respond = (action = 'accept', messageId = 'offer1', uid = 'seller') => call(respondShippingOffer, { chatId: 'chat1', messageId, action }, uid);
const article = () => fs.getDoc('articles/article')!;
const read = (messageId: unknown = 'offer1', extra = {}) => fs.db.runTransaction(tx => readAcceptedShippingOffer(tx as never,
  { buyerId: 'buyer', articleId: 'article', article: article(), messageId, chatId: 'chat1', ...extra }));
beforeEach(() => {
  fs.reset(); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true');
  const data = { sellerId: 'seller', price: 50, title: 'Manteau', description: 'Bon état', categoryIds: ['women','women_clothing','women_clothing_sweaters','women_clothing_sweaters_hoodies'],
    images: ['image'], quantity: 1, isActive: true, isSold: false, isShipping: true, isHandDelivery: true };
  fs.setDoc('articles/article', { ...data, saleDeclaration: recordArticleListingContent('article', data, 'seller', 'a'.repeat(64), null) });
  fs.setDoc('users/seller', { isActive: true, dateOfBirth: '2000-01-01' });
  fs.setDoc('users/buyer', { isActive: true, dateOfBirth: '2000-01-01' });
  fs.setDoc('chats/chat1', { participants: ['buyer','seller'], articleId: 'article', unreadCount: { buyer: 0, seller: 0 } });
});
afterEach(() => vi.unstubAllEnvs());
describe('native postal offer and accepted price', () => {
  it('accepts a new private seller with no legacy sales questionnaire and reads the exact price', async () => {
    expect(await send()).toMatchObject({ messageId: 'offer1', amount: 40, reused: false });
    expect(await respond()).toMatchObject({ accepted: true, amount: 40, reused: false });
    const price = await read();
    expect(price).toMatchObject({ messageId: 'offer1', buyerId: 'buyer', sellerId: 'seller', amountCents: 4000 });
    expect(price.listingSourceHash).toBe(shippingOfferListingHash(article()));
    expect(shippingPriceSourceHash('base', price)).not.toBe('base');
    expect(shippingPriceSourceHash('base')).toBe('base');
  });
  it('replays send/accept without writing a second message or changing the accepted instant', async () => {
    await send(); await respond(); const before = fs.writeOps.length, accepted = (fs.getDoc('messages/offer1')!.offer as any).acceptedAt;
    expect(await send()).toMatchObject({ reused: true }); expect(await respond()).toMatchObject({ reused: true });
    expect(fs.writeOps).toHaveLength(before); expect((fs.getDoc('messages/offer1')!.offer as any).acceptedAt).toEqual(accepted);
    await expect(send('offer1', 39)).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('binds a seller counter-offer accepted by the buyer, without assuming the original sender is the buyer', async () => {
    await send(); await send('counter1', 45, { originalMessageId: 'offer1' }, 'seller');
    expect((fs.getDoc('messages/offer1')!.offer as any).status).toBe('counter_price');
    await respond('accept', 'counter1', 'buyer'); expect(await read('counter1')).toMatchObject({ amountCents: 4500 });
    await expect(read('offer1')).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('rejects another sender, buyer, chat or meetup as authorization for a postal discount', async () => {
    await send(); await expect(respond('accept', 'offer1', 'buyer')).rejects.toMatchObject({ code: 'permission-denied' });
    await respond();
    await expect(read('offer1', { buyerId: 'other' })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(read('offer1', { chatId: 'different' })).rejects.toMatchObject({ code: 'failed-precondition' });
    const message = fs.getDoc('messages/offer1')!; fs.setDoc('messages/offer1', { ...message, offer: { ...(message.offer as any), meetup: { location: {} } } });
    await expect(read()).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('rejects a changed listing, expired agreement, or another order consuming it', async () => {
    await send(); await respond(); const before = article();
    fs.setDoc('articles/article', { ...before, price: 60 }); await expect(read()).rejects.toMatchObject({ code: 'failed-precondition' }); fs.setDoc('articles/article', before);
    const message = fs.getDoc('messages/offer1')!, offer = message.offer as any;
    fs.setDoc('messages/offer1', { ...message, offer: { ...offer, transactionId: 'order1' } });
    await expect(read()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await read('offer1', { transactionId: 'order1' })).toMatchObject({ amountCents: 4000 });
    await expect(read('offer1', { transactionId: 'other' })).rejects.toMatchObject({ code: 'failed-precondition' });
    const old = Timestamp.fromMillis(Date.now() - 49 * 3600_000);
    fs.setDoc('messages/offer1', { ...message, offer: { ...offer, acceptedAt: old, expiresAt: Timestamp.fromMillis(old.toMillis() + 48 * 3600_000) } });
    await expect(read()).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('rejects once, replays that rejection and never creates an accepted price', async () => {
    await send(); expect(await respond('reject')).toMatchObject({ accepted: false, reused: false });
    expect(await respond('reject')).toMatchObject({ reused: true }); await expect(read()).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it.each([0, -1, 0.5, 40.001, 51])('rejects invalid offered amount %s', async amount => {
    await expect(send('bad', amount)).rejects.toMatchObject({ code: 'invalid-argument' }); expect(fs.getDoc('messages/bad')).toBeUndefined();
  });
  it('replaces a pending offer and refuses an expired counter-offer or replacement of a current accepted price', async () => {
    await send(); await send('offer2', 39); await expect(respond()).rejects.toMatchObject({ code: 'failed-precondition' });
    const m = fs.getDoc('messages/offer2')!; fs.setDoc('messages/offer2', { ...m, offer: { ...(m.offer as any), expiresAt: Timestamp.fromMillis(Date.now() - 1) } });
    await expect(send('counter', 40, { originalMessageId: 'offer2' }, 'seller')).rejects.toMatchObject({ code: 'failed-precondition' });
    await send('offer3', 38); await respond('accept', 'offer3'); await expect(send('offer4', 37)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('keeps the ordinary meetup admission and activity capture open for the same questionnaire-free seller', async () => {
    await fs.db.runTransaction(async tx => {
      await assertNewMeetupAdmission(tx as never, 'buyer', 'seller', 'buyer', 'article');
      const capture = await captureSellerActivityAdmission(tx as never, ['seller'], 'sell', { kind: 'purchase', id: 'order', phase: 'cash_agreement' });
      expect(capture.parties[0].admission.allowed).toBe(true);
      expect(capture.parties[0].activity.qualification).toBe('missing');
    });
  });
});
