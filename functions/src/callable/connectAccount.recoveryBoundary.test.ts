import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createFirestoreMock, type MockFirestore} from '../utils/testHelpers/firestoreMock';

// Keep the callable, private-session guard, Connect orchestration, lifetime
// identity rules and financial source guard real. Only external IO is replaced.
const h = vi.hoisted(() => ({fs: null as MockFirestore | null,
  objects: new Map<string, {bytes: Buffer; temporaryHold: boolean}>(), claims: new Map<string, Record<string, unknown>>(),
  create: vi.fn(), retrieve: vi.fn(), log: vi.fn(), evidence: vi.fn()}));
const fs = createFirestoreMock({enforceReadBeforeWrite: true}); h.fs = fs;
vi.mock('../config/firebase', () => ({get db() {return h.fs!.db;}, get FieldValue() {return h.fs!.FieldValue;},
  auth: {getUser: async (uid: string) => ({uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(),
    metadata: {creationTime: '2026-10-26T12:00:00Z'}, customClaims: {}})}}));
vi.mock('../config/stripe', () => ({getStripe: () => ({accounts: {create: h.create, retrieve: h.retrieve}})}));
vi.mock('@google-cloud/storage', () => ({Storage: class {
  bucket(name: string) {return {name, file(path: string) {return {
    getMetadata: async () => {
      const value = h.objects.get(path); if (!value) throw {code: 404};
      return [{generation: '1', size: String(value.bytes.length), temporaryHold: value.temporaryHold}];
    },
    download: async () => {
      const value = h.objects.get(path); if (!value) throw {code: 404};
      return [value.bytes];
    },
    save: async (bytes: Buffer, options: {metadata?: {temporaryHold?: boolean}}) => {
      if (h.objects.has(path)) throw {code: 412};
      const value = JSON.parse(bytes.toString('utf8'));
      h.evidence(path, value);
      h.objects.set(path, {bytes, temporaryHold: options.metadata?.temporaryHold === true});
      if (path.includes('/connect-identities/')) h.claims.set(path, value);
    },
  };}};}
}}));
vi.mock('firebase-functions/logger', () => ({info() {}, warn: h.log, error: h.log}));

import {createStripeConnectAccount, getStripeAccountStatus} from './payments/connectAccount';
import {BANK_OWNERSHIP_STATEMENT_VERSION} from '../shared/bankConsent';
import {CONNECT_CONSENT_PRESENTATION_VERSION} from '../shared/connectConsent';
import {connectIdentityParentHash} from '../utils/connectRecoveryIdentity';
import {supportSourceHash} from '../utils/supportRequest';
import {recoveryDigest} from '../config/recoveryControl';
const uid = 'connect_boundary_member';
const accountId = 'acct_boundary';
const address = {line1: '123 Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA'};
const input = {expectedUid: uid, firstName: 'Membre', lastName: 'Test', dob: {year: 2000, month: 1, day: 1}, address,
  transitNumber: '11000', institutionNumber: '000', accountNumber: '000123456789', accountHolderName: 'Membre Test',
  bankOwnershipAccepted: true, bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION,
  paymentAccountConsent: {accepted: true, presentationVersion: CONNECT_CONSENT_PRESENTATION_VERSION}};
const provider = () => ({id: accountId, type: 'custom', country: 'CA', business_type: 'individual',
  metadata: {firebaseUserId: uid}, individual: {dob: input.dob,
    address: {line1: address.line1, city: address.city, state: 'QC', postal_code: address.postalCode, country: 'CA'}},
  charges_enabled: true, payouts_enabled: true, details_submitted: true,
  capabilities: {card_payments: 'active', transfers: 'active'}, settings: {payouts: {schedule: {interval: 'manual'}}},
  requirements: {disabled_reason: null, currently_due: [], past_due: [], pending_verification: []}, external_accounts: {data: []}});
