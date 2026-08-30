/**
 * Régression photo de profil : React Native New Architecture ne supporte pas
 * l'upload Blob/ArrayBuffer du SDK Web Firebase Storage. Le fichier local doit
 * être streamé via l'endpoint REST Storage.
 */

const mockUploadAsync = jest.fn();
const mockPrepareImageForUpload = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 'binary' },
}));

jest.mock('@/utils/imageUtils', () => ({
  prepareImageForUpload: (...args: unknown[]) => mockPrepareImageForUpload(...args),
}));

jest.mock('@/utils/fixStorageUrl', () => ({ fixStorageUrl: (url: string) => url }));

import { auth, storage } from '@/config/firebaseConfig';
import { UserService } from '@/services/userService';

const mockAuth = auth as unknown as {
  currentUser: { uid: string; getIdToken: jest.Mock<Promise<string>> } | null;
};
const mockStorage = storage as unknown as {
  app: { options: { storageBucket: string } };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = {
    uid: 'user-1',
    getIdToken: jest.fn().mockResolvedValue('id-token'),
  };
  mockStorage.app = { options: { storageBucket: 'bucket.firebasestorage.app' } };
  mockPrepareImageForUpload.mockResolvedValue('file:///cache/profile.jpg');
  mockUploadAsync.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ downloadTokens: 'download-token' }),
  });
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
    expect(endpoint).toContain('/b/bucket.firebasestorage.app/o?uploadType=media&name=');
    expect(endpoint).toContain('users%2Fuser-1%2Fprofile.jpg');
    expect(fileUri).toBe('file:///cache/profile.jpg');
    expect(options).toMatchObject({
      httpMethod: 'POST',
      uploadType: 'binary',
      headers: {
        Authorization: 'Firebase id-token',
        'Content-Type': 'image/jpeg',
      },
    });
    expect(url).toContain('alt=media&token=download-token');
  });

  it('refuse d’uploader dans le dossier d’un autre utilisateur', async () => {
    await expect(
      UserService.uploadProfileImage('other-user', 'file:///photo.jpg'),
    ).rejects.toThrow("Erreur lors de l'upload de la photo de profil");
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('échoue proprement quand Storage ne renvoie aucun token de téléchargement', async () => {
    mockUploadAsync.mockResolvedValueOnce({ status: 200, body: '{}' });
    await expect(
      UserService.uploadProfileImage('user-1', 'file:///photo.jpg'),
    ).rejects.toThrow("Erreur lors de l'upload de la photo de profil");
  });
});
