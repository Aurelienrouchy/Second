import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock();
holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) },
  get db() { return holder.fs!.db; },
  get FieldValue() { return holder.fs!.FieldValue; },
}));
vi.mock('../services/brands', () => ({ matchBrand: vi.fn(), BRAND_MATCHING: { strongThreshold: 1 } }));
vi.mock('../utils/articleMedia', () => ({ promoteArticleImages: vi.fn() }));
vi.mock('firebase-functions/v2/https', async () => {
  const actual = await vi.importActual<typeof import('firebase-functions/v2/https')>('firebase-functions/v2/https');
  return { ...actual, onCall: (_options: unknown, handler: unknown) => handler };
});
import { toggleArticleSold, updateArticle } from './products';
import { promoteArticleImages } from '../utils/articleMedia';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
type Handler = (request: { auth: { uid: string }; data: Record<string, unknown> }) => Promise<unknown>;
const toggle = toggleArticleSold as unknown as Handler;
const edit = updateArticle as unknown as Handler;
const snapshotTime = { seconds: 1800000000, nanoseconds: 1 };
const expectedRevision = createHash('sha256').update(JSON.stringify(['item', 'seller', snapshotTime.seconds, snapshotTime.nanoseconds])).digest('hex');
const request = { auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'seller' }, data: { expectedUid: 'seller', operation: 'set', articleId: 'item', requestId: 'sold-gesture',
  desiredIsSold: true, expectedIsSold: false, expectedRevision } };
const originalTransaction = fs.db.runTransaction.bind(fs.db);
const article = { sellerId: 'seller', title: 'Article', price: 20, isSold: false, isActive: true };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(promoteArticleImages).mockReset();
  fs.reset();
  // Representative updateTime for these existing commitment fixtures only.
  // Revision changes/replays are exercised in articleSoldIntent.test.ts.
  vi.spyOn(fs.db, 'runTransaction').mockImplementation(handler => originalTransaction(async tx => handler({ ...tx,
    get: (async (target: any) => { const snap = await (tx.get as any)(target);
      return target.path && snap.exists ? { ...snap, updateTime: snapshotTime } : snap; }) as typeof tx.get,
  })));
  fs.setDoc('articles/item', article);
  fs.setDoc('users/seller', { dateOfBirth: '2000-01-01' });
  fs.setDoc('eligibility_profiles/seller', { version: 1, activityDeclaration: { kind: 'personal', actorUid: 'seller',
    recordedAt: new Date(), declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
});

describe('article commitment guards', () => {
  it.each(['pending_payment', 'paid', 'label_created', 'shipped', 'delivered', 'disputed', 'refund_in_progress', 'meetup_pending', 'meetup_confirmed'])
    ('blocks sold-toggle and edits while %s holds the article, including legacy missing isSold locks', async (status) => {
      fs.setDoc('transactions/agreement', { articleId: 'item', status });
      await expect(toggle(request)).rejects.toMatchObject({ code: 'failed-precondition' });
      await expect(edit({ ...request, data: { articleId: 'item', updates: { price: 15 } } }))
        .rejects.toMatchObject({ code: 'failed-precondition' });
      expect(fs.getDoc('articles/item')).toEqual(article);
    });

  it('cannot clear acceptance that arrived after a stale preflight query', async () => {
    const original = fs.db.runTransaction.bind(fs.db);
    vi.spyOn(fs.db, 'runTransaction').mockImplementationOnce(async (handler) => {
      fs.setDoc('transactions/agreement', { articleId: 'item', status: 'meetup_pending', amount: 18 });
      fs.setDoc('articles/item', { ...article, isSold: true, activeTransactionId: 'agreement' });
      return original(handler);
    });
    await expect(toggle(request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('articles/item')?.isSold).toBe(true);
    expect(fs.getDoc('articles/item')?.activeTransactionId).toBe('agreement');
    expect(fs.getDoc('transactions/agreement')?.amount).toBe(18);
  });

  it('allows an explicit seller change after the exact linked agreement was cancelled', async () => {
    fs.setDoc('articles/item', { ...article, activeTransactionId: 'agreement' });
    fs.setDoc('transactions/agreement', { articleId: 'item', status: 'cancelled' });
    await edit({ ...request, data: { articleId: 'item', updates: { price: 15 } } });
    expect(fs.getDoc('articles/item')?.price).toBe(15);
    expect(fs.getDoc('transactions/agreement')?.status).toBe('cancelled');
  });

  it('fails closed for an unresolved accepted link even if the article query misses it', async () => {
    fs.setDoc('articles/item', { ...article, activeTransactionId: 'missing-agreement' });
    await expect(toggle(request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('articles/item')?.isSold).toBe(false);
  });

  it('keeps legitimate title edits and soft deletes available through the callable', async () => {
    await edit({ ...request, data: { articleId: 'item', updates: { title: 'Un autre article' } } });
    expect(fs.getDoc('articles/item')?.title).toBe('Un autre article');
    await edit({ ...request, data: { articleId: 'item', updates: { isActive: false } } });
    expect(fs.getDoc('articles/item')?.isActive).toBe(false);
  });

  it.each(['foreign', 'missing', 'sold', 'inactive', 'legacy-agreement'])
    ('rejects %s article edits before creating any promoted Storage copies', async (state) => {
      if (state === 'foreign') fs.setDoc('articles/item', { ...article, sellerId: 'other' });
      if (state === 'missing') fs.setDoc('articles/item', null);
      if (state === 'sold') fs.setDoc('articles/item', { ...article, isSold: true });
      if (state === 'inactive') fs.setDoc('articles/item', { ...article, isActive: false });
      if (state === 'legacy-agreement') fs.setDoc('transactions/agreement', { articleId: 'item', status: 'meetup_disputed' });
      await expect(edit({ ...request, data: { articleId: 'item', updates: { images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fseller%2Fd%2Fimage.jpg?alt=media' }] } } })).rejects.toMatchObject({ code: state === 'foreign' ? 'permission-denied' : state === 'missing' ? 'not-found' : 'failed-precondition' });
      expect(promoteArticleImages).not.toHaveBeenCalled();
      expect(fs.writeOps).toHaveLength(0);
    });

  it('rechecks a commitment accepted during image promotion before publishing the new images', async () => {
    vi.mocked(promoteArticleImages).mockImplementationOnce(async () => {
      fs.setDoc('articles/item', { ...article, isSold: true, activeTransactionId: 'agreement' });
      fs.setDoc('transactions/agreement', { articleId: 'item', status: 'meetup_pending' });
      return [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/articles%2Fitem%2Fimage.jpg?alt=media' }];
    });
    await expect(edit({ ...request, data: { articleId: 'item', updates: { images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fseller%2Fd%2Fimage.jpg?alt=media' }] } } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(promoteArticleImages).toHaveBeenCalledOnce();
    expect(fs.getDoc('articles/item')?.images).toBeUndefined();
    expect(fs.getDoc('articles/item')?.activeTransactionId).toBe('agreement');
  });

  it('publishes validated promoted images for an available owned article', async () => {
    const images = [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/articles%2Fitem%2Fimage.jpg?alt=media' }];
    vi.mocked(promoteArticleImages).mockResolvedValueOnce(images);
    await edit({ ...request, data: { articleId: 'item', updates: { images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fseller%2Fd%2Fimage.jpg?alt=media' }] } } });
    expect(fs.getDoc('articles/item')?.images).toEqual(images);
  });
});
