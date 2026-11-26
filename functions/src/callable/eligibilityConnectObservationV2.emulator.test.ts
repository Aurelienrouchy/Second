/** Actual Admin SDK causal fences. Stripe/auth simulated, loopback demo only. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_ELIGIBILITY_03B2_V2_SDK_TESTS === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('03B2 V2 SDK requires demo-second loopback');
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, retrieve: null as any, list: null as any, create: null as any, creates: 0 }));
vi.mock('../config/firebase', () => ({ get db() { return holder.db!; }, get FieldValue() { return FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: {
  create: async (p: any) => { holder.creates++; return holder.create(p); }, retrieve: async () => holder.retrieve(), list: async () => holder.list(),
} }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { createStripeConnectAccount, getStripeAccountStatus } from './payments/connectAccount';
import { handleAccountUpdated } from '../http/stripe/account';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const uid = 'sdk_03b2_v2', accountId = 'acct_sdk03b2v2';
const account = (extra: any = {}) => ({ id: accountId, type: 'custom', country: 'CA', business_type: 'individual', metadata: { firebaseUserId: uid },
  individual: { dob: { year: 2000, month: 1, day: 1 }, address: { line1: '123 Exemple', city: 'Montréal', state: 'QC', postal_code: 'H2X1A1', country: 'CA' } },
  charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] }, external_accounts: { data: [] }, ...extra });
const restricted = () => account({ charges_enabled: false, payouts_enabled: false,
  requirements: { currently_due: ['individual.address'], past_due: [], disabled_reason: 'requirements.past_due' } });
const call = (fn: any, data: any = {}) => fn.run({ auth: { uid, token: { email: 'owner@example.invalid' } }, data, rawRequest: { ip: '192.0.2.1' } });
const outcome = (promise: Promise<any>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }));
function waitForRetrieve() {
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  holder.retrieve = async () => { started(); await barrier; return account(); };
  return { begun, release };
}
describe.skipIf(!enabled)('03B2 V2 actual SDK private revision and preserved obligations', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, '03b2_v2_sdk') : null;
  beforeAll(() => { if (app) holder.db = getFirestore(app); });
  const paths = ['users/' + uid, 'eligibility_profiles/' + uid, 'wallets/' + uid, 'transactions/' + uid + '_old'];
  async function clean() { if (holder.db) for (const path of paths) await holder.db.doc(path).delete(); }
  beforeEach(async () => {
    await clean(); holder.creates = 0; holder.retrieve = async () => account(); holder.list = async () => ({ data: [], has_more: false }); holder.create = async (p: any) => account({ metadata: p.metadata });
    await holder.db!.doc('users/' + uid).set({ stripeAccountId: accountId, dateOfBirth: '2000-01-01', isActive: true });
    await holder.db!.doc('eligibility_profiles/' + uid).set({ version: 1, activityDeclaration: { kind: 'personal', actorUid: uid, recordedAt: new Date(), declarationVersion: 1,
      statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS.personal },
      activeReviews: { old: { active: false, scope: 'sell' } }, signals: { buy: { active: true, scope: 'buy', internalNote: 'PRIVATE' } } });
    await holder.db!.doc('wallets/' + uid).set({ balance: 4321, heldBalance: 900 });
    await holder.db!.doc('transactions/' + uid + '_old').set({ status: 'refunded', refund: { state: 'pending' }, amount: 30 });
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });
  async function controls() {
    expect((await holder.db!.doc('wallets/' + uid).get()).data()).toEqual({ balance: 4321, heldBalance: 900 });
    expect((await holder.db!.doc('transactions/' + uid + '_old').get()).data()).toEqual({ status: 'refunded', refund: { state: 'pending' }, amount: 30 });
    const profile = (await holder.db!.doc('eligibility_profiles/' + uid).get()).data()!;
    expect(profile.signals).toEqual({ buy: { active: true, scope: 'buy', internalNote: 'PRIVATE' } });
    expect(profile.activeReviews).toEqual({ old: { active: false, scope: 'sell' } });
    expect((await holder.db!.doc('users/' + uid).get()).data()!.dateOfBirth).toBe('2000-01-01');
  }

  it.each(['absent', 'already_review'])('real invalidation of %s proof fences the earlier read', async state => {
    if (state === 'already_review') { await call(getStripeAccountStatus); await handleAccountUpdated(restricted()); }
    const ref = holder.db!.doc('eligibility_profiles/' + uid), before = (await ref.get()).data()!;
    const wait = waitForRetrieve(), pending = outcome(call(getStripeAccountStatus)); await wait.begun;
    await handleAccountUpdated(restricted()); const invalidated = (await ref.get()).data()!;
    wait.release(); const result = await pending;
    expect(invalidated.connectObservationRevision).toBe((before.connectObservationRevision ?? 0) + 1);
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } });
    expect((await ref.get()).data()).toEqual(invalidated);
    expect((await holder.db!.doc('users/' + uid).get()).data()).toMatchObject({ stripeChargesEnabled: false, stripePayoutsEnabled: false });
    await controls(); expect(holder.creates).toBe(0);
  });

  it('two real transactions cannot overwrite the winner even with identical private DOB/address identity', async () => {
    await call(getStripeAccountStatus); const ref = holder.db!.doc('eligibility_profiles/' + uid), before = (await ref.get()).data()!;
    const wait = waitForRetrieve(), pending = outcome(call(createStripeConnectAccount)); await wait.begun;
    holder.retrieve = async () => restricted(); const winnerResult = await call(getStripeAccountStatus), winner = (await ref.get()).data()!;
    wait.release(); const loser = await pending;
    expect(winnerResult).toMatchObject({ chargesEnabled: false, payoutsEnabled: false }); expect(winner.version).toBe(before.version);
    expect(winner.connectObservationRevision).toBe(before.connectObservationRevision + 1);
    expect(loser.error).toMatchObject({ code: 'aborted' }); expect((await ref.get()).data()).toEqual(winner);
    expect((await holder.db!.doc('users/' + uid).get()).data()).toMatchObject({ stripeChargesEnabled: false, stripePayoutsEnabled: false });
    await controls(); expect(holder.creates).toBe(0);
  });

  it.each(['known_id', 'unknown_lookup'])('%s recovery keeps the captured revision across network IO', async state => {
    const profileRef = holder.db!.doc('eligibility_profiles/' + uid), userRef = holder.db!.doc('users/' + uid);
    await profileRef.update({ connectOperation: { id: 'op_v2_real', state: state === 'known_id' ? 'created' : 'unknown',
      providerId: state === 'known_id' ? accountId : null, startedAtMs: Date.now() - 1000000 } });
    await userRef.update({ stripeAccountId: FieldValue.delete() });
    const wait = waitForRetrieve();
    holder.retrieve = (() => { const blocked = holder.retrieve; return async () => ({ ...await blocked(), metadata: { firebaseUserId: uid, secondConnectOperationId: 'op_v2_real' } }); })();
    if (state === 'unknown_lookup') holder.list = async () => ({ data: [await holder.retrieve()], has_more: false });
    const pending = outcome(call(createStripeConnectAccount)); await wait.begun;
    // Deliberate server fixture of another recovery linking the same actual ID,
    // then the actual account.updated handler; no real provider workflow claimed.
    await userRef.update({ stripeAccountId: accountId }); await handleAccountUpdated(restricted());
    const invalidated = (await profileRef.get()).data(); wait.release(); const result = await pending;
    expect(result.error).toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } });
    expect((await profileRef.get()).data()).toEqual(invalidated); expect((await userRef.get()).data()!.stripeAccountId).toBe(accountId);
    await controls(); expect(holder.creates).toBe(0);
  });

  it('a real ID received from create remains persisted when a newer server-linked invalidation fences its result', async () => {
    const userRef = holder.db!.doc('users/' + uid), profileRef = holder.db!.doc('eligibility_profiles/' + uid);
    await userRef.update({ stripeAccountId: FieldValue.delete() });
    holder.create = async (p: any) => {
      // Controlled competing server link to the actually simulated-created ID.
      // This is a defensive interleaving, not a claimed ordinary Stripe event chain.
      await userRef.update({ stripeAccountId: accountId }); await handleAccountUpdated(restricted());
      return account({ metadata: p.metadata });
    };
    const input = { firstName: 'Test', lastName: 'Owner', dob: { year: 2000, month: 1, day: 1 },
      address: { line1: '123 Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA' },
      transitNumber: '12345', institutionNumber: '123', accountNumber: '1234567' };
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'aborted', details: { reason: 'connect_observation_stale' } });
    expect((await profileRef.get()).data()!.connectOperation).toMatchObject({ state: 'created', providerId: accountId });
    expect((await userRef.get()).data()).toMatchObject({ stripeAccountId: accountId, stripeChargesEnabled: false });
    holder.retrieve = async () => restricted();
    expect(await call(getStripeAccountStatus)).toMatchObject({ hasAccount: true, chargesEnabled: false, admission: { evaluationStage: 'foundations' } });
    await controls(); expect(holder.creates).toBe(1);
  });
});
