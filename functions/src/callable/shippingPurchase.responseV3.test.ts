/** Author 03B3a V3 regressions. Real callable/core/parser/HTTP adapter, IO simulated. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, retrieve: null as any, post: null as any, get: null as any, client: null as any }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) } }) }));
vi.mock('../config/shipEngine', async importOriginal => ({ ...await importOriginal<any>(), getShipEngine: () => h.client ?? ({
  getPurchaseRates: (...args: any[]) => h.post(...args), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args),
}) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { quoteShippingPurchase } from '../callable/payments/shippingPurchase';
import { createTransaction } from '../callable/payments/checkout';
import { ShipEngineClient } from '../config/shipEngine';
import { purchaseAddress, purchaseAccount, purchaseRates, purchaseRawRates, seedPurchase } from '../utils/testHelpers/shippingPurchaseFixture';
const call = (fn: any, data: any, uid = 'buyer') => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000),} }, data });
const quote = () => call(quoteShippingPurchase, { articleId: 'article', shippingAddress: purchaseAddress });
const reserve = (q: any, extra = {}, uid = 'buyer') => call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount, ...extra }, uid);
function noFinancialWrites() { expect(fs.writeOps.filter(o => /^(wallets|ledger|withdrawals|platform_ledger)\//.test(o.path))).toHaveLength(0); }
function noReservation() { noFinancialWrites(); expect(fs.getDoc('articles/article')!.isSold).toBe(false); expect(fs.writeOps.filter(o => /^transactions\//.test(o.path))).toHaveLength(0); }
beforeEach(() => {
  fs.reset(); seedPurchase(fs); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
  vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true'); h.client = null;
  h.retrieve = async () => purchaseAccount(); h.post = h.get = async () => purchaseRates();
  fs.setDoc('wallets/seller', { balance: 7100, pendingBalance: 9000 }); fs.setDoc('wallets/seller/ledger/old', { amount: 1100, type: 'sale_pending' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** Author V3 probes: actual adapter/core, provider IO simulated. */
function http(post: any, get: any = post) {
  h.client = new ShipEngineClient({ apiKey: 'local_fake', baseUrl: 'https://example.invalid' });
  vi.stubGlobal('fetch', async (url: string, options: any) => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => url.endsWith('/carriers') ? { carriers: [{ carrier_id: 'se-carrier' }] } : options.method === 'POST' ? post : get }));
}
const providerAddress = (a: any) => ({ name: a.name, address_line1: a.street, city_locality: a.city,
  state_province: a.province, postal_code: a.postalCode, country_code: a.country });
