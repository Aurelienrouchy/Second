import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

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
});
