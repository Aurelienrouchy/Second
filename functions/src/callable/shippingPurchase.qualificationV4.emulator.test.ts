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
const seller = 'author_03b3a_v4_seller', buyer = 'author_03b3a_v4_buyer', buyer2 = 'author_03b3a_v4_buyer2', articleId = 'author_03b3a_v4_article';
const call = (fn: any, data: any, uid = buyer) => fn.run({ auth: { uid, token: {} }, data });
const quote = (uid = buyer) => call(quoteShippingPurchase, { articleId, shippingAddress: purchaseAddress }, uid);
const reserve = (q: any, uid = buyer) => call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount }, uid);
const read = async (path: string) => (await h.db!.doc(path).get()).data();
const orders = () => h.db!.collection('transactions').where('articleId', '==', articleId).get();
describe.skipIf(!enabled)('author V4 qualified private proofs / real SDK', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'author_03b3a_v4_v2') : null;
  beforeAll(() => { if (app) h.db = getFirestore(app); });
  async function clean() {
    if (!h.db) return;
    for (const c of ['transactions', 'shipping_quotes']) for (const d of (await h.db.collection(c).where('articleId', '==', articleId).get()).docs) await d.ref.delete();
    for (const path of ['transactions/author_03b3a_v4_legacy', `articles/${articleId}`, `shipping_packages/${articleId}`, `wallets/${seller}/ledger/legacy`, `wallets/${seller}`, `wallets/${buyer}`, `wallets/${buyer2}`,
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

  function completeRaw() {
    const r: any = purchaseRawRates(); r.shipment_id = 'se-shipment';
    r.ship_to = { name: purchaseAddress.name, address_line1: purchaseAddress.street, city_locality: purchaseAddress.city, state_province: 'QC', postal_code: 'H2X1A1', country_code: 'CA' };
    r.ship_from = { ...r.ship_to, name: 'Seller', address_line1: '999 Origine privée' }; r.packages = [structuredClone(purchaseParcel)]; r.total_weight = { value: 0.8, unit: 'kilogram' }; return r;
  }
  async function fundsAndOld() {
    await h.db!.doc('transactions/author_03b3a_v4_legacy').set({ articleId: 'author_03b3a_v4_legacy_article', buyerId: buyer, sellerId: seller, status: 'refunded', deliveryType: 'shipping', shippingAddress: { country: 'CA', province: 'ON', street: 'Legacy authorized street' }, refundBlocked: true, stripePaymentIntentId: 'pi_legacy' });
    const refs = [`wallets/${seller}`, `wallets/${seller}/ledger/legacy`, 'transactions/author_03b3a_v4_legacy'];
    const before = await Promise.all(refs.map(read));
    return async () => { expect(await Promise.all(refs.map(read))).toEqual(before); expect((await h.db!.doc(`wallets/${buyer}`).get()).exists).toBe(false); };
  }

  it.each(['complete','absent','null','normalized'])('V4 SDK legitimate %s private proof reserves once; full old wallet/ledger/ON order preserved', async kind => {
    const conserved = await fundsAndOld(); const raw = completeRaw();
    if (kind === 'absent') for (const k of ['shipment_id','ship_from','ship_to','packages','total_weight','is_return']) delete raw[k];
    if (kind === 'null') for (const k of ['ship_from','ship_to','packages','total_weight','is_return']) raw[k] = null;
    if (kind === 'normalized') { raw.packages = [{ weight: { value: 800, unit: 'gram' }, dimensions: { length: 40/2.54, width: 20/2.54, height: 15/2.54, unit: 'inch' } }]; raw.ship_to.postal_code = 'h2x 1a1'; }
    const get: any = purchaseRawRates().rate_response; get.rates[0].rate_details = null;
    http(raw, [get]); const q = await quote(); expect(q.rates[0].totalAmount).toBe(64.75);
    expect(JSON.stringify(encode(q))).not.toMatch(/qualification|contexts|999 Origine privée/);
    const ref = h.db!.doc(`shipping_quotes/${q.quoteId}`), before = (await ref.get()).data()!;
    const result = await reserve(q); expect(result.paymentPermissionGranted).toBe(false); expect((await orders()).size).toBe(1);
    const claimed = (await ref.get()).data()!; expect(claimed.state).toBe('claimed'); expect(claimed.rates).toEqual(before.rates);
    expect(claimed.acceptedQualification.details[0].state).toBe('null'); await conserved();
    await h.db!.doc(`users/${buyer}`).update({ dateOfBirth: null, isActive: false }); vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('SHIPPING_ENABLED', 'false');
    const orderBefore = await read(`transactions/${result.transactionId}`); const timeBefore = (await ref.get()).updateTime!;
    expect(await reserve(q)).toMatchObject({ replay: true, transactionId: result.transactionId, paymentPermissionGranted: false });
    expect((await ref.get()).updateTime!.isEqual(timeBefore)).toBe(true); expect(await read(`transactions/${result.transactionId}`)).toEqual(orderBefore);
    expect(await call(createTransaction, { existingTransactionId: 'author_03b3a_v4_legacy' })).toMatchObject({ existingOrderOnly: true, paymentPermissionGranted: false }); await conserved();
  });
});
