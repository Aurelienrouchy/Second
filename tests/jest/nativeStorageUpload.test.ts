const mockGetInfo = jest.fn();
const mockNativeUpload = jest.fn();
const mockAssertCurrent = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfo(...args),
  uploadAsync: (...args: unknown[]) => mockNativeUpload(...args),
  FileSystemUploadType: { BINARY_CONTENT: 'binary' },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '92413ad7-8208-488d-a9cd-26ddc2308d0f' }));
jest.mock('@/services/tradeOperation', () => ({
  captureTradeSession: (uid: string) => ({ uid, generation: 1 }),
  assertTradeSessionCurrent: (...args: unknown[]) => mockAssertCurrent(...args),
  staleTradeOperation: () => Object.assign(new Error('Session expirée'), { code: 'client/stale-operation' }),
}));
jest.mock('@/utils/fixStorageUrl', () => ({ storageApiOrigin: () => 'https://firebasestorage.googleapis.com' }));

import { auth, storage } from '@/config/firebaseConfig';
import { uploadPreparedJpeg } from '@/services/nativeStorageUpload';

const path = 'drafts/owner/draft/92413ad7-8208-488d-a9cd-26ddc2308d0f.jpg';
const endpoint = 'https://firebasestorage.googleapis.com/v0/b/dev-bucket.firebasestorage.app/o';
const sessionUrl = `${endpoint}?name=${encodeURIComponent(path)}&upload_id=synthetic-bearer`;
const options = { ownerUid: 'owner', path, localUri: 'file:///cache/prepared.jpg' };
const mockFetch = jest.fn();
const previousFetch = global.fetch;

function startResponse(url = sessionUrl, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (key: string) => ({
    'x-goog-upload-status': 'active', 'x-goog-upload-url': url,
  })[key.toLowerCase() as 'x-goog-upload-status' | 'x-goog-upload-url'] ?? null } };
}

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = mockFetch;
  (auth as unknown as { currentUser: unknown }).currentUser = { uid: 'owner', getIdToken: jest.fn().mockResolvedValue('synthetic-id-token') };
  (storage as unknown as { app: unknown }).app = { options: { storageBucket: 'dev-bucket.firebasestorage.app' } };
  mockGetInfo.mockResolvedValue({ exists: true, isDirectory: false, size: 1024 });
  mockFetch.mockResolvedValue(startResponse());
  mockNativeUpload.mockResolvedValue({ status: 200, headers: { 'X-Goog-Upload-Status': 'final' }, body: '{}' });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { global.fetch = previousFetch; });

it('streams the prepared file with private metadata fixed before the first byte', async () => {
  await expect(uploadPreparedJpeg(options)).resolves.toEqual({ publicDownloadUrl: null });
  expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(endpoint), expect.objectContaining({
    method: 'POST', redirect: 'error',
    body: JSON.stringify({ name: path, contentType: 'image/jpeg', cacheControl: 'private, no-store, max-age=0' }),
  }));
  expect(mockFetch.mock.calls[0][1].body).not.toContain('firebaseStorageDownloadTokens');
  expect(mockNativeUpload).toHaveBeenCalledWith(sessionUrl, options.localUri, expect.objectContaining({
    httpMethod: 'POST', uploadType: 'binary', headers: expect.objectContaining({
      Authorization: 'Firebase synthetic-id-token', 'Content-Type': 'image/jpeg', 'X-Goog-Upload-Command': 'upload, finalize',
    }),
  }));
});

it('never returns server-generated bearer tokens for a private draft', async () => {
  mockNativeUpload.mockResolvedValue({ status: 200, headers: { 'x-goog-upload-status': 'final' }, body: JSON.stringify({
    downloadTokens: 'synthetic-download-capability', name: path,
  }) });
  const result = await uploadPreparedJpeg(options);
  expect(result).toEqual({ publicDownloadUrl: null });
  expect(JSON.stringify(result)).not.toContain('synthetic-download-capability');
  expect(console.warn).not.toHaveBeenCalled();
});

it('reports a denied initialization without attempting the native transfer', async () => {
  mockFetch.mockResolvedValue(startResponse(sessionUrl, 403));
  await expect(uploadPreparedJpeg(options)).rejects.toMatchObject({ stage: 'start', httpStatus: 403 });
  expect(mockNativeUpload).not.toHaveBeenCalled();
});

