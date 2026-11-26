import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arrayRemove, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth } from '@/config/firebaseConfig';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { removeDevPushDestination } from '@/services/devPushDestinationService';
import { getUserById, getUserPreferences, removeExpoPushToken, removeFcmToken } from './userAuthData';

// This leaf's production logout path does not need a native Expo runtime.
vi.mock('@/services/devPushDestinationService', () => ({ removeDevPushDestination: vi.fn() }));
vi.mock('@/config/firebaseEnvironment', () => ({ runtimeEnvironment: { name: 'production' } }));

describe('auth account data leaf', () => {
  beforeEach(() => {
    vi.stubGlobal('__DEV__', false);
    vi.clearAllMocks();
    runtimeEnvironment.name = 'production';
    Object.assign(auth, { currentUser: { uid: 'owner' } });
    vi.mocked(doc).mockReturnValue({ path: 'users/owner' } as ReturnType<typeof doc>);
    vi.mocked(updateDoc).mockResolvedValue(undefined);
  });

  it('keeps profile identity, timestamp conversion, preferences and missing/read-error results', async () => {
    const createdAt = new Date('2026-10-01T12:00:00Z');
    const preferences = { aiProfilingConsent: false };
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, id: 'owner', data: () => ({ id: 'ignored', createdAt: { toDate: () => createdAt }, preferences }) } as Awaited<ReturnType<typeof getDoc>>);
    await expect(getUserById('owner')).resolves.toEqual({ id: 'owner', createdAt, preferences });
    await expect(getUserPreferences('owner')).resolves.toEqual(preferences);
    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false } as Awaited<ReturnType<typeof getDoc>>);
    await expect(getUserById('missing')).resolves.toBeNull();
    vi.mocked(getDoc).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(getUserPreferences('owner')).resolves.toBeNull();
    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => true, id: 'owner', data: () => ({}) } as Awaited<ReturnType<typeof getDoc>>);
    const undated = await getUserById('owner');
    expect(undated?.createdAt).toBeInstanceOf(Date);
  });

  it('removes the exact token with a timestamp and ignores a different SDK owner', async () => {
    await removeFcmToken('owner', 'fcm-token');
    expect(updateDoc).toHaveBeenLastCalledWith({ path: 'users/owner' }, { fcmTokens: arrayRemove('fcm-token'), updatedAt: expect.any(Date) });
    await removeExpoPushToken('owner', 'ExpoPushToken[device]');
    expect(updateDoc).toHaveBeenLastCalledWith({ path: 'users/owner' }, { expoPushTokens: arrayRemove('ExpoPushToken[device]'), updatedAt: expect.any(Date) });
    expect(serverTimestamp).toHaveBeenCalledTimes(2);
    Object.assign(auth, { currentUser: { uid: 'different' } });
    await removeFcmToken('owner', 'fcm-token');
    await removeExpoPushToken('owner', 'ExpoPushToken[device]');
    expect(updateDoc).toHaveBeenCalledTimes(2);
  });

  it('keeps FCM cleanup best-effort and leaves an Expo cleanup failure observable to logout', async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(removeFcmToken('owner', 'fcm-token')).resolves.toBeUndefined();
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(removeExpoPushToken('owner', 'ExpoPushToken[device]')).rejects.toThrow('permission-denied');
  });

  it('uses the isolated Dev destination removal instead of changing production token fields', async () => {
    runtimeEnvironment.name = 'development';
    await removeExpoPushToken('owner', 'ExpoPushToken[dev-device]');
    expect(removeDevPushDestination).toHaveBeenCalledWith('owner', 'ExpoPushToken[dev-device]');
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
