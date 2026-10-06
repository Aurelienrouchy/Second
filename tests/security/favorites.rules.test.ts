import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';

describe('favorites identifiers', () => {
  beforeAll(getTestEnv);
  afterAll(teardownTestEnv);
  const write = async (articleIds: unknown[]) => {
    const db = (await getTestEnv()).authenticatedContext('alice').firestore();
    return setDoc(doc(db, 'favorites', 'alice'), { userId: 'alice', articleIds });
  };
  it('allows an empty list and canonical article IDs', async () => {
    await assertSucceeds(write([]));
    await assertSucceeds(write(['a', 'article-1', 'A_123']));
  });
  it.each([null, 17, true, {}, '', 'a/b', '.', '..', '__reserved__', 'a'.repeat(376)])
    ('rejects a malformed ID among valid favorites: %j', async (invalid) => {
      await assertFails(write(['a', invalid, 'article-1']));
    });
  it('rejects nested array IDs in the SDK before a rules request is possible', async () => {
    await expect(write(['a', [], 'article-1'])).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('retains the 500-entry cap', async () => {
    await assertSucceeds(write(Array.from({ length: 500 }, (_, i) => `article-${i}`)));
    await assertFails(write(Array.from({ length: 501 }, (_, i) => `article-${i}`)));
  });
  it('does not hide a reserved path segment behind a newline in another ID', async () => {
    await assertFails(write(['line\nbreak', '.']));
    await assertFails(write(['line\nbreak', '__reserved__']));
  });
});
