/** Actual canonical quote -> claim -> wallet handler/commit, demo-second only.
 * Provider and label IO simulated; flags are scoped to this test process.
 * No production configuration, provider funds or shipping label is modified. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_ACCOUNT_STANDING_SHIPPING_SDK === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('Standard demo-second loopback required');
const h = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, get: null as any, rates: 0, labels: 0 }));
vi.mock('../config/firebase', () => ({ get db() { return h.db!; }, FieldValue }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: async () => purchaseAccount(seller) } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: async () => purchaseRates(), getPurchaseRatesForShipment: async (...args: any[]) => { h.rates++; return h.get(...args); } }) }));
vi.mock('../utils/labelFulfillment', async original => ({ ...await original<any>(), createLabelIdempotent: async () => { h.labels++; return 'failed'; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { payWithWallet } from './wallet';
import { purchaseAddress, purchaseParcel, purchaseAccount, purchaseRates, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
const seller = 'as_shipping_seller', buyer = 'as_shipping_buyer', item = 'as_shipping_article', old = 'as_shipping_old', refund = 'as_shipping_refund';
const call = (fn: any, data: any, uid = buyer) => fn.run({ auth: { uid, token: {} }, data });
const pay = (id: string) => call(payWithWallet, { transactionId: id });
describe.skipIf(!enabled)('ACCOUNT_STANDING real reserved purchase consumer', () => {
  let app: ReturnType<typeof initializeApp>;
  async function native(path: string) { const snap = await h.db!.doc(path).get(); return { path, id: snap.id, data: snap.data(), updateTime: snap.updateTime }; }
  async function ledger(uid: string) { return (await h.db!.collection(`wallets/${uid}/ledger`).get()).docs.map(d => ({ id: d.id, data: d.data(), updateTime: d.updateTime })).sort((a, b) => a.id.localeCompare(b.id)); }
  async function economy() { return { docs: await Promise.all([`wallets/${buyer}`, `wallets/${seller}`, `transactions/${old}`, `transactions/${refund}`].map(native)), ledgers: [{ uid: buyer, docs: await ledger(buyer) }, { uid: seller, docs: await ledger(seller) }] }; }
  async function reserved() {
    const quote = await call(quoteShippingPurchase, { articleId: item, shippingAddress: purchaseAddress });
    const claimed = await call(createTransaction, { deliveryType: 'shipping', quoteId: quote.quoteId, rateId: quote.rates[0].rateId, expectedTotal: quote.rates[0].totalAmount });
    return { id: claimed.transactionId as string, quoteId: quote.quoteId as string };
  }
  async function source(id: string, quoteId: string) { return Promise.all([`transactions/${id}`, `articles/${item}`, `shipping_quotes/${quoteId}`].map(native)); }
  async function clean() {
    if (!h.db) return;
    for (const uid of [buyer, seller]) for (const d of (await h.db.collection(`wallets/${uid}/ledger`).get()).docs) await d.ref.delete();
    for (const collection of ['transactions', 'shipping_quotes']) for (const d of (await h.db.collection(collection).where('articleId', '==', item).get()).docs) await d.ref.delete();
    for (const path of [`articles/${item}`, `shipping_packages/${item}`, `transactions/${old}`, `transactions/${refund}`, ...[buyer, seller].flatMap(uid => [`users/${uid}`, `wallets/${uid}`, `eligibility_profiles/${uid}`])]) await h.db.doc(path).delete();
  }
  beforeAll(() => { app = initializeApp({ projectId: 'demo-second' }, 'account-standing-shipping'); h.db = getFirestore(app); });
  beforeEach(async () => {
    await clean(); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true'); h.rates = h.labels = 0; h.get = async () => purchaseRates();
    await h.db!.doc(`articles/${item}`).set({ sellerId: seller, price: 50, title: 'Manteau', isActive: true, isShipping: true, isSold: false });
    await h.db!.doc(`users/${buyer}`).set({ dateOfBirth: '2000-01-01', isActive: true });
    await h.db!.doc(`users/${seller}`).set({ dateOfBirth: '2000-01-01', isActive: true, displayName: 'Vendeur', stripeAccountId: 'acct_purchase', stripeChargesEnabled: true, addresses: [{ ...purchaseAddress, name: 'Vendeur', isDefault: true }] });
    await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller));
    await h.db!.doc(`shipping_packages/${item}`).set({ schemaVersion: 1, ownerId: seller, articleId: item, source: 'seller_declared', measurementVerified: false, version: 1, parcel: purchaseParcel });
    for (const uid of [buyer, seller]) {
      await h.db!.doc(`wallets/${uid}`).set({ balance: 10000, pendingBalance: 9876, heldBalance: 4567, status: 'active', currency: 'CAD' });
      await h.db!.doc(`wallets/${uid}/ledger/old`).set({ type: uid === buyer ? 'purchase_debit' : 'sale_pending', transactionId: old, amount: 1200, createdAt: FieldValue.serverTimestamp() });
    }
    await h.db!.doc(`transactions/${old}`).set({ buyerId: buyer, sellerId: seller, articleId: 'old_shipping_other', status: 'delivered', shippingAddress: { country: 'CA', province: 'ON' }, totalAmount: 12, createdAt: FieldValue.serverTimestamp() });
    await h.db!.doc(`transactions/${refund}`).set({ buyerId: buyer, sellerId: seller, articleId: 'refund_shipping_other', status: 'refunded', totalAmount: 12, bankDispute: { reconciliationRequired: true }, refund: { providerStatus: 'pending', outstandingCardCents: 1200 }, createdAt: FieldValue.serverTimestamp() });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });
  for (const uid of [buyer, seller]) for (const stage of ['preflight', 'lastCommit']) {
    it.each([false, null, 'active', 1, { active: true }, []].map(isActive => ({ isActive })))(`${uid} ${stage} refuses present %j after exact real reservation without financial mutation`, async ({ isActive }) => {
      const { id, quoteId } = await reserved();
      const ratesBeforePayment = h.rates;
      if (stage === 'preflight') await h.db!.doc(`users/${uid}`).update({ isActive });
      else h.get = async () => { await h.db!.doc(`users/${uid}`).update({ isActive }); return purchaseRates(); };
      const before = await economy(), agreed = await source(id, quoteId);
      const error = await pay(id).catch((e: any) => e);
      expect(error).toMatchObject({ code: uid === buyer ? 'permission-denied' : 'failed-precondition', details: { reason: uid === buyer ? 'account_unavailable' : 'counterparty_unavailable' } });
      if (uid === seller) expect(JSON.stringify(error.details)).not.toMatch(/isActive|account_unavailable|dateOfBirth|2000/);
      expect(h.rates - ratesBeforePayment).toBe(stage === 'lastCommit' ? 1 : 0); expect(h.labels).toBe(0);
      expect((await native(`users/${uid}`)).data).toMatchObject({ isActive, dateOfBirth: '2000-01-01' });
      expect(await economy()).toEqual(before); expect(await source(id, quoteId)).toEqual(agreed);
    });
  }
  it.each([true, 'absent'])('active/legacy %s still admits valid seller/origin/destination QC and exact receipt survives malformed status', async standing => {
    if (standing === 'absent') for (const uid of [buyer, seller]) await h.db!.doc(`users/${uid}`).update({ isActive: FieldValue.delete() });
    const { id, quoteId } = await reserved(); const preservedPaths = [`wallets/${seller}`, `transactions/${old}`, `transactions/${refund}`], preserved = await Promise.all(preservedPaths.map(native)), oldSellerLedger = await ledger(seller);
    const result = await pay(id); expect(result).toMatchObject({ success: true, newBalance: 3525, paymentCommitted: true, replay: false });
    const paid = await native(`transactions/${id}`); expect(paid.data).toMatchObject({ status: 'paid', walletAmountUsed: 6475 });
    const debit = (await h.db!.collection(`wallets/${buyer}/ledger`).where('transactionId', '==', id).get()).docs;
    expect(debit).toHaveLength(1); expect(debit[0].data()).toMatchObject({ type: 'purchase_debit', amount: 6475, balanceAfter: 3525 });
    expect(await Promise.all(preservedPaths.map(native))).toEqual(preserved); expect(await ledger(seller)).toEqual(oldSellerLedger);
    if (standing === 'absent') for (const uid of [buyer, seller]) expect((await native(`users/${uid}`)).data).not.toHaveProperty('isActive');
    await h.db!.doc(`users/${buyer}`).update({ isActive: null }); await h.db!.doc(`users/${seller}`).update({ isActive: { malformed: true } });
    vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('SHIPPING_ENABLED', 'false'); const before = await economy(), agreed = await source(id, quoteId), rates = h.rates, labels = h.labels;
    expect(await pay(id)).toMatchObject({ replay: true, paymentCommitted: true, currentStatus: 'paid', newBalance: 3525 });
    expect(await economy()).toEqual(before); expect(await source(id, quoteId)).toEqual(agreed); expect(h.rates).toBe(rates); expect(h.labels).toBe(labels);
  });
});
