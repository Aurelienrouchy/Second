/** Tiny real-SDK probe of the shared article read and swap-query predicate.
 * No provider, callable deployment, money movement or production project. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_SWAP_CROSS_RAIL_SDK_TESTS === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('Cross-rail probe requires demo-second loopback.');
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null }));
vi.mock('../config/firebase', () => ({ get db() { return holder.db!; } }));
import { assertArticleNotSwapEngaged } from './articleSwapEngagement';

describe.skipIf(!enabled)('cross-rail article serialization on the native SDK', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'swap-cross-rail-sdk') : null;
  const articleId = 'sdk_swap_cross_rail_article', swapId = 'sdk_swap_cross_rail_swap';
  beforeAll(() => { if (app) holder.db = getFirestore(app); });
  beforeEach(async () => {
    await holder.db!.doc('swaps/' + swapId).delete();
    await holder.db!.doc('articles/' + articleId).set({ isSold: false, sellerId: 'sdk_swap_cross_rail_seller' });
  });
  afterAll(async () => {
    if (!holder.db) return;
    await holder.db.doc('swaps/' + swapId).delete(); await holder.db.doc('articles/' + articleId).delete();
    if (app) await deleteApp(app);
  });
  it('allows an unengaged article without writing a swap or changing inventory', async () => {
    await holder.db!.runTransaction(tx => assertArticleNotSwapEngaged(tx, articleId));
    expect((await holder.db!.doc('swaps/' + swapId).get()).exists).toBe(false);
    expect((await holder.db!.doc('articles/' + articleId).get()).data()!.isSold).toBe(false);
  });
  it.each(['swap', 'purchase'] as const)('serializes concurrent rails when %s starts first', async firstRail => {
    let release!: () => void, reached!: () => void;
    const barrier = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let gated = false;
    const reserve = (rail: 'swap' | 'purchase') => holder.db!.runTransaction(async tx => {
      const article = await tx.get(holder.db!.doc('articles/' + articleId));
      if (article.data()!.isSold) throw new Error('article_already_reserved');
      if (rail === 'purchase') await assertArticleNotSwapEngaged(tx, articleId);
      else {
        const swaps = await tx.get(holder.db!.collection('swaps').where('articleIds', 'array-contains', articleId));
        if (!swaps.empty) throw new Error('article_already_in_swap');
      }
      if (rail === firstRail && !gated) { gated = true; reached(); await gate; }
      if (rail === 'purchase') tx.update(article.ref, { isSold: true, activeTransactionId: 'sdk_purchase' });
      else tx.set(holder.db!.doc('swaps/' + swapId), { status: 'proposed', articleIds: [articleId] });
      return rail;
    });
    const first = reserve(firstRail); await barrier;
    const second = reserve(firstRail === 'swap' ? 'purchase' : 'swap'); release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const sold = (await holder.db!.doc('articles/' + articleId).get()).data()!.isSold;
    const swap = (await holder.db!.doc('swaps/' + swapId).get()).exists;
    expect(Number(sold) + Number(swap)).toBe(1);
  }, 30_000);
});
