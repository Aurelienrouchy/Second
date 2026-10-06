import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const storageState = vi.hoisted(() => ({
  objects: new Map<string, { contentType?: string; size?: number | string }>(),
  getMetadata: vi.fn(),
}));
const fs = createFirestoreMock();
holder.fs = fs;
vi.mock('../config/firebase', () => ({
  get db() { return holder.fs!.db; },
  get FieldValue() { return holder.fs!.FieldValue; },
  storage: { bucket: () => ({ name: 'test-bucket', file: (path: string) => ({ getMetadata: () => storageState.getMetadata(path) }) }) },
}));
vi.mock('../config/stripe', () => ({ getStripe: vi.fn() }));
vi.mock('./wallet', () => ({ getOrCreateSellerWallet: vi.fn() }));
vi.mock('./reviews', () => ({ updateUserRating: vi.fn() }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: vi.fn() }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: vi.fn() }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: vi.fn(), resolveCallerKey: vi.fn() }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock('firebase-functions/v2/https', async () => {
  const actual = await vi.importActual<typeof import('firebase-functions/v2/https')>('firebase-functions/v2/https');
  return { ...actual, onCall: (_options: unknown, handler: unknown) => handler };
});
import { uploadSwapPhotos } from './swaps';

const call = uploadSwapPhotos as unknown as (request: { auth: { uid: string }; data: { swapId: string; photoUrls: unknown[] } }) => Promise<unknown>;
const path = (uid: string, name = 'proof.jpg') => `swaps/swap-1/photos/${uid}/${name}`;
const url = (objectPath: string, bucket = 'test-bucket') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=test`;
const request = (uid = 'alice', photoUrls: unknown[] = [url(path(uid))]) => ({ auth: { uid }, data: { swapId: 'swap-1', photoUrls } });
const swap = { initiatorId: 'alice', receiverId: 'bob', status: 'photos_pending' };

beforeEach(() => {
  fs.reset();
  vi.clearAllMocks();
  storageState.objects.clear();
  storageState.objects.set(path('alice'), { contentType: 'image/jpeg', size: 120 });
  storageState.objects.set(path('bob'), { contentType: 'image/jpeg', size: 200 });
  storageState.getMetadata.mockImplementation(async (objectPath: string) => {
    const metadata = storageState.objects.get(objectPath);
    if (!metadata) throw { code: 404 };
    return [metadata];
  });
  fs.setDoc('swaps/swap-1', swap);
});

describe('swap proof object validation and immutable submission', () => {
  it('requires an uploaded object and does not advance the swap on a fabricated owned URL', async () => {
    const withOtherProof = { ...swap, receiverPhotos: { userId: 'bob', photos: [url(path('bob'))] } };
    fs.setDoc('swaps/swap-1', withOtherProof);
    await expect(call(request('alice', [url(path('alice', 'absent.jpg'))]))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('swaps/swap-1')).toEqual(withOtherProof);
    expect(fs.writeOps).toHaveLength(0);
  });

  it.each([
    { contentType: 'application/pdf', size: 100 },
    { contentType: 'image/jpeg', size: 10 * 1024 * 1024 },
    { contentType: 'image/jpeg', size: 0 },
    { contentType: 'image/jpeg', size: -1 },
    { contentType: 'image/jpeg', size: 'NaN' },
    { contentType: 'image/jpeg' },
    { size: 100 },
  ])('rejects invalid object metadata without recording any proof: %j', async (metadata) => {
    storageState.objects.set(path('alice'), metadata);
    await expect(call(request())).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.getDoc('swaps/swap-1')).toEqual(swap);
    expect(fs.writeOps).toHaveLength(0);
  });

  it.each([
    url(path('bob')),
    url('swaps/other-swap/photos/alice/proof.jpg'),
    url(path('alice'), 'other-bucket'),
    url(path('alice', 'nested/proof.jpg')),
    'https://example.com/proof.jpg',
    null,
  ])('rejects URLs outside the exact bucket/swap/uploader/file path: %s', async (invalid) => {
    await expect(call(request('alice', [invalid]))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(storageState.getMetadata).not.toHaveBeenCalled();
    expect(fs.writeOps).toHaveLength(0);
  });

  it('checks participant identity before Admin metadata reads', async () => {
    await expect(call(request('mallory'))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(storageState.getMetadata).not.toHaveBeenCalled();
    expect(fs.writeOps).toHaveLength(0);
  });

  it('records two valid proofs and advances only after both exist', async () => {
    await call(request('alice'));
    expect(fs.getDoc('swaps/swap-1')).toMatchObject({ status: 'photos_pending', initiatorPhotos: { userId: 'alice', photos: [url(path('alice'))] } });
    await call(request('bob'));
    expect(fs.getDoc('swaps/swap-1')).toMatchObject({ status: 'shipping', receiverPhotos: { userId: 'bob', photos: [url(path('bob'))] } });
  });

  it('never replaces an already registered proof, including competing submissions', async () => {
    storageState.objects.set(path('alice', 'second.jpg'), { contentType: 'image/jpeg', size: 130 });
    const results = await Promise.allSettled([
      call(request('alice')),
      call(request('alice', [url(path('alice', 'second.jpg'))])),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(fs.countWrites((op) => op.path === 'swaps/swap-1')).toBe(1);
    const recorded = fs.getDoc('swaps/swap-1')?.initiatorPhotos;
    await expect(call(request('alice'))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('swaps/swap-1')?.initiatorPhotos).toEqual(recorded);
  });

  it('rechecks cancellation after metadata reads and leaves the cancelled swap untouched', async () => {
    storageState.getMetadata.mockImplementationOnce(async () => {
      fs.setDoc('swaps/swap-1', { ...swap, status: 'cancelled' });
      return [{ contentType: 'image/jpeg', size: 120 }];
    });
    await expect(call(request())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('swaps/swap-1')).toEqual({ ...swap, status: 'cancelled' });
    expect(fs.writeOps).toHaveLength(0);
  });
});
