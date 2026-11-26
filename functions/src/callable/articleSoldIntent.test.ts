import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../services/brands', () => ({ matchBrand: vi.fn(), BRAND_MATCHING: { autoSelectThreshold: 1 } }));
vi.mock('../utils/articleMedia', () => ({ promoteArticleImages: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('firebase-functions/v2/https', async () => {
  const actual = await vi.importActual<typeof import('firebase-functions/v2/https')>('firebase-functions/v2/https');
  return { ...actual, onCall: (_options: unknown, handler: unknown) => handler };
});
import { toggleArticleSold } from './products';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';

type Request = { auth?: { uid: string }; data: unknown };
const run = toggleArticleSold as unknown as (request: Request) => Promise<any>;
const send = (data: unknown, uid = 'seller') => run({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid }, data });
const article = { sellerId: 'seller', isSold: false, isActive: true, title: 'Article', price: 20 };
const stamps = new Map<string, { seconds: number; nanoseconds: number }>();
let tick = 100;
let retryMutation: (() => void) | null = null;
const discardedWrites: unknown[][] = [];
const originalTransaction = fs.db.runTransaction.bind(fs.db);
function seed(path: string, data: Record<string, unknown> | null) {
  fs.setDoc(path, data); stamps.set(path, { seconds: 1800000000, nanoseconds: ++tick });
}
function revision(articleId = 'item', uid = 'seller') {
  const stamp = stamps.get('articles/' + articleId)!;
  return createHash('sha256').update(JSON.stringify([articleId, uid, stamp.seconds, stamp.nanoseconds])).digest('hex');
}
function intent(desiredIsSold = true, requestId = 'sold-gesture', extra: Record<string, unknown> = {}) {
  return { operation: 'set', articleId: 'item', requestId, desiredIsSold,
    expectedIsSold: fs.getDoc('articles/item')?.isSold === true, expectedRevision: revision(), ...extra };
}
function receiptId(requestId = 'sold-gesture', uid = 'seller') {
  return createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex');
}
const receiptPath = (requestId = 'sold-gesture', uid = 'seller') => 'article_sold_requests/' + receiptId(requestId, uid);

beforeEach(() => {
  vi.restoreAllMocks(); fs.reset(); stamps.clear(); tick = 100; retryMutation = null; discardedWrites.length = 0;
  seed('articles/item', article);
  seed('users/seller', { dateOfBirth: '2000-01-01' });
  seed('eligibility_profiles/seller', { version: 1, activityDeclaration: { kind: 'personal', actorUid: 'seller',
    recordedAt: new Date(), declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal,
    statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
  // Local Timestamp-shaped fields only. The shared mock has neither native
  // updateTime nor conflict retries. This adapter models one atomic commit stamp
  // and explicitly discards an attempt for the two named retry cases below.
  vi.spyOn(fs.db, 'runTransaction').mockImplementation(async (handler) => {
    const invoke = (discard: boolean) => originalTransaction(async (tx) => {
      const paths = new Set<string>(); const staged: unknown[] = [];
      const wrapped = { ...tx,
        get: async (target: any) => {
          const snap = await (tx.get as any)(target);
          return target.path && snap.exists ? { ...snap, updateTime: stamps.get(target.path) } : snap;
        },
        update: (ref: any, data: any) => { paths.add(ref.path); staged.push({ method: 'update', path: ref.path, data }); tx.update(ref, data); },
        create: (ref: any, data: any) => { paths.add(ref.path); staged.push({ method: 'create', path: ref.path, data }); tx.create(ref, data); },
      };
      const result = await handler(wrapped);
      if (discard) { discardedWrites.push(staged); throw new Error('LOCAL_DISCARD_ATTEMPT'); }
      if (paths.size) {
        const stamp = { seconds: 1800000000, nanoseconds: ++tick };
        paths.forEach(path => stamps.set(path, stamp));
      }
      return result;
    });
    if (retryMutation) {
      const mutation = retryMutation; retryMutation = null;
      await invoke(true).catch(error => { if (error.message !== 'LOCAL_DISCARD_ATTEMPT') throw error; });
      mutation();
    }
    return invoke(false);
  });
});

describe('R03 explicit article sold intent canonical handler probes', () => {
  it('C01 an old mark-sold intention cannot relist an already sold article', async () => {
    const captured = intent(); seed('articles/item', { ...article, isSold: true });
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    const result = await send(captured).catch(error => error);
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    expect(result).toMatchObject({ code: 'failed-precondition', details: { reason: 'article_sold_observation_stale' } });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('C02 identical repeated sold intention never inverts its first committed result', async () => {
    const captured = intent(); await send(captured);
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    const count = fs.writeOps.length; const replay = await send(captured);
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    expect(replay).toMatchObject({ success: true, outcome: 'replayed', isSold: true, requestId: captured.requestId });
    expect(fs.writeOps).toHaveLength(count);
  });
  it('C03 legacy articleId-only payload is rejected before writes', async () => {
    const result = await send({ articleId: 'item' }).catch(error => error);
    expect(fs.writeOps).toHaveLength(0); expect(result).toMatchObject({ code: 'invalid-argument' });
  });
  it('C04 observation is owner-only read-only access even without selling eligibility', async () => {
    seed('users/seller', {}); seed('eligibility_profiles/seller', null);
    seed('transactions/old', { articleId: 'item', status: 'meetup_pending' });
    const result = await send({ operation: 'observe', articleId: 'item' });
    expect(result).toEqual({ operation: 'observe', articleId: 'item', isSold: false, revision: revision() });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('C05 actual observation prepares one nominal sold then a fresh opposite relist gesture', async () => {
    const first = await send({ operation: 'observe', articleId: 'item' });
    expect(first.isSold).toBe(false); expect(fs.writeOps).toHaveLength(0);
    const sold = await send(intent(true, 'first', { expectedRevision: first.revision }));
    expect(sold).toEqual({ success: true, operation: 'set', outcome: 'applied', articleId: 'item', requestId: 'first', isSold: true, revision: null });
    const after = await send({ operation: 'observe', articleId: 'item' });
    expect(after.isSold).toBe(true); expect(after.revision).not.toBe(first.revision);
    const listed = await send(intent(false, 'second', { expectedRevision: after.revision }));
    expect(listed).toMatchObject({ outcome: 'applied', isSold: false });
    expect(fs.getDoc('articles/item')!.isSold).toBe(false);
    expect(fs.countWrites(op => op.path === 'articles/item')).toBe(2);
    expect(fs.getDoc(receiptPath('first'))).toMatchObject({ desiredIsSold: true, expectedIsSold: false });
    expect(fs.getDoc(receiptPath('second'))).toMatchObject({ desiredIsSold: false, expectedIsSold: true });
  });
  it('C06 replay after an opposite gesture retains history and reports current superseded state without writes', async () => {
    const old = intent(); await send(old); await send(intent(false, 'relist'));
    expect(fs.getDoc('articles/item')!.isSold).toBe(false);
    const count = fs.writeOps.length; const result = await send(old).catch(error => error);
    expect(fs.getDoc('articles/item')!.isSold).toBe(false);
    expect(result).toMatchObject({ code: 'failed-precondition', details: { reason: 'article_sold_intent_superseded', action: 'refreshArticle',
      appliedIsSold: true, currentIsSold: false, currentRevision: revision(), requestId: old.requestId } });
    expect(fs.getDoc(receiptPath())).toMatchObject({ desiredIsSold: true }); expect(fs.writeOps).toHaveLength(count);
  });
  it('C07 two concurrent identical intents commit once (shared mock serializes callbacks)', async () => {
    const old = intent(); const results = await Promise.all([send(old), send(old)]);
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    expect(results.map(result => result.outcome).sort()).toEqual(['applied', 'replayed']);
    expect(fs.countWrites(op => op.path === 'articles/item')).toBe(1);
    expect(fs.countWrites(op => op.path === receiptPath())).toBe(1);
  });
  it('C08 concurrent different request IDs cannot convert the loser into an opposite state', async () => {
    const a = intent(); const b = { ...a, requestId: 'different' };
    const results = await Promise.allSettled([send(a), send(b)]);
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(fs.countWrites(op => op.path === 'articles/item')).toBe(1);
  });
  it('C09 never-applied old request after external reservation/release ABA is stale even though its boolean matches', async () => {
    const old = intent(); seed('articles/item', { ...article, isSold: true }); seed('articles/item', article);
    expect(fs.getDoc('articles/item')!.isSold).toBe(old.expectedIsSold); expect(revision()).not.toBe(old.expectedRevision);
    await expect(send(old)).rejects.toMatchObject({ details: { reason: 'article_sold_observation_stale' } });
    expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc('articles/item')!.isSold).toBe(false);
  });
  it('C10 nanosecond-only revision change rejects a stale request (no millisecond truncation)', async () => {
    const old = intent(); const stamp = stamps.get('articles/item')!;
    stamps.set('articles/item', { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds + 1 });
    expect(revision()).not.toBe(old.expectedRevision);
    await expect(send(old)).rejects.toMatchObject({ details: { reason: 'article_sold_observation_stale' } });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('C11 a callback attempt discarded locally re-reads changed server state before any real commit', async () => {
    const old = intent(); retryMutation = () => seed('articles/item', { ...article, isSold: true });
    await expect(send(old)).rejects.toMatchObject({ details: { reason: 'article_sold_observation_stale' } });
    expect(discardedWrites).toHaveLength(1); expect(discardedWrites[0]).toHaveLength(2);
    expect(fs.writeOps).toHaveLength(0); expect(fs.getDoc(receiptPath())).toBeUndefined();
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
  });
  it('C12 a locally retried callback cannot clear a newly accepted agreement', async () => {
    const old = intent(); retryMutation = () => {
      seed('transactions/accepted', { articleId: 'item', status: 'meetup_pending' });
      seed('articles/item', { ...article, isSold: true, activeTransactionId: 'accepted' });
    };
    await expect(send(old)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(discardedWrites).toHaveLength(1); expect(fs.writeOps).toHaveLength(0);
    expect(fs.getDoc('articles/item')).toMatchObject({ isSold: true, activeTransactionId: 'accepted' });
  });
  it.each(['paid', 'meetup_pending', 'meetup_confirmed', 'legacy_unknown'])('C13 live agreement %s blocks a new manual sold intention', async status => {
    seed('transactions/agreement', { articleId: 'item', status });
    await expect(send(intent())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('articles/item')!.isSold).toBe(false); expect(fs.writeOps).toHaveLength(0);
  });
  it('C14 marking an old article sold is allowed without seller evidence, relisting remains refused', async () => {
    seed('users/seller', {}); seed('eligibility_profiles/seller', null);
    await send(intent()); expect(fs.getDoc('articles/item')!.isSold).toBe(true);
    const count = fs.writeOps.length;
    await expect(send(intent(false, 'relist'))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.getDoc('articles/item')!.isSold).toBe(true); expect(fs.writeOps).toHaveLength(count);
  });
  it.each([
    { desiredIsSold: 'true' }, { expectedIsSold: null }, { desiredIsSold: 1 }, { expectedIsSold: true },
    { expectedRevision: 'short' }, { expectedRevision: 'A'.repeat(64) }, { requestId: '' }, { requestId: 'a/b' },
    { requestId: 'a'.repeat(129) }, { articleId: '' }, { articleId: 'a/b' }, { articleId: {} }, { operation: 'toggle' },
    { extraUnboundField: true },
  ])('C15 malformed payload %j is rejected without writes', async extra => {
    await expect(send(intent(true, 'sold-gesture', extra))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it.each([null, [], 'item', 42])('C16 malformed envelope %j is rejected without writes', async data => {
    await expect(send(data)).rejects.toMatchObject({ code: 'invalid-argument' }); expect(fs.writeOps).toHaveLength(0);
  });
  it('C17 authentication is checked before any payload parsing', async () => {
    await expect(run({ data: null })).rejects.toMatchObject({ code: 'unauthenticated' }); expect(fs.writeOps).toHaveLength(0);
  });
  it.each(['observe', 'set'])('C18 %s cannot inspect or change a foreign article', async operation => {
    await expect(send(operation === 'set' ? intent() : { operation, articleId: 'item' }, 'stranger')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('C19 missing article gives not-found and cannot create a receipt', async () => {
    const old = intent(); seed('articles/item', null);
    await expect(send(old)).rejects.toMatchObject({ code: 'not-found' }); expect(fs.writeOps).toHaveLength(0);
  });
  it('C20 reused requestId with changed payload or another article is refused before any second write', async () => {
    await send(intent()); const count = fs.writeOps.length;
    await expect(send(intent(false))).rejects.toMatchObject({ code: 'already-exists' });
    seed('articles/other', article);
    await expect(send(intent(true, 'sold-gesture', { articleId: 'other', expectedIsSold: false, expectedRevision: revision('other') })))
      .rejects.toMatchObject({ code: 'already-exists' });
    expect(fs.writeOps).toHaveLength(count); expect(fs.getDoc('articles/other')!.isSold).toBe(false);
  });
  it('C21 requestId is scoped to the owner and cannot poison another seller receipt', async () => {
    seed('articles/other', { ...article, sellerId: 'otherSeller' });
    await send(intent());
    await send(intent(true, 'sold-gesture', { articleId: 'other', expectedIsSold: false, expectedRevision: revision('other', 'otherSeller') }), 'otherSeller');
    expect(fs.getDoc(receiptPath())).toMatchObject({ sellerId: 'seller', articleId: 'item' });
    expect(fs.getDoc(receiptPath('sold-gesture', 'otherSeller'))).toMatchObject({ sellerId: 'otherSeller', articleId: 'other' });
  });
  it('C22 replay after unrelated write reports superseded proof conservatively even if boolean unchanged', async () => {
    const old = intent(); await send(old); seed('articles/item', { ...fs.getDoc('articles/item')!, views: 1 });
    const count = fs.writeOps.length;
    await expect(send(old)).rejects.toMatchObject({ details: { reason: 'article_sold_intent_superseded', appliedIsSold: true, currentIsSold: true } });
    expect(fs.writeOps).toHaveLength(count); expect(fs.getDoc(receiptPath())).toBeDefined();
  });
  it('C23 invalid stored isSold/updateTime cannot yield a false observation or mutation', async () => {
    const old = intent(); seed('articles/item', { ...article, isSold: 'false' });
    await expect(send(old)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(fs.writeOps).toHaveLength(0);
    seed('articles/item', article); stamps.delete('articles/item');
    await expect(send({ operation: 'observe', articleId: 'item' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('C24 legacy absent isSold is observed as listed and can close without seller admission', async () => {
    const { isSold: _unused, ...legacy } = article; seed('articles/item', legacy); seed('users/seller', {}); seed('eligibility_profiles/seller', null);
    const before = await send({ operation: 'observe', articleId: 'item' }); expect(before.isSold).toBe(false);
    await send(intent()); expect(fs.getDoc('articles/item')!.isSold).toBe(true);
  });
  it.each(['annonce-é Québec', 'a'.repeat(129)])('C25 valid historical document ID %s remains closable without selling eligibility', async articleId => {
    seed('articles/' + articleId, article); seed('users/seller', {}); seed('eligibility_profiles/seller', null);
    const observed = await send({ operation: 'observe', articleId });
    expect(observed).toMatchObject({ articleId, isSold: false, revision: revision(articleId) });
    await send(intent(true, 'historical-id', { articleId, expectedRevision: observed.revision }));
    expect(fs.getDoc('articles/' + articleId)!.isSold).toBe(true);
    expect(fs.getDoc(receiptPath('historical-id'))).toMatchObject({ articleId, desiredIsSold: true });
  });
});