const call = (fn: typeof createStripeConnectAccount | typeof getStripeAccountStatus, data: unknown = input) => fn.run({
  auth: {uid, token: {uid, sub: uid, aud: 'seconde-dev', iss: 'test', iat: 1, exp: 1,
    auth_time: Math.floor(Date.now()/1000)-30, email: 'member@example.test', firebase: {identities: {}, sign_in_provider: 'google.com'}}},
  data, rawRequest: {ip: '192.0.2.1'}, acceptsStreaming: false,
} as any);
const putObject = (path: string, value: unknown) => {
  const bytes = Buffer.from(JSON.stringify(value)); h.objects.set(path, {bytes, temporaryHold: false}); return bytes;
};
function qualifyExactParent() {
  const control = JSON.parse(h.objects.get('control/current.json')!.bytes.toString('utf8'));
  const authIdentityHash = supportSourceHash({protocol: 'connect_auth_identity_v1', projectId: 'seconde-dev', uid,
    createdAtMs: Date.parse('2026-10-26T12:00:00Z')});
  const {protocol: _protocol, mode: _mode, reconciliationManifest: _manifest, businessAdmission: _business, ...context} = control;
  const object = 'installations/seconde-dev/manifests/member-source.json';
  const bytes = putObject(object, {protocol: 'financial_recovery_manifest_v1', ...context,
    sources: [{ref: 'users/'+uid, nativeSourceHash: connectIdentityParentHash(uid, authIdentityHash, 'create',
      fs.getDoc('users/'+uid)!, fs.getDoc('eligibility_profiles/'+uid), null)}]});
  putObject('control/current.json', {...control, reconciliationManifest: {object, generation: '1', sha256: recoveryDigest(bytes)}});
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T02:03:39Z'));
  const env = {GCLOUD_PROJECT: 'seconde-dev', SECONDE_ENV: 'development', SECONDE_COMMERCE_TEST_MODE: 'true',
    FINANCIAL_RECOVERY_ENVIRONMENT: 'test', FINANCIAL_RECOVERY_BUCKET: 'seconde-dev-controls',
    FINANCIAL_RECOVERY_CONTROL_OBJECT: 'control/current.json', FINANCIAL_RECOVERY_PREFIX: 'installations/seconde-dev',
    FINANCIAL_RECOVERY_INSTALLATION_ID: 'connect-boundary-test', FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID: 'seconde-dev',
    FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID: '(default)', FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID: 'acct_platform',
    FINANCIAL_RECOVERY_IDENTITY_POLICY_OBJECT: 'installations/seconde-dev/manifests/identity.json',
    FINANCIAL_RECOVERY_IDENTITY_POLICY_GENERATION: '1', FINANCIAL_RECOVERY_IDENTITY_POLICY_SHA256: 'a'.repeat(64),
    PAYMENTS_ENABLED: 'true'};
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  for (const key of ['GCP_PROJECT','GOOGLE_CLOUD_PROJECT','SECONDE_PROJECT_ID','FIREBASE_CONFIG']) vi.stubEnv(key, undefined);
  const context = {installationId: 'connect-boundary-test', firestoreProjectId: 'seconde-dev', firestoreDatabaseId: '(default)',
    financialEnvironment: 'test', stripePlatformAccountId: 'acct_platform'};
  h.objects.clear();
  putObject('control/current.json', {...context, protocol: 'financial_recovery_control_v1', epoch: 'initial-test', previousEpoch: null,
    mode: 'normal', reconciliationManifest: null, businessAdmission: {protocol: 'business_admission_control_v1', state: 'open', planId: null}});
  const boundary = Date.parse('2026-10-27T12:00:00Z');
  const policy = {protocol: 'financial_recovery_connect_identity_policy_v2', ...context, epoch: 'initial-test',
    legacyWritersDrained: true, allConnectCreatesUseLifetimeClaims: true, authUidReuseForbidden: true,
    authImportsAfterBoundaryForbidden: true, claimNamespace: 'lifetime_installation', newAuthCreatedAfterMs: boundary,
    lifetimeStore: {bucket: 'seconde-dev-controls', prefix: 'installations/seconde-dev/permits/connect-identities', claimProtection: 'temporary_hold',
      runtimeObjectPermissions: 'create_get_only_no_update_delete', holdReleaseAuthority: 'independent_iam_only',
      namespaceMigration: 'independently_qualified_only', historicalClaimsComplete: true, lifecycleDeletion: 'prevented_by_held_objects',
      continuityId: 'boundary-test', protectedSinceMs: boundary-1000, qualifiedThroughMs: boundary}};
  const policyBytes = putObject('installations/seconde-dev/manifests/identity.json', policy);
  vi.stubEnv('FINANCIAL_RECOVERY_IDENTITY_POLICY_SHA256', recoveryDigest(policyBytes));
  fs.reset(); h.claims.clear(); h.log.mockClear(); h.evidence.mockClear();
  h.create.mockReset().mockImplementation(async (params: any) => ({...provider(), metadata: params.metadata}));
  h.retrieve.mockReset().mockImplementation(async () => provider());
  fs.setDoc('users/'+uid, {dateOfBirth: '2000-01-01', email: 'member@example.test', isActive: true});
  fs.setDoc('eligibility_profiles/'+uid, {version: 1});
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllEnvs();});