it.each([
  sessionUrl.replace('firebasestorage.googleapis.com', 'untrusted.example'),
  sessionUrl.replace(encodeURIComponent(path), encodeURIComponent('drafts/other/draft/photo.jpg')),
  `${sessionUrl}&upload_id=duplicate`,
])('never forwards credentials or bytes to a mismatched upload session', async (url) => {
  mockFetch.mockResolvedValue(startResponse(url));
  await expect(uploadPreparedJpeg(options)).rejects.toMatchObject({ stage: 'session' });
  expect(mockNativeUpload).not.toHaveBeenCalled();
});

it('does not turn an unconfirmed HTTP response into upload success', async () => {
  mockNativeUpload.mockResolvedValue({ status: 200, headers: {}, body: '{}' });
  await expect(uploadPreparedJpeg(options)).rejects.toMatchObject({ stage: 'confirmation', httpStatus: 200 });
});

it('never leaks native exception messages or resumable capabilities in errors or diagnostics', async () => {
  mockNativeUpload.mockRejectedValue(new Error(`Request failed ${sessionUrl} token=synthetic-id-token`));
  const error = await uploadPreparedJpeg(options).catch(value => value);
  expect(error).toMatchObject({ stage: 'transfer', code: 'storage/upload-unconfirmed' });
  const surfaced = `${String(error)} ${JSON.stringify(error)} ${JSON.stringify((console.warn as jest.Mock).mock.calls)}`;
  expect(surfaced).not.toContain('synthetic-bearer');
  expect(surfaced).not.toContain('synthetic-id-token');
  expect(surfaced).not.toContain(path);
});

it('preserves cancellation or a changed identity after a pending transfer', async () => {
  const cancelled = new Error('Cancelled');
  let isCurrent = true;
  const pending = uploadPreparedJpeg({ ...options, assertContext: () => { if (!isCurrent) throw cancelled; } });
  mockNativeUpload.mockImplementation(async () => { isCurrent = false; throw new Error('native failure'); });
  await expect(pending).rejects.toBe(cancelled);
  expect(console.warn).not.toHaveBeenCalled();
});


it('logs only whitelisted native failure codes without capabilities, file names or exception text', async () => {
  mockNativeUpload.mockRejectedValue(Object.assign(new Error(`Error Domain=NSURLErrorDomain Code=-999 Request ${sessionUrl} token=synthetic-id-token file:///cache/prepared.jpg`), {code: 'ERR_FILESYSTEM_CANNOT_UPLOAD'}));
  await expect(uploadPreparedJpeg(options)).rejects.toMatchObject({stage: 'transfer', code: 'storage/upload-unconfirmed'});
  expect(console.warn).toHaveBeenCalledWith('[nativeStorageUpload] Upload not confirmed', JSON.stringify({
    stage: 'transfer', httpStatus: null, causeName: 'Error', causeCode: 'ERR_FILESYSTEM_CANNOT_UPLOAD', nativeDomain: 'NSURLErrorDomain', nativeCode: -999,
  }));
  const logged = JSON.stringify((console.warn as jest.Mock).mock.calls);
  for (const privateValue of ['synthetic-bearer', 'synthetic-id-token', path, 'file:///cache/prepared.jpg', 'Request']) expect(logged).not.toContain(privateValue);
});


it('streams a private swap photo in the current owner namespace', async () => {
  const swapPath = 'swaps/swap-1/photos/owner/0_92413ad7-8208-488d-a9cd-26ddc2308d0f.jpg';
  const swapSession = `${endpoint}?name=${encodeURIComponent(swapPath)}&upload_id=synthetic-swap-session`;
  mockFetch.mockResolvedValue(startResponse(swapSession));
  await expect(uploadPreparedJpeg({...options, path: swapPath})).resolves.toEqual({publicDownloadUrl: null});
  expect(mockNativeUpload).toHaveBeenCalledWith(swapSession, options.localUri, expect.objectContaining({uploadType: 'binary'}));
});
it.each([
  ['swaps/swap-1/photos/other/0_92413ad7-8208-488d-a9cd-26ddc2308d0f.jpg', false],
  ['swaps/swap-1/photos/owner/4_92413ad7-8208-488d-a9cd-26ddc2308d0f.jpg', false],
  ['swaps/swap-1/photos/owner/0_92413ad7-8208-488d-a9cd-26ddc2308d0f.jpg', true],
] as const)('refuses mismatched or public swap uploads (%s, public=%s) before any network bytes', async (swapPath, publicProfileUrl) => {
  await expect(uploadPreparedJpeg({...options, path: swapPath, ...(publicProfileUrl ? {publicProfileUrl: true as const} : {})})).rejects.toThrow();
  expect(mockFetch).not.toHaveBeenCalled(); expect(mockNativeUpload).not.toHaveBeenCalled();
});
