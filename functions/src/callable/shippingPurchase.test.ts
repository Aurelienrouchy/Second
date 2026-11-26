import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, retrieve: null as any, post: null as any, get: null as any, calls: [] as any[] }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: (...args: any[]) => { h.calls.push(['post', ...args]); return h.post(...args); },
  getPurchaseRatesForShipment: (...args: any[]) => { h.calls.push(['get', ...args]); return h.get(...args); } }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { quoteShippingPurchase, setArticleShippingParcel, getArticleShippingParcel } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { purchaseAddress as address, purchaseParcel as parcel, purchaseAccount, purchaseRates, seedPurchase, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
const call = (fn: any, data: any, uid = 'buyer') => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000),} }, data });
const quote = (extra = {}) => call(quoteShippingPurchase, { articleId: 'article', shippingAddress: address, ...extra });
const reserve = (q: any, extra = {}, uid = 'buyer') => call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount, ...extra }, uid);
function change(path: string, patch: any) { fs.setDoc(path, { ...fs.getDoc(path), ...patch }); }
function noMoneyOrReservation() {
  expect(fs.getDoc('articles/article')!.isSold).toBe(false);
  expect(fs.writeOps.filter(o => /^(transactions)\//.test(o.path))).toHaveLength(0);
  expect(fs.writeOps.filter(o => /^(wallets|ledger|withdrawals|platform_ledger)\//.test(o.path))).toHaveLength(0);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true');
  fs.reset(); seedPurchase(fs); h.calls = []; h.retrieve = async () => purchaseAccount(); h.post = h.get = async () => purchaseRates();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('actual quote, explicit complete price and reservation: ON resident buyer allowed, no invented phone, private proof hidden', async () => {
  const q = await quote(); expect(q.rates[0]).toMatchObject({ shippingCost: 10.75, serviceFee: 4, totalAmount: 64.75, currency: 'CAD' });
  expect(JSON.stringify(q)).not.toMatch(/999 Origine privée|999 Adresse privée|dateOfBirth|2000-01-01|5145559876|identityHash/);
  expect(h.calls[0][2]).not.toHaveProperty('phone'); noMoneyOrReservation();
  const result = await reserve(q, { shippingCost: 0.01, shippingAddress: { street: 'FORGED' }, amount: 1, payloadDOB: '2000-01-01', proTier: true });
  expect(result).toMatchObject({ success: true, replay: false, paymentPermissionGranted: false });
  const order = fs.getDoc(`transactions/${result.transactionId}`)!;
  expect(order).toMatchObject({ amount: 50, serviceFee: 4, shippingCost: 10.75, totalAmount: 64.75, sellerPayout: 50,
    shippingAddress: address, shippingSnapshot: { origin: { street: '999 Origine privée' }, parcel, measurementVerified: false,
      rate: { componentsCents: { shipping: 900, insurance: 100, confirmation: 50, other: 25 } } } });
  expect(fs.getDoc('articles/article')!.activeTransactionId).toBe(result.transactionId);
  expect(h.calls.filter(c => c[0] === 'post')).toHaveLength(1); expect(h.calls[1]).toEqual(['get', 'se-shipment', { shipFrom: h.calls[0][1], shipTo: h.calls[0][2], parcel: h.calls[0][3] }]);
  expect(fs.writeOps.filter(o => /^(wallets|ledger)\//.test(o.path))).toHaveLength(0);
});
it.each(['minor', 'missing', 'invalid', 'inactive', 'review'])('valid quote cannot authorize changed buyer %s', async problem => {
  const q = await quote();
  if (problem === 'minor') change('users/buyer', { dateOfBirth: '2009-01-01' });
  if (problem === 'missing') change('users/buyer', { dateOfBirth: null });
  if (problem === 'invalid') change('users/buyer', { dateOfBirth: '2000-02-30' });
  if (problem === 'inactive') change('users/buyer', { isActive: false });
  if (problem === 'review') fs.setDoc('eligibility_profiles/buyer', { signals: { s: { active: true, scope: 'buy', internalNote: 'PRIVATE' } } });
  await expect(reserve(q)).rejects.toMatchObject({ code: 'permission-denied' }); noMoneyOrReservation();
});
it.each(['minor', 'missing', 'invalid', 'inactive', 'activity_missing', 'professional', 'review', 'origin_on', 'origin_missing_country', 'parcel_missing'])('valid quote cannot authorize changed seller %s and does not reveal own reason', async problem => {
  const q = await quote();
  if (problem === 'minor') change('users/seller', { dateOfBirth: '2009-01-01' });
  if (problem === 'missing') change('users/seller', { dateOfBirth: null });
  if (problem === 'invalid') change('users/seller', { dateOfBirth: {} });
  if (problem === 'inactive') change('users/seller', { isActive: false });
  if (problem === 'activity_missing') fs.setDoc('eligibility_profiles/seller', {});
  if (problem === 'professional') fs.setDoc('eligibility_profiles/seller', personalProfile('seller', 'professional'));
  if (problem === 'review') change('eligibility_profiles/seller', { activeReviews: { r: { active: true, scope: 'sell', internalNote: 'PRIVATE' } } });
  if (problem === 'origin_on') change('users/seller', { addresses: [{ ...address, province: 'ON', postalCode: 'M5V1A1' }] });
  if (problem === 'origin_missing_country') change('users/seller', { addresses: [{ ...address, country: undefined }] });
  if (problem === 'parcel_missing') fs.setDoc('shipping_packages/article', null);
  await expect(reserve(q)).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } }); noMoneyOrReservation();
});
it.each(['dob', 'country', 'province', 'metadata', 'disabled', 'missing'])('current Stripe %s data invalidates cached valid quote', async problem => {
  const q = await quote();
  h.retrieve = async () => { const a: any = purchaseAccount();
    if (problem === 'dob') a.individual.dob.year = 2009;
    if (problem === 'country') delete a.individual.address.country;
    if (problem === 'province') a.individual.address = { ...a.individual.address, state: 'ON', postal_code: 'M5V1A1' };
    if (problem === 'metadata') a.metadata.firebaseUserId = 'other';
    if (problem === 'disabled') a.charges_enabled = false;
    if (problem === 'missing') delete a.individual;
    return a; };
  await expect(reserve(q)).rejects.toMatchObject({ code: 'failed-precondition' }); noMoneyOrReservation();
});
it.each(['street', 'country', 'province', 'postalCode', 'name', 'phone'])('destination %s not forged or defaulted', async field => {
  const bad: any = { ...address, [field]: field === 'province' ? 'ON' : field === 'country' ? undefined : field === 'phone' ? {} : '' };
  await expect(quote({ shippingAddress: bad })).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(h.calls).toHaveLength(0); noMoneyOrReservation();
});
it.each(['dob', 'activity', 'origin', 'parcel', 'price', 'item', 'shop', 'account_update', 'blocking'])('sources changed during provider GET %s: no order/lock/money writes', async race => {
  const q = await quote();
  h.get = async () => {
    if (race === 'dob') change('users/buyer', { dateOfBirth: '2009-01-01' });
    if (race === 'activity') change('eligibility_profiles/seller', { activeReviews: { r: { scope: 'sell', active: true } } });
    if (race === 'origin') change('users/seller', { addresses: [{ ...address, street: 'CHANGED' }] });
    if (race === 'parcel') change('shipping_packages/article', { parcel: { ...parcel, weight: { value: 8, unit: 'kilogram' } }, version: 2 });
    if (race === 'price') change('articles/article', { price: 51 });
    if (race === 'item') change('articles/article', { description: 'CHANGED' });
    if (race === 'shop') fs.setDoc('shops/shop', { ownerId: 'seller', status: 'approved', tier: 'premium', tierPaidUntil: new Date('2026-12-01') });
    if (race === 'account_update') await invalidateConnectObservation('seller', 'acct_purchase', { stripeChargesEnabled: false });
    if (race === 'blocking') change('users/seller', { blockedUsers: [{ userId: 'buyer' }] });
    return purchaseRates();
  };
  await expect(reserve(q)).rejects.toBeDefined(); noMoneyOrReservation();
});
it.each(['origin', 'parcel', 'buyer', 'item'])('sources changed during initial POST %s: no ready quote or reservation', async race => {
  h.post = async () => {
    if (race === 'origin') change('users/seller', { addresses: [{ ...address, street: 'CHANGED' }] });
    if (race === 'parcel') change('shipping_packages/article', { version: 2 });
    if (race === 'buyer') change('users/buyer', { dateOfBirth: '2009-01-01' });
    if (race === 'item') change('articles/article', { price: 51 });
    return purchaseRates();
  };
  await expect(quote()).rejects.toBeDefined(); expect(fs.writeOps.filter(o => /^shipping_quotes\//.test(o.path))).toHaveLength(0); noMoneyOrReservation();
});
it.each(['wrong_owner', 'foreign_rate', 'estimate', 'wrong_total'])('valid quote does not accept %s selection', async problem => {
  const q = await quote();
  const extra = problem === 'foreign_rate' ? { rateId: 'se-other' } : problem === 'estimate' ? { rateId: 'estimate_1' } : problem === 'wrong_total' ? { expectedTotal: 54.01 } : {};
  await expect(reserve(q, extra, problem === 'wrong_owner' ? 'other' : 'buyer')).rejects.toBeDefined(); noMoneyOrReservation();
});
it('carrier price changed requires new consent, never a silently repriced order', async () => {
  const q = await quote(); h.get = async () => { const r = purchaseRates(); r.rates[0].shippingCents += 100; r.rates[0].componentsCents.shipping += 100; return r; };
  await expect(reserve(q)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'shipping_quote_stale' } }); noMoneyOrReservation();
});
it.each(['bank', 'refund', 'unknown', 'lost_link'])('old %s engagement protects article while catalogue claims available', async type => {
  const q = await quote();
  if (type === 'lost_link') change('articles/article', { activeTransactionId: 'missing' });
  else fs.setDoc('transactions/old', { articleId: 'article', status: type === 'unknown' ? 'unexpected' : 'completed',
    ...(type === 'bank' ? { bankDispute: { id: 'dp_old', state: 'open' } } : {}), ...(type === 'refund' ? { refundBlocked: true } : {}) });
  await expect(reserve(q)).rejects.toBeDefined(); noMoneyOrReservation();
});
it('professional buyer can buy, while premium seller without personal statement cannot sell', async () => {
  fs.setDoc('eligibility_profiles/buyer', personalProfile('buyer', 'professional')); const q = await quote(); expect(q.payable).toBe(true);
  fs.setDoc('shops/shop', { ownerId: 'seller', status: 'approved', tier: 'premium', tierPaidUntil: new Date('2026-12-01') });
  fs.setDoc('eligibility_profiles/seller', personalProfile('seller', 'professional'));
  await expect(quote()).rejects.toMatchObject({ details: { reason: 'counterparty_unavailable' } }); noMoneyOrReservation();
});
it('negotiated meetup agreement cannot produce new shipping price authorization', async () => {
  fs.setDoc('chats/chat', { articleId: 'article', participants: ['buyer', 'seller'] });
  fs.setDoc('chats/chat/messages/offer', { senderId: 'buyer', type: 'offer', offer: { status: 'accepted', amount: 40, meetup: { location: { toArrange: true } } } });
  await expect(quote({ amount: 40, chatId: 'chat', offerMessageId: 'offer' })).rejects.toMatchObject({ details: { reason: 'shipping_offer_unavailable' } }); noMoneyOrReservation();
});
it('exact claimed receipt and explicit legacy consultation remain readable without new proofs/flags', async () => {
  const q = await quote(), first = await reserve(q); const writes = fs.writeOps.length;
  change('users/buyer', { dateOfBirth: null }); fs.setDoc('eligibility_profiles/seller', {}); vi.stubEnv('PAYMENTS_ENABLED', 'false');
  expect(await reserve(q)).toMatchObject({ transactionId: first.transactionId, replay: true, paymentPermissionGranted: false });
  expect(fs.writeOps).toHaveLength(writes);
  fs.setDoc('transactions/old', { buyerId: 'buyer', deliveryType: 'shipping', status: 'disputed', shippingAddress: { province: 'ON' } });
  expect(await call(createTransaction, { existingTransactionId: 'old' })).toMatchObject({ transactionId: 'old', existingOrderOnly: true, paymentPermissionGranted: false });
  await expect(call(createTransaction, { existingTransactionId: 'old' }, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
});
it('parcel preparation is owner-bound, versioned, numeric and idempotent, no QC/KYC or flag opening', async () => {
  change('users/seller', { stripeAccountId: null, addresses: [] }); vi.stubEnv('PAYMENTS_ENABLED', 'false');
  const data = { articleId: 'article', requestId: 'change_1', expectedVersion: 1, parcel: { ...parcel, weight: { value: 1.2, unit: 'kilogram' } } };
  const result = await call(setArticleShippingParcel, data, 'seller'); expect(result).toMatchObject({ version: 2, measurementVerified: false, replay: false });
  change('users/seller', { dateOfBirth: null }); const writes = fs.writeOps.length;
  expect(await call(setArticleShippingParcel, data, 'seller')).toMatchObject({ version: 2, replay: true }); expect(fs.writeOps).toHaveLength(writes);
  await expect(call(setArticleShippingParcel, data, 'buyer')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(call(setArticleShippingParcel, { ...data, parcel: { ...parcel, weight: { value: '0.8', unit: 'kilogram' } } }, 'seller')).rejects.toMatchObject({ code: 'invalid-argument' });
  noMoneyOrReservation();
});

it('owner can inspect parcel version after restart without sale eligibility; foreign caller denied', async () => {
  change('users/seller', { dateOfBirth: null, isActive: false });
  expect(await call(getArticleShippingParcel, { articleId: 'article' }, 'seller')).toMatchObject({ version: 1, parcel, measurementVerified: false });
  await expect(call(getArticleShippingParcel, { articleId: 'article' }, 'buyer')).rejects.toMatchObject({ code: 'permission-denied' });
  fs.setDoc('shipping_packages/article', null);
  expect(await call(getArticleShippingParcel, { articleId: 'article' }, 'seller')).toMatchObject({ version: 0, parcel: null, status: 'missing' });
});
it('explicit incompatible article currency cannot be treated as CAD', async () => {
  change('articles/article', { currency: 'USD' }); await expect(quote()).rejects.toMatchObject({ code: 'failed-precondition' });
  noMoneyOrReservation(); expect(h.calls).toHaveLength(0);
});
it('parcel measurements and version changes refuse without writing old contracts', async () => {
  await expect(call(setArticleShippingParcel, { articleId: 'article', requestId: 'bad', expectedVersion: 0, parcel }, 'seller')).rejects.toMatchObject({ code: 'aborted' });
  change('users/seller', { dateOfBirth: '2009-01-01' });
  await expect(call(setArticleShippingParcel, { articleId: 'article', requestId: 'minor', expectedVersion: 1, parcel }, 'seller')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(fs.writeOps).toHaveLength(0); noMoneyOrReservation();
});

it('original shipment GET no longer contains accepted rate: explicit re-quote, no assertion of provider expiry', async () => {
  const q = await quote(); h.get = async () => { const rates = purchaseRates(); rates.rates[0].rateId = 'se-replacement'; return rates; };
  await expect(reserve(q)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'shipping_quote_stale' } });
  expect(h.calls[1]).toEqual(['get', 'se-shipment', { shipFrom: h.calls[0][1], shipTo: h.calls[0][2], parcel: h.calls[0][3] }]); noMoneyOrReservation();
});
it('failed stored-rate retrieval preserves the quote and allows a later explicit retry with same accepted price', async () => {
  const q = await quote(); h.get = async () => { throw new Error('Provider unavailable'); };
  await expect(reserve(q)).rejects.toMatchObject({ code: 'unavailable' }); noMoneyOrReservation();
  expect(fs.getDoc(`shipping_quotes/${q.quoteId}`)!.state).toBe('ready'); h.get = async () => purchaseRates();
  const result = await reserve(q); expect(fs.getDoc(`transactions/${result.transactionId}`)!.totalAmount).toBe(64.75);
});
