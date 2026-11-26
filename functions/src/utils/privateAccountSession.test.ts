import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { createFirestoreMock, type MockFirestore } from './testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null,
  user: {uid: 'owner', disabled: false, tokensValidAfterTime: '2026-10-17T10:00:00.000Z', customClaims: {admin: false}} as any,
  missing: false, networkFailure: false }));
const fs = createFirestoreMock({enforceReadBeforeWrite: true}); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() {return holder.fs!.db;}, get FieldValue() {return {...holder.fs!.FieldValue, serverTimestamp: () => Timestamp.now()};},
  auth: { getUser: async () => {if (holder.missing) throw Object.assign(Error('not found'), {code: 'auth/user-not-found'});
    if (holder.networkFailure) throw Error('network unavailable'); return holder.user;},
    revokeRefreshTokens: async () => {holder.user.tokensValidAfterTime = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();} } }));
vi.mock('firebase-functions/v2/https', () => ({onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {constructor(public code: string, message: string, public details?: unknown) {super(message);}}}));
vi.mock('firebase-functions/logger', () => ({info() {}, warn() {}, error() {}}));
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {secureMyAccount} from '../callable/accountSecurity';
import {getMyEligibility} from '../callable/eligibility';
const containedMs = Date.parse('2026-10-17T12:00:00.500Z');
const seconds = Math.floor(containedMs / 1000);
const request = (authTime = seconds + 1, data: any = {expectedUid: 'owner'}) => ({auth: {uid: 'owner', token: {auth_time: authTime}}, data});
async function contain() {
  await (secureMyAccount as any)(request(seconds - 30, {expectedUid: 'owner', requestId: 'containment_request_01',
    mode: 'execute', statementVersion: 'account_security_containment_v1', accepted: true}));
}
beforeEach(() => {
  fs.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date(containedMs));
  holder.missing = false; holder.networkFailure = false; holder.user = {uid: 'owner', disabled: false,
    tokensValidAfterTime: '2026-10-17T10:00:00.000Z', customClaims: {admin: false}};
  fs.setDoc('users/owner', {dateOfBirth: '2000-01-01', isActive: true});
});
afterEach(() => vi.useRealTimers());
describe('private account session after real native containment', () => {
  it.each([null, {}, {protocol: 'phase1_legacy_deletion_fence_v1', ownerId: 'owner'}])(
    'closes modern servicing for every present legacy deletion fence %j', async legacyDeletionFence => {
      fs.setDoc('eligibility_profiles/owner', {legacyDeletionFence});
      await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({
        code: 'failed-precondition', details: {reason: 'legacy_deletion_in_progress'},
      });
    });
  it('rejects the old JWT and every authentication during the containment second', async () => {
    await contain();
    await expect(assertPrivateAccountSession(request(seconds - 30))).rejects.toMatchObject({details: {reason: 'private_session_stale', action: 'reauthenticate'}});
    await expect(assertPrivateAccountSession(request(seconds))).rejects.toMatchObject({details: {reason: 'private_session_stale'}});
  });
  it('permits a fresh owner historical eligibility read without reopening commerce or clearing the barrier', async () => {
    await contain(); vi.setSystemTime(new Date(containedMs + 2000));
    const before = fs.getDoc('eligibility_profiles/owner');
    const dto = await (getMyEligibility as any)(request(seconds + 1, {}));
    expect(dto.dateOfBirth).toBe('2000-01-01'); expect(dto.decisions.buy.allowed).toBe(false);
    expect(dto.decisions.buy.reasons).toContain('account_security_contained');
    expect(fs.getDoc('eligibility_profiles/owner')).toEqual(before);
  });
  it.each([null, {}, {schemaVersion: 1, recordedAt: Timestamp.fromMillis(containedMs)}])('fails closed for a present malformed barrier %j', async barrier => {
    fs.setDoc('eligibility_profiles/owner', {accountSecurityBarrier: barrier});
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({details: {reason: 'private_session_unqualified'}});
  });
  it('does not accept an invented native journal after a real barrier', async () => {
    await contain(); const profile = fs.getDoc('eligibility_profiles/owner')!;
    fs.setDoc('eligibility_audit/' + (profile.accountSecurityBarrier as any).commandId, null);
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({details: {reason: 'private_session_unqualified'}});
  });
  it('checks current Auth cutoff, account existence, UID and disabled state rather than issued claims', async () => {
    vi.setSystemTime(new Date(containedMs + 4000));
    holder.user.tokensValidAfterTime = new Date((seconds + 2) * 1000).toISOString();
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({details: {reason: 'private_session_stale'}});
    holder.user.tokensValidAfterTime = '2026-10-17T10:00:00.000Z'; holder.user.disabled = true;
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({code: 'unauthenticated'});
    holder.user.disabled = false; holder.missing = true;
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({code: 'unauthenticated'});
    holder.missing = false;
    await expect(assertPrivateAccountSession(request(seconds + 1, {expectedUid: 'someone_else'}))).rejects.toMatchObject({code: 'unauthenticated'});
    holder.user.uid = 'someone_else';
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({code: 'unauthenticated'});
  });
  it('allows an absent barrier but rejects malformed session or cutoff dates', async () => {
    expect(await assertPrivateAccountSession(request())).toEqual({uid: 'owner', currentAdminClaim: false});
    await expect(assertPrivateAccountSession(request(NaN))).rejects.toMatchObject({code: 'unauthenticated'});
    holder.user.tokensValidAfterTime = 'unknown';
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({details: {reason: 'private_session_unqualified'}});
  });
  it('qualifies epoch zero but never invents an absent Auth cutoff or equates network failure with revocation', async () => {
    holder.user.tokensValidAfterTime = new Date(0).toISOString();
    expect((await assertPrivateAccountSession(request())).uid).toBe('owner');
    delete holder.user.tokensValidAfterTime;
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({details: {reason: 'private_session_unqualified'}});
    holder.networkFailure = true;
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({code: 'unavailable', details: {reason: 'private_session_unqualified'}});
  });
  it('rejects a future native barrier even when the presented session would be later', async () => {
    await contain(); vi.setSystemTime(new Date(containedMs - 250));
    await expect(assertPrivateAccountSession(request())).rejects.toMatchObject({details: {reason: 'private_session_unqualified'}});
  });
  it('does not disclose a result when native containment commits during a long read', async () => {
    await expect(withPrivateAccountSession(request(seconds - 30), async () => {await contain(); return {privateBody: 'secret'};}))
      .rejects.toMatchObject({details: {reason: 'private_session_stale'}});
  });
  it('rechecks the profile and current Auth inside every caller transaction attempt before writes', async () => {
    const readPaths: string[] = [];
    const tx = {get: async (ref: any) => {readPaths.push(ref.path); return ref.get();}};
    await assertPrivateAccountSession(request(seconds - 30), tx as any);
    await contain();
    await expect(assertPrivateAccountSession(request(seconds - 30), tx as any)).rejects.toMatchObject({details: {reason: 'private_session_stale'}});
    expect(readPaths).toContain('eligibility_profiles/owner');
  });
});
