import {establishIdentityFixture} from '@/tests/jest/helpers/identityFixture';
/**
 * Régression photo de profil : React Native New Architecture ne supporte pas
 * l'upload Blob/ArrayBuffer du SDK Web Firebase Storage. Le fichier local doit
 * être streamé via l'endpoint REST Storage.
 */

const mockUploadAsync = jest.fn();
const mockPrepareImageForUpload = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({exists: true, size: 2048})),
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 'binary' },
}));

jest.mock('@/utils/imageUtils', () => ({
  prepareImageForUpload: (...args: unknown[]) => mockPrepareImageForUpload(...args),
}));

jest.mock('@/utils/fixStorageUrl', () => ({...jest.requireActual('@/utils/fixStorageUrl'), fixStorageUrl: (url: string) => url}));

import { auth, storage } from '@/config/firebaseConfig';
import { UserService } from '@/services/userService';

const mockAuth = auth as unknown as {
  currentUser: { uid: string; getIdToken: jest.Mock<Promise<string>> } | null;
};
const mockStorage = storage as unknown as {
  app: { options: { storageBucket: string } };
};

beforeEach(() => {
  jest.clearAllMocks(); establishIdentityFixture('user-1');
  mockAuth.currentUser = {
    uid: 'user-1',
    getIdToken: jest.fn().mockResolvedValue('id-token'),
  };
  mockStorage.app = { options: { storageBucket: 'bucket.firebasestorage.app' } };
  mockPrepareImageForUpload.mockResolvedValue('file:///cache/profile.jpg');
  global.fetch = jest.fn(async (url: string) => {
    const target = new URL(url); target.searchParams.set('upload_id', 'synthetic-session');
    return {ok: true, status: 200, headers: {get: (key: string) => key === 'X-Goog-Upload-Status' ? 'active' : key === 'X-Goog-Upload-URL' ? target.toString() : null}};
  }) as unknown as typeof fetch;
  mockUploadAsync.mockImplementation(async (url: string) => ({status: 200, headers: {'X-Goog-Upload-Status': 'final'}, body: JSON.stringify({
    name: new URL(url).searchParams.get('name'), bucket: 'bucket.firebasestorage.app', contentType: 'image/jpeg', size: '2048',
    cacheControl: 'private, no-store, max-age=0', downloadTokens: '00000000-0000-4000-8000-000000000001',
  })}));
});

describe('UserService.uploadProfileImage', () => {
  it('streame l’image préparée vers Storage REST avec authentification Firebase', async () => {
    const url = await UserService.uploadProfileImage('user-1', 'content://gallery/photo');

    expect(mockPrepareImageForUpload).toHaveBeenCalledWith(
      'content://gallery/photo',
      { maxDimension: 800 },
    );
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);

    const [endpoint, fileUri, options] = mockUploadAsync.mock.calls[0];
    expect(endpoint).toContain('/b/bucket.firebasestorage.app/o?name=');
    expect(new URL(endpoint).searchParams.get('upload_id')).toBe('synthetic-session');
    expect(new URL(endpoint).searchParams.get('name')).toMatch(/^users\/user-1\/profile_[0-9a-f-]{36}\.jpg$/);
    expect(fileUri).toBe('file:///cache/profile.jpg');
    expect(options).toMatchObject({
      httpMethod: 'POST',
      uploadType: 'binary',
      headers: {
        Authorization: 'Firebase id-token',
        'Content-Type': 'image/jpeg',
      },
    });
    expect(url).toContain('alt=media&token=00000000-0000-4000-8000-000000000001');
  });

  it('refuse d’uploader dans le dossier d’un autre utilisateur', async () => {
    await expect(
      UserService.uploadProfileImage('other-user', 'file:///photo.jpg'),
    ).rejects.toThrow("Erreur lors de l'upload de la photo de profil");
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('échoue proprement quand Storage ne renvoie aucun token de téléchargement', async () => {
    mockUploadAsync.mockResolvedValueOnce({ status: 200, headers: {'X-Goog-Upload-Status': 'final'}, body: '{}' });
    await expect(
      UserService.uploadProfileImage('user-1', 'file:///photo.jpg'),
    ).rejects.toThrow("Erreur lors de l'upload de la photo de profil");
  });
});
