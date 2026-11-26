import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createFirestoreMock, type MockFirestore} from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({fs: null as MockFirestore | null, metadata: vi.fn(), nativeOrder: vi.fn(), privateImage: vi.fn()}));
const fs = createFirestoreMock({enforceReadBeforeWrite: true}); holder.fs = fs;
vi.mock('../config/firebase', () => ({get db() {return holder.fs!.db;},
  storage: {bucket: () => ({name: 'seconde-dev.firebasestorage.app', file: (path: string) => ({getMetadata: () => holder.metadata(path)})})}}));
vi.mock('firebase-functions/v2/https', () => ({onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {constructor(public code: string, message: string, public details?: unknown) {super(message);}}}));
vi.mock('firebase-functions/logger', () => ({info() {}, warn() {}, error() {}}));
vi.mock('../utils/privateAccountSession', () => ({withPrivateAccountSession: (_request: unknown, execute: () => unknown) => execute(),
  assertPrivateAccountSession: async () => ({currentAdminClaim: false})}));
vi.mock('../utils/privateMedia', () => ({preservePrivateImage: vi.fn(), readPrivateImage: holder.privateImage,
  sourceImageWitness: vi.fn(), nativeSwapAgreement: vi.fn(), readNativeOrderAgreement: holder.nativeOrder}));
vi.mock('../utils/reportEvidence', () => ({preserveArticleReportEvidenceBeforeDeletion: vi.fn()}));
import {readPrivateArticleEvidence, readPrivateArticleMedia} from './articlePrivacy';
const evidence = readPrivateArticleEvidence as unknown as (request: any) => Promise<any>;
const media = readPrivateArticleMedia as unknown as (request: any) => Promise<any>;
const sourceUrl = 'https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/articles%2Farticle%2Fphoto?alt=media&token=source-token';
const sourceHash = createHash('sha256').update(sourceUrl).digest('hex');
const request = (uid = 'buyer', overrides: Record<string, unknown> = {}) => ({auth: {uid},
  data: {expectedUid: uid, articleId: 'article', transactionId: 'reservation', sourceReferenceHashes: [sourceHash], ...overrides}});
const patch = (path: string, data: Record<string, unknown>) => fs.setDoc(path, {...fs.getDoc(path), ...data});
beforeEach(() => {
  fs.reset(); vi.clearAllMocks(); holder.nativeOrder.mockResolvedValue(null);
  holder.metadata.mockResolvedValue([{generation: '123', crc32c: 'crc', contentType: 'image/jpeg', size: '100',
    metadata: {firebaseStorageDownloadTokens: 'source-token'}}]);
  fs.setDoc('articles/article', {sellerId: 'seller', isActive: true, isSold: true, moderationStatus: 'approved',
    activeTransactionId: 'reservation', images: [{url: sourceUrl}]});
  fs.setDoc('transactions/reservation', {buyerId: 'buyer', sellerId: 'seller', articleId: 'article', deliveryType: 'shipping',
    status: 'pending_payment', currency: 'CAD', createdAt: Timestamp.fromMillis(Date.now() - 60_000), articleSnapshot: {images: [{url: sourceUrl}]}});
});

