/** Author V2: actual handlers, strict IO, fixed civil clock. No provider reality. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, retrieve: null as any, list: null as any, creates: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: {
  create: async (p: any) => { holder.creates++; return account({ metadata: p.metadata }); },
  retrieve: async () => holder.retrieve(), list: async () => holder.list(),
} }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { createStripeConnectAccount, getStripeAccountStatus } from './payments/connectAccount';
import { handleAccountUpdated } from '../http/stripe/account';
import { invalidateConnectObservation } from '../utils/connectEligibility';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const uid = 'v2_owner', accountId = 'acct_v2owner';
const call = (fn: any) => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000), email: 'owner@example.invalid' } }, data: { expectedUid: uid,}, rawRequest: { ip: '192.0.2.1' } });
const account = (extra: any = {}) => ({ id: accountId, type: 'custom', country: 'CA', business_type: 'individual', metadata: { firebaseUserId: uid },
  individual: { dob: { year: 2000, month: 1, day: 1 }, address: { line1: '123 Exemple', city: 'Montréal', state: 'QC', postal_code: 'H2X1A1', country: 'CA' } },
  charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] }, external_accounts: { data: [] }, ...extra });
const restricted = () => account({ charges_enabled: false, payouts_enabled: false,
  requirements: { currently_due: ['individual.address'], past_due: [], disabled_reason: 'requirements.past_due' } });
function waitForRetrieve() {
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  holder.retrieve = async () => { started(); await barrier; return account(); };
  return { begun, release };
}
const outcome = (promise: Promise<any>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }));
function preserved() {
  expect(fs.getDoc('wallets/' + uid)).toEqual({ balance: 4321, heldBalance: 900 });
  expect(fs.getDoc('transactions/old_v2')).toEqual({ status: 'refunded', refund: { state: 'pending' }, amount: 30 });
  expect(fs.writeOps.filter(op => /^(wallets|transactions|ledger|platform_ledger)\//.test(op.path))).toEqual([]);
  expect(fs.getDoc('eligibility_profiles/' + uid)!.signals).toEqual({ buy: { active: true, scope: 'buy', internalNote: 'PRIVATE' } });
  expect(fs.getDoc('eligibility_profiles/' + uid)!.activeReviews).toEqual({ old: { active: false, scope: 'sell' } });
  expect(holder.creates).toBe(0);
}
beforeEach(() => {
  fs.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
  holder.creates = 0; holder.retrieve = async () => account(); holder.list = async () => ({ data: [], has_more: false });
  fs.setDoc('users/' + uid, { stripeAccountId: accountId, dateOfBirth: '2000-01-01', isActive: true });
  fs.setDoc('eligibility_profiles/' + uid, { version: 1, activityDeclaration: { kind: 'personal', actorUid: uid, recordedAt: new Date(),
    declarationVersion: 1, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS.personal },
    signals: { buy: { active: true, scope: 'buy', internalNote: 'PRIVATE' } }, activeReviews: { old: { active: false, scope: 'sell' } } });
  fs.setDoc('wallets/' + uid, { balance: 4321, heldBalance: 900 });
  fs.setDoc('transactions/old_v2', { status: 'refunded', refund: { state: 'pending' }, amount: 30 });
});
afterEach(() => vi.useRealTimers());

describe('03B2 V2 causal provider observations, separate from DOB/business versions', () => {
  it.each(['status', 'linked_create'])('%s does not commit a response begun before a newer webhook', async entry => {
    await call(getStripeAccountStatus);
    const wait = waitForRetrieve(), pending = outcome(call(entry === 'status' ? getStripeAccountStatus : createStripeConnectAccount));
    await wait.begun; await handleAccountUpdated(restricted());
    const invalidated = fs.getDoc('eligibility_profiles/' + uid), invalidatedUser = fs.getDoc('users/' + uid);
    wait.release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale', action: 'getStripeAccountStatus' } });
    expect(result.value).toBeNull(); expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(invalidated);
    expect(fs.getDoc('users/' + uid)).toEqual(invalidatedUser); preserved();
  });

  it.each(['absent', 'already_review'])('invalidation of %s proof advances the fence and blocks an older reply', async state => {
    if (state === 'already_review') { await call(getStripeAccountStatus); await handleAccountUpdated(restricted()); }
    const wait = waitForRetrieve(), pending = outcome(call(getStripeAccountStatus));
    await wait.begun;
    const before = fs.getDoc('eligibility_profiles/' + uid)!;
    await handleAccountUpdated(restricted()); const invalidated = fs.getDoc('eligibility_profiles/' + uid)!;
    expect(invalidated.connectObservationRevision).toBe((before.connectObservationRevision ?? 0) + 1);
    wait.release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } });
    expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(invalidated);
    expect(fs.getDoc('users/' + uid)).toMatchObject({ stripeChargesEnabled: false, stripePayoutsEnabled: false }); preserved();
  });

  it.each(['status', 'linked_create'])('%s concurrent retrieves with identical DOB/address cannot overwrite the first committed technical state', async entry => {
    await call(getStripeAccountStatus); const before = fs.getDoc('eligibility_profiles/' + uid)!;
    const wait = waitForRetrieve(), pending = outcome(call(entry === 'status' ? getStripeAccountStatus : createStripeConnectAccount));
    await wait.begun; holder.retrieve = async () => restricted();
    expect(await call(getStripeAccountStatus)).toMatchObject({ chargesEnabled: false, payoutsEnabled: false });
    const winner = fs.getDoc('eligibility_profiles/' + uid)!;
    expect(winner.version).toBe(before.version); // identity DOB/address unchanged, technical projection changed
    expect(winner.connectObservationRevision).toBe(before.connectObservationRevision + 1);
    wait.release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted' });
    expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(winner);
    expect(fs.getDoc('users/' + uid)).toMatchObject({ stripeChargesEnabled: false, stripePayoutsEnabled: false }); preserved();
  });

  it.each(['known_id', 'unknown_lookup'])('%s operation recovery carries the pre-network fence through its observation', async state => {
    const profile = fs.getDoc('eligibility_profiles/' + uid)!;
    fs.setDoc('eligibility_profiles/' + uid, { ...profile, connectOperation: { id: 'op_real', state: state === 'known_id' ? 'created' : 'unknown',
      providerId: state === 'known_id' ? accountId : null, startedAtMs: Date.now() - 1000000 } });
    fs.setDoc('users/' + uid, { dateOfBirth: '2000-01-01', isActive: true });
    const wait = waitForRetrieve();
    if (state === 'unknown_lookup') holder.list = async () => ({ data: [await holder.retrieve()], has_more: false });
    holder.retrieve = (() => { const blocked = holder.retrieve; return async () => { const a = await blocked(); return { ...a, metadata: { firebaseUserId: uid, secondConnectOperationId: 'op_real' } }; }; })();
    const pending = outcome(call(createStripeConnectAccount)); await wait.begun;
    // Server fixture: the same known account is linked by another recovery while this read is in flight.
    fs.setDoc('users/' + uid, { ...fs.getDoc('users/' + uid), stripeAccountId: accountId });
    await invalidateConnectObservation(uid, accountId, { stripeChargesEnabled: false, stripePayoutsEnabled: false });
    const invalidated = fs.getDoc('eligibility_profiles/' + uid);
    wait.release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } });
    expect(fs.getDoc('eligibility_profiles/' + uid)).toEqual(invalidated); expect(fs.getDoc('users/' + uid)!.stripeAccountId).toBe(accountId);
    preserved();
  });

  it('a fresh read begun after invalidation may observe the actual current account', async () => {
    await call(getStripeAccountStatus); await handleAccountUpdated(restricted());
    expect(await call(getStripeAccountStatus)).toMatchObject({ hasAccount: true, chargesEnabled: true, admission: { allowed: true, evaluationStage: 'foundations' } });
    preserved();
  });

  it.each(['wrong', -1])('malformed private revision %s fails closed before provider IO', async revision => {
    fs.setDoc('eligibility_profiles/' + uid, { ...fs.getDoc('eligibility_profiles/' + uid), connectObservationRevision: revision });
    let reads = 0; holder.retrieve = async () => { reads++; return account(); };
    await expect(call(getStripeAccountStatus)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(reads).toBe(0); expect(fs.writeOps).toEqual([]); preserved();
  });
});
