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

  it('allows the owner to stage image/jpeg 1MB before server publication', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, 'drafts/alice/draft-1/cover.jpg');
    await assertSucceeds(
      uploadBytes(r, makeBytes(1024 * 1024), { contentType: 'image/jpeg' }),
    );
  });

  it('rejects SVG active content even for the article owner', async () => {
    const storage = (await getTestEnv()).authenticatedContext(ALICE).storage();
    await assertFails(uploadBytes(ref(storage, 'drafts/alice/draft-1/image.svg'), makeBytes(100), { contentType: 'image/svg+xml' }));
  });

  it('denies the owner staging application/pdf', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, 'drafts/alice/draft-1/doc.pdf');
    await assertFails(
      uploadBytes(r, makeBytes(1024 * 1024), { contentType: 'application/pdf' }),
    );
  });

  it('denies the owner staging an 11MB image', async () => {
    const env = await getTestEnv();
    const storage = env.authenticatedContext(ALICE).storage();
    const r = ref(storage, 'drafts/alice/draft-1/large.jpg');
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

  it('reserves published article creation, replacement and deletion to the server', async () => {
    const env = await getTestEnv();
    const path = 'articles/article-1/cover.jpg';
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), makeBytes(10), { contentType: 'image/jpeg' });
    });
    for (const uid of [ALICE, 'mallory']) {
      const storage = env.authenticatedContext(uid).storage();
      await assertFails(uploadBytes(ref(storage, 'articles/article-1/new.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(storage, path), makeBytes(10), { contentType: 'image/jpeg' }));
      await assertFails(deleteObject(ref(storage, path)));
    }
  });

  it('denies article media edits while reserved/sold, even to the owner', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'articles', 'article-1'), { sellerId: ALICE, isSold: true });
    });
    await assertFails(uploadBytes(ref(env.authenticatedContext(ALICE).storage(), 'articles/article-1/new.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
  });

  it.each(['meetup_disputed', 'meetup_pending', 'processing', 'missing'])
    ('denies owner media changes when an unsold article still has a %s transaction link', async (status) => {
      const env = await getTestEnv();
      const path = 'articles/article-1/locked.jpg';
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), path), makeBytes(10), { contentType: 'image/jpeg' });
        await setDoc(doc(ctx.firestore(), 'articles', 'article-1'), { sellerId: ALICE, isSold: false, activeTransactionId: 'agreement' });
        if (status !== 'missing') await setDoc(doc(ctx.firestore(), 'transactions', 'agreement'), { status, articleId: 'article-1' });
      });
      const owner = ref(env.authenticatedContext(ALICE).storage(), path);
      await assertFails(uploadBytes(owner, makeBytes(10), { contentType: 'image/jpeg' }));
      await assertFails(deleteObject(owner));
    });

  it.each(['cancelled', 'refunded', 'completed', 'meetup_completed'])
    ('keeps published media server-only after a linked transaction is %s', async (status) => {
      const env = await getTestEnv();
      const path = 'articles/article-1/retained.jpg';
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'articles', 'article-1'), { sellerId: ALICE, isSold: false, activeTransactionId: 'agreement' });
        await setDoc(doc(ctx.firestore(), 'transactions', 'agreement'), { status, articleId: 'article-1' });
        await uploadBytes(ref(ctx.storage(), path), makeBytes(10), { contentType: 'image/jpeg' });
      });
      const storage = env.authenticatedContext(ALICE).storage();
      await assertFails(uploadBytes(ref(storage, 'articles/article-1/new.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(storage, path), makeBytes(10), { contentType: 'image/jpeg' }));
      await assertFails(deleteObject(ref(storage, path)));
      // An edit stages a fresh private original; only updateArticle promotes it.
      await assertSucceeds(uploadBytes(ref(storage, `drafts/alice/edit-${status}/new.jpg`), makeBytes(10), { contentType: 'image/jpeg' }));
    });

  it('scopes prepublication staging and draft reads to the owner', async () => {
    const env = await getTestEnv();
    const owner = env.authenticatedContext(ALICE).storage();
    const path = 'drafts/alice/draft-1/photo.jpg';
    await assertSucceeds(uploadBytes(ref(owner, path), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(owner, path)));
    await assertFails(uploadBytes(ref(owner, path), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(ref(owner, path)));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path)));
    await assertFails(getBytes(ref(env.authenticatedContext('mallory').storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext('mallory').storage(), 'drafts/alice/draft-1/forged.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(env.authenticatedContext('mallory').storage(), 'products/alice/temp_1/photo.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
  });

  it('allows immutable participant chat uploads and requires the server reader for every read', async () => {
    const env = await getTestEnv();
    const path = 'chat_images/chat-1/alice/photo.jpg';
    const image = ref(env.authenticatedContext(ALICE).storage(), path);
    await assertSucceeds(uploadBytes(image, makeBytes(10), { contentType: 'image/jpeg' }));
    // readChatMessageImage checks session, chat and moderation server-side.
    await assertFails(getBytes(image));
    await assertFails(getBytes(ref(env.authenticatedContext('bob').storage(), path)));
    const outsider = ref(env.authenticatedContext('mallory').storage(), path);
    await assertFails(getBytes(outsider));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path)));
    await assertFails(uploadBytes(ref(env.authenticatedContext('mallory').storage(), 'chat_images/chat-1/forged.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(env.authenticatedContext('bob').storage(), 'chat_images/chat-1/alice/forged.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(env.authenticatedContext(ALICE).storage(), 'chat_images/chat-1/old-path.jpg'), makeBytes(10), { contentType: 'image/jpeg' }));
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
