/** Actual port + native private-session/admin/fraud readers. Only external
 * Auth/control clients and the native Firestore transport are substituted. */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h = await vi.hoisted(async () => {
  const {createFirestoreMock} = await import('../utils/testHelpers/firestoreMock');
  const fs = createFirestoreMock({enforceReadBeforeWrite: true});
  return {fs, native: {} as any, control: {} as any, authRead: vi.fn(), controlRead: vi.fn(),
    afterQuery: null as null | (() => void), provider: vi.fn(() => {throw Error('Provider forbidden');})};
});
vi.mock('../config/firebase', () => ({db: h.fs.db, FieldValue: h.fs.FieldValue,
  auth: {getUser: async (uid: string) => {await h.authRead(); if (uid !== h.native.uid) throw {code: 'auth/user-not-found'}; return structuredClone(h.native);}}}));
vi.mock('../config/recoveryControl', async original => ({...await original<any>(),
  withFinancialRecoveryIoBudget: async (fn: any) => fn(), readFinancialRecoveryControl: async () => {
    await h.controlRead(); return structuredClone(h.control);
  }}));
vi.mock('../config/stripe', () => ({getStripe: h.provider}));

import {getStripeAccountStatusPhase1, checkTrackingStatusPhase1} from './phase1ReadPorts';
import {supportSourceHash} from '../utils/supportRequest';

const uid = 'phase1_owner', caseId = 'fr_' + 'a'.repeat(64), now = Date.parse('2026-11-25T18:00:00.000Z');
const req = (data: any = {}, token: any = {}) => ({auth: {uid, token: {auth_time: Math.floor(now / 1000) - 1,
  firebase: {sign_in_provider: 'password'}, ...token}}, data, rawRequest: {ip: '192.0.2.2'}} as any);
const status = (data: any = {}) => getStripeAccountStatusPhase1.run(req(data));
const cases = (data: any = {}) => checkTrackingStatusPhase1.run(req({expectedUid: uid, mode: 'fraud_admin_cases_observe', ...data}));
const originalTransaction = h.fs.db.runTransaction.bind(h.fs.db);
h.fs.db.runTransaction = (fn: any) => originalTransaction(async (tx: any) => {
  const get = tx.get.bind(tx);
  tx.get = async (target: any) => {
    const snap = await get(target), timed = (row: any) => ({...row, updateTime: Timestamp.fromMillis(now - 10_000)});
    if (snap.docs) {const hook = h.afterQuery; h.afterQuery = null; hook?.(); return {...snap, docs: snap.docs.map(timed)};}
    return snap.exists ? timed(snap) : snap;
  };
  return fn(tx);
});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); h.fs.reset(); h.authRead.mockReset(); h.controlRead.mockReset(); h.provider.mockClear(); h.afterQuery = null;
  for (const [key, value] of Object.entries({GCLOUD_PROJECT: 'seconde-dev', SECONDE_ENV: 'development',
    FINANCIAL_RECOVERY_ENVIRONMENT: 'unconfigured', PAYMENTS_ENABLED: 'false', SHIPPING_ENABLED: 'false',
    SECONDE_PHASE1_NEW_ACCOUNT_CUTOFF: new Date(now - 120_000).toISOString()})) vi.stubEnv(key, value);
  for (const key of ['GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'SECONDE_PROJECT_ID', 'FIREBASE_CONFIG', 'STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY']) vi.stubEnv(key, undefined);
  h.native = {uid, disabled: false, tokensValidAfterTime: new Date(now - 60_000).toISOString(),
    metadata: {creationTime: new Date(now - 30_000).toISOString()}, customClaims: {}};
  h.control = {control: {mode: 'normal', financialEnvironment: 'unconfigured', previousEpoch: null}, generation: '1', sha256: 'a'.repeat(64)};
  h.fs.setDoc('users/' + uid, {isActive: true, displayName: 'Fixture'});
  h.fs.setDoc('eligibility_profiles/' + uid, {version: 1});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllEnvs();});

