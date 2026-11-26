import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return {...holder.fs!.FieldValue,serverTimestamp:()=>Timestamp.now()}; }, auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: '1970-01-01T00:00:00Z', customClaims: { admin: uid === 'admin' } }) } }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } } }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('./username', () => ({ validateChosenUsername: (username: string) => ({ valid: true, username }) }));
import { recordSignupConsent,setMarketingConsent } from './consent';
import { getMyEligibility, declareSellerActivity } from './eligibility';
import signupPolicy from '../shared/signupConsentPolicy.json';
import activityPolicy from '../shared/sellerActivityPolicy.json';
import { readSellerActivitySource, readEligibilityEvidence, sellerActivityReceiptDto } from '../utils/eligibility';
import { Timestamp } from 'firebase-admin/firestore';

const call = (fn: any, data: any = {}, uid = 'owner') => fn({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000) } }, data });
const read = () => call(getMyEligibility);
async function payload() {
  return { dateOfBirth: '2000-01-01', acceptedTerms: true, acceptedPrivacy: true, marketingOptIn: true,
    desiredUsername: 'chosen', policyVersion: signupPolicy.version, sellerActivityDeclaration: {
      kind: 'personal', statementVersion: activityPolicy.version, personalDeclarationAccepted: true,
      expectedVersion: (await read()).version, expectedUid: 'owner', requestId: 'signup-one' } };
}
const consents = () => fs.db.collection('users/owner/consents').get();
describe('phase1 canonical marketing endpoint used by privacy settings',()=>{
  it('records grant then withdrawal and observes the exact native receipt without another write',async()=>{
    fs.setDoc('users/owner',{isActive:true,preferences:{notifications:{essential:true}}});
    const grant=await call(setMarketingConsent,{expectedUid:'owner',enabled:true,mode:'request'});
    expect(grant).toMatchObject({ownerId:'owner',enabled:true,decisionCommitted:true,requestReceiptMatched:true});
    const withdrawn=await call(setMarketingConsent,{expectedUid:'owner',enabled:false,mode:'request'});
    expect(withdrawn).toMatchObject({ownerId:'owner',enabled:false,decisionCommitted:true,requestReceiptMatched:true});
    const writes=fs.writeOps.length,observed=await call(setMarketingConsent,{expectedUid:'owner',mode:'observe'});
    expect(observed).toMatchObject({ownerId:'owner',enabled:false,mode:'observed',decisionCommitted:false});
    expect(observed.consentId).toBe(withdrawn.consentId);expect(fs.writeOps).toHaveLength(writes);
    expect((await consents()).size).toBe(2);expect(fs.getDoc('users/owner')?.preferences.notifications.essential).toBe(true);
  });
  it.each([null,{malformed:true}])('refuses a present erasure fence %j before writing or returning a private receipt',async fence=>{
    fs.setDoc('eligibility_profiles/owner',{accountErasureFence:fence});
    await expect(call(setMarketingConsent,{expectedUid:'owner',enabled:false,mode:'request'})).rejects.toBeDefined();
    await expect(call(setMarketingConsent,{expectedUid:'owner',mode:'observe'})).rejects.toBeDefined();expect(fs.writeOps).toHaveLength(0);
  });
  it('rejects another SDK owner without appending a consent proof',async()=>{
    await expect(call(setMarketingConsent,{expectedUid:'other',enabled:true,mode:'request'})).rejects.toBeDefined();expect(fs.writeOps).toHaveLength(0);
  });
});
beforeEach(() => {
  fs.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T16:00:00Z'));
  fs.setDoc('users/owner', { email: 'owner@example.invalid', isActive: true });
});
afterEach(() => vi.useRealTimers());

