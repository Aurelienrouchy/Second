/** Historical direct-order baseline. V3a closes this legacy new-order entry;
 * dedicated new-flow tests must separately prove each admission/quote guard. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, rates: null as any }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({}) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getRates: (...args: any[]) => holder.rates(...args) }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { createTransaction } from './payments/checkout';
const address = { street: '123 Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA', name: 'Buyer' };
const request = () => createTransaction.run({ auth: { uid: 'buyer', token: {} }, data: { articleId: 'article', deliveryType: 'shipping', amount: 50,
  shippingCost: 9, shippingAddress: address, shipEngineRateId: 'se-123' } } as any);
beforeEach(() => {
  fs.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true');
  fs.setDoc('articles/article', { sellerId: 'seller', price: 50, isActive: true, isSold: false, isShipping: true, weight: 0.5, dimensions: { length: 30, width: 25, height: 10 } });
  fs.setDoc('users/buyer', { dateOfBirth: '2000-01-01', isActive: true });
  fs.setDoc('users/seller', { dateOfBirth: '2000-01-01', isActive: true, stripeAccountId: 'acct_seller', stripeChargesEnabled: true,
    addresses: [{ ...address, isDefault: true }] });
  holder.rates = async () => [{ rateId: 'se-123', carrierCode: 'carrier', shippingAmount: { amount: 9, currency: 'cad' } }];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it.each(['minor_buyer', 'minor_seller', 'missing_activity', 'professional', 'review', 'destination_on', 'origin_on', 'currency', 'nonfinite', 'address_race', 'parcel_race', 'source_race'])('direct new order has no explicit accepted quote and must not reserve: %s', async state => {
  if (state === 'minor_buyer') fs.setDoc('users/buyer', { dateOfBirth: '2009-01-01' });
  if (state === 'minor_seller') fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), dateOfBirth: '2009-01-01' });
  if (state === 'professional' || state === 'review') fs.setDoc('eligibility_profiles/seller', state === 'professional' ? { activityDeclaration: { kind: 'professional' } } : { activeReviews: { r: { scope: 'sell', active: true } } });
  if (state === 'origin_on') fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), addresses: [{ ...address, province: 'ON', postalCode: 'M5V1A1' }] });
  const oldRates = holder.rates;
  if (state === 'currency') holder.rates = async () => [{ rateId: 'se-123', shippingAmount: { amount: 9, currency: 'usd' } }];
  if (state === 'nonfinite') holder.rates = async () => [{ rateId: 'se-123', shippingAmount: { amount: NaN, currency: 'cad' } }];
  if (state === 'address_race' || state === 'parcel_race' || state === 'source_race') holder.rates = async () => {
    if (state === 'address_race') fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), addresses: [{ ...address, street: 'CHANGED' }] });
    if (state === 'parcel_race') fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), weight: 20 });
    if (state === 'source_race') fs.setDoc('users/buyer', { dateOfBirth: '2009-01-01' });
    return oldRates();
  };
  const req: any = { auth: { uid: 'buyer', token: {} }, data: { articleId: 'article', deliveryType: 'shipping', amount: 50,
    shippingCost: 9, shippingAddress: state === 'destination_on' ? { ...address, province: 'ON', postalCode: 'M5V1A1' } : address, shipEngineRateId: 'se-123' } };
  await expect(state === 'minor_buyer' ? request() : createTransaction.run(req)).rejects.toBeDefined();
  expect(fs.getDoc('articles/article')!.isSold).toBe(false);
  expect(fs.writeOps.filter(op => /^(transactions|wallets|ledger)\//.test(op.path))).toEqual([]);
});
