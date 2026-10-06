import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock();
holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_: unknown, handler: unknown) => handler, onDocumentUpdated: (_: unknown, handler: unknown) => handler }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: vi.fn() }));
import { onArticleFavorited } from './favorites';
const run = onArticleFavorited as unknown as (event: unknown) => Promise<void>;
const event = (uid: string, before: unknown, after: unknown) => ({ params: { userId: uid }, data: { before: { data: () => before && ({ articleIds: before }) }, after: { data: () => after && ({ articleIds: after }) } } });

describe('favorite projection: creation, replay and ordering', () => {
  beforeEach(() => {
    fs.reset();
    fs.setDoc('articles/a', { sellerId: 'seller', title: 'Article', favoritesCount: 0, likes: 0 });
    fs.setDoc('search_index/a', { likes: 0 });
  });
  it('counts the first favorite document creation exactly once across retries', async () => {
    fs.setDoc('favorites/alice', { articleIds: ['a'] });
    await run(event('alice', null, ['a']));
    await run(event('alice', null, ['a']));
    expect(fs.getDoc('articles/a')).toMatchObject({ favoritesCount: 1, likes: 1 });
    expect(fs.getDoc('search_index/a')?.likes).toBe(1);
  });
  it('ignores stale like delivery after the live source has been unliked', async () => {
    fs.setDoc('favorites/bob', { articleIds: ['a'] });
    fs.setDoc('articles/a', { sellerId: 'seller', title: 'Article', favoritesCount: 1, likes: 1 });
    fs.setDoc('favorites/alice', { articleIds: [] });
    await run(event('alice', ['a'], []));
    await run(event('alice', null, ['a']));
    expect(fs.getDoc('articles/a')).toMatchObject({ favoritesCount: 1, likes: 1 });
    expect(fs.getDoc('search_index/a')?.likes).toBe(1);
  });
  it('preserves both buyers and decrements only the removed membership', async () => {
    fs.setDoc('favorites/alice', { articleIds: ['a'] });
    fs.setDoc('favorites/bob', { articleIds: ['a'] });
    await run(event('alice', null, ['a']));
    await run(event('bob', null, ['a']));
    fs.setDoc('favorites/alice', { articleIds: [] });
    await run(event('alice', ['a'], []));
    await run(event('alice', ['a'], []));
    expect(fs.getDoc('articles/a')).toMatchObject({ favoritesCount: 1, likes: 1 });
    expect(fs.getDoc('search_index/a')?.likes).toBe(1);
  });
  it('handles source deletion and a missing search index without negative counts', async () => {
    fs.setDoc('favorites/alice', { articleIds: ['a'] });
    await run(event('alice', null, ['a']));
    fs.setDoc('favorites/alice', null);
    fs.setDoc('search_index/a', null);
    await run(event('alice', ['a'], null));
    await run(event('alice', ['a'], null));
    expect(fs.getDoc('articles/a')).toMatchObject({ favoritesCount: 0, likes: 0 });
  });
  it('projects valid IDs in a malformed legacy event instead of retrying a poisoned ID forever', async () => {
    const malformed = [null, 17, {}, [], '', 'a/b', '.', '..', '__reserved__', 'x'.repeat(1501), 'a'];
    fs.setDoc('favorites/alice', { articleIds: malformed });
    await run(event('alice', null, malformed));
    await run(event('alice', null, malformed));
    expect(fs.getDoc('articles/a')).toMatchObject({ favoritesCount: 1, likes: 1 });
    expect(fs.writeOps.map((op) => op.path)).toEqual([
      'favorite_memberships/a/users/alice', 'articles/a', 'search_index/a',
      'favorite_memberships/a/users/alice', 'articles/a', 'search_index/a',
    ]);
  });
  it('handles a malformed live source and whole-list events without throwing or resurrecting a favorite', async () => {
    fs.setDoc('favorites/alice', { articleIds: {} });
    await run(event('alice', ['a', null], {}));
    await run(event('alice', null, ['a', null]));
    await run(event('alice', {}, 17));
    expect(fs.getDoc('articles/a')).toMatchObject({ favoritesCount: 0, likes: 0 });
    expect(fs.getDoc('favorite_memberships/a/users/alice')?.counted).toBe(false);
  });
});