describe('signup atomically captures the explicit prospective personal declaration', () => {
  it('records native original evidence, legal document versions, marketing and username together', async () => {
    const data = await payload(); await expect(call(recordSignupConsent, data)).resolves.toMatchObject({ ok: true, username: 'chosen' });
    const dto = await read(), profile = fs.getDoc('eligibility_profiles/owner')!;
    expect(dto.decisions.sell.allowed).toBe(true);
    expect(profile.activityDeclaration).toMatchObject({ statement: activityPolicy.statements.personal, statementVersion: activityPolicy.version, personalDeclarationAccepted: true });
    expect(profile.marketingConsent).toMatchObject({ ownerId: 'owner', granted: true, revision: 1 });
    const event = fs.getDoc('eligibility_audit/' + profile.activityDeclaration.receiptId)!;
    expect(sellerActivityReceiptDto(profile.activityDeclaration.receiptId, event, 'owner').qualification).toBe('native_original');
    const source = await fs.db.runTransaction(async tx => readSellerActivitySource(tx, await readEligibilityEvidence(tx, 'owner')));
    expect(source.qualification).toBe('native_original');
    const legal = (await consents()).docs.map(d => d.data());
    expect(legal).toContainEqual(expect.objectContaining({ type: 'terms', version: signupPolicy.termsVersion, signupPolicyVersion: signupPolicy.version }));
    expect(legal).toContainEqual(expect.objectContaining({ type: 'privacy_policy', version: signupPolicy.privacyVersion }));
    expect(fs.getDoc('users/owner')).toMatchObject({ dateOfBirth: data.dateOfBirth, dateOfBirthVersion: 1, username: 'chosen' });
  });
  it.each(['missing', 'unchecked', 'professional', 'stale-wording', 'other-owner', 'extra-field', 'stale-cas', 'stale-policy'])('rejects %s without any mutation', async variant => {
    const data: any = await payload();
    if (variant === 'missing') delete data.sellerActivityDeclaration;
    if (variant === 'unchecked') data.sellerActivityDeclaration.personalDeclarationAccepted = false;
    if (variant === 'professional') data.sellerActivityDeclaration.kind = 'professional';
    if (variant === 'stale-wording') data.sellerActivityDeclaration.statementVersion = '2026-10-10.v1';
    if (variant === 'other-owner') data.sellerActivityDeclaration.expectedUid = 'another';
    if (variant === 'extra-field') data.sellerActivityDeclaration.allowed = true;
    if (variant === 'stale-cas') data.sellerActivityDeclaration.expectedVersion = 'a'.repeat(64);
    if (variant === 'stale-policy') data.policyVersion = '2026-05-31';
    await expect(call(recordSignupConsent, data)).rejects.toBeInstanceOf(Error);
    expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('users/owner')!.dateOfBirth).toBeUndefined();
  });
  it('username conflict leaves no partial declaration, marketing or legal proof', async () => {
    fs.setDoc('usernames/chosen', { uid: 'other' });
    await expect(call(recordSignupConsent, await payload())).rejects.toMatchObject({ code: 'already-exists' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('exact replay including object key reorder survives stale CAS without duplicate proofs or overwriting later choices', async () => {
    const data = await payload(); await call(recordSignupConsent, data);
    const profile = fs.getDoc('eligibility_profiles/owner')!;
    fs.setDoc('eligibility_profiles/owner', { ...profile, version: 8, marketingConsent: { ...profile.marketingConsent, granted: false, revision: 2 },
      activityDeclaration: { ...profile.activityDeclaration, kind: 'professional' } });
    const count = fs.writeOps.length;
    await expect(call(recordSignupConsent, { ...Object.fromEntries(Object.entries(data).reverse()),
      sellerActivityDeclaration: Object.fromEntries(Object.entries(data.sellerActivityDeclaration).reverse()) })).resolves.toMatchObject({ ok: true });
    expect(fs.writeOps).toHaveLength(count); expect((await consents()).size).toBe(3);
    expect(fs.getDoc('eligibility_profiles/owner')).toMatchObject({ version: 8, marketingConsent: { granted: false }, activityDeclaration: { kind: 'professional' } });
  });
  it.each(['marketingOptIn', 'desiredUsername', 'dateOfBirth', 'policyVersion'])('same requestId cannot accept a changed signup %s', async field => {
    const data: any = await payload(); await call(recordSignupConsent, data); const count = fs.writeOps.length;
    const changed: any = { marketingOptIn: false, desiredUsername: 'another', dateOfBirth: '1999-01-01', policyVersion: 'other' };
    await expect(call(recordSignupConsent, { ...data, [field]: changed[field] })).rejects.toMatchObject({ code: 'already-exists' });
    expect(fs.writeOps).toHaveLength(count);
  });
  it('a standalone activity receipt cannot be adopted as a signup receipt', async () => {
    const data = await payload(); await call(declareSellerActivity, data.sellerActivityDeclaration); const count = fs.writeOps.length;
    await expect(call(recordSignupConsent, data)).rejects.toMatchObject({ code: 'already-exists' });
    expect(fs.writeOps).toHaveLength(count); expect(fs.getDoc('users/owner')!.dateOfBirth).toBeUndefined();
  });
  it('preserves an existing marketing withdrawal during the first signup', async () => {
    fs.setDoc('eligibility_profiles/owner', { version: 2, marketingConsent: { granted: false, revision: 3, ownerId: 'owner' } });
    await call(recordSignupConsent, await payload());
    expect(fs.getDoc('eligibility_profiles/owner')).toMatchObject({ version: 3, marketingConsent: { granted: false, revision: 3 }, activityDeclaration: { kind: 'personal' } });
    expect((await consents()).size).toBe(2);
  });
  it('does not create or replace a declaration for an already completed account', async () => {
    fs.setDoc('users/owner', { dateOfBirth: '2000-01-01', username: 'legacy', isActive: true });
    fs.setDoc('eligibility_profiles/owner', { version: 4, activityDeclaration: { kind: 'professional', recordedAt: Timestamp.now() } });
    const data = await payload();
    await expect(call(recordSignupConsent, data)).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'signup_already_completed' } });
    expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('eligibility_profiles/owner')!.version).toBe(4);
  });
});
