/** Existing price/reduction/availability regressions adapted to explicit quote
 * acceptance. Historical exact sources remain in the 03B3a before snapshot. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, post: null as any, get: null as any, calls: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: async () => purchaseAccount() } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: async () => { h.calls++; return h.post(); }, getPurchaseRatesForShipment: async () => { h.calls++; return h.get(); } }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { purchaseAccount, purchaseRates, purchaseAddress, seedPurchase } from '../utils/testHelpers/shippingPurchaseFixture';
const call = (fn: any, data: any) => fn.run({ auth: { uid: 'buyer', token: { auth_time: Math.floor(Date.now() / 1000),} }, data });
const quote = () => call(quoteShippingPurchase, { articleId: 'article', shippingAddress: purchaseAddress });
const reserve = (q: any, extra = {}) => call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount, ...extra });
beforeEach(() => {
  fs.reset(); seedPurchase(fs); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true');
  h.calls = 0; h.post = h.get = async () => { const r = purchaseRates(); r.rates[0].componentsCents = { shipping: 1499, insurance: 0, confirmation: 0, other: 0 }; r.rates[0].shippingCents = 1499; return r; };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('client shippingCost never changes an explicitly accepted authoritative price or seller payout', async () => {
  const q = await quote(), result = await reserve(q, { shippingCost: 0.01 }); const tx = fs.getDoc(`transactions/${result.transactionId}`)!;
  expect(tx.shippingCost).toBe(14.99); expect(tx.serviceFee).toBe(4); expect(tx.totalAmount).toBe(68.99); expect(tx.sellerPayout).toBe(50);
  expect(fs.getDoc('articles/article')!.isSold).toBe(true); expect(h.calls).toBe(2);
});
it.each(['fallback_se_rate', 'se-expired'])('an accepted quote cannot authorize foreign/expired rate %s', async rateId => {
  const q = await quote(); await expect(reserve(q, { rateId })).rejects.toMatchObject({ code: 'aborted' });
  expect(h.calls).toBe(1); expect(fs.getDoc('articles/article')!.isSold).toBe(false);
});
it.each([{ tier: 'pro', until: '2026-12-10', fee: 2, reduction: 0.5 }, { tier: 'pro', until: '2026-09-10', fee: 4, reduction: 0 },
  { tier: 'premium', until: null, fee: 4, reduction: 0 }])('paid-shop $tier/$until keeps original fee policy', async row => {
  fs.setDoc('shops/shop', { ownerId: 'seller', status: 'approved', tier: row.tier, ...(row.until ? { tierPaidUntil: new Date(row.until) } : {}) });
  const result = await reserve(await quote()), tx = fs.getDoc(`transactions/${result.transactionId}`)!;
  expect(tx.serviceFee).toBe(row.fee); expect(tx.buyerFeeReduction).toBe(row.reduction); expect(tx.sellerPayout).toBe(50);
});
it('shipping OFF refuses a current accepted quote before GET and reservation', async () => {
  const q = await quote(); vi.stubEnv('SHIPPING_ENABLED', 'false'); await expect(reserve(q)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(h.calls).toBe(1); expect(fs.getDoc('articles/article')!.isSold).toBe(false);
});
it('payments OFF refuses a current accepted quote before GET and reservation', async () => {
  const q = await quote(); vi.stubEnv('PAYMENTS_ENABLED', 'false'); await expect(reserve(q)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(h.calls).toBe(1); expect(fs.getDoc('articles/article')!.isSold).toBe(false);
});
it.each(['true', 'false'])('direct meetup creation remains forbidden with shipping flag %s', async shipping => {
  vi.stubEnv('SHIPPING_ENABLED', shipping); await expect(call(createTransaction, { articleId: 'article', deliveryType: 'meetup', amount: 50 })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(h.calls).toBe(0); expect(fs.getDoc('articles/article')!.isSold).toBe(false); expect(fs.writeOps).toHaveLength(0);
});
it('price raised during GET is rejected before reservation, not treated as a negotiated price', async () => {
  const q = await quote(), original = h.get; h.get = async () => { fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), price: 80 }); return original(); };
  await expect(reserve(q)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(fs.getDoc('articles/article')!.isSold).toBe(false);
  expect(fs.writeOps.filter(o => o.path.startsWith('transactions/'))).toHaveLength(0);
});