describe('public photo during the current unpaid checkout reservation', () => {
  it('qualifies only the exact public reference, with no private media or financial writes', async () => {
    const result = await evidence(request());
    expect(result).toMatchObject({kind: 'private_article_evidence_v1', state: 'unrecorded', viewerId: 'buyer',
      publicReferenceUseAllowed: true, publicReferenceHashes: [sourceHash], snapshot: null, evidenceId: null, mediaRefs: []});
    expect(holder.nativeOrder).toHaveBeenCalledTimes(2);
    expect(holder.metadata).toHaveBeenCalledWith('articles/article/photo');
    expect(fs.writeOps).toHaveLength(0);
  });

  it.each([
    ['other buyer', 'transactions/reservation', {buyerId: 'other'}],
    ['other seller', 'transactions/reservation', {sellerId: 'other'}],
    ['other article', 'transactions/reservation', {articleId: 'other'}],
    ['previous reservation', 'articles/article', {activeTransactionId: 'other'}],
    ['inactive listing', 'articles/article', {isActive: false}],
    ['unreserved listing', 'articles/article', {isSold: false}],
    ['moderated listing', 'articles/article', {moderationStatus: 'pending'}],
    ['cancelled purchase', 'transactions/reservation', {status: 'cancelled'}],
    ['paid marker without private contract proof', 'transactions/reservation', {status: 'paid', paidAt: Timestamp.now()}],
    ['order privacy marker', 'transactions/reservation', {articlePrivacyWithdrawal: null}],
  ])('refuses %s', async (_label, path, changes) => {
    patch(path as string, changes as Record<string, unknown>);
    await expect(evidence(request())).rejects.toMatchObject({code: 'permission-denied'});
    expect(holder.metadata).not.toHaveBeenCalled(); expect(fs.writeOps).toHaveLength(0);
  });

  it('rejects another requested transaction and another authenticated member', async () => {
    await expect(evidence(request('buyer', {transactionId: 'other'}))).rejects.toMatchObject({code: 'permission-denied'});
    await expect(evidence(request('stranger'))).rejects.toMatchObject({code: 'permission-denied'});
    expect(holder.metadata).not.toHaveBeenCalled();
  });

  it('refuses a snapshot photo that no longer exactly matches the current listing', async () => {
    patch('transactions/reservation', {articleSnapshot: {images: [{url: sourceUrl + '-old'}]}});
    await expect(evidence(request())).rejects.toMatchObject({code: 'permission-denied'});
    expect(holder.metadata).not.toHaveBeenCalled();
  });

  it('does not authorize an arbitrary hash or a source whose download token was revoked', async () => {
    const unrelated = await evidence(request('buyer', {sourceReferenceHashes: ['0'.repeat(64)]}));
    expect(unrelated).toMatchObject({publicReferenceUseAllowed: false, publicReferenceHashes: [], mediaRefs: []});
    expect(holder.metadata).not.toHaveBeenCalled();
    holder.metadata.mockResolvedValue([{metadata: {firebaseStorageDownloadTokens: 'new-token'}}]);
    const revoked = await evidence(request());
    expect(revoked).toMatchObject({publicReferenceUseAllowed: false, publicReferenceHashes: [], mediaRefs: []});
  });

  it('never turns an unpaid reservation into permission to read private pixels', async () => {
    await expect(media(request('buyer', {evidenceId: '0'.repeat(64), mediaId: '1'.repeat(64)}))).rejects.toMatchObject({code: 'not-found'});
    expect(holder.privateImage).not.toHaveBeenCalled(); expect(fs.writeOps).toHaveLength(0);
  });

  it('refuses a privacy withdrawal even when its marker value is null', async () => {
    patch('articles/article', {privacyWithdrawal: null});
    await expect(evidence(request())).rejects.toMatchObject({code: 'failed-precondition'});
    expect(holder.metadata).not.toHaveBeenCalled();
  });

  it('refuses a privacy dossier appearing before the reservation read, even without a public marker', async () => {
    holder.nativeOrder.mockImplementationOnce(async () => {
      fs.setDoc('article_privacy_evidence/article', {schemaVersion: 1, articleId: 'article', ownerId: 'seller'});
      return null;
    });
    await expect(evidence(request())).rejects.toMatchObject({code: 'permission-denied'});
    expect(holder.metadata).not.toHaveBeenCalled(); expect(fs.writeOps).toHaveLength(0);
  });

  it.each(['privacy', 'reservation', 'photo'])('rechecks %s after Storage IO before returning permission', async change => {
    const metadata = {metadata: {firebaseStorageDownloadTokens: 'source-token'}};
    holder.metadata.mockImplementationOnce(async () => {
      if (change === 'privacy') patch('articles/article', {privacyWithdrawal: null});
      else if (change === 'reservation') patch('articles/article', {activeTransactionId: 'other'});
      else patch('articles/article', {images: [{url: sourceUrl + '-new'}]});
      return [metadata];
    });
    await expect(evidence(request())).rejects.toMatchObject({code: change === 'privacy' ? 'failed-precondition' : 'permission-denied'});
    expect(fs.writeOps).toHaveLength(0);
  });
});
