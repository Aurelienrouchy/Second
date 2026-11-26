import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, create: null as any, retrieve: null as any,
  list: null as any, created: 0, retrieved: 0, rates: 0, estimates: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: {
  create: async (data: any) => { holder.created++; return holder.create(data); },
  retrieve: async (id: string) => { holder.retrieved++; return holder.retrieve(id); },
  list: async () => holder.list(),
} }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({
  getRates: async () => { holder.rates++; return [{ rateId: 'payable_rate', carrierFriendlyName: 'Carrier', carrierCode: 'ca', serviceType: 'Parcel',
    shippingAmount: { amount: 5, currency: 'cad' }, estimatedDeliveryDays: 2, deliveryType: 'home' }]; },
  getRateEstimates: async () => { holder.estimates++; return [{ carrierFriendlyName: 'Carrier', carrierCode: 'ca', serviceType: 'Parcel',
    shippingAmount: { amount: 5, currency: 'cad' }, estimatedDeliveryDays: 2, deliveryType: 'home' }]; },
}), ShipEngineClient: {} }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid ?? 'anon', isAuthenticated: !!r.auth }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: any, fn: any) => fn,
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: any) { super(message); } } }));
import { createStripeConnectAccount, getStripeAccountStatus } from './payments/connectAccount';
import { getShippingEstimate } from './payments/shipping';
import { validateBuyerShippingAddress, resolveSellerOriginAddress } from './payments/address';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
import { invalidateConnectObservation } from '../utils/connectEligibility';
const call = (fn: any, data = {}) => fn({ auth: { uid: 'seller', token: { auth_time: Math.floor(Date.now() / 1000), email: 'seller@example.test' } }, data, rawRequest: { ip: '192.0.2.1' } });
const address = { line1: '123 rue Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X 1A1', country: 'CA' };
const input = { firstName: 'Marie', lastName: 'Test', dob: { year: 2000, month: 1, day: 1 }, address,
  transitNumber: '12345', institutionNumber: '123', accountNumber: '1234567' };
const provider = (extra = {}) => ({ id: 'acct_known', type: 'custom', country: 'CA', business_type: 'individual',
  metadata: { firebaseUserId: 'seller' }, individual: { dob: { year: 2000, month: 1, day: 1 },
    address: { line1: address.line1, city: address.city, state: 'QC', postal_code: 'H2X1A1', country: 'CA' } },
  requirements: { currently_due: [], past_due: [] }, charges_enabled: true, payouts_enabled: true, details_submitted: true,
  external_accounts: { data: [] }, ...extra });