describe('phase one provider-free account status', () => {
  it('returns the frozen client neutral DTO without a provider secret, recovery or writes', async () => {
    expect(await status()).toMatchObject({success: true, hasAccount: false, status: 'none', chargesEnabled: false,
      payoutsEnabled: false, connectCreationReady: false, connectActionRequired: false, payoutEligible: false,
      requirementsCurrentlyDue: [], requirementsPastDue: [], requirementsPendingVerification: []});
    expect(await status({includeBankAccounts: true})).toMatchObject({bankAccountsAvailable: true, bankAccounts: [], bankChangesBlockedReason: null});
    expect(h.provider).not.toHaveBeenCalled(); expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each([undefined, '', '2026-11-25', 'invalid', '2026-11-25T18:00:01.000Z'])('refuses an absent/unqualified cutoff %s', async value => {
    vi.stubEnv('SECONDE_PHASE1_NEW_ACCOUNT_CUTOFF', value);
    await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it.each([now - 180_000, now - 120_000, now + 1, NaN])('refuses an older, boundary or invalid native birth %s', async birth => {
    h.native.metadata.creationTime = Number.isFinite(birth) ? new Date(birth).toISOString() : 'invalid';
    await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it.each(['stripeAccountId', 'stripeAccountCreationStartedAt', 'connectOperation', 'bankOperation', 'financialRecoveryWitness', 'wallet', 'paymentAccount'])('does not turn a present %s, even null, into absence', async key => {
    for (const collection of ['users', 'eligibility_profiles']) {
      h.fs.setDoc(collection + '/' + uid, {[key]: null});
      await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
      h.fs.setDoc(collection + '/' + uid, {});
    }
  });
  it('rejects a nested historical provider marker and even an empty wallet document', async () => {
    h.fs.setDoc('eligibility_profiles/' + uid, {accountClosure: {cleanup: {stripeAccountId: null}}});
    await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
    h.fs.setDoc('eligibility_profiles/' + uid, {}); h.fs.setDoc('wallets/' + uid, {});
    await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it.each(['recovery', 'draining'])('does not serve a %s control as the initial normal release', async mode => {
    h.control.control.mode = mode; await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it('closes on a changed control generation or native Auth recreation during the read', async () => {
    h.controlRead.mockImplementationOnce(() => {}).mockImplementationOnce(() => {h.control.generation = '2';});
    await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
    h.controlRead.mockReset(); h.authRead.mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {}).mockImplementationOnce(() => {h.native.metadata.creationTime = new Date(now - 20_000).toISOString();});
    await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it('refuses enabled financial rails, mismatched owner, extra commands and a missing user', async () => {
    vi.stubEnv('PAYMENTS_ENABLED', 'true'); await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
    vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('SHIPPING_ENABLED', 'true'); await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
    vi.stubEnv('SHIPPING_ENABLED', 'false'); await expect(status({expectedUid: 'other'})).rejects.toMatchObject({code: 'unauthenticated'});
    await expect(status({mode: 'recover'})).rejects.toMatchObject({code: 'invalid-argument'});
    h.fs.setDoc('users/' + uid, null); await expect(status()).rejects.toMatchObject({code: 'failed-precondition'});
  });
});

describe('phase one exact private administrative fraud reads', () => {
  const admin = () => {h.native.customClaims.admin = true;};
  const nativeCase = () => ({protocol: 'fraud_review_case_v1', caseId, family: 'review', state: 'lookup_pending',
    firstObservedAt: Timestamp.fromMillis(now - 20_000), resolutionState: 'human_review_required', financialDecision: 'none', identityDecision: 'none'});
  it('returns the actual bounded native list and matching detail without commands or provider I/O', async () => {
    admin(); h.fs.setDoc('fraud_review_cases/' + caseId, nativeCase());
    const list = await cases();
    expect(list).toMatchObject({protocol: 'fraud_admin_cases_v1', ownerId: uid, transactionId: null,
      coverage: {source: 'native_case_records', exhaustiveRiskHistoryVerified: false}, financialEffectAuthorized: false});
    expect(list.items).toHaveLength(1);
    const detail = await cases({mode: 'fraud_admin_case_observe', caseId, expectedSource: list.items[0].source});
    expect(detail).toMatchObject({protocol: 'fraud_admin_case_v1', caseId, qualification: 'native_case',
      items: [], financialEffectAuthorized: false, guardReleased: false});
    expect(h.provider).not.toHaveBeenCalled(); expect(h.fs.writeOps).toHaveLength(0);
  });
  it('requires the exact current native role, not an old client admin claim', async () => {
    await expect(checkTrackingStatusPhase1.run(req({mode: 'fraud_admin_cases_observe', expectedUid: uid}, {admin: true}))).rejects.toMatchObject({code: 'permission-denied'});
    h.fs.setDoc('users/' + uid, {isAdmin: true, isActive: true}); expect((await cases()).items).toEqual([]);
    h.native.customClaims.admin = true; h.fs.setDoc('users/' + uid, {isAdmin: false});
    await expect(cases()).rejects.toMatchObject({code: 'permission-denied'});
  });
  it('requires a recent real primary login and the same owner', async () => {
    admin();
    await expect(checkTrackingStatusPhase1.run(req({mode: 'fraud_admin_cases_observe', expectedUid: uid}, {auth_time: now / 1000 - 301}))).rejects.toMatchObject({code: 'unauthenticated'});
    await expect(checkTrackingStatusPhase1.run(req({mode: 'fraud_admin_cases_observe', expectedUid: uid}, {firebase: {sign_in_provider: 'custom'}}))).rejects.toMatchObject({code: 'unauthenticated'});
    await expect(cases({expectedUid: 'other'})).rejects.toMatchObject({code: 'permission-denied'});
    h.native.disabled = true; await expect(cases()).rejects.toMatchObject({code: 'unauthenticated'});
  });
  it.each(['fraud_cases_observe', 'fraud_admin_decision_preview', 'fraud_admin_decision_command', 'seller_activity_facts_observe', 'policy_observe', 'refresh'])('rejects excluded mode %s', async mode => {
    admin(); await expect(cases({mode})).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it('cannot smuggle a command through the allowed list or a stale detail source', async () => {
    admin(); await expect(cases({operation: 'execute'})).rejects.toMatchObject({code: 'invalid-argument'});
    h.fs.setDoc('fraud_review_cases/' + caseId, nativeCase());
    await expect(cases({mode: 'fraud_admin_case_observe', caseId, expectedSource: {caseRevision: '1:0',
      caseSourceHash: supportSourceHash(nativeCase()), orderRevision: null, orderSourceHash: null}})).rejects.toMatchObject({code: 'failed-precondition'});
  });
  it('checks role again after reading instead of returning data following revocation', async () => {
    admin(); h.afterQuery = () => {h.native.customClaims.admin = false;};
    await expect(cases()).rejects.toMatchObject({code: 'permission-denied'});
  });
});

describe('both readers keep account fences and native token cutoffs', () => {
  it.each([null, {}, {protocol: 'unqualified'}])('refuses fence presence even malformed %s', async fence => {
    h.native.customClaims.admin = true; h.fs.setDoc('eligibility_profiles/' + uid, {accountErasureFence: fence});
    for (const call of [status, cases]) await expect(call()).rejects.toBeDefined();
  });
  it('does not serve an old token after native revocation', async () => {
    h.native.customClaims.admin = true; h.native.tokensValidAfterTime = new Date(now).toISOString();
    for (const call of [status, cases]) await expect(call()).rejects.toMatchObject({code: 'unauthenticated'});
  });
});
