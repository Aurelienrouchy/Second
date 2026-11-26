import {beforeEach, describe, expect, it, vi} from 'vitest';

const h = vi.hoisted(() => ({
  files: new Map<string, any>(), copy: vi.fn(), patch: vi.fn(),
  patchRace: false, patchIgnored: false, patchResponseLost: false, replaceAfterPatch: false,
}));
vi.mock('../config/firebase', () => ({db: {}, storage: {bucket: () => ({file: (path: string, opts?: any) => ({
  name: path,
  exists: async () => [h.files.has(path)],
  getMetadata: async () => {
    const data = h.files.get(path);
    if (!data || opts?.generation && opts.generation !== data.generation) throw {code: 404};
    return [{...data, metadata: {...data.metadata}}];
  },
  copy: async (destination: any, options: any) => {
    h.copy(path, destination.name, options);
    const source = h.files.get(path);
    if (opts?.generation !== source?.generation) throw {code: 404};
    if (h.files.has(destination.name)) throw {code: 412};
    // Actual observed rewrite: no MIME is retained when contentType is omitted.
    const metadata = {...options.metadata};
    delete metadata.firebaseStorageDownloadTokens;
    h.files.set(destination.name, {generation: '200', metageneration: '1', crc32c: source.crc32c,
      size: source.size, cacheControl: options.cacheControl, metadata,
      ...(options.contentType ? {contentType: options.contentType} : {})});
  },
  setMetadata: async (patch: any, pre: any) => {
    h.patch(path, patch, pre);
    const data = h.files.get(path);
    if (h.patchRace || pre.ifGenerationMatch !== data.generation || pre.ifMetagenerationMatch !== data.metageneration) {
      throw {code: 412};
    }
    if (!h.patchIgnored) h.files.set(path, {...data, ...patch, metageneration: String(Number(data.metageneration) + 1)});
    if (h.replaceAfterPatch) h.files.set(path, {...h.files.get(path), generation: '201'});
    if (h.patchResponseLost) throw {code: 503};
  },
  download: async () => [Buffer.alloc(100)],
})})}}));

import {preservePrivateImage, readPrivateImage, sourceImageWitness} from './privateMedia';

const sourcePath = 'articles/article/photo.jpg';
const privatePath = 'article_privacy/article/operation/0123456789abcdef';
const witness = {sourceGeneration: '100', sourceCrc32c: 'crc', contentType: 'image/jpeg', size: 100};
const copied = () => ({generation: '200', metageneration: '7', crc32c: 'crc', size: '100',
  cacheControl: 'private, no-store', metadata: {privacyOperationId: 'operation', privacyMediaId: 'media',
    privacySourceGeneration: '100'}});

beforeEach(() => {
  h.files.clear(); vi.clearAllMocks();
  h.patchRace = false; h.patchIgnored = false; h.patchResponseLost = false; h.replaceAfterPatch = false;
  h.files.set(sourcePath, {...witness, generation: '100', crc32c: 'crc'});
});

describe('generation qualified private image copy MIME', () => {
  it('passes the witnessed image MIME to the rewrite for the extensionless private destination', async () => {
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).resolves.toBe('200');
    expect(h.copy).toHaveBeenCalledWith(sourcePath, privatePath, expect.objectContaining({contentType: 'image/jpeg'}));
    expect(h.files.get(privatePath).contentType).toBe('image/jpeg');
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('repairs only the observed absent MIME after all exact native private invariants match', async () => {
    h.files.set(privatePath, copied());
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).resolves.toBe('200');
    expect(h.copy).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledWith(privatePath, {contentType: 'image/jpeg'},
      {ifGenerationMatch: '200', ifMetagenerationMatch: '7'});
    expect(h.files.get(privatePath).metageneration).toBe('8');
    await expect(readPrivateImage(privatePath, {...witness, privateGeneration: '200'}, 'operation', 'media')).resolves.toHaveLength(100);
  });

  it.each([
    ['different CRC', {crc32c: 'other'}], ['different size', {size: '101'}],
    ['public cache', {cacheControl: 'public'}], ['missing generation', {generation: undefined}],
    ['missing metageneration', {metageneration: undefined}], ['invalid metageneration', {metageneration: '0'}],
    ['different MIME', {contentType: 'application/octet-stream'}], ['empty MIME', {contentType: ''}],
    ['another image MIME', {contentType: 'image/png'}],
    ['token present', {metadata: {...copied().metadata, firebaseStorageDownloadTokens: 'token'}}],
    ['different operation', {metadata: {...copied().metadata, privacyOperationId: 'other'}}],
    ['different media', {metadata: {...copied().metadata, privacyMediaId: 'other'}}],
    ['different source generation', {metadata: {...copied().metadata, privacySourceGeneration: '99'}}],
  ])('does not repair %s', async (_label, change) => {
    h.files.set(privatePath, {...copied(), ...change});
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).rejects.toBeDefined();
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.copy).not.toHaveBeenCalled();
  });

  it('does not repair a different generation from the one already journaled', async () => {
    h.files.set(privatePath, copied());
    await expect(preservePrivateImage(sourcePath, privatePath, {...witness, privateGeneration: '199'}, 'operation', 'media')).rejects.toBeDefined();
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('rejects the metadata race instead of overwriting the concurrent object', async () => {
    h.files.set(privatePath, copied()); h.patchRace = true;
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).rejects.toMatchObject({code: 412});
    expect(h.files.get(privatePath).contentType).toBeUndefined();
  });

  it('reconciles a lost patch response from the same native object on retry', async () => {
    h.files.set(privatePath, copied()); h.patchResponseLost = true;
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).rejects.toMatchObject({code: 503});
    h.patchResponseLost = false;
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).resolves.toBe('200');
    expect(h.patch).toHaveBeenCalledTimes(1);
  });

  it('requires a real successful re-read after a patch response', async () => {
    h.files.set(privatePath, copied()); h.patchIgnored = true;
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).rejects.toMatchObject({code: 'failed-precondition'});
  });

  it('does not return a replacement generation after the CAS', async () => {
    h.files.set(privatePath, copied()); h.replaceAfterPatch = true;
    await expect(preservePrivateImage(sourcePath, privatePath, witness, 'operation', 'media')).rejects.toMatchObject({code: 'failed-precondition'});
  });

  it('never repairs through the private reader or with a non-image source witness', async () => {
    h.files.set(privatePath, copied());
    await expect(readPrivateImage(privatePath, {...witness, privateGeneration: '200'}, 'operation', 'media')).rejects.toMatchObject({code: 'failed-precondition'});
    expect(() => sourceImageWitness({generation: '100', crc32c: 'crc', contentType: 'application/pdf', size: 100})).toThrow();
    expect(h.patch).not.toHaveBeenCalled();
  });
});
