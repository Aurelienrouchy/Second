/** Real Admin SDK / demo-second / Standard local. Auth, Stripe, fetch IO simulated. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encode } = require('/Users/aurelien/dev/Second/functions/node_modules/firebase-functions/lib/common/providers/https.js');
const enabled = process.env.SECOND_SHIPPING_PURCHASE_SDK === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('Independent SDK only demo-second loopback');
const h = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, post: null as any, get: null as any, retrieve: null as any, client: null as any }));
vi.mock('../config/firebase', () => ({ get db() { return h.db!; }, FieldValue }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) } }) }));
vi.mock('../config/shipEngine', async importOriginal => ({ ...await importOriginal<any>(), getShipEngine: () => h.client ?? ({ getPurchaseRates: (...args: any[]) => h.post(...args), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args) }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { ShipEngineClient } from '../config/shipEngine';
import { quoteShippingPurchase } from '../callable/payments/shippingPurchase';
import { createTransaction } from '../callable/payments/checkout';
import { purchaseAddress, purchaseParcel, purchaseAccount, purchaseRawRates, purchaseRates, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
const seller = 'author_03b3a_v3_seller', buyer = 'author_03b3a_v3_buyer', buyer2 = 'author_03b3a_v3_buyer2', articleId = 'author_03b3a_v3_article';
const call = (fn: any, data: any, uid = buyer) => fn.run({ auth: { uid, token: {} }, data });
const quote = (uid = buyer) => call(quoteShippingPurchase, { articleId, shippingAddress: purchaseAddress }, uid);
const reserve = (q: any, uid = buyer) => call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount }, uid);
const read = async (path: string) => (await h.db!.doc(path).get()).data();
const orders = () => h.db!.collection('transactions').where('articleId', '==', articleId).get();
describe.skipIf(!enabled)('author V3 response consistency / actual SDK', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'author_03b3a_v3_v2') : null;
  beforeAll(() => { if (app) h.db = getFirestore(app); });
  async function clean() {
    if (!h.db) return;
    for (const c of ['transactions', 'shipping_quotes']) for (const d of (await h.db.collection(c).where('articleId', '==', articleId).get()).docs) await d.ref.delete();
    for (const path of ['transactions/author_03b3a_v3_old', `articles/${articleId}`, `shipping_packages/${articleId}`, `wallets/${seller}/ledger/legacy`, `wallets/${seller}`, `wallets/${buyer}`, `wallets/${buyer2}`,
      ...[seller, buyer, buyer2].flatMap(uid => [`users/${uid}`, `eligibility_profiles/${uid}`])]) await h.db.doc(path).delete();
  }
  beforeEach(async () => {
    await clean(); vi.stubEnv('SHIPPING_ENABLED', 'true'); vi.stubEnv('PAYMENTS_ENABLED', 'true'); h.client = null;
    await h.db!.doc(`articles/${articleId}`).set({ sellerId: seller, price: 50, title: 'Manteau privé', isActive: true, isSold: false, isShipping: true });
    await h.db!.doc(`users/${seller}`).set({ dateOfBirth: '2000-01-01', isActive: true, displayName: 'Seller', stripeAccountId: 'acct_purchase', stripeChargesEnabled: true,
      addresses: [{ ...purchaseAddress, name: 'Seller', street: '999 Origine privée', isDefault: true }] });
    await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller));
    for (const uid of [buyer, buyer2]) await h.db!.doc(`users/${uid}`).set({ dateOfBirth: '2000-01-01', isActive: true, addresses: [{ ...purchaseAddress, province: 'ON', postalCode: 'M5V1A1' }] });
    await h.db!.doc(`shipping_packages/${articleId}`).set({ schemaVersion: 1, articleId, ownerId: seller, version: 1, parcel: purchaseParcel, source: 'seller_declared', measurementVerified: false });
    await h.db!.doc(`wallets/${seller}`).set({ balance: 7100, pendingBalance: 9000 });
    await h.db!.doc(`wallets/${seller}/ledger/legacy`).set({ type: 'sale_pending', amount: 1100, createdAt: FieldValue.serverTimestamp() });
    h.retrieve = async () => purchaseAccount(seller); h.post = h.get = async () => purchaseRates();
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function http(raw: any, getRaw = raw) {
    const requests: any[] = []; h.client = new ShipEngineClient({ apiKey: 'fake_local', baseUrl: 'https://example.invalid' });
    vi.stubGlobal('fetch', async (url: string, options: any) => {
      requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => url.endsWith('/carriers') ? { carriers: [{ carrier_id: 'se-carrier' }] } : options.method === 'POST' ? raw : getRaw };
    }); return requests;
  }

  it.each(['root','destination','breakdown'])('V3 SDK GET %s contradiction rejects after admissible quote, preserves full ledger/old order', async kind => {
    const raw: any = purchaseRawRates(), bad: any = purchaseRawRates();
    if (kind === 'root') bad.shipment_id = 'se-foreign';
    if (kind === 'destination') bad.ship_to = { name: 'Other', address_line1: '55 Other', city_locality: 'Toronto', state_province: 'ON', postal_code: 'M5V1A1', country_code: 'CA' };
    if (kind === 'breakdown') bad.rate_response.rates[0].rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 100 } }];
    await h.db!.doc('transactions/author_03b3a_v3_old').set({ articleId: 'author_03b3a_v3_old_article', buyerId: buyer, sellerId: seller, deliveryType: 'shipping', status: 'refunded', shippingAddress: { country: 'CA', province: 'ON' }, refundBlocked: true });
    const paths = [`wallets/${seller}`, `wallets/${seller}/ledger/legacy`, 'transactions/author_03b3a_v3_old'];
    const before = await Promise.all(paths.map(read)); http(raw, bad); const q = await quote();
    const quoteBefore = await read(`shipping_quotes/${q.quoteId}`);
    await expect(reserve(q)).rejects.toMatchObject({ code: 'unavailable' });
    expect((await orders()).empty).toBe(true); expect((await read(`articles/${articleId}`))!.isSold).toBe(false);
    expect(await read(`shipping_quotes/${q.quoteId}`)).toEqual(quoteBefore); expect(await Promise.all(paths.map(read))).toEqual(before);
    const legacy = await call(createTransaction, { existingTransactionId: 'author_03b3a_v3_old' }); expect(legacy.existingOrderOnly).toBe(true);
    await h.db!.doc('transactions/author_03b3a_v3_old').delete();
  });
  it('V3 SDK consistent signed details private; GET absent proof retained; receipt survives incompatible old qualification', async () => {
    const raw: any = purchaseRawRates(); raw.rate_response.rates[0].rate_details = [
      { rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 11.75 }, carrier_memo: 'PRIVATE' },
      { rate_detail_type: 'discount', amount: { currency: 'CAD', amount: -1 } }];
    http(raw, [purchaseRawRates().rate_response]); const q = await quote(); expect(JSON.stringify(encode(q))).not.toMatch(/PRIVATE|qualification|contexts/);
    const r = await reserve(q); expect((await orders()).size).toBe(1); expect(r.paymentPermissionGranted).toBe(false);
    const ref = h.db!.doc(`shipping_quotes/${q.quoteId}`), stored = (await ref.get()).data()!;
    expect(stored.rates.qualification.details[0].state).toBe('provided'); expect(stored.acceptedQualification.details[0].state).toBe('absent');
    expect((await read(`transactions/${r.transactionId}`))!.shippingCost).toBe(10.75);
    delete stored.rates.qualification; await ref.set(stored); vi.stubEnv('PAYMENTS_ENABLED', 'false');
    expect(await reserve(q)).toMatchObject({ replay: true, transactionId: r.transactionId }); expect((await orders()).size).toBe(1);
  });
});