function raw() { const r: any = purchaseRawRates(); r.shipment_id = 'se-shipment'; r.ship_to = providerAddress(purchaseAddress); return r; }
function contradiction(r: any, kind: string) {
  if (kind === 'root_id') r.shipment_id = 'se-foreign';
  if (kind === 'rate_id') r.rate_response.rates[0].shipment_id = 'se-foreign';
  if (kind === 'destination') r.ship_to.state_province = 'ON';
  if (kind === 'recipient') r.ship_to.name = 'Another recipient';
  if (kind === 'contact') r.ship_to.phone = '5145559876';
  if (kind === 'origin') r.ship_from = { ...r.ship_to, address_line1: 'FOREIGN' };
  if (kind === 'parcel') r.packages = [{ weight: { value: 9, unit: 'kilogram' }, dimensions: { length: 40, width: 20, height: 15, unit: 'centimeter' } }];
  if (kind === 'empty_address') r.ship_to = {};
  if (kind === 'null_id') r.shipment_id = null;
  if (kind === 'empty_id') r.shipment_id = '';
  if (kind === 'return') r.is_return = true;
  if (kind === 'breakdown') r.rate_response.rates[0].rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 100 } }];
  if (kind === 'detail_currency') r.rate_response.rates[0].rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'USD', amount: 10.75 } }];
  if (kind === 'detail_type') r.rate_response.rates[0].rate_details = {};
}
const failures = ['root_id','rate_id','destination','recipient','contact','origin','parcel','empty_address','null_id','empty_id','return','breakdown','detail_currency','detail_type'];
it.each(failures)('V3 POST %s refuses before quote write; existing funds deep-equal', async kind => {
  const r = raw(); contradiction(r, kind); http(r);
  const wallet = fs.getDoc('wallets/seller'), ledger = fs.getDoc('wallets/seller/ledger/old');
  await expect(quote()).rejects.toMatchObject({ code: 'unavailable' }); noReservation();
  expect(fs.writeOps.filter(o => /^shipping_quotes\//.test(o.path))).toHaveLength(0);
  expect(fs.getDoc('wallets/seller')).toEqual(wallet); expect(fs.getDoc('wallets/seller/ledger/old')).toEqual(ledger);
});
it.each(failures)('V3 GET %s refuses from an admissible quote without claim/order', async kind => {
  const good = raw(), bad = raw(); contradiction(bad, kind); http(good, bad);
  const q = await quote(), stored = fs.getDoc(`shipping_quotes/${q.quoteId}`);
  await expect(reserve(q)).rejects.toMatchObject({ code: 'unavailable' }); noReservation();
  expect(fs.getDoc(`shipping_quotes/${q.quoteId}`)).toEqual(stored);
});
it.each(['absent','null','empty','signed'])('V3 coherent %s detail projection never doubles totals nor exposes raw context', async kind => {
  const r = raw(); const rate = r.rate_response.rates[0];
  if (kind === 'null') { rate.rate_details = null; r.ship_from = null; }
  if (kind === 'empty') rate.rate_details = [];
  if (kind === 'signed') rate.rate_details = [
    { rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 11.75 }, carrier_memo: 'PRIVATE' },
    { rate_detail_type: 'discount', amount: { currency: 'CAD', amount: -1 } }];
  http(r, [purchaseRawRates().rate_response]); const q = await quote();
  expect(q.rates[0].shippingCost).toBe(10.75); expect(JSON.stringify(q)).not.toMatch(/qualification|PRIVATE|contexts|rate_details/);
  const stored = fs.getDoc(`shipping_quotes/${q.quoteId}`)!; expect(stored.rates.qualification.version).toBe(3);
  const result = await reserve(q); expect(result.paymentPermissionGranted).toBe(false);
  expect(fs.getDoc(`transactions/${result.transactionId}`)!.totalAmount).toBe(64.75); noFinancialWrites();
  expect(fs.getDoc(`shipping_quotes/${q.quoteId}`)!.rates).toEqual(stored.rates);
});
it('V3 ready old qualification requires explicit requote; claimed receipt remains unchanged', async () => {
  http(raw()); const q = await quote(), ref = `shipping_quotes/${q.quoteId}`;
  const qualified = fs.getDoc(ref)!; const old = structuredClone(qualified); delete old.rates.qualification; fs.setDoc(ref, old);
  await expect(reserve(q)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'shipping_quote_stale' } }); noReservation();
  expect(fs.getDoc(ref)).toEqual(old);
  fs.setDoc(ref, qualified); const result = await reserve(q);
  const claimed = fs.getDoc(ref)!; delete claimed.rates.qualification; fs.setDoc(ref, claimed);
  vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('SHIPPING_ENABLED', 'false'); const writes = fs.writeOps.length;
  expect(await reserve(q)).toMatchObject({ replay: true, transactionId: result.transactionId, paymentPermissionGranted: false });
  expect(fs.writeOps).toHaveLength(writes);
});
it('V3 details changed coherently in GET require new consent instead of replacing private evidence', async () => {
  const good = raw(), changed = raw();
  good.rate_response.rates[0].rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 10.75 } }];
  changed.rate_response.rates[0].rate_details = [{ rate_detail_type: 'handling', amount: { currency: 'CAD', amount: 10.75 } }];
  http(good, changed); const q = await quote(), stored = fs.getDoc(`shipping_quotes/${q.quoteId}`);
  await expect(reserve(q)).rejects.toMatchObject({ code: 'aborted' }); noReservation(); expect(fs.getDoc(`shipping_quotes/${q.quoteId}`)).toEqual(stored);
});
it.each(['missing_details','unknown_detail_state','missing_context'])('V3 corrupt private qualification %s is not repaired or adopted', async kind => {
  http(raw()); const q = await quote(), ref = `shipping_quotes/${q.quoteId}`;
  const stored = fs.getDoc(ref)!;
  if (kind === 'missing_details') delete stored.rates.qualification.details;
  if (kind === 'unknown_detail_state') stored.rates.qualification.details[0].state = 'future_unknown';
  if (kind === 'missing_context') delete stored.rates.qualification.contexts;
  fs.setDoc(ref, stored);
  await expect(reserve(q)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'shipping_quote_stale' } });
  noReservation(); expect(fs.getDoc(ref)).toEqual(stored);
});
