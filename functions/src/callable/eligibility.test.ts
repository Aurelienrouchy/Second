import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; }, auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: '1970-01-01T00:00:00Z', customClaims: { admin: uid === 'admin' } }) } }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } } }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('./username', () => ({ validateChosenUsername: () => ({ valid: true, username: 'chosen' }) }));
import { ageAtCivilDate, ageFromIsoDate, civilDateAfterDays, isOldEnoughToBuy, isOldEnoughToSell, quebecCivilDate } from '../shared/age';
import { counterpartEligibilityRefusal, evaluateEligibility, ELIGIBILITY_POLICY_VERSION, SELLER_ACTIVITY_STATEMENT_VERSION, SELLER_ACTIVITY_STATEMENTS } from '../shared/eligibility';
import signupPolicy from '../shared/signupConsentPolicy.json';
import { recordSignupConsent } from './consent';
import { Timestamp } from 'firebase-admin/firestore';
import * as actions from './eligibility';
const call = (fn: any, data: any = {}, uid = 'owner', admin = false) => fn({ auth: { uid, token: { admin, auth_time: Math.floor(Date.now() / 1000) } }, data });
const read = () => call(actions.getMyEligibility);
const activity = async (kind = 'personal', id = 'declaration') => call(actions.declareSellerActivity, { kind,
  statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, ...(kind === 'personal' ? { personalDeclarationAccepted: true } : {}),
  expectedVersion: (await read()).version, requestId: id });
const review = async (extra: any = {}) => call(actions.requestEligibilityReview, { kind: 'review', scope: 'sell', reason: 'Veuillez examiner ma situation.',
  expectedVersion: (await read()).version, requestId: 'review', ...extra });
const detail = (id: string) => call(actions.getEligibilityReview, { reviewId: id });
const adminDetail = (id: string) => call(actions.getAdminEligibilityReview, { reviewId: id }, 'admin', true);
async function decide(id: string, outcome: string, extra: any = {}) {
  const dossier = await adminDetail(id);
  return call(actions.decideEligibilityReview, { reviewId: id, outcome, ownerReason: 'Motif communicable de la décision.',
    internalNote: 'PRIVATE_OPERATOR_NOTE', expectedVersion: dossier.eligibility.version,
    expectedRequestVersion: dossier.request.requestVersion, requestId: 'decision_' + outcome, ...extra }, 'admin', true);
}
beforeEach(() => {
  fs.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
  fs.setDoc('users/owner', { dateOfBirth: '2000-01-01', username: 'established', accountType: 'shop', shopTier: 'pro',
    stripeAccountId: 'acct_existing', addresses: [{ province: 'ON' }] });
});
afterEach(() => vi.useRealTimers());

describe('civil Québec calendar policy', () => {
  it.each([
    ['2008-10-11', '2026-10-11T00:30:00Z', 17], ['2008-10-11', '2026-10-11T04:00:00Z', 18],
    ['2008-03-09', '2026-03-09T03:30:00Z', 17], ['2008-03-09', '2026-03-09T04:00:00Z', 18],
    ['2008-11-01', '2026-11-01T03:59:59Z', 17], ['2008-11-01', '2026-11-01T04:00:00Z', 18],
    ['2008-02-29', '2026-02-28T17:00:00Z', 17], ['2008-02-29', '2026-03-01T05:00:00Z', 18],
  ])('DOB %s on instant %s gives %d, independent of host TZ', (dob, instant, expected) => {
    expect(ageFromIsoDate(dob, new Date(instant))).toBe(expected);
    expect(isOldEnoughToBuy(dob, new Date(instant))).toBe(expected >= 18);
    expect(isOldEnoughToSell(dob, new Date(instant))).toBe(expected >= 18);
  });
  it.each([null, undefined, '', {}, 20080101, '2008-2-01', '2008/02/01', '2008-02-30', '2007-02-29', '2027-01-01'])('fails closed for malformed/future DOB %j', dob => {
    expect(ageFromIsoDate(dob)).toBeNull(); expect(isOldEnoughToBuy(dob)).toBe(false);
  });
  it('explicit civil date is pure; invalid now and impossible comparison day do not admit', () => {
    expect(ageAtCivilDate('2008-10-11', '2026-10-10')).toBe(17);
    expect(ageAtCivilDate('2008-10-11', '2026-02-30')).toBeNull(); expect(quebecCivilDate(new Date(NaN))).toBeNull();
    expect(civilDateAfterDays('2026-10-10', 30)).toBe('2026-11-09');
    expect(civilDateAfterDays('2028-02-01', 30)).toBe('2028-03-02');
  });
});

