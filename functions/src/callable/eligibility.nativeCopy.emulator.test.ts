import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_ELIGIBILITY_SDK_TESTS === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('Native SDK test requires demo-second loopback.');
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null }));
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: {} }) }, get db() { return holder.db!; }, get FieldValue() { return FieldValue; } }));
import * as actions from './eligibility';
const require = createRequire(import.meta.url);
const { encode } = require(path.resolve(path.dirname(require.resolve('firebase-functions')), '../common/providers/https.js'));
const uid = 'sdk_native_dob_owner', admin = 'sdk_native_dob_admin';
const call = (fn: any, data: any = {}, who = uid, isAdmin = false) => fn.run({ auth: { uid: who, token: { auth_time: Math.floor(Date.now() / 1000), admin: isAdmin } }, data });
const read = () => call(actions.getMyEligibility);
const request = async () => call(actions.requestEligibilityReview, { kind: 'date_of_birth_correction', proposedDateOfBirth: (await read()).decisions.buy.civilDate,
  reason: 'Corriger la donnée native persistée.', expectedVersion: (await read()).version, requestId: 'native_request' });
const adminView = (id: string) => call(actions.getAdminEligibilityReview, { reviewId: id }, admin, true);
const approve = (view: any) => call(actions.decideEligibilityReview, { reviewId: view.request.id, outcome: 'approve_correction',
  ownerReason: 'Source rectifiée après examen.', expectedVersion: view.eligibility.version, expectedRequestVersion: view.request.requestVersion,
  requestId: 'native_decision' }, admin, true);

describe.skipIf(!enabled)('native persisted DOB, exact source and actual callable response encoder', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'native-dob-sdk-tests') : null;
  beforeAll(() => { if (app) holder.db = getFirestore(app); });
  async function clean() {
    if (!holder.db) return;
    for (const name of ['eligibility_requests', 'eligibility_audit']) {
      const docs = await holder.db.collection(name).where('ownerId', '==', uid).get();
      for (const doc of docs.docs) await doc.ref.delete();
    }
    for (const name of ['users', 'eligibility_profiles', 'wallets', 'transactions']) await holder.db.recursiveDelete(holder.db.doc(name + '/' + uid));
    await holder.db.doc('users/' + admin).delete();
  }
  beforeEach(async () => {
    await clean(); await holder.db!.doc('users/' + admin).set({ isAdmin: true });
    await holder.db!.doc('users/' + uid).set({ dateOfBirth: '2000-01-01', username: 'existing', dateOfBirthVersion: 4 });
    await holder.db!.doc('wallets/' + uid).set({ balance: 1234 }); await holder.db!.doc('transactions/' + uid).set({ status: 'completed' });
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });

  it.each([
    ['reference', () => holder.db!.doc('users/' + uid)],
    ['nested references', () => ({ list: [holder.db!.doc('users/' + uid), { link: holder.db!.doc('articles/native_fixture') }] })],
    ['GeoPoint', () => new GeoPoint(45, -73)],
    ['Buffer bytes', () => Buffer.from([0, 255])],
    ['Uint8Array bytes', () => new Uint8Array([0, 255])],
    ['vector', () => FieldValue.vector([1.5, 2])],
    ['Timestamp sub-ms', () => new Timestamp(1000, 1000)],
    ['deep map', () => Array.from({ length: 14 }).reduce(value => ({ inner: value }), { ref: holder.db!.doc('users/' + uid) })],
  ] as const)('persisted %s permits private reading/rectification and encoded admin/owner replies, never admits a corrected minor', async (_name, build) => {
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: build() });
    await call(actions.requestEligibilityReview, {kind: 'review', scope: 'sell', reason: 'Dossier natif de contrôle.',
      expectedVersion: (await read()).version, requestId: 'native_flag_source'});
    await call(actions.flagEligibilityForReview, { ownerId: uid, scope: 'sell', internalNote: 'PRIVATE_NATIVE_SIGNAL',
      expectedVersion: (await read()).version, requestId: 'native_signal' }, admin, true);
    const before = await read(); expect(before.decisions.buy.reasons).toContain('age_invalid');
    expect(encode(before)).toEqual(JSON.parse(JSON.stringify(before)));
    const submitted = await request(), view = await adminView(submitted.request.id);
    expect(view.request.originalDateOfBirth).toBeNull(); expect(view.request.originalDateOfBirthCopy).toEqual(submitted.request.originalDateOfBirthCopy);
    expect(encode(view)).toEqual(JSON.parse(JSON.stringify(view)));
    expect(view.signals[Object.keys(view.signals)[0]].recordedAt).toEqual(expect.any(String));
    const result = await approve(view); expect(encode(result)).toEqual(JSON.parse(JSON.stringify(result)));
    expect(result.eligibility.decisions.buy.reasons).toContain('underage');
    expect(result.eligibility.decisions.sell.reasons).toContain('review_required');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE_SIGNAL');
    expect((await holder.db!.doc('users/' + uid).collection('consents').get()).size).toBe(0);
    expect((await holder.db!.doc('wallets/' + uid).get()).data()).toEqual({ balance: 1234 });
    expect((await holder.db!.doc('transactions/' + uid).get()).data()).toEqual({ status: 'completed' });
  });
  it('reference changed to a different path is refused even with a fresh eligibility version', async () => {
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: holder.db!.doc('articles/source_one') });
    const before = await read(), submitted = await request();
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: holder.db!.doc('articles/source_two') });
    expect((await read()).version).not.toBe(before.version);
    await expect(approve(await adminView(submitted.request.id))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('Timestamp source changed within a millisecond is refused although the owner ISO copy is identical', async () => {
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: new Timestamp(1000, 1000) });
    const before = await read(), submitted = await request();
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: new Timestamp(1000, 2000) });
    const after = await read(); expect(after.dateOfBirthCopy).toEqual(before.dateOfBirthCopy); expect(after.version).not.toBe(before.version);
    await expect(approve(await adminView(submitted.request.id))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('diagnostic: installed Admin SDK resolves a persisted cross-database reference against the reading database', async () => {
    // Actual persisted-state diagnostic, not proof that production has this data.
    const otherDb = new Firestore({ projectId: 'demo-second', databaseId: 'other-local' });
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: otherDb.doc('articles/same_path') });
    const source = (await holder.db!.doc('users/' + uid).get()).data()!.dateOfBirth;
    expect(source.firestore.databaseId).toBe('(default)');
  });
  it('cross-database source changed to the same relative path is refused by public document revision, not invented source identity', async () => {
    const otherDb = new Firestore({ projectId: 'demo-second', databaseId: 'other-local' });
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: otherDb.doc('articles/same_path') });
    const before = await read(), submitted = await request();
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: holder.db!.doc('articles/same_path') });
    const after = await read(); expect(after.dateOfBirthCopy).toEqual(before.dateOfBirthCopy); expect(after.version).not.toBe(before.version);
    await expect(approve(await adminView(submitted.request.id))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('unrelated user edit conservatively requires renewed review only for an ambiguous reference source', async () => {
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: holder.db!.doc('articles/same_path') });
    const before = await read(), submitted = await request();
    await holder.db!.doc('users/' + uid).update({ displayName: 'New display' });
    expect((await read()).version).not.toBe(before.version);
    await expect(approve(await adminView(submitted.request.id))).rejects.toMatchObject({ code: 'failed-precondition' });
    await holder.db!.doc('users/' + uid).update({ dateOfBirth: '2000-01-01' });
    const isoVersion = (await read()).version;
    await holder.db!.doc('users/' + uid).update({ displayName: 'Another display' });
    expect((await read()).version).toBe(isoVersion);
  });
});
