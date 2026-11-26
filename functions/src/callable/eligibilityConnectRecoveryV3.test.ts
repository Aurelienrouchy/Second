/** R02 actual endpoints/core. IO strict; only the explicit catch-contract case injects an error. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, list: null as any, retrieve: null as any,
  metadata: null as any, forcedRecoveryError: null as any, creates: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: {
  create: async (p: any) => { holder.creates++; holder.metadata = p.metadata; throw new Error('Response lost'); },
  list: async (p: any) => holder.list(p), retrieve: async () => holder.retrieve(),
} }) }));
vi.mock('../utils/connectEligibility', async original => {
  const actual = await original<typeof import('../utils/connectEligibility')>();
  return { ...actual, recoverConnectOperation: async (...args: Parameters<typeof actual.recoverConnectOperation>) => {
    if (holder.forcedRecoveryError) throw holder.forcedRecoveryError;
    return actual.recoverConnectOperation(...args);
  } };
});
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { createStripeConnectAccount, getStripeAccountStatus } from './payments/connectAccount';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const uid = 'v3_owner', accountId = 'acct_v3_owner';
const input = { firstName: 'Test', lastName: 'Owner', dob: { year: 2000, month: 1, day: 1 },
  address: { line1: '123 Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA' },
  transitNumber: '12345', institutionNumber: '123', accountNumber: '1234567' };
const account = (extra: any = {}) => ({ id: accountId, type: 'custom', business_type: 'individual', country: 'CA', metadata: holder.metadata,
  individual: { dob: input.dob, address: { line1: '123 Exemple', city: 'Montréal', state: 'QC', postal_code: 'H2X1A1', country: 'CA' } },
  charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] }, external_accounts: { data: [] }, ...extra });
const call = (fn: any, data = {}) => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000), email: 'owner@example.invalid' } }, data, rawRequest: { ip: '192.0.2.1' } });
const outcome = (promise: Promise<any>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }));
const empty = { data: [], has_more: false };
async function unknown() { await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' }); }
function controls() {
  expect(fs.getDoc('wallets/' + uid)).toEqual({ balance: 4321 });
  expect(fs.getDoc('transactions/old_v3')).toEqual({ status: 'refunded', refund: { state: 'pending' } });
  expect(holder.creates).toBe(1);
}
beforeEach(() => {
  fs.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
  holder.creates = 0; holder.metadata = holder.forcedRecoveryError = null; holder.list = async () => empty; holder.retrieve = async () => account();
  fs.setDoc('users/' + uid, { dateOfBirth: '2000-01-01', isActive: true });
  fs.setDoc('eligibility_profiles/' + uid, { version: 1, activityDeclaration: { kind: 'personal', actorUid: uid, recordedAt: new Date(),
    declarationVersion: 1, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS.personal } });
  fs.setDoc('wallets/' + uid, { balance: 4321 }); fs.setDoc('transactions/old_v3', { status: 'refunded', refund: { state: 'pending' } });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('03B2 V3 negative recovery freshness and explicit classification', () => {
  it.each(['empty', 'error', 'ambiguous', 'page_error', 'page_limit'])('old %s lookup after actual recovery is causal aborted, never none/creating', async kind => {
    await unknown(); let began!: () => void, release!: () => void, requests = 0, pages = 0;
    const started = new Promise<void>(resolve => { began = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    holder.list = async (p: any) => {
      if (++requests === 1) { began(); await wait; }
      else if (!p.starting_after) return { data: [account()], has_more: false }; // genuine winner's lookup
      if (kind === 'error' || (kind === 'page_error' && p.starting_after)) throw new Error('Provider unavailable');
      if (kind === 'ambiguous') return { data: [account(), account({ id: 'acct_duplicate' })], has_more: false };
      if (kind === 'page_error' || kind === 'page_limit') return { data: Array.from({ length: 100 }, (_, i) =>
        account({ id: 'acct_nonmatch_' + (++pages) + '_' + i, metadata: { firebaseUserId: 'other' } })), has_more: true };
      return empty;
    };
    const pending = outcome(call(getStripeAccountStatus)); await started;
    expect(await call(createStripeConnectAccount)).toMatchObject({ stripeAccountId: accountId });
    const winner = fs.getDoc('eligibility_profiles/' + uid), user = fs.getDoc('users/' + uid), writes = fs.writeOps.length;
    release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale', action: 'getStripeAccountStatus' } });
    expect(result.value).toBeNull(); expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(winner); expect(fs.getDoc('users/' + uid)).toEqual(user);
    expect(fs.writeOps).toHaveLength(writes); controls();
  });

  it.each(['empty', 'error', 'ambiguous'])('%s still current stays unknown/actionRequired with no absence proof or replacement', async kind => {
    await unknown(); const before = fs.getDoc('eligibility_profiles/' + uid), writes = fs.writeOps.length;
    holder.list = async () => { if (kind === 'error') throw new Error('Provider unavailable');
      return kind === 'ambiguous' ? { data: [account(), account({ id: 'acct_duplicate' })], has_more: false } : empty; };
    expect(await call(getStripeAccountStatus)).toMatchObject({ hasAccount: false, connectActionRequired: true, connectOperationState: 'unknown' });
    expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(before); expect(fs.writeOps).toHaveLength(writes); controls();
  });

  it('the status catch preserves a causal aborted instead of renaming it creating', async () => {
    holder.forcedRecoveryError = new HttpsError('aborted', 'Refresh', { reason: 'connect_observation_stale', action: 'getStripeAccountStatus' });
    await expect(call(getStripeAccountStatus)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } });
    expect(fs.writeOps).toEqual([]);
  });

  it('changed intent without a counter change does not publish the old negative result', async () => {
    await unknown(); holder.list = async () => { const profile = fs.getDoc('eligibility_profiles/' + uid)!;
      fs.setDoc('eligibility_profiles/' + uid, { ...profile, connectOperation: { ...profile.connectOperation, id: 'different_op' } }); return empty; };
    await expect(call(getStripeAccountStatus)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } }); controls();
  });

  it('unavailable final Firestore qualification is an error, never a neutral successful status', async () => {
    await unknown(); holder.list = async () => { vi.spyOn(fs.db, 'runTransaction').mockRejectedValueOnce(new Error('Qualification unavailable')); return empty; };
    await expect(call(getStripeAccountStatus)).rejects.toMatchObject({ code: 'internal' }); controls();
  });

  it('known-ID retrieve failure after a concurrent real recovery is also stale', async () => {
    await unknown(); const profile = fs.getDoc('eligibility_profiles/' + uid)!;
    fs.setDoc('eligibility_profiles/' + uid, { ...profile, connectOperation: { ...profile.connectOperation, providerId: accountId, state: 'created' } });
    let began!: () => void, release!: () => void, retrieves = 0;
    const started = new Promise<void>(resolve => { began = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    holder.retrieve = async () => { if (++retrieves === 1) { began(); await wait; throw new Error('Provider unavailable'); } return account(); };
    const pending = outcome(call(getStripeAccountStatus)); await started; await call(createStripeConnectAccount);
    const winner = fs.getDoc('eligibility_profiles/' + uid); release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } }); expect(result.value).toBeNull();
    expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(winner); controls();
  });

  it.each(['creating', 'rejected', 'none'])('unchanged %s intention preserves its honest classification without provider IO', async state => {
    if (state !== 'none') fs.setDoc('eligibility_profiles/' + uid, { ...fs.getDoc('eligibility_profiles/' + uid),
      connectOperation: { id: 'current_op', state, providerId: null, startedAtMs: Date.now() } });
    let lists = 0; holder.list = async () => { lists++; return empty; };
    const result = await call(getStripeAccountStatus);
    expect(result.hasAccount).toBe(false); if (state !== 'none') expect(result.connectOperationState).toBe(state);
    expect(lists).toBe(0); expect(holder.creates).toBe(0); expect(fs.writeOps).toEqual([]);
  });
});
