import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes, deleteObject } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';

function makeBytes(sizeBytes: number): Uint8Array {
  // Note: Storage emulator caps payloads; we keep tests under realistic sizes.
  return new Uint8Array(sizeBytes);
}

describe('storage rules', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });
  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'articles', 'article-1'), { sellerId: ALICE, isSold: false });
      await setDoc(doc(ctx.firestore(), 'chats', 'chat-1'), { participants: [ALICE, 'bob'] });
      await setDoc(doc(ctx.firestore(), 'swaps', 'swap-1'), { initiatorId: ALICE, receiverId: 'bob', status: 'photos_pending' });
    });
  });

  it('allows authenticated user to upload image/jpeg 1MB to /articles/...', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, 'articles/article-1/cover.jpg');
    await assertSucceeds(
      uploadBytes(r, makeBytes(1024 * 1024), { contentType: 'image/jpeg' }),
    );
  });

  it('denies authenticated user uploading application/pdf to /articles/...', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, 'articles/article-1/doc.pdf');
    await assertFails(
      uploadBytes(r, makeBytes(1024 * 1024), { contentType: 'application/pdf' }),
    );
  });

  it('denies authenticated user uploading 11MB image to /articles/...', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, 'articles/article-1/large.jpg');
    await assertFails(
      uploadBytes(r, makeBytes(11 * 1024 * 1024), { contentType: 'image/jpeg' }),
    );
  });

  it('allows anonymous read on public article paths', async () => {
    const env = await getTestEnv();
    // Seed via privileged context.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const r = ref(ctx.storage(), 'articles/article-1/public.jpg');
      await uploadBytes(r, makeBytes(1024), { contentType: 'image/jpeg' });
    });
    const storage = env.unauthenticatedContext().storage();
    const r = ref(storage, 'articles/article-1/public.jpg');
    await assertSucceeds(getBytes(r));
  });

  // F109 — swap photo proof upload must be allowed for an authenticated user.
  it('allows authenticated user to upload an image to /swaps/{id}/photos/...', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, `swaps/swap-1/photos/${ALICE}/0_123.jpg`);
    await assertSucceeds(
      uploadBytes(r, makeBytes(1024 * 1024), { contentType: 'image/jpeg' }),
    );
  });

  it('denies anonymous upload to /swaps/{id}/photos/...', async () => {
    const env = await getTestEnv();
    const storage = env.unauthenticatedContext().storage();
    const r = ref(storage, 'swaps/swap-1/photos/anon_0_123.jpg');
    await assertFails(
      uploadBytes(r, makeBytes(1024), { contentType: 'image/jpeg' }),
    );
  });

  it('denies authenticated user uploading a non-image to /swaps/{id}/photos/...', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, `swaps/swap-1/photos/${ALICE}/0_123.pdf`);
    await assertFails(
      uploadBytes(r, makeBytes(1024), { contentType: 'application/pdf' }),
    );
  });

  it('denies another account overwriting or deleting article media', async () => {
    const env = await getTestEnv();
    const owner = ref(env.authenticatedContext(ALICE).storage(), 'articles/article-1/cover.jpg');
    await assertSucceeds(uploadBytes(owner, makeBytes(10), { contentType: 'image/jpeg' }));
    const outsider = ref(env.authenticatedContext('mallory').storage(), owner.fullPath);
    await assertFails(uploadBytes(outsider, makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(outsider));
  });

  it('denies article media edits while reserved/sold, even to the owner', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'articles', 'article-1'), { sellerId: ALICE, isSold: true });
    });
    await assertFails(uploadBytes(ref(env.authenticatedContext(ALICE).storage(), 'articles/article-1/new.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
  });

  it('scopes prepublication staging and draft reads to the owner', async () => {
    const env = await getTestEnv();
    const owner = env.authenticatedContext(ALICE).storage();
    const path = 'drafts/alice/draft-1/photo.jpg';
    await assertSucceeds(uploadBytes(ref(owner, path), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(getBytes(ref(env.authenticatedContext('mallory').storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext('mallory').storage(), 'products/alice/temp_1/photo.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
  });

  it('binds chat reads/creates to participants and forbids overwrite/delete', async () => {
    const env = await getTestEnv();
    const path = 'chat_images/chat-1/photo.jpg';
    const image = ref(env.authenticatedContext(ALICE).storage(), path);
    await assertSucceeds(uploadBytes(image, makeBytes(10), { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(env.authenticatedContext('bob').storage(), path)));
    const outsider = ref(env.authenticatedContext('mallory').storage(), path);
    await assertFails(getBytes(outsider));
    await assertFails(uploadBytes(outsider, makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(image, makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(image));
  });

  it('keeps swap proofs immutable, private, and bound to the uploading participant', async () => {
    const env = await getTestEnv();
    const path = 'swaps/swap-1/photos/alice/proof.jpg';
    const image = ref(env.authenticatedContext(ALICE).storage(), path);
    await assertSucceeds(uploadBytes(image, makeBytes(10), { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(env.authenticatedContext('bob').storage(), path)));
    await assertFails(getBytes(ref(env.authenticatedContext('mallory').storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext('bob').storage(), 'swaps/swap-1/photos/alice/forged.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(image, makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(image));
  });
});
