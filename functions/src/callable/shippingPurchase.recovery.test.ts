/** Owner restart/read and counter exhaustion: targeted author controls. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({}) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
import * as endpoints from './payments/shippingPurchase';
import { seedPurchase, purchaseParcel } from '../utils/testHelpers/shippingPurchaseFixture';
const call = (fn: any, data: any, uid = 'seller') => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000),} }, data });
beforeEach(() => { fs.reset(); seedPurchase(fs); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('owner restart returns exact current measurements/version while commerce proofs missing and flags OFF', async () => {
  fs.setDoc('users/seller', { dateOfBirth: null, isActive: false }); vi.stubEnv('SHIPPING_ENABLED', 'false'); vi.stubEnv('PAYMENTS_ENABLED', 'false');
  expect(await call(endpoints.getArticleShippingParcel, { articleId: 'article' })).toMatchObject({ version: 1, parcel: purchaseParcel, status: 'declared', measurementVerified: false });
  await expect(call(endpoints.getArticleShippingParcel, { articleId: 'article' }, 'buyer')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(fs.writeOps).toHaveLength(0);
});
it('MAX_SAFE_INTEGER source cannot be incremented or reset: no private/article/order/financial write', async () => {
  fs.setDoc('shipping_packages/article', { ...fs.getDoc('shipping_packages/article'), version: Number.MAX_SAFE_INTEGER });
  const before = fs.getDoc('shipping_packages/article');
  await expect(call(endpoints.setArticleShippingParcel, { articleId: 'article', requestId: 'exhausted', expectedVersion: Number.MAX_SAFE_INTEGER, parcel: purchaseParcel })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('shipping_packages/article')).toEqual(before); expect(fs.getDoc('articles/article')!.isSold).toBe(false);
});
it.each(['version', 'source', 'articleId', 'ownerId', 'measurementVerified'])('malformed persisted %s is operator examination, never an owner-safe authoritative source', async field => {
  fs.setDoc('shipping_packages/article', { ...fs.getDoc('shipping_packages/article'), [field]: field === 'version' ? '1' : field === 'measurementVerified' ? true : 'unexpected' });
  await expect(call(endpoints.getArticleShippingParcel, { articleId: 'article' })).rejects.toMatchObject({ code: 'failed-precondition' }); expect(fs.writeOps).toHaveLength(0);
});
it.each([['version', null], ['version', undefined], ['version', 0], ['version', 1.5], ['schemaVersion', 2], ['source', 'unqualified'],
  ['articleId', 'different'], ['measurementVerified', true]])('existing malformed setter source %s=%s is not reset/replaced', async (field, value) => {
  const data = { ...fs.getDoc('shipping_packages/article'), [String(field)]: value }; if (value === undefined) delete data[String(field)];
  fs.setDoc('shipping_packages/article', data);
  await expect(call(endpoints.setArticleShippingParcel, { articleId: 'article', requestId: 'new', expectedVersion: field === 'version' ? 0 : 1, parcel: purchaseParcel })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.getDoc('shipping_packages/article')).toEqual(data); expect(fs.writeOps).toHaveLength(0);
});
it.each(['source', 'parcel'])('corrupt persisted %s cannot become an authoritative exact replay DTO', async field => {
  const saved: any = { ...fs.getDoc('shipping_packages/article'), requestId: 'same', previousVersion: 0,
    [field]: field === 'parcel' ? { ...purchaseParcel, weight: { value: '0.8', unit: 'kilogram' } } : 'unqualified' };
  fs.setDoc('shipping_packages/article', saved);
  await expect(call(endpoints.setArticleShippingParcel, { articleId: 'article', requestId: 'same', expectedVersion: 0, parcel: purchaseParcel }, 'seller')).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('shipping_packages/article')).toEqual(saved);
});
