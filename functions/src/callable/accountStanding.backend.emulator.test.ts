/** Actual Admin SDK and handlers.run, isolated Standard demo-second only.
 * Auth context, rate limit, media, brands, notifications and analytics simulated.
 * No Auth suspension, provider, GCS upload or device is exercised. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
const enabled = process.env.SECOND_ACCOUNT_STANDING_BACKEND_SDK === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('Standard demo-second loopback required');
const h = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, prepare: null as null | (() => Promise<void>), media: 0 }));
vi.mock('../config/firebase', () => ({ get db() { return h.db!; }, FieldValue, storage: {} }));
vi.mock('../utils/articleMedia', () => ({ promoteArticleImages: async (images: any, _uid: string, id: string) => {
  h.media++; if (h.prepare) await h.prepare();
  return images.map((image: any) => ({ ...image, url: `https://firebasestorage.googleapis.com/v0/b/demo-second.firebasestorage.app/o/articles%2F${id}%2Flocal.jpg?alt=media` }));
} }));
vi.mock('../services/brands', () => ({ matchBrand: async () => ({ brandName: null }), BRAND_MATCHING: { autoSelectThreshold: 1 } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { sendMeetupProposal } from './offers';
import { createArticle } from './products';
import { acceptMeetupOffer } from './payments/meetup';
import { getMyEligibility } from './eligibility';
import { captureConnectObservationBarrier, observeConnectAccount } from '../utils/connectEligibility';
import { readReservedShippingPurchase } from '../utils/reservedShippingPurchase';
import { personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
const seller = 'as_backend_seller', buyer = 'as_backend_buyer', article = 'as_backend_article', chat = 'as_backend_chat', old = 'as_backend_old', refunded = 'as_backend_refunded';
const call = (fn: any, data: any, uid = buyer) => fn.run({ auth: { uid, token: { email_verified: true } }, data });
const send = (id: string, uid = buyer, amount = 40) => call(sendMeetupProposal, { chatId: chat, requestId: id, amount, location: { toArrange: true } }, uid);
const pub = { clientRequestId: 'as_backend_publication', title: 'Article local', price: 50, categoryIds: ['women'], isHandDelivery: true,
  neighborhoods: [{ id: 'local', name: 'Quartier', borough: 'Ville' }], images: [{ url: `https://firebasestorage.googleapis.com/v0/b/demo-second.firebasestorage.app/o/drafts%2F${seller}%2Fd%2Flocal.jpg?alt=media` }] };
const published = createHash('sha256').update(`${seller}:${pub.clientRequestId}`).digest('hex').slice(0, 20);
const malformed = [false, null, 'active', 1, {}, { value: true }, []].map(isActive => ({ isActive }));
describe.skipIf(!enabled)('ACCOUNT_STANDING backend native admission and preserved obligations', () => {
  let app: ReturnType<typeof initializeApp>;
  async function native(path: string) { const snap = await h.db!.doc(path).get(); return { path, id: snap.id, data: snap.data(), updateTime: snap.updateTime }; }
  async function economy() {
    return { docs: await Promise.all([`wallets/${seller}`, `wallets/${buyer}`, `transactions/${old}`, `transactions/${refunded}`].map(native)),
      ledgers: await Promise.all([seller, buyer].map(async uid => ({ uid, docs: (await h.db!.collection(`wallets/${uid}/ledger`).get()).docs.map(d => ({ id: d.id, data: d.data(), updateTime: d.updateTime })).sort((a, b) => a.id.localeCompare(b.id)) }))) };
  }
  async function clean() {
    if (!h.db) return;
    for (const collection of ['messages', 'meetup_offer_requests']) for (const d of (await h.db.collection(collection).where('chatId', '==', chat).get()).docs) await d.ref.delete();
    for (const collection of ['transactions', 'meetup_offer_threads']) for (const d of (await h.db.collection(collection).where('articleId', '==', article).get()).docs) await d.ref.delete();
    for (const uid of [seller, buyer]) for (const d of (await h.db.collection(`wallets/${uid}/ledger`).get()).docs) await d.ref.delete();
    for (const path of [`users/${seller}`, `users/${buyer}`, `eligibility_profiles/${seller}`, `eligibility_profiles/${buyer}`, `articles/${article}`, `articles/${published}`, `chats/${chat}`, `wallets/${seller}`, `wallets/${buyer}`, `transactions/${old}`, `transactions/${refunded}`, 'shipping_quotes/as_backend_quote']) await h.db.doc(path).delete();
  }
  beforeAll(() => { app = initializeApp({ projectId: 'demo-second' }, 'account-standing-backend'); h.db = getFirestore(app); });
  beforeEach(async () => {
    await clean(); h.prepare = null; h.media = 0;
    for (const uid of [seller, buyer]) await h.db!.doc(`users/${uid}`).set({ id: uid, email: `${uid}@example.test`, displayName: 'Compte', dateOfBirth: '2000-01-01', isActive: true });
    await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller));
    await h.db!.doc(`articles/${article}`).set({ sellerId: seller, price: 50, isActive: true, isSold: false, isHandDelivery: true });
    await h.db!.doc(`chats/${chat}`).set({ participants: [buyer, seller], articleId: article });
    for (const uid of [buyer, seller]) {
      await h.db!.doc(`wallets/${uid}`).set({ balance: 12345, pendingBalance: 9876, heldBalance: 4567, currency: 'CAD', status: 'active' });
      await h.db!.doc(`wallets/${uid}/ledger/old`).set({ type: uid === buyer ? 'purchase_debit' : 'sale_pending', transactionId: old, amount: 1200, createdAt: FieldValue.serverTimestamp() });
    }
    await h.db!.doc(`transactions/${old}`).set({ buyerId: buyer, sellerId: seller, articleId: 'old_other', status: 'delivered', shippingAddress: { country: 'CA', province: 'ON' }, totalAmount: 12, createdAt: FieldValue.serverTimestamp() });
    await h.db!.doc(`transactions/${refunded}`).set({ buyerId: buyer, sellerId: seller, articleId: 'refund_other', status: 'refunded', totalAmount: 12, bankDispute: { reconciliationRequired: true }, refund: { providerStatus: 'pending', outstandingCardCents: 1200 }, createdAt: FieldValue.serverTimestamp() });
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });

  for (const uid of [buyer, seller]) {
    const scope = uid === buyer ? 'buy' : 'sell', other = uid === buyer ? seller : buyer;
    it.each(malformed)(scope + ' new actor operation refuses own present malformed %j', async ({ isActive }) => {
      await h.db!.doc(`users/${uid}`).update({ isActive }); const before = await economy(), user = await native(`users/${uid}`);
      await expect(send('as_backend_new', uid)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect((await native('messages/as_backend_new')).data).toBeUndefined(); expect(await native(`users/${uid}`)).toEqual(user); expect(await economy()).toEqual(before);
    });
    it.each(malformed)(scope + ' counterpart present malformed %j stays private', async ({ isActive }) => {
      await h.db!.doc(`users/${other}`).update({ isActive }); const before = await economy(), user = await native(`users/${other}`);
      const error = await send('as_backend_new', uid).catch((e: any) => e);
      expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
      expect(JSON.stringify(error.details)).not.toMatch(/isActive|account_unavailable|2000|dateOfBirth/);
      expect((await native('messages/as_backend_new')).data).toBeUndefined(); expect(await native(`users/${other}`)).toEqual(user); expect(await economy()).toEqual(before);
    });
    it(scope + ' exact proposal receipt and getter stay available with malformed present standing', async () => {
      const receipt = await send('as_backend_receipt', uid); await h.db!.doc(`users/${uid}`).update({ isActive: null });
      const before = await economy(), message = await native(`messages/${receipt.messageId}`);
      expect(await send('as_backend_receipt', uid)).toMatchObject({ messageId: receipt.messageId, reused: true });
      expect(await call(getMyEligibility, {}, uid)).toHaveProperty('version');
      await expect(send('as_backend_changed', uid, 39)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect(await native(`messages/${receipt.messageId}`)).toEqual(message); expect(await economy()).toEqual(before);
    });
  }
  for (const stage of ['preflight', 'lastCommit']) it.each(malformed)('publication ' + stage + ' refuses %j and preserves native money', async ({ isActive }) => {
    if (stage === 'preflight') await h.db!.doc(`users/${seller}`).update({ isActive });
    else h.prepare = async () => { await h.db!.doc(`users/${seller}`).update({ isActive }); };
    const before = await economy(); await expect(call(createArticle, pub, seller)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope: 'sell' } });
    expect(h.media).toBe(stage === 'preflight' ? 0 : 1); expect((await native(`articles/${published}`)).data).toBeUndefined(); expect(await economy()).toEqual(before);
    expect((await native(`users/${seller}`)).data).toMatchObject({ isActive, dateOfBirth: '2000-01-01' });
  });
  it.each([true, 'absent'])('active/legacy %s permits new valid operation without normalizing standing', async standing => {
    if (standing === 'absent') for (const uid of [buyer, seller]) await h.db!.doc(`users/${uid}`).update({ isActive: FieldValue.delete() });
    const before = await economy(), users = await Promise.all([buyer, seller].map(uid => native(`users/${uid}`)));
    const proposal = await send('as_backend_valid'); expect(proposal).toMatchObject({ success: true, reused: false });
    expect((await native(`messages/${proposal.messageId}`)).data).toBeDefined(); const created = await call(createArticle, pub, seller);
    expect((await native(`articles/${created.articleId}`)).data).toBeDefined(); expect(await economy()).toEqual(before);
    expect(await Promise.all([buyer, seller].map(uid => native(`users/${uid}`)))).toEqual(users);
  });
  it('exact accepted agreement and publication replay do not become new admissions', async () => {
    const proposal = await send('as_backend_accept'), accepted = await call(acceptMeetupOffer, { chatId: chat, messageId: proposal.messageId }, seller);
    const created = await call(createArticle, pub, seller);
    await h.db!.doc(`users/${seller}`).update({ isActive: { malformed: true } }); await h.db!.doc(`users/${buyer}`).update({ isActive: null });
    const before = await economy(), order = await native(`transactions/${accepted.transactionId}`), message = await native(`messages/${proposal.messageId}`), publication = await native(`articles/${created.articleId}`), media = h.media;
    expect(await call(acceptMeetupOffer, { chatId: chat, messageId: proposal.messageId }, seller)).toMatchObject({ transactionId: accepted.transactionId, reused: true });
    expect(await call(createArticle, pub, seller)).toEqual(created); expect(h.media).toBe(media);
    expect(await native(`transactions/${accepted.transactionId}`)).toEqual(order); expect(await native(`messages/${proposal.messageId}`)).toEqual(message);
    expect(await native(`articles/${created.articleId}`)).toEqual(publication); expect(await economy()).toEqual(before);
  });
  it.each([null, 'active', 1, { active: true }])('Connect observation at final commit preserves linked obligations but refuses malformed %j', async isActive => {
    await h.db!.doc(`users/${seller}`).update({ stripeAccountId: 'acct_as_backend' }); const barrier = await captureConnectObservationBarrier(seller, 'acct_as_backend');
    await h.db!.doc(`users/${seller}`).update({ isActive }); const before = await economy();
    const account = { id: 'acct_as_backend', type: 'custom', business_type: 'individual', country: 'CA', metadata: { firebaseUserId: seller }, charges_enabled: true, payouts_enabled: true, details_submitted: true,
      requirements: { currently_due: [], past_due: [] }, external_accounts: { data: [] }, individual: { dob: { year: 2000, month: 1, day: 1 }, address: { line1: '123 Rue locale', city: 'Montréal', state: 'QC', postal_code: 'H2X1A1', country: 'CA' } } };
    const result = await observeConnectAccount(seller, account, { expectedId: account.id, barrier }); expect(result.admission.allowed).toBe(false);
    expect((await native(`eligibility_profiles/${seller}`)).data!.sellerQuebecEvidence.reasons).toContain('account_inactive');
    expect((await native(`users/${seller}`)).data).toMatchObject({ isActive, stripeAccountId: account.id, dateOfBirth: '2000-01-01' }); expect(await economy()).toEqual(before);
  });
  for (const uid of [buyer, seller]) it.each([null, 'active', 1, { active: true }])('reserved canonical new payment ' + uid + ' refuses malformed %j before financial writes', async isActive => {
    const id = 'as_backend_reserved', quote = 'as_backend_quote';
    await h.db!.doc(`articles/${article}`).update({ isSold: true, isShipping: true, activeTransactionId: id });
    await h.db!.doc(`shipping_quotes/${quote}`).set({ schemaVersion: 1, state: 'claimed', transactionId: id, ownerId: buyer, articleId: article, sellerId: seller, acceptedRateId: 'rate', acceptedTotal: 50 });
    await h.db!.doc(`users/${uid}`).update({ isActive }); const before = await economy(), item = await native(`articles/${article}`), acceptedQuote = await native(`shipping_quotes/${quote}`);
    const order = { sellerId: seller, articleId: article, shippingQuoteId: quote, shipEngineRateId: 'rate', totalAmount: 50 };
    await expect(h.db!.runTransaction(tx => readReservedShippingPurchase(tx, buyer, id, order, true))).rejects.toMatchObject({ code: uid === buyer ? 'permission-denied' : 'failed-precondition', details: { reason: uid === buyer ? 'account_unavailable' : 'counterparty_unavailable' } });
    expect(await native(`articles/${article}`)).toEqual(item); expect(await native(`shipping_quotes/${quote}`)).toEqual(acceptedQuote); expect(await economy()).toEqual(before);
  });
});
