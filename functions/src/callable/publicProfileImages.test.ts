import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock();
holder.fs = fs;
vi.mock('../config/firebase', () => ({
  get db() { return holder.fs!.db; },
  get FieldValue() { return holder.fs!.FieldValue; },
}));
vi.mock('../utils/notifications', () => ({ sendPushNotification: vi.fn() }));
vi.mock('firebase-functions/v2/https', async () => {
  const actual = await vi.importActual<typeof import('firebase-functions/v2/https')>('firebase-functions/v2/https');
  return { ...actual, onCall: (_options: unknown, handler: unknown) => handler };
});

import { getUserPublicProfile } from './reviews';
type Response = { profile: Record<string, unknown>; articles: { images: unknown[] }[] };
const callProfile = getUserPublicProfile as unknown as (request: { data: { userId: string } }) => Promise<Response>;

beforeEach(() => {
  fs.reset();
  fs.setDoc('users/seller', { displayName: 'Seller', email: 'private@example.test', preferences: { privacy: { showProfilePhoto: false } } });
});

describe('public profile image candidates', () => {
  it('preserves a valid later photo after a malformed first entry without exposing private user fields', async () => {
    const images = [{ url: '' }, 'https://example.test/legacy.jpg', { url: 'https://example.test/photo.jpg', blurhash: 'abc' }];
    fs.setDoc('articles/item', { sellerId: 'seller', isActive: true, createdAt: new Date(), images });
    const result = await callProfile({ data: { userId: 'seller' } });
    expect(result.articles[0].images).toEqual(images);
    expect(result.profile).not.toHaveProperty('email');
    expect(result.profile.profileImage).toBeNull();
  });

  it('returns a safe image list for a malformed legacy images field', async () => {
    fs.setDoc('articles/item', { sellerId: 'seller', isActive: true, createdAt: new Date(), images: 'invalid-field' });
    const result = await callProfile({ data: { userId: 'seller' } });
    expect(result.articles[0].images).toEqual([]);
  });
});
