import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = await vi.hoisted(async () => {
  const { createFirestoreMock } = await import('./testHelpers/firestoreMock');
  return { fs: createFirestoreMock({ enforceReadBeforeWrite: true }), files: new Map<string, any>(), copy: vi.fn(), metadata: vi.fn(), getMetadata: vi.fn(), articles: [] as Array<{ images: Array<{ url: string } | string> }>, contentType: 'image/jpeg', size: 100 as number | string | undefined, exists: true };
});
vi.mock('../config/firebase', () => ({
  db: new Proxy({}, { get: (_target, key) => state.fs.db[key as keyof typeof state.fs.db] }),
  storage: { bucket: () => ({ name: 'test-bucket', file: (path: string) => ({
    name: path,
    getMetadata: () => state.getMetadata(path),
    copy: async (destination: { name: string }, options: unknown) => {
      state.copy(destination, options);
      state.files.set(destination.name, { ...state.files.get(path), generation: '200', metageneration: '1' });
    },
    setMetadata: async (patch: any, precondition: any) => {
      state.metadata(patch, precondition);
      const old = state.files.get(path);
      if (String(precondition.ifGenerationMatch) !== old.generation || String(precondition.ifMetagenerationMatch) !== old.metageneration) throw { code: 412 };
      state.files.set(path, { ...old, ...patch, metadata: { ...old.metadata, ...patch.metadata }, metageneration: String(Number(old.metageneration) + 1) });
    },
  }) }) },
}));
import { promoteArticleImages, publishedDraftPaths, storageObjectPath } from './articleMedia';
const url = (path: string, bucket = 'test-bucket') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=test`;
describe('published media ownership and promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.fs.reset(); state.files.clear(); state.articles = []; state.contentType = 'image/jpeg'; state.size = 100; state.exists = true;
    state.getMetadata.mockImplementation(async (path: string) => {
      if (!state.exists) throw { code: 404 };
      if (!state.files.has(path)) state.files.set(path, { generation: '100', metageneration: '1', crc32c: 'synthetic-checksum', contentType: state.contentType, size: state.size, cacheControl: 'private, no-store' });
      return [state.files.get(path)];
    });
  });
  it('decodes a canonical object path, rejecting external hosts and traversal', () => {
    expect(storageObjectPath(url('drafts/alice/d1/0.jpg'), 'test-bucket')).toBe('drafts/alice/d1/0.jpg');
    expect(storageObjectPath('https://example.com/o/anything')).toBeNull();
    expect(storageObjectPath(url('drafts/alice/../secret'))).toBeNull();
    expect(storageObjectPath(url('drafts/alice/d1/0.jpg', 'other'), 'test-bucket')).toBeNull();
  });
  it('allows local emulator URLs only for the explicitly configured emulator', () => {
    vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
    const local = url('drafts/alice/d1/0.jpg').replace('https://firebasestorage.googleapis.com', 'http://127.0.0.1:9199');
    expect(storageObjectPath(local, 'test-bucket')).toBe('drafts/alice/d1/0.jpg');
    expect(storageObjectPath(local.replace('9199', '9200'), 'test-bucket')).toBeNull();
    vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', undefined);
    expect(storageObjectPath(local, 'test-bucket')).toBeNull();
  });
  it('keeps promoted download URLs local when the emulator is configured', async () => {
    vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
    const photos = await promoteArticleImages([{ url: url('drafts/alice/d1/0.jpg').replace('https://firebasestorage.googleapis.com', 'http://127.0.0.1:9199') }], 'alice', 'a');
    expect(photos[0].url.startsWith('http://127.0.0.1:9199/v0/b/test-bucket/o/')).toBe(true);
    vi.unstubAllEnvs();
  });
  it('promotes owned AI/local staging photos to durable article paths and preserves order/blurhash', async () => {
    const photos = await promoteArticleImages([{ url: url('drafts/alice/d1/0.jpg'), blurhash: 'blur' }, { url: url('products/alice/temp_1/1.jpg') }], 'alice', 'article1');
    expect(photos.map((p) => storageObjectPath(p.url)?.split('/')[1])).toEqual(['article1', 'article1']);
    expect(photos[0].blurhash).toBe('blur');
    expect(state.copy).toHaveBeenCalledTimes(2);
    expect(state.metadata).toHaveBeenCalledTimes(2);
    expect(state.metadata).toHaveBeenCalledWith({ cacheControl: 'public, max-age=3600', metadata: { firebaseStorageDownloadTokens: expect.any(String) } }, { ifGenerationMatch: '200', ifMetagenerationMatch: '1' });
  });
  it('promotes an owned tokenless draft with Admin copy rather than an anonymous download', async () => {
    const privateDraft = url('drafts/alice/d1/0.jpg').replace('&token=test', '');
    const promoted = await promoteArticleImages([{ url: privateDraft }], 'alice', 'published');
    expect(state.copy).toHaveBeenCalledTimes(1);
    expect(storageObjectPath(promoted[0].url, 'test-bucket')).toMatch(/^articles\/published\//);
    expect(new URL(promoted[0].url).searchParams.get('token')).toBeTruthy();
  });
  it('rejects media owned by another account or non-images before copying', async () => {
    await expect(promoteArticleImages([{ url: url('drafts/bob/d1/0.jpg') }], 'alice', 'a')).rejects.toMatchObject({ code: 'permission-denied' });
    state.contentType = 'application/pdf';
    await expect(promoteArticleImages([{ url: url('drafts/alice/d1/0.jpg') }], 'alice', 'a')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('allows existing current article images on edits and rejects another article path', async () => {
    const image = { url: url('articles/a/old.jpg') };
    expect(await promoteArticleImages([image], 'alice', 'a', true)).toEqual([image]);
    expect(state.getMetadata).toHaveBeenCalledWith('articles/a/old.jpg');
    await expect(promoteArticleImages([{ url: url('articles/other/old.jpg') }], 'alice', 'a', true)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.copy).not.toHaveBeenCalled();
    expect(state.metadata).not.toHaveBeenCalled();
  });
  it.each(['drafts/alice/d1/0.jpg', 'articles/a/missing.jpg'])('rejects a missing staged or current article object: %s', async (objectPath) => {
    state.exists = false;
    await expect(promoteArticleImages([{ url: url(objectPath) }], 'alice', 'a', true)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(state.copy).not.toHaveBeenCalled();
  });
  it.each([0, -1, 'NaN', undefined, 10 * 1024 * 1024])('rejects invalid/boundary size for staged and current article photos: %s', async (size) => {
    state.size = size;
    for (const objectPath of ['drafts/alice/d1/0.jpg', 'articles/a/old.jpg']) {
      await expect(promoteArticleImages([{ url: url(objectPath) }], 'alice', 'a', true)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('rejects non-image objects even for current article URLs', async () => {
    state.contentType = 'application/pdf';
    await expect(promoteArticleImages([{ url: url('articles/a/old.jpg') }], 'alice', 'a', true)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(state.copy).not.toHaveBeenCalled();
    expect(state.metadata).not.toHaveBeenCalled();
  });
  it('retains legacy draft media referenced by published, sold or inactive articles', async () => {
    state.fs.setDoc('articles/legacy', { images: [{ url: url('drafts/alice/old/0.jpg') }, url('drafts/alice/old/legacy.jpg'), { url: url('articles/a/1.jpg') }] });
    expect([...await publishedDraftPaths()]).toEqual(['drafts/alice/old/0.jpg', 'drafts/alice/old/legacy.jpg']);
  });
});
