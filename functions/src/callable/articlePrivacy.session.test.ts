import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createFirestoreMock, type MockFirestore} from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({fs: null as MockFirestore | null, authCalls: 0, revoked: false, revokeAfterFirstCheck: false}));
const fs = createFirestoreMock({enforceReadBeforeWrite: true}); holder.fs = fs;
vi.mock('../config/firebase', () => ({get db() {return holder.fs!.db;},
  storage: {bucket: () => ({name: 'seconde-dev.firebasestorage.app', getFiles: async () => [[], null]})},
  auth: {getUser: async (uid: string) => {
    holder.authCalls++;
    return {uid, disabled: false, tokensValidAfterTime: new Date(holder.revoked ||
      holder.revokeAfterFirstCheck && holder.authCalls > 1 ? Date.now() : 0).toISOString(), customClaims: {}};
  }}}));
vi.mock('firebase-functions/v2/https', () => ({onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {constructor(public code: string, message: string, public details?: unknown) {super(message);}}}));
vi.mock('firebase-functions/logger', () => ({info() {}, warn() {}, error() {}}));
vi.mock('../utils/privateMedia', () => ({preservePrivateImage: vi.fn(), readPrivateImage: vi.fn(), sourceImageWitness: vi.fn(),
  nativeSwapAgreement: vi.fn(), readNativeOrderAgreement: vi.fn()}));
vi.mock('../utils/reportEvidence', () => ({preserveArticleReportEvidenceBeforeDeletion: vi.fn()}));
import {withdrawArticlePrivacy} from './articlePrivacy';
const call = withdrawArticlePrivacy as unknown as (request: any) => Promise<any>;
const request = (mode: 'request'|'observe') => ({auth: {uid: 'owner', token: {auth_time: Math.floor(Date.now()/1000)-60}},
  data: {expectedUid: 'owner', articleId: 'article', requestId: 'privacy_request_0001', mode}});
beforeEach(() => {fs.reset(); holder.authCalls = 0; holder.revoked = false; holder.revokeAfterFirstCheck = false;
  fs.setDoc('articles/article', {sellerId: 'owner', title: 'Article', images: []});});
describe('privacy withdrawal admission uses current native session', () => {
  it('lets the current owner observe its unrecorded intention without writing or opening commerce', async () => {
    const result = await call(request('observe'));
    expect(result).toMatchObject({kind: 'article_privacy_withdrawal_v1', state: 'unrecorded', ownerId: 'owner', intentCommitted: false});
    expect(fs.writeOps).toHaveLength(0); expect(holder.authCalls).toBe(2);
  });
  it.each(['observe','request'] as const)('rejects a previously revoked JWT before %s can read or redact the listing', async mode => {
    holder.revoked = true;
    await expect(call(request(mode))).rejects.toMatchObject({code: 'unauthenticated', details: {reason: 'private_session_stale'}});
    expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('articles/article')?.title).toBe('Article');
  });
  it('rechecks Auth/barrier inside the first redaction transaction before committing effects', async () => {
    holder.revokeAfterFirstCheck = true;
    await expect(call(request('request'))).rejects.toMatchObject({code: 'unauthenticated'});
    expect(holder.authCalls).toBe(2); expect(fs.writeOps).toHaveLength(0);
    expect(fs.getDoc('article_privacy_evidence/article')).toBeUndefined();
  });
  it('withholds an observation if its current session is revoked during private reads', async () => {
    holder.revokeAfterFirstCheck = true;
    await expect(call(request('observe'))).rejects.toMatchObject({code: 'unauthenticated'});
    expect(fs.writeOps).toHaveLength(0);
  });
});
