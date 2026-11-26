import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';

vi.mock('@/utils/imageUtils', () => ({ prepareImageForUpload: vi.fn() }));
vi.mock('@/utils/fixStorageUrl', () => ({ fixStorageUrl: (url: string) => url }));
vi.mock('@/store/authStore', () => ({ getAuthSessionGeneration: vi.fn(), useAuthStore: { getState: vi.fn() } }));
vi.mock('@/services/devPushDestinationService', () => ({ removeDevPushDestination: vi.fn() }));

import { UserService } from './userService';

describe('UserService.getPublicProfile', () => {
  const callProfile = vi.fn();
  const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.stubGlobal('__DEV__', true);
    vi.clearAllMocks();
    callProfile.mockReset();
    vi.mocked(httpsCallable).mockReturnValue(callProfile as ReturnType<typeof httpsCallable>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    logError.mockRestore();
  });

  it('returns the public profile with its existing nullable-field and date mapping', async () => {
    callProfile.mockResolvedValue({ data: { profile: {
      id: 'participant', displayName: 'Membre', profileImage: null, bio: null,
      createdAt: '2026-11-25T12:00:00.000Z', rating: null, accountType: 'user', sellerLikesCount: 2,
    } } });

    await expect(UserService.getPublicProfile('participant')).resolves.toEqual({
      id: 'participant', displayName: 'Membre', profileImage: null, bio: null,
      createdAt: new Date('2026-11-25T12:00:00.000Z'), rating: null, accountType: 'user', sellerLikesCount: 2,
    });
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getUserPublicProfile');
    expect(callProfile).toHaveBeenCalledWith({ userId: 'participant' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns the existing null fallback without an error overlay when the server reports an absent user', async () => {
    // Exact absence contract from getUserPublicProfile, including the message.
    callProfile.mockRejectedValue(new FirebaseError('functions/not-found', 'User not found'));

    await expect(UserService.getPublicProfile('deleted-participant')).resolves.toBeNull();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    ['missing callable endpoint', new FirebaseError('functions/not-found', 'NOT_FOUND')],
    ['another not-found response', new FirebaseError('functions/not-found', 'Profile query not found')],
    ['permission failure with the same text', new FirebaseError('functions/permission-denied', 'User not found')],
    ['internal server failure', new FirebaseError('functions/internal', 'Failed to fetch user profile')],
    ['network failure', new FirebaseError('functions/unavailable', 'Failed to fetch')],
    ['unclassified error with the same text', new Error('User not found')],
  ])('keeps the diagnostic and null fallback for %s', async (_case, error) => {
    callProfile.mockRejectedValue(error);

    await expect(UserService.getPublicProfile('participant')).resolves.toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('Error fetching public profile via callable:', error);
  });
});
