import { assertFails } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';

const article = { sellerId: 'alice', title: 'Une chemise', price: 30, isActive: true, isSold: false, views: 2, likes: 1, favoritesCount: 1, likedBy: [], moderationStatus: 'approved', createdAt: new Date() };
describe('article server-owned fields and reservation', () => {
  beforeAll(getTestEnv);
  afterAll(teardownTestEnv);
  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'articles', 'a'), article); });
  });
  it('requires the guarded callable even for ordinary text edits and soft deletes', async () => {
    const ref = doc((await getTestEnv()).authenticatedContext('alice').firestore(), 'articles', 'a');
    await assertFails(updateDoc(ref, { title: 'Une autre chemise' }));
    await assertFails(updateDoc(ref, { isActive: false }));
    await assertFails(deleteDoc(ref));
  });
  it.each([[{ url: 'https://example.com/draft.jpg' }], {}, deleteField()])
    ('rejects direct image changes, malformed replacements and deletion', async (images) => {
      await assertFails(updateDoc(doc((await getTestEnv()).authenticatedContext('alice').firestore(), 'articles', 'a'), { images }));
    });
  it('cannot bypass a live legacy transaction whose article sold lock/link are missing', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'transactions', 'legacy-agreement'), { articleId: 'a', status: 'meetup_disputed' });
    });
    const ref = doc(env.authenticatedContext('alice').firestore(), 'articles', 'a');
    await assertFails(updateDoc(ref, { title: 'Autre titre', isActive: false }));
    await assertFails(deleteDoc(ref));
  });
  for (const field of ['isSold', 'likes', 'favoritesCount', 'views', 'likedBy', 'moderationStatus', 'createdAt']) {
    it(`rejects deleteField of ${field}`, async () => {
      await assertFails(updateDoc(doc((await getTestEnv()).authenticatedContext('alice').firestore(), 'articles', 'a'), { [field]: deleteField() }));
    });
  }
  it('rejects replacement set omitting the server lock', async () => {
    const { isSold: _isSold, ...withoutLock } = article;
    await assertFails(setDoc(doc((await getTestEnv()).authenticatedContext('alice').firestore(), 'articles', 'a'), withoutLock));
  });
  it('rejects reserved article editing/deletion, even by its owner', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'articles', 'a'), { ...article, isSold: true }); });
    const ref = doc(env.authenticatedContext('alice').firestore(), 'articles', 'a');
    await assertFails(updateDoc(ref, { title: 'Autre titre', isActive: false }));
    await assertFails(deleteDoc(ref));
  });
  it('requires server creation and blocks foreign edits', async () => {
    const env = await getTestEnv();
    await assertFails(setDoc(doc(env.authenticatedContext('alice').firestore(), 'articles', 'new'), article));
    await assertFails(updateDoc(doc(env.authenticatedContext('mallory').firestore(), 'articles', 'a'), { title: 'Mon titre' }));
  });
});