describe('Connect creation recovery boundary through the actual callable', () => {
  it('returns an actionable callable error when an older Auth identity lacks a qualified parent, without a Stripe POST or claim', async () => {
    await expect(call(createStripeConnectAccount)).rejects.toMatchObject({code: 'unavailable', details: {
      reason: 'connect_service_unavailable', action: 'getStripeAccountStatus'}});
    expect(h.log).toHaveBeenCalledWith('Connect creation blocked by recovery controls', {reason: 'source_not_reconciled'});
    expect(h.create).not.toHaveBeenCalled(); expect(h.claims.size).toBe(0);
    expect(fs.getDoc('users/'+uid)).not.toHaveProperty('stripeAccountCreationStartedAt');
    expect(fs.getDoc('eligibility_profiles/'+uid)).not.toHaveProperty('connectOperation');
    expect(fs.getDoc('users/'+uid)).not.toHaveProperty('stripeAccountId');
  });
  it('keeps the source guard closed on another tap, while status remains a GET-only observation', async () => {
    await call(createStripeConnectAccount).catch(() => undefined);
    expect(await call(getStripeAccountStatus, {expectedUid: uid})).toMatchObject({success: true, hasAccount: false,
      connectActionRequired: false, connectCreationReady: false});
    await expect(call(createStripeConnectAccount)).rejects.toMatchObject({code: 'unavailable'});
    expect(h.create).not.toHaveBeenCalled(); expect(h.claims.size).toBe(0);
    expect(fs.getDoc('eligibility_profiles/'+uid)).not.toHaveProperty('connectOperation');
  });
  it('creates exactly once after independent source qualification and recovers the same linked account on a repeated call', async () => {
    qualifyExactParent();
    expect(await call(getStripeAccountStatus, {expectedUid: uid})).toMatchObject({success: true, hasAccount: false,
      connectActionRequired: false, connectCreationReady: true});
    expect(h.create).not.toHaveBeenCalled(); expect(h.claims.size).toBe(0);
    expect(fs.writeOps).toHaveLength(0); expect(h.evidence).not.toHaveBeenCalled();
    expect(await call(createStripeConnectAccount)).toMatchObject({success: true, stripeAccountId: accountId});
    expect(await call(createStripeConnectAccount)).toMatchObject({success: true, stripeAccountId: accountId});
    expect(h.create).toHaveBeenCalledTimes(1); expect(h.retrieve).toHaveBeenCalledTimes(1); expect(h.claims.size).toBe(1);
    expect(fs.getDoc('eligibility_profiles/'+uid)?.connectOperation).toMatchObject({state: 'linked', providerId: accountId});
    expect(fs.getDoc('users/'+uid)?.stripeAccountId).toBe(accountId);
  });
  it('does not publish readiness for a changed native parent even when both local account markers still look absent', async () => {
    qualifyExactParent();
    fs.setDoc('eligibility_profiles/'+uid, {version: 1, connectOperation: null});
    expect(await call(getStripeAccountStatus, {expectedUid: uid})).toMatchObject({success: true, hasAccount: false,
      connectActionRequired: false, connectCreationReady: false});
    expect(h.create).not.toHaveBeenCalled(); expect(h.claims.size).toBe(0);
    expect(fs.writeOps).toHaveLength(0); expect(h.evidence).not.toHaveBeenCalled();
  });
});