function profile(kind = 'personal') {
  fs.setDoc('eligibility_profiles/seller', { version: 1, activityDeclaration: { kind, actorUid: 'seller', recordedAt: new Date(),
    declarationVersion: 1, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS[kind as 'personal' | 'professional'] } });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); fs.reset();
  holder.created = holder.retrieved = holder.rates = holder.estimates = 0;
  holder.create = async (data: any) => provider({ metadata: data.metadata }); holder.retrieve = async () => provider(); holder.list = async () => ({ data: [], has_more: false });
  fs.setDoc('users/seller', { dateOfBirth: '2000-01-01', email: 'seller@example.test', isActive: true }); profile();
});
afterEach(() => vi.useRealTimers());
describe('03B2 Connect uses the current private source, not a new DOB declaration', () => {
  it.each(['minor', 'missing', 'invalid', 'professional', 'review'])('no new account for own %s evidence', async problem => {
    if (problem === 'minor') fs.setDoc('users/seller', { dateOfBirth: '2009-01-01' });
    if (problem === 'missing') fs.setDoc('users/seller', {});
    if (problem === 'invalid') fs.setDoc('users/seller', { dateOfBirth: '2000-02-30' });
    if (problem === 'professional') profile('professional');
    if (problem === 'review') fs.setDoc('eligibility_profiles/seller', { ...fs.getDoc('eligibility_profiles/seller'), signals: { privateSignal: { scope: 'sell', active: true, internalNote: 'PRIVATE' } } });
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(holder.created).toBe(0); expect(fs.writeOps).toHaveLength(0);
  });
  it.each([{ year: 2000, month: 2, day: 30 }, { year: '2000', month: 1, day: 1 }, { year: 2000, month: 1, day: 2 }, { year: 2027, month: 1, day: 1 }])('new payload DOB is a real exact match or refused %j', async dob => {
    await expect(call(createStripeConnectAccount, { ...input, dob })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(holder.created).toBe(0); expect(fs.getDoc('users/seller')!.dateOfBirth).toBe('2000-01-01');
  });
  it.each(['minor', 'missing', 'professional'])('already linked account %s stays recoverable without new onboarding payload', async problem => {
    fs.setDoc('users/seller', { stripeAccountId: 'acct_known', ...(problem === 'missing' ? {} : { dateOfBirth: problem === 'minor' ? '2009-01-01' : '2000-01-01' }) });
    if (problem === 'professional') profile('professional');
    expect(await call(createStripeConnectAccount)).toMatchObject({ success: true, stripeAccountId: 'acct_known' });
    expect(holder.created).toBe(0); expect(holder.retrieved).toBe(1);
  });
  it('new Custom account produces an owner-safe observed Quebec proof, not a residence/KYC badge', async () => {
    const result = await call(createStripeConnectAccount, input);
    expect(result).toMatchObject({ success: true, stripeAccountId: 'acct_known', admission: { allowed: true } });
    const proof = fs.getDoc('eligibility_profiles/seller')!.sellerQuebecEvidence;
    expect(proof).toMatchObject({ accountId: 'acct_known', source: 'stripe_account_observed', country: 'CA', province: 'QC', residenceVerified: false });
    expect(fs.getDoc('users/seller')!).not.toHaveProperty('sellerQuebecEvidence');
  });
  it('extra DOB keys never escape to Stripe; only canonical source components are sent', async () => {
    let sent: any;
    holder.create = async (data: any) => { sent = data; return provider({ metadata: data.metadata }); };
    expect(await call(createStripeConnectAccount, { ...input, dob: { ...input.dob, extra: 'never_sent' } })).toMatchObject({ admission: { allowed: true } });
    expect(sent.individual.dob).toEqual({ year: 2000, month: 1, day: 1 });
    expect(sent.settings.payouts.schedule.interval).toBe('manual'); expect(sent.type).toBe('custom');
  });
  it.each([null, {}, { dob: { year: 2000, month: 1, day: null } }, { dob: { year: 2000, month: 2, day: 30 } }])('provider individual missing/invalid cannot produce admission %j', async individual => {
    holder.create = async (data: any) => provider({ individual, metadata: data.metadata });
    const result = await call(createStripeConnectAccount, input);
    expect(result).toMatchObject({ stripeAccountId: 'acct_known', admission: { allowed: false } });
    expect(fs.getDoc('users/seller')!.stripeAccountId).toBe('acct_known');
  });
  it('source changed during create keeps the real provider account, without silently granting new shipping', async () => {
    holder.create = async (data: any) => { fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), dateOfBirth: '2009-01-01' }); return provider({ metadata: data.metadata }); };
    const result = await call(createStripeConnectAccount, input);
    expect(result).toMatchObject({ stripeAccountId: 'acct_known', admission: { allowed: false } }); expect(holder.created).toBe(1);
    expect(fs.getDoc('users/seller')!.dateOfBirth).toBe('2009-01-01');
  });
  it('inactivity changed during create is re-read even when DOB/profile version remain identical', async () => {
    holder.create = async (data: any) => { fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), isActive: false }); return provider({ metadata: data.metadata }); };
    const result = await call(createStripeConnectAccount, input);
    expect(result).toMatchObject({ stripeAccountId: 'acct_known', admission: { allowed: false, evaluationStage: 'foundations' } });
    expect(fs.getDoc('users/seller')!.stripeAccountId).toBe('acct_known');
  });
  it('account country does not invent a missing individual address country', async () => {
    holder.create = async (data: any) => { const account = provider({ metadata: data.metadata }); delete (account.individual.address as any).country; return account; };
    const result = await call(createStripeConnectAccount, input);
    expect(result.admission.allowed).toBe(false);
    expect(fs.getDoc('eligibility_profiles/seller')!.sellerQuebecEvidence).toMatchObject({ country: null, addressCountryProvenance: 'missing_or_invalid', residenceVerified: false });
  });
  it('unchanged fresh retrieve keeps the counter-version, new provider source changes it without clearing signals', async () => {
    await call(createStripeConnectAccount, input); const before = fs.getDoc('eligibility_profiles/seller')!.version;
    await call(getStripeAccountStatus); expect(fs.getDoc('eligibility_profiles/seller')!.version).toBe(before);
    const current = fs.getDoc('eligibility_profiles/seller')!;
    fs.setDoc('eligibility_profiles/seller', { ...current, signals: { ignoredBuy: { scope: 'buy', active: true, internalNote: 'PRIVATE' } } });
    holder.retrieve = async () => provider({ individual: { dob: { year: 2000, month: 1, day: 1 }, address: { line1: '10 Exemple', city: 'Toronto', state: 'ON', postal_code: 'M5V1A1', country: 'CA' } } });
    const result = await call(getStripeAccountStatus); expect(result.admission.allowed).toBe(false);
    expect(fs.getDoc('eligibility_profiles/seller')!.signals).toEqual({ ignoredBuy: { scope: 'buy', active: true, internalNote: 'PRIVATE' } });
    expect(fs.getDoc('eligibility_profiles/seller')!.version).toBe(before + 1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('unavailable provider preserves unknown creation and never creates a replacement on stale replay', async () => {
    holder.create = async () => { throw new Error('Lost provider response'); };
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(fs.getDoc('eligibility_profiles/seller')!.connectOperation).toMatchObject({ state: 'unknown', providerId: null });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z'));
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' }); expect(holder.created).toBe(1);
    const status = await call(getStripeAccountStatus); expect(status).toMatchObject({ hasAccount: false, connectActionRequired: true });
  });
  it('a response without a qualified provider ID remains unknown, not a fabricated linked account', async () => {
    holder.create = async () => provider({ id: null });
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(fs.getDoc('eligibility_profiles/seller')!.connectOperation).toMatchObject({ state: 'unknown', providerId: null });
    expect(fs.getDoc('users/seller')!).not.toHaveProperty('stripeAccountId');
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(holder.created).toBe(1);
  });
  it('a documented parameter rejection is distinct from a lost response, without inventing automatic retry', async () => {
    holder.create = async () => { throw Object.assign(new Error('Bad parameter'), { type: 'StripeInvalidRequestError', code: 'parameter_unknown', statusCode: 400, param: 'individual.bad_key' }); };
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'connect_creation_rejected' } });
    expect(fs.getDoc('eligibility_profiles/seller')!.connectOperation).toMatchObject({ state: 'rejected', providerId: null });
    expect(await call(getStripeAccountStatus)).toMatchObject({ hasAccount: false, connectActionRequired: true, connectOperationState: 'rejected' });
    expect(holder.created).toBe(1);
  });
  it('lost create response recovers only the real operation-tagged account, without another create or DOB overwrite', async () => {
    let sent: any;
    holder.create = async (data: any) => { sent = data; throw new Error('Response lost after creation'); };
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' });
    holder.list = async () => ({ data: [provider({ metadata: sent.metadata })], has_more: false });
    const result = await call(getStripeAccountStatus);
    expect(result).toMatchObject({ hasAccount: true, admission: { allowed: true } }); expect(holder.created).toBe(1);
    expect(fs.getDoc('users/seller')).toMatchObject({ stripeAccountId: 'acct_known', dateOfBirth: '2000-01-01' });
  });
  it('signed account observation invalidates old eligibility; a fresh retrieve may refresh, not the event payload', async () => {
    await call(createStripeConnectAccount, input);
    await invalidateConnectObservation('seller', 'acct_known', { stripeChargesEnabled: false });
    expect(fs.getDoc('eligibility_profiles/seller')!.sellerQuebecEvidence.status).toBe('review_required');
    expect(fs.getDoc('users/seller')!.stripeChargesEnabled).toBe(false);
    const result = await call(getStripeAccountStatus); expect(result.admission.allowed).toBe(true);
  });
  it.each([
    ['2026-10-11T00:30:00Z', '2008-10-11', false], ['2026-10-11T04:30:00Z', '2008-10-11', true],
    ['2026-11-01T03:30:00Z', '2008-11-01', false], ['2026-11-01T06:30:00Z', '2008-11-01', true],
    ['2026-02-28T17:00:00Z', '2008-02-29', false], ['2026-03-01T17:00:00Z', '2008-02-29', true],
  ])('Connect age follows Quebec civil source at %s for birthday %s', async (instant, birth, adult) => {
    vi.setSystemTime(new Date(String(instant))); const parts = String(birth).split('-').map(Number);
    fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), dateOfBirth: birth });
    const dob = { year: parts[0], month: parts[1], day: parts[2] };
    holder.create = async (data: any) => provider({ metadata: data.metadata, individual: { ...provider().individual, dob } });
    if (adult) expect(await call(createStripeConnectAccount, { ...input, dob })).toMatchObject({ admission: { allowed: true } });
    else { await expect(call(createStripeConnectAccount, { ...input, dob })).rejects.toMatchObject({ code: 'permission-denied' }); expect(holder.created).toBe(0); }
  });
});
describe('03B2 Canadian normalization stays separate from a new Quebec shipment', () => {
  const ca = { street: '123 rue Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X 1A1', country: 'CA' };
  it.each(['street', 'city', 'province', 'postalCode', 'country'])('rejects non-string %s', field => {
    expect(() => validateBuyerShippingAddress({ ...ca, [field]: { toString: () => 'CA' } })).toThrow();
  });
  it.each([{ province: 'QC', postalCode: 'M5V1A1' }, { country: 'US' }, { postalCode: 'D1D1D1' }])('rejects incoherent Canada address %j', extra => {
    expect(() => validateBuyerShippingAddress({ ...ca, ...extra })).toThrow();
  });
  it('Ontario complete address remains usable for an old return and never fabricated from article city', () => {
    const on = { street: '123 Example St', city: 'Toronto', province: 'ON', postalCode: 'M5V1A1' };
    expect(validateBuyerShippingAddress(on)).toMatchObject(on);
    expect(resolveSellerOriginAddress({ addresses: [{ isDefault: true, street: {}, postalCode: 'H2X1A1' }, on] }, {})).toMatchObject({ addressLine1: on.street, stateProvince: 'ON' });
    expect(resolveSellerOriginAddress({ addresses: [] }, { location: { city: 'Montréal', province: 'QC', postalCode: 'H2X1A1' } })).toBeNull();
  });
  it('postal-only is honestly incomplete when the current estimate variant needs locality, without payable rate IDs', async () => {
    const result = await call(getShippingEstimate, { fromAddress: { postalCode: 'H2X1A1' }, toAddress: { postalCode: 'G1R1A1' }, weight: 0.5 });
    expect(result).toMatchObject({ success: false, estimateOnly: true, usableForPurchase: false, rates: [] });
    expect(result.requiredFields).toContain('fromAddress.city'); expect(holder.rates).toBe(0); expect(holder.estimates).toBe(0);
  });
  it('real locality estimate does not expose a rateId usable for a label', async () => {
    const result = await call(getShippingEstimate, { fromAddress: ca, toAddress: { ...ca, city: 'Québec', postalCode: 'G1R1A1' }, weight: 0.5 });
    expect(result).toMatchObject({ success: true, estimateOnly: true, usableForPurchase: false });
    expect(result.rates[0].rateId).toBeNull(); expect(holder.rates).toBe(0); expect(holder.estimates).toBe(1);
  });
});
