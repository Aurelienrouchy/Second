/** Real Admin SDK, local demo project. Stripe/ShipEngine IO simulated. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_SHIPPING_PURCHASE_SDK === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('03B3a SDK only demo-second loopback');
const h = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, post: null as any, get: null as any }));
vi.mock('../config/firebase', () => ({ get db() { return h.db!; }, FieldValue }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: async () => purchaseAccount('sdk_shipping_seller') } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: (...args: any[]) => h.post(...args), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args) }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { quoteShippingPurchase, setArticleShippingParcel, getArticleShippingParcel } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { purchaseAccount, purchaseAddress, purchaseRates, personalProfile, purchaseParcel } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
const articleId = 'sdk_shipping_article', seller = 'sdk_shipping_seller', buyer = 'sdk_shipping_buyer';
const call = (fn: any, data: any, uid = buyer) => fn.run({ auth: { uid, token: {} }, data });
const quote = (uid = buyer) => call(quoteShippingPurchase, { articleId, shippingAddress: purchaseAddress }, uid);
const reserve = (q: any, uid = buyer) => call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount }, uid);
function gate() { let reached!: () => void, release!: () => void; const at = new Promise<void>(r => { reached = r; }), wait = new Promise<void>(r => { release = r; }); return { reached, release, at, wait }; }
describe.skipIf(!enabled)('03B3a real SDK source fences and atomic reservation', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'shipping_purchase_03b3a') : null;
  beforeAll(() => { if (app) h.db = getFirestore(app); });
  async function clean() {
    if (!h.db) return;
    for (const collection of ['shipping_quotes', 'transactions']) {
      const docs = await h.db.collection(collection).where('articleId', '==', articleId).get();
      for (const d of docs.docs) await d.ref.delete();
    }
    for (const path of [`wallets/${seller}`, `wallets/${seller}/ledger/03b3a_existing`, `articles/${articleId}`, `shipping_packages/${articleId}`, ...[buyer, buyer + '_2', seller].flatMap(uid => [`users/${uid}`, `eligibility_profiles/${uid}`])]) await h.db.doc(path).delete();
  }
  beforeEach(async () => {
    await clean(); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true');
    await h.db!.doc(`articles/${articleId}`).set({ sellerId: seller, price: 50, title: 'Manteau', isActive: true, isSold: false, isShipping: true });
    await h.db!.doc(`users/${seller}`).set({ dateOfBirth: '2000-01-01', isActive: true, displayName: 'Seller', stripeAccountId: 'acct_purchase', stripeChargesEnabled: true,
      addresses: [{ ...purchaseAddress, name: 'Seller', street: '999 Origine privée', isDefault: true }] });
    await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller));
    for (const uid of [buyer, buyer + '_2']) await h.db!.doc(`users/${uid}`).set({ dateOfBirth: '2000-01-01', isActive: true });
    await h.db!.doc(`shipping_packages/${articleId}`).set({ schemaVersion: 1, ownerId: seller, articleId, version: 1, source: 'seller_declared', measurementVerified: false, parcel: purchaseParcel });
    h.post = h.get = async () => purchaseRates();
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); vi.unstubAllEnvs(); });
  const orders = () => h.db!.collection('transactions').where('articleId', '==', articleId).get();
  it('quote and exact reservation/replay use real SDK queries and snapshots; no financial writes', async () => {
    const q = await quote(), result = await reserve(q);
    expect(result).toMatchObject({ success: true, replay: false, paymentPermissionGranted: false });
    const order = (await h.db!.doc(`transactions/${result.transactionId}`).get()).data()!;
    expect(order).toMatchObject({ totalAmount: 64.75, shippingSnapshot: { origin: { street: '999 Origine privée' }, parcel: purchaseParcel }, articleSnapshot: { title: 'Manteau' } });
    expect(await reserve(q)).toMatchObject({ transactionId: result.transactionId, replay: true }); expect((await orders()).size).toBe(1);
    expect((await h.db!.doc(`articles/${articleId}`).get()).data()!.activeTransactionId).toBe(result.transactionId);
    expect((await h.db!.doc(`wallets/${buyer}`).get()).exists).toBe(false);
  });
  it('two buyers with exact quotes cannot both reserve; losing source is refused, not charged', async () => {
    const qa = await quote(), qb = await quote(buyer + '_2'); const g = gate(); let first = true;
    h.get = async () => { if (first) { first = false; g.reached(); await g.wait; } return purchaseRates(); };
    const a = reserve(qa); const settledA = a.then(r => ({ r }), e => ({ e })); await g.at;
    const b = await reserve(qb, buyer + '_2'); g.release(); expect(await settledA).toHaveProperty('e');
    expect((await orders()).size).toBe(1); expect((await h.db!.doc(`articles/${articleId}`).get()).data()!.activeTransactionId).toBe(b.transactionId);
  });
  it('buyer DOB changes during POST: no private ready quote/order/reservation', async () => {
    h.post = async () => { await h.db!.doc(`users/${buyer}`).update({ dateOfBirth: '2009-01-01' }); return purchaseRates(); };
    await expect(quote()).rejects.toMatchObject({ code: 'permission-denied' }); expect((await orders()).empty).toBe(true);
    expect((await h.db!.collection('shipping_quotes').where('articleId', '==', articleId).get()).empty).toBe(true);
    expect((await h.db!.doc(`articles/${articleId}`).get()).data()!.isSold).toBe(false);
  });
  it('price/address changes during GET: quote cannot authorize old source', async () => {
    const q = await quote(); h.get = async () => { await h.db!.doc(`users/${seller}`).update({ addresses: [{ ...purchaseAddress, street: 'CHANGED' }] }); return purchaseRates(); };
    await expect(reserve(q)).rejects.toMatchObject({ code: 'aborted' }); expect((await orders()).empty).toBe(true);
    expect((await h.db!.doc(`articles/${articleId}`).get()).data()!.isSold).toBe(false);
  });
  it('account invalidation during GET fences same identity and preserves private controls', async () => {
    const q = await quote(); await h.db!.doc(`eligibility_profiles/${seller}`).update({ signals: { preserved: { active: true, scope: 'buy', internalNote: 'PRIVATE' } } });
    h.get = async () => { await invalidateConnectObservation(seller, 'acct_purchase', { stripeChargesEnabled: false }); return purchaseRates(); };
    await expect(reserve(q)).rejects.toBeDefined(); expect((await orders()).empty).toBe(true);
    expect((await h.db!.doc(`eligibility_profiles/${seller}`).get()).data()!.signals.preserved.internalNote).toBe('PRIVATE');
  });
  it('parcel setting serializes versions on actual SDK without reserving an order', async () => {
    const results = await Promise.allSettled(['a', 'b'].map(requestId => call(setArticleShippingParcel, { articleId, requestId, expectedVersion: 1, parcel: purchaseParcel }, seller)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await h.db!.doc(`shipping_packages/${articleId}`).get()).data()!.version).toBe(2);
    expect((await orders()).empty).toBe(true); expect((await h.db!.doc(`articles/${articleId}`).get()).data()!.isSold).toBe(false);
  });
  it('real legacy order outside Quebec, wallet and ledger survive consultation with missing DOB/flags OFF', async () => {
    const oldRef = h.db!.doc('transactions/sdk_03b3a_old'), walletRef = h.db!.doc(`wallets/${seller}`), ledgerRef = h.db!.doc(`wallets/${seller}/ledger/03b3a_existing`);
    await oldRef.set({ articleId, buyerId: buyer, sellerId: seller, deliveryType: 'shipping', status: 'disputed',
      shippingAddress: { country: 'CA', province: 'ON', street: 'Old authorized address' }, amount: 35, totalAmount: 44,
      stripePaymentIntentId: 'pi_preserved_old', bankDispute: { id: 'dp_preserved', state: 'open' }, refundBlocked: true });
    await walletRef.set({ balance: 7000, pendingBalance: 9000, heldBalance: 1000 });
    await ledgerRef.set({ transactionId: 'sdk_03b3a_old', amount: 3500, type: 'sale_pending', createdAt: FieldValue.serverTimestamp() });
    await h.db!.doc(`users/${buyer}`).update({ dateOfBirth: null }); await h.db!.doc(`users/${seller}`).update({ dateOfBirth: null, isActive: false });
    await h.db!.doc(`articles/${articleId}`).update({ isSold: true, activeTransactionId: oldRef.id });
    vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('SHIPPING_ENABLED', 'false');
    const before = await Promise.all([oldRef, walletRef, ledgerRef].map(async ref => (await ref.get()).data()));
    expect(await call(createTransaction, { existingTransactionId: oldRef.id })).toMatchObject({ transactionId: oldRef.id, existingOrderOnly: true, paymentPermissionGranted: false });
    expect(await call(getArticleShippingParcel, { articleId }, seller)).toMatchObject({ version: 1, parcel: purchaseParcel, measurementVerified: false });
    expect(await Promise.all([oldRef, walletRef, ledgerRef].map(async ref => (await ref.get()).data()))).toEqual(before);
    expect((await orders()).size).toBe(1); await expect(quote()).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('existing SDK record with null version is examined, never normalized to genesis/replayed', async () => {
    const ref = h.db!.doc(`shipping_packages/${articleId}`); await ref.update({ version: null });
    const before = (await ref.get()).data();
    await expect(call(setArticleShippingParcel, { articleId, expectedVersion: 0, requestId: 'corrupt', parcel: purchaseParcel }, seller)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(call(getArticleShippingParcel, { articleId }, seller)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await ref.get()).data()).toEqual(before); expect((await orders()).empty).toBe(true);
    expect((await h.db!.doc(`articles/${articleId}`).get()).data()!.isSold).toBe(false);
  });

});
