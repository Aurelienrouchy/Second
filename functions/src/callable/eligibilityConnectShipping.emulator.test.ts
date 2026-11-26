/** Actual Firestore SDK; Stripe is simulated, never a real connected account. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_ELIGIBILITY_03B2_SDK_TESTS === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('03B2 SDK requires demo-second loopback.');
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, create: null as any, retrieve: null as any, list: null as any, creates: 0 }));
vi.mock('../config/firebase', () => ({ get db() { return holder.db!; }, get FieldValue() { return FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { create: async (data: any) => { holder.creates++; return holder.create(data); },
  retrieve: async () => holder.retrieve(), list: async () => holder.list() } }) }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
import { createStripeConnectAccount, getStripeAccountStatus } from './payments/connectAccount';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const uid = 'sdk_03b2_owner';
const input = { firstName: 'Test', lastName: 'Owner', dob: { year: 2000, month: 1, day: 1 },
  address: { line1: '123 Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA' },
  transitNumber: '12345', institutionNumber: '123', accountNumber: '1234567' };
const account = (metadata: any = { firebaseUserId: uid }) => ({ id: 'acct_sdk03b2', type: 'custom', country: 'CA', business_type: 'individual', metadata,
  individual: { dob: { year: 2000, month: 1, day: 1 }, address: { line1: '123 Exemple', city: 'Montréal', state: 'QC', postal_code: 'H2X1A1', country: 'CA' } },
  charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] }, external_accounts: { data: [] } });
const call = (fn: any, data = {}) => fn.run({ auth: { uid, token: { email: 'owner@example.invalid' } }, data, rawRequest: { ip: '192.0.2.1' } });
describe.skipIf(!enabled)('03B2 actual SDK private intent and observation', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, '03b2_sdk') : null;
  beforeAll(() => { if (app) holder.db = getFirestore(app); });
  async function clean() { if (holder.db) for (const path of ['users/' + uid, 'eligibility_profiles/' + uid]) await holder.db.doc(path).delete(); }
  beforeEach(async () => {
    await clean(); holder.creates = 0; holder.create = async (data: any) => account(data.metadata); holder.retrieve = async () => account(); holder.list = async () => ({ data: [], has_more: false });
    await holder.db!.doc('users/' + uid).set({ dateOfBirth: '2000-01-01', isActive: true });
    await holder.db!.doc('eligibility_profiles/' + uid).set({ version: 1, activityDeclaration: { kind: 'personal', actorUid: uid, recordedAt: new Date(),
      statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS.personal, declarationVersion: 1 } });
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });
  it('two concurrent initiators claim one intention before the single external create', async () => {
    let reached!: () => void, release!: () => void;
    const atCreate = new Promise<void>(resolve => { reached = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    holder.create = async (data: any) => { reached(); await barrier; return account(data.metadata); };
    const first = call(createStripeConnectAccount, input); await atCreate;
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'aborted' }); release();
    expect(await first).toMatchObject({ stripeAccountId: 'acct_sdk03b2', admission: { allowed: true } }); expect(holder.creates).toBe(1);
    expect((await holder.db!.doc('eligibility_profiles/' + uid).get()).data()!.connectOperation).toMatchObject({ state: 'linked', providerId: 'acct_sdk03b2' });
  });
  it('source inactivation inside simulated create keeps the actual ID with no foundation admission', async () => {
    holder.create = async (data: any) => { await holder.db!.doc('users/' + uid).update({ isActive: false }); return account(data.metadata); };
    expect(await call(createStripeConnectAccount, input)).toMatchObject({ stripeAccountId: 'acct_sdk03b2', admission: { allowed: false } });
    expect((await holder.db!.doc('users/' + uid).get()).data()).toMatchObject({ stripeAccountId: 'acct_sdk03b2', dateOfBirth: '2000-01-01', isActive: false });
  });
  it('unchanged provider observation preserves version and internal signal, changed address increments it', async () => {
    await call(createStripeConnectAccount, input); const ref = holder.db!.doc('eligibility_profiles/' + uid), prior = (await ref.get()).data()!;
    await ref.update({ signals: { privateCase: { active: true, scope: 'buy', internalNote: 'PRIVATE' } } });
    await call(getStripeAccountStatus); expect((await ref.get()).data()!.version).toBe(prior.version);
    holder.retrieve = async () => { const value = account(); value.individual.address = { line1: '123 Example', city: 'Toronto', state: 'ON', postal_code: 'M5V1A1', country: 'CA' }; return value; };
    const result = await call(getStripeAccountStatus); expect(result.admission.allowed).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE');
    const current = (await ref.get()).data()!; expect(current.version).toBe(prior.version + 1); expect(current.signals).toEqual({ privateCase: { active: true, scope: 'buy', internalNote: 'PRIVATE' } });
  });
  it('lost response is recovered by real operation identity without replacement or new DOB', async () => {
    let sent: any; holder.create = async (data: any) => { sent = data; throw new Error('Response lost'); };
    await expect(call(createStripeConnectAccount, input)).rejects.toMatchObject({ code: 'unavailable' });
    const ref = holder.db!.doc('eligibility_profiles/' + uid); expect((await ref.get()).data()!.connectOperation).toMatchObject({ state: 'unknown', providerId: null });
    holder.list = async () => ({ data: [account(sent.metadata)], has_more: false });
    expect(await call(getStripeAccountStatus)).toMatchObject({ hasAccount: true, admission: { allowed: true } }); expect(holder.creates).toBe(1);
    expect((await holder.db!.doc('users/' + uid).get()).data()!.dateOfBirth).toBe('2000-01-01');
    expect((await ref.get()).data()!.connectOperation.providerId).toBe('acct_sdk03b2');
  });
});
