/** Actual Admin SDK transactions/queries, only an explicitly isolated demo emulator. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_ELIGIBILITY_SDK_TESTS === '1';
if (enabled && (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') || process.env.GCLOUD_PROJECT !== 'demo-second')) {
  throw new Error('Eligibility SDK tests require explicit loopback emulator and demo-second.');
}
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null }));
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: {} }) }, get db() { return holder.db!; }, get FieldValue() { return FieldValue; } }));
import * as actions from './eligibility';
import { SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const owner = 'sdk_eligibility_owner', other = 'sdk_eligibility_other', admin = 'sdk_eligibility_admin';
const call = (fn: any, data: any = {}, uid = owner, isAdmin = false) => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000), admin: isAdmin } }, data });
const read = () => call(actions.getMyEligibility);
const review = async (requestId: string, extra: any = {}) => call(actions.requestEligibilityReview, { kind: 'review', scope: 'sell',
  reason: 'Examen de ma situation.', expectedVersion: (await read()).version, requestId, ...extra });

describe.skipIf(!enabled)('eligibility foundations with actual Admin SDK', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'eligibility-sdk-tests') : null;
  beforeAll(() => { if (app) holder.db = getFirestore(app); });
  async function clean() {
    if (!holder.db) return;
    for (const uid of [owner, other, admin]) {
      for (const collection of ['eligibility_requests', 'eligibility_audit']) {
        const snap = await holder.db.collection(collection).where('ownerId', '==', uid).get();
        for (const doc of snap.docs) await doc.ref.delete();
      }
      await holder.db.doc('eligibility_profiles/' + uid).delete();
      await holder.db.recursiveDelete(holder.db.doc('users/' + uid));
    }
  }
  beforeEach(async () => {
    await clean();
    await holder.db!.doc('users/' + owner).set({ dateOfBirth: '2000-01-01', username: 'sdk_owner' });
    await holder.db!.doc('users/' + admin).set({ isAdmin: true });
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });

  it('concurrent exact declarations/requests join one durable version and audit identity', async () => {
    const payload = { kind: 'personal', personalDeclarationAccepted: true, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION,
      expectedVersion: (await read()).version, requestId: 'sdk_concurrent_activity' };
    const declared = await Promise.all([call(actions.declareSellerActivity, payload), call(actions.declareSellerActivity, payload)]);
    expect(declared.filter(r => r.alreadyRecorded)).toHaveLength(1);
    const profile = (await holder.db!.doc('eligibility_profiles/' + owner).get()).data()!;
    expect(profile.version).toBe(1); expect(profile.activityDeclaration.recordedAt).toBeInstanceOf(Timestamp);
    const input = { kind: 'review', scope: 'sell', reason: 'Examen concurrent.', expectedVersion: (await read()).version, requestId: 'sdk_concurrent_review' };
    const requests = await Promise.all([call(actions.requestEligibilityReview, input), call(actions.requestEligibilityReview, input)]);
    expect(requests[0].request.id).toBe(requests[1].request.id);
    expect(requests.filter(r => r.alreadyRecorded)).toHaveLength(1);
    expect((await holder.db!.collection('eligibility_requests').where('ownerId', '==', owner).get()).size).toBe(1);
    expect((await holder.db!.collection('eligibility_audit').where('ownerId', '==', owner).get()).size).toBe(2);
  }, 30_000);

  it('atomic correction/details/decision preserve receipt, private copy and one admin trace; no new legal consent', async () => {
    await holder.db!.doc('users/' + owner).update({ dateOfBirth: Timestamp.fromDate(new Date('2000-01-01T00:00:00Z')) });
    const submitted = await review('sdk_rectification', { kind: 'date_of_birth_correction', proposedDateOfBirth: '1999-01-01' });
    expect(submitted.request.originalDateOfBirthCopy).toEqual({ type: 'timestamp', value: '2000-01-01T00:00:00.000Z' });
    const data = { reviewId: submitted.request.id, details: 'Ma copie précise.', expectedVersion: submitted.eligibility.version,
      expectedRequestVersion: submitted.request.requestVersion, requestId: 'sdk_details' };
    await call(actions.addEligibilityReviewDetails, data);
    const dossier = await call(actions.getAdminEligibilityReview, { reviewId: submitted.request.id }, admin, true);
    const decision = { reviewId: submitted.request.id, outcome: 'approve_correction', ownerReason: 'Correction admise après examen.',
      internalNote: 'SDK_PRIVATE_ADMIN_NOTE', expectedVersion: dossier.eligibility.version,
      expectedRequestVersion: dossier.request.requestVersion, requestId: 'sdk_decision' };
    const results = await Promise.all([call(actions.decideEligibilityReview, decision, admin, true), call(actions.decideEligibilityReview, decision, admin, true)]);
    expect(results.filter(r => r.alreadyRecorded)).toHaveLength(1);
    expect((await holder.db!.doc('users/' + owner).get()).data()).toMatchObject({ dateOfBirth: '1999-01-01', dateOfBirthVersion: 1, username: 'sdk_owner' });
    const retrieved = await call(actions.getEligibilityReview, { reviewId: submitted.request.id });
    expect(retrieved.request).toMatchObject({ receivedAt: submitted.request.receivedAt, statutoryDueDate: submitted.request.statutoryDueDate,
      correctedDateOfBirth: '1999-01-01', ownerResponse: { text: 'Correction admise après examen.', respondedAt: expect.any(String) } });
    expect(JSON.stringify(retrieved)).not.toContain('SDK_PRIVATE_ADMIN_NOTE');
    expect((await holder.db!.doc('users/' + owner).collection('consents').get()).size).toBe(0);
    expect((await holder.db!.collection('eligibility_audit').where('ownerId', '==', owner).where('action', '==', 'decide_review').get()).size).toBe(1);
  });

  it('actual owner/admin queries paginate55 with ID ASC and missing/equal dates without leaking other owners', async () => {
    const batch = holder.db!.batch();
    for (let i = 0; i < 55; i++) batch.set(holder.db!.doc('eligibility_requests/sdk_e_' + String(i).padStart(2, '0')), {
      ownerId: owner, kind: 'review', scope: 'sell', status: i % 2 ? 'needs_information' : 'submitted', version: 1,
      reason: 'Fixture explicite.', ...(i % 3 ? { createdAt: Timestamp.fromMillis(1) } : {}), internalNote: 'SDK_PRIVATE_LIST_NOTE' });
    batch.set(holder.db!.doc('eligibility_requests/sdk_e_other'), { ownerId: other, kind: 'review', scope: 'buy', status: 'submitted', version: 1 });
    await batch.commit();
    const first = await call(actions.listMyEligibilityReviews), second = await call(actions.listMyEligibilityReviews, { cursor: first.cursor });
    expect([first.items.length, second.items.length]).toEqual([50, 5]);
    expect(new Set([...first.items, ...second.items].map(r => r.id)).size).toBe(55);
    expect(JSON.stringify(first)).not.toContain('SDK_PRIVATE_LIST_NOTE');
    await expect(call(actions.getEligibilityReview, { reviewId: 'sdk_e_other' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call(actions.listAdminEligibilityReviews)).rejects.toMatchObject({ code: 'permission-denied' });
    const adminFirst = await call(actions.listAdminEligibilityReviews, {}, admin, true);
    const adminSecond = await call(actions.listAdminEligibilityReviews, { cursor: adminFirst.cursor }, admin, true);
    expect([adminFirst.items.length, adminSecond.items.length]).toEqual([50, 6]);
    expect((await call(actions.listAdminEligibilityReviews, { status: 'needs_information' }, admin, true)).items).toHaveLength(27);
  });

  it('persisted backend admin role can flag, but owner resubmission cannot clear its independent signal', async () => {
    await review('sdk_flag_source');
    await call(actions.flagEligibilityForReview, { ownerId: owner, scope: 'sell', internalNote: 'SDK_PRIVATE_SIGNAL',
      expectedVersion: (await read()).version, requestId: 'sdk_flag' }, admin);
    await call(actions.declareSellerActivity, { kind: 'personal', personalDeclarationAccepted: true, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION,
      expectedVersion: (await read()).version, requestId: 'sdk_again' });
    expect((await read()).decisions.sell.reasons).toContain('review_required');
    expect(JSON.stringify(await read())).not.toContain('SDK_PRIVATE_SIGNAL');
    await holder.db!.doc('users/' + admin).update({ isAdmin: false });
    await expect(call(actions.flagEligibilityForReview, { ownerId: owner, scope: 'buy', internalNote: 'Revoked.',
      expectedVersion: (await read()).version, requestId: 'sdk_revoked' }, admin)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