describe('stable DOB and first consent compatibility', () => {
  const signup = (dateOfBirth: string, extra = {}) => call(recordSignupConsent, { dateOfBirth, acceptedTerms: true, acceptedPrivacy: true, marketingOptIn: false, ...extra });
  it('different existing birth date cannot change age source, username or legal proofs through signup', async () => {
    fs.setDoc('users/owner', { dateOfBirth: '2009-10-10', username: 'minor' });
    await expect(signup('2000-01-01')).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'date_of_birth_locked' } });
    expect(fs.getDoc('users/owner')).toEqual({ dateOfBirth: '2009-10-10', username: 'minor' }); expect(fs.writeOps).toHaveLength(0);
  });
  it('first birth still requires both legal consents and registration16, then identical replay preserves the DOB revision/handle', async () => {
    fs.setDoc('users/owner', { email: 'owner@example.invalid' });
    await expect(signup('2010-10-10', { acceptedPrivacy: false })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(signup('2011-10-10')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.writeOps).toHaveLength(0);
    const declaration = { kind: 'personal', statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, personalDeclarationAccepted: true,
      expectedUid: 'owner', expectedVersion: (await read()).version, requestId: 'first-signup' };
    const signupData = { policyVersion: signupPolicy.version, sellerActivityDeclaration: declaration };
    await signup('2010-10-10', signupData); await signup('2010-10-10', signupData);
    expect(fs.getDoc('users/owner')).toMatchObject({ dateOfBirth: '2010-10-10', dateOfBirthVersion: 1 });
    expect((await read()).decisions.buy.allowed).toBe(false);
  });
  it('missing initial DOB cannot be populated by correction request or a forged administrator outcome', async () => {
    fs.setDoc('users/owner', { username: 'legacy' });
    expect((await read()).initialDateRequiresTermsAndPrivacy).toBe(true);
    await expect(review({ kind: 'date_of_birth_correction', proposedDateOfBirth: '2000-01-01' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('users/owner')!.dateOfBirth).toBeUndefined(); expect(fs.writeOps).toHaveLength(0);
    fs.setDoc('eligibility_requests/forged', { ownerId: 'owner', kind: 'date_of_birth_correction', scope: 'buy', proposedDateOfBirth: '2000-01-01',
      originalDateOfBirth: null, status: 'submitted', version: 1, policyVersion: ELIGIBILITY_POLICY_VERSION });
    await expect(decide('forged', 'approve_correction')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('users/owner')!.dateOfBirth).toBeUndefined();
  });
  it.each([20000101, { year: 2000, month: 1, day: 1 }, Timestamp.fromDate(new Date('2000-01-01T00:00:00Z'))])('malformed existing DOB %j has a private copy and can be rectified without fabricating consent', async dob => {
    fs.setDoc('users/owner', { dateOfBirth: dob, username: 'legacy' });
    expect((await read()).decisions.buy.reasons).toContain('age_invalid');
    await expect(signup('2000-01-01')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
    const req = await review({ kind: 'date_of_birth_correction', proposedDateOfBirth: '2000-01-01' });
    expect(req.request.originalDateOfBirth).toBeNull();
    expect(req.request.originalDateOfBirthCopy.type).not.toBe('missing');
    const result = await decide(req.request.id, 'approve_correction');
    expect(result.eligibility.dateOfBirth).toBe('2000-01-01');
    expect((await fs.db.collection('users/owner/consents').get()).size).toBe(0);
    expect(result.request.originalDateOfBirthCopy).toEqual(req.request.originalDateOfBirthCopy);
  });
  it('a changed malformed source cannot be approved from a stale correction record', async () => {
    fs.setDoc('users/owner', { dateOfBirth: { year: 2000 } });
    const req = await review({ kind: 'date_of_birth_correction', proposedDateOfBirth: '2000-01-01' });
    fs.setDoc('users/owner', { dateOfBirth: { year: 2001 } });
    await expect(decide(req.request.id, 'approve_correction')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('users/owner')!.dateOfBirth).toEqual({ year: 2001 });
  });
});

describe('versioned activity and private owner/admin review', () => {
  it('pure helper refuses stale/unversioned activity evidence and malformed independent controls', () => {
    const user = { dateOfBirth: '2000-01-01' };
    const activityDeclaration = { kind: 'personal', statement: SELLER_ACTIVITY_STATEMENTS.personal,
      statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, actorUid: 'owner', recordedAt: new Date(), declarationVersion: 1 };
    const profile = { version: 1, activityDeclaration };
    expect(evaluateEligibility({ user, profile }, 'sell').allowed).toBe(true);
    for (const bad of [{ ...activityDeclaration, statementVersion: 'old' }, { ...activityDeclaration, declarationVersion: null }]) {
      expect(evaluateEligibility({ user, profile: { version: 1, activityDeclaration: bad } }, 'sell').reasons).toContain('activity_version_required');
    }
    expect(evaluateEligibility({ user, profile: { ...profile, activeReviews: { invalid: { scope: 'sell' } } } }, 'buy').reasons).toContain('review_required');
  });
  it('current private-member selling needs no questionnaire, while a declared professional stays blocked and Stripe alone does not qualify shipping', async () => {
    const initial = await read();
    expect(initial.decisions.sell.allowed).toBe(true);
    expect(initial.decisions.sell.reasons).toEqual([]);
    expect(evaluateEligibility({user: fs.getDoc('users/owner'), profile: null}, 'sell').reasons).toContain('activity_missing');
    expect(initial.decisions.buy.allowed).toBe(true); expect(initial.decisions.new_paid_shipping.allowed).toBe(false);
    const result = await activity('professional');
    expect(result.eligibility.decisions.sell.reasons).toContain('professional_declared');
    expect(result.eligibility.decisions.buy.allowed).toBe(true); expect(fs.getDoc('users/owner')!.shopTier).toBe('pro');
    expect(result.eligibility.activityDeclaration.legallyVerified).toBe(false);
  });
  it('personal declaration is independently versioned and invalid/versionless/forged projected inputs are rejected', async () => {
    await expect(call(actions.declareSellerActivity, { kind: 'personal', requestId: 'bad', expectedVersion: (await read()).version })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(actions.declareSellerActivity, { kind: 'personal', personalDeclarationAccepted: true,
      statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, requestId: 'bad', expectedVersion: (await read()).version, allowed: true })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.writeOps).toHaveLength(0);
    const declared = await activity(); expect(declared.eligibility.decisions.sell.allowed).toBe(true);
    expect(declared.eligibility.decisions.new_paid_shipping.reasons).toContain('seller_qc_missing');
    expect((await fs.db.collection('users/owner/consents').get()).size).toBe(0);
  });
  it('identical replay (including JSON key reorder) performs no second mutation and conflicting reuse is refused', async () => {
    const data = { kind: 'personal', statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, personalDeclarationAccepted: true,
      expectedVersion: (await read()).version, requestId: 'same' };
    await call(actions.declareSellerActivity, data); const count = fs.writeOps.length;
    const replayed = await call(actions.declareSellerActivity, Object.fromEntries(Object.entries(data).reverse()));
    expect(replayed.alreadyRecorded).toBe(true); expect(fs.writeOps).toHaveLength(count);
    await expect(call(actions.declareSellerActivity, { ...data, kind: 'professional', personalDeclarationAccepted: false })).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('operator signal is private and resubmission cannot clear it or a review', async () => {
    await activity();
    // This compatibility action now supplements an existing open native case.
    await review({ requestId: 'prior-open-review' });
    const version = (await read()).version;
    await call(actions.flagEligibilityForReview, { ownerId: 'owner', scope: 'sell', internalNote: 'PRIVATE_SIGNAL_NOTE', expectedVersion: version, requestId: 'flag' }, 'admin', true);
    const result = await activity('personal', 'again'); expect(result.eligibility.decisions.sell.reasons).toContain('review_required');
    expect(JSON.stringify(await read())).not.toContain('PRIVATE'); expect(JSON.stringify(await read())).not.toContain('signal_');
    const req = await review(); expect(req.request.status).toBe('submitted');
    expect((await activity('personal', 'third')).eligibility.decisions.sell.allowed).toBe(false);
  });
  it('one completed request cannot clear another active request or a rejected decision', async () => {
    await activity(); const first = await review(); const second = await review({ requestId: 'second' });
    expect((await decide(first.request.id, 'complete_review')).eligibility.decisions.sell.allowed).toBe(false);
    await decide(second.request.id, 'reject');
    expect((await activity('personal', 'resubmit')).eligibility.decisions.sell.allowed).toBe(false);
    const appeal = await review({ requestId: 'appeal', priorReviewId: second.request.id });
    expect((await decide(appeal.request.id, 'complete_review', { requestId: 'appeal_decision' })).eligibility.decisions.sell.allowed).toBe(true);
  });
  it('request_information, owner details and administrative decision have versions, preserved narratives and private notes', async () => {
    await activity(); const request = await review();
    const stale = await adminDetail(request.request.id);
    await decide(request.request.id, 'request_information');
    const info = await detail(request.request.id);
    expect(info.request.status).toBe('needs_information'); expect(JSON.stringify(info)).not.toContain('PRIVATE_OPERATOR_NOTE');
    await call(actions.addEligibilityReviewDetails, { reviewId: request.request.id, details: 'Ma précision owner.',
      expectedVersion: info.eligibility.version, expectedRequestVersion: info.request.requestVersion, requestId: 'details' });
    const updated = await adminDetail(request.request.id);
    expect(updated.request).toMatchObject({ reason: 'Veuillez examiner ma situation.', latestOwnerDetails: 'Ma précision owner.', internalNote: 'PRIVATE_OPERATOR_NOTE' });
    await expect(call(actions.decideEligibilityReview, { reviewId: request.request.id, outcome: 'complete_review', ownerReason: 'Décision',
      expectedVersion: stale.eligibility.version, expectedRequestVersion: stale.request.requestVersion, requestId: 'stale' }, 'admin', true)).rejects.toMatchObject({ code: 'aborted' });
  });
  it('correction receipt and civil deadline survive details/replays/DST; only administrator changes DOB, never age policy', async () => {
    fs.setDoc('users/owner', { dateOfBirth: '2000-01-01', username: 'established' });
    const payload = { kind: 'date_of_birth_correction', proposedDateOfBirth: '2009-10-10', reason: 'Ma naissance déclarée est inexacte.', expectedVersion: (await read()).version, requestId: 'dob' };
    const submitted = await call(actions.requestEligibilityReview, payload);
    expect(submitted.request.statutoryDueDate).toBe('2026-11-09'); expect(submitted.eligibility.decisions.buy.allowed).toBe(false);
    const receipt = submitted.request.receivedAt;
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z'));
    expect((await call(actions.requestEligibilityReview, payload)).request.receivedAt).toBe(receipt);
    const d = await detail(submitted.request.id);
    await call(actions.addEligibilityReviewDetails, { reviewId: submitted.request.id, details: 'Précision nouvelle.', expectedVersion: d.eligibility.version,
      expectedRequestVersion: d.request.requestVersion, requestId: 'dob_details' });
    expect((await detail(submitted.request.id)).request.statutoryDueDate).toBe('2026-11-09');
    const result = await decide(submitted.request.id, 'approve_correction');
    expect(fs.getDoc('users/owner')).toMatchObject({ dateOfBirth: '2009-10-10', username: 'established', dateOfBirthVersion: 1 });
    expect(result.request).toMatchObject({ originalDateOfBirth: '2000-01-01', correctedDateOfBirth: '2009-10-10', receivedAt: receipt });
    expect(result.eligibility.decisions.buy.reasons).toContain('underage');
    expect(result.eligibility.decisions.new_paid_shipping.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_OPERATOR_NOTE');
  });
  it('silence after30days is never admission, and a rectification refusal needs human legal basis/recourse', async () => {
    const req = await review({ kind: 'date_of_birth_correction', proposedDateOfBirth: '1999-01-01' });
    vi.setSystemTime(new Date('2026-11-10T17:00:00Z'));
    const overdue = await detail(req.request.id);
    expect(overdue.request).toMatchObject({ deadlineState: 'overdue', silenceEffect: 'refusal_not_permission' });
    expect(overdue.eligibility.decisions.buy.allowed).toBe(false);
    await expect(decide(req.request.id, 'reject')).rejects.toMatchObject({ code: 'invalid-argument' });
    const rejected = await decide(req.request.id, 'reject', { legalBasis: 'Fondement examiné et fourni par l’administrateur.', recourse: 'Recours applicable communiqué par l’administrateur.' });
    expect(rejected.request.ownerResponse.legalBasis).toContain('administrateur');
    expect(rejected.request.ownerResponse.recordedAfterDueDate).toBe(true);
    expect(rejected.request.receivedAt).toBe(req.request.receivedAt); expect(fs.getDoc('users/owner')!.dateOfBirth).toBe('2000-01-01');
  });
  it('professional activity and Québec are never overridden by a completed review', async () => {
    await activity('professional'); const req = await review();
    const result = await decide(req.request.id, 'complete_review');
    expect(result.eligibility.decisions.sell.reasons).toContain('professional_declared');
    expect(result.eligibility.decisions.new_paid_shipping.reasons).toContain('seller_qc_missing');
  });
  it('a continuation after refusal preserves the first rectification receipt and deadline', async () => {
    const req = await review({ kind: 'date_of_birth_correction', proposedDateOfBirth: '1999-01-01' });
    await decide(req.request.id, 'reject', { legalBasis: 'Fondement fourni.', recourse: 'Recours communiqué.' });
    vi.setSystemTime(new Date('2026-10-30T17:00:00Z'));
    const again = await review({ kind: 'date_of_birth_correction', proposedDateOfBirth: '1999-01-01', requestId: 'appeal_dob', priorReviewId: req.request.id });
    expect(again.request.receivedAt).toBe(req.request.receivedAt);
    expect(again.request.statutoryDueDate).toBe(req.request.statutoryDueDate);
    expect((await decide(again.request.id, 'approve_correction')).eligibility.decisions.buy.allowed).toBe(true);
  });
  it('owner/admin access gates precede mutations and reject third-party ID, version and untrusted allow input', async () => {
    await expect((actions.getMyEligibility as any)({ auth: null, data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(call(actions.getMyEligibility, { ownerId: 'other' })).rejects.toMatchObject({ code: 'invalid-argument' });
    const req = await review();
    await expect(call(actions.getEligibilityReview, { reviewId: req.request.id }, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call(actions.listAdminEligibilityReviews)).rejects.toMatchObject({ code: 'permission-denied' });
    const current = await adminDetail(req.request.id); const before = fs.writeOps.length;
    await expect(call(actions.decideEligibilityReview, { reviewId: req.request.id, outcome: 'complete_review', ownerReason: 'OK',
      expectedVersion: current.eligibility.version, expectedRequestVersion: current.request.requestVersion, requestId: 'allow', forceAllowed: true }, 'admin', true)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.writeOps).toHaveLength(before);
    const generic = counterpartEligibilityRefusal('sell');
    expect(generic).toEqual({ scope: 'sell', reason: 'counterparty_unavailable', message: expect.any(String) });
    expect(JSON.stringify(generic)).not.toContain('2000');
  });
  it('owner and admin lists rediscover persisted requests; idempotent admin replay preserves one trace', async () => {
    await activity(); const req = await review();
    expect((await call(actions.listMyEligibilityReviews)).items[0].id).toBe(req.request.id);
    expect((await call(actions.listAdminEligibilityReviews, {}, 'admin', true)).items[0].id).toBe(req.request.id);
    const d = await adminDetail(req.request.id), payload = { reviewId: req.request.id, outcome: 'complete_review', ownerReason: 'Examen terminé.',
      expectedVersion: d.eligibility.version, expectedRequestVersion: d.request.requestVersion, requestId: 'decision_replay' };
    await call(actions.decideEligibilityReview, payload, 'admin', true); const count = fs.writeOps.length;
    expect((await call(actions.decideEligibilityReview, payload, 'admin', true)).alreadyRecorded).toBe(true);
    expect(fs.writeOps).toHaveLength(count);
  });
});
