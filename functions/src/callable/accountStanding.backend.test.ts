/** Pure standing and canonical consumers. Firestore/provider IO are simulated. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = h.fs ??= createFirestoreMock({ enforceReadBeforeWrite: true });
vi.mock('../config/firebase', async () => {
  const { createFirestoreMock } = await import('../utils/testHelpers/firestoreMock');
  h.fs ??= createFirestoreMock({ enforceReadBeforeWrite: true });
  return { get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; } };
});
import { hasUnavailableAccountStanding } from '../shared/accountStanding';
import { assertOwnTradingEligibility, assertMeetupAccountsAvailable } from '../utils/tradeAdmission';
import { captureConnectObservationBarrier, observeConnectAccount } from '../utils/connectEligibility';
import { readReservedShippingPurchase } from '../utils/reservedShippingPurchase';
import { purchaseAccount, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
const values = [false, null, 'true', 1, 0, {}, { active: true }, [], ['true'], undefined];
beforeEach(() => {
  fs.reset(); fs.setDoc('users/seller', { isActive: true, dateOfBirth: '2000-01-01', stripeAccountId: 'acct_purchase' });
  fs.setDoc('users/buyer', { isActive: true, dateOfBirth: '2000-01-01' }); fs.setDoc('eligibility_profiles/seller', personalProfile('seller'));
});
describe('ACCOUNT_STANDING present malformed is never new admission', () => {
  it.each(values.map(value => ({ value })))('pure predicate rejects present %j without mutating input', ({ value }) => {
    const user = { isActive: value }, before = { ...user }; expect(hasUnavailableAccountStanding(user)).toBe(true); expect(user).toEqual(before);
  });
  it('absent and exact true retain compatibility; missing doc remains existing caller responsibility', async () => {
    for (const user of [{}, { isActive: true }, null, undefined]) expect(hasUnavailableAccountStanding(user)).toBe(false);
    await expect(fs.db.runTransaction(tx => assertOwnTradingEligibility({ ownerId: 'missing', user: null, profile: null }, 'buy', tx, 'missing'))).rejects.toThrow();
  });
  for (const scope of ['buy', 'sell'] as const) {
    it.each(values.map(isActive => ({ isActive })))(scope + ' owns honest structured refusal for %j', async ({ isActive }) => {
      const evidence = { ownerId: 'seller', user: { dateOfBirth: '2000-01-01', isActive }, profile: personalProfile('seller') };
      await expect(fs.db.runTransaction(tx => assertOwnTradingEligibility(evidence, scope, tx, 'seller'))).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
    });
    it.each(values.map(isActive => ({ isActive })))(scope + ' counterpart refusal never discloses standing %j', ({ isActive }) => {
      try { assertMeetupAccountsAvailable({ isActive: true }, { isActive }, scope); throw new Error('accepted'); }
      catch (error: any) { expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } }); expect(JSON.stringify(error.details)).not.toMatch(/isActive|account_unavailable|dateOfBirth/); }
    });
  }
  it.each([true, 'absent'])('legacy/active still require independent age and seller role evidence %s', async standing => {
    const user = { dateOfBirth: '2000-01-01', ...(standing === true ? { isActive: true } : {}) };
    await expect(fs.db.runTransaction(tx => assertOwnTradingEligibility({ ownerId: 'seller', user, profile: personalProfile('seller') }, 'sell', tx, 'seller'))).resolves.toBeUndefined();
    await expect(fs.db.runTransaction(tx => assertOwnTradingEligibility({ ownerId: 'seller', user: { ...user, dateOfBirth: '2009-01-01' }, profile: personalProfile('seller') }, 'buy', tx, 'seller'))).rejects.toThrow();
    await expect(fs.db.runTransaction(tx => assertOwnTradingEligibility({ ownerId: 'seller', user, profile: personalProfile('seller', 'professional') }, 'sell', tx, 'seller'))).rejects.toThrow();
  });
  it.each([false, null, 'active', 1, { value: true }, []].map(isActive => ({ isActive })))('existing Connect remains observable but does not qualify malformed standing %j', async ({ isActive }) => {
    fs.setDoc('users/seller', { ...fs.getDoc('users/seller'), isActive }); const barrier = await captureConnectObservationBarrier('seller', 'acct_purchase');
    const result = await observeConnectAccount('seller', purchaseAccount(), { expectedId: 'acct_purchase', barrier });
    expect(result.admission.allowed).toBe(false); expect(fs.getDoc('eligibility_profiles/seller')!.sellerQuebecEvidence.reasons).toContain('account_inactive');
    expect(fs.getDoc('users/seller')!.isActive).toEqual(isActive); expect(fs.getDoc('users/seller')!.stripeAccountId).toBe('acct_purchase');
  });
  it.each([true, 'absent'])('Connect observed proof remains compatible for %s', async standing => {
    const user = fs.getDoc('users/seller')!; if (standing === 'absent') delete user.isActive; fs.setDoc('users/seller', user);
    const barrier = await captureConnectObservationBarrier('seller', 'acct_purchase'); const result = await observeConnectAccount('seller', purchaseAccount(), { expectedId: 'acct_purchase', barrier });
    expect(result.admission.allowed).toBe(true); if (standing === 'absent') expect(fs.getDoc('users/seller')).not.toHaveProperty('isActive');
  });
  for (const role of ['buyer', 'seller']) it.each([null, 'active', 1, { value: true }])(`reserved purchase ${role} rejects present malformed %j before any writes`, async isActive => {
    fs.setDoc('articles/article', { sellerId: 'seller', isActive: true, isShipping: true, isSold: true, activeTransactionId: 'reserved' });
    fs.setDoc('shipping_quotes/quote', { schemaVersion: 1, state: 'claimed', transactionId: 'reserved', ownerId: 'buyer', articleId: 'article', sellerId: 'seller', acceptedRateId: 'rate', acceptedTotal: 50 });
    fs.setDoc('users/' + role, { ...fs.getDoc('users/' + role), isActive });
    const order = { sellerId: 'seller', articleId: 'article', shippingQuoteId: 'quote', shipEngineRateId: 'rate', totalAmount: 50 };
    await expect(fs.db.runTransaction(tx => readReservedShippingPurchase(tx, 'buyer', 'reserved', order, true))).rejects.toMatchObject({
      code: role === 'buyer' ? 'permission-denied' : 'failed-precondition', details: { reason: role === 'buyer' ? 'account_unavailable' : 'counterparty_unavailable' } });
    expect(fs.writeOps).toHaveLength(0);
  });
});
