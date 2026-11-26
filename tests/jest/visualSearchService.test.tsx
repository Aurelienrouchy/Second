/**
 * visualSearchService.searchByImage — recherche visuelle par image.
 *
 * Domaine : recherche-decouverte. Comportement MÉTIER couvert :
 *  - l'image est lue en base64 et envoyée à la callable `visualSearch` sous la
 *    clé `imageBase64` (contrat backend), avec filtres + limit.
 *  - toute image, même petite ou HEIC, est préparée en JPEG avant lecture base64.
 *  - une image trop grande est redimensionnée dans cette préparation.
 *  - les URLs d'images des résultats passent par fixStorageUrl (réparation des
 *    chemins non encodés).
 *  - le rafraîchissement du token auth qui échoue ne bloque pas la recherche
 *    (la callable supporte l'anonyme).
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

// --- Modules natifs / firebase mockés -----------------------------------------
const mockGetInfoAsync = jest.fn();
const mockReadAsStringAsync = jest.fn((..._args: unknown[]) => Promise.resolve('QkFTRTY0'));
const mockManipulateAsync = jest.fn((uri: string, ..._args: unknown[]) =>
  Promise.resolve({ uri: `${uri}#compressed` })
);
const mockGetImageSize = jest.fn();

jest.mock('@/utils/imageSize', () => ({
  getImageSize: (...args: unknown[]) => mockGetImageSize(...args),
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...(args as [string, ...unknown[]])),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockVisualSearchCallable = jest.fn();
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((..._args: unknown[]) => mockVisualSearchCallable),
}));

const mockGetIdToken = jest.fn((..._args: unknown[]) => Promise.resolve('token'));
jest.mock('@/config/firebaseConfig', () => ({
  functions: {},
  auth: { get currentUser() { return mockCurrentUser.value; } },
}));
const mockCurrentUser: { value: { uid: string; getIdToken: typeof mockGetIdToken } | null } = {
  value: { uid: 'member', getIdToken: mockGetIdToken },
};
let mockAuthenticatedUid: string | null = 'member';
let mockGeneration = 1;

jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: {getState: () => ({authenticatedUid: mockAuthenticatedUid})},
}));

jest.mock('@/services/articlesService', () => ({
  ArticlesService: {
    // fixStorageUrl marque l'URL pour prouver qu'elle a bien transité ici.
    fixStorageUrl: (url: string) => `FIXED(${url})`,
  },
}));

import { searchByImage } from '@/features/search/services/visualSearchService';

describe('visualSearchService.searchByImage', () => {
  beforeEach(() => {
    mockGetInfoAsync.mockReset().mockResolvedValue({exists: true, isDirectory: false, size: 500});
    mockGetImageSize.mockReset().mockResolvedValue({width: 600, height: 800});
    mockReadAsStringAsync.mockClear();
    mockManipulateAsync.mockReset().mockImplementation((uri: string) => Promise.resolve({uri: `${uri}#compressed`}));
    mockVisualSearchCallable.mockReset();
    mockGetIdToken.mockClear();
    mockGetIdToken.mockResolvedValue('token');
    mockCurrentUser.value = { uid: 'member', getIdToken: mockGetIdToken };
    mockAuthenticatedUid = 'member';
    mockGeneration = 1;
    mockVisualSearchCallable.mockResolvedValue({
      data: {
        results: [
          {
            articleId: 'a1',
            similarity: 0.9,
            title: 'Robe',
            price: 25,
            imageUrl: 'https://store/path with space.jpg',
            condition: 'neuf',
          },
        ],
      },
    });
  });

  it('envoie le base64 sous la clé imageBase64 avec filtres + limit', async () => {
    await searchByImage('file:///photo.jpg', { categoryIds: ['femme'] }, 15);

    expect(mockVisualSearchCallable).toHaveBeenCalledTimes(1);
    const payload = mockVisualSearchCallable.mock.calls[0][0] as {
      imageBase64: string;
      filters?: { categoryIds?: string[] };
      limit: number;
    };
    expect(payload.imageBase64).toBe('QkFTRTY0');
    expect(payload.filters?.categoryIds).toEqual(['femme']);
    expect(payload.limit).toBe(15);
  });

  it('prépare aussi une petite photo HEIC en JPEG sans agrandir ses dimensions', async () => {
    await searchByImage('file:///small.heic');

    expect(mockManipulateAsync).toHaveBeenCalledWith('file:///small.heic', [], {compress: 0.75, format: 'jpeg'});
    expect(mockGetInfoAsync).toHaveBeenCalledWith('file:///small.heic#compressed');
    expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///small.heic#compressed', {encoding: 'base64'});
  });

  it('borne le côté le plus grand à 1200 px avant lecture base64', async () => {
    mockGetImageSize.mockResolvedValue({width: 3000, height: 4000});

    await searchByImage('file:///big.jpg');

    expect(mockManipulateAsync).toHaveBeenCalledWith('file:///big.jpg', [{resize: {height: 1200}}], {compress: 0.75, format: 'jpeg'});
    expect(mockReadAsStringAsync.mock.calls[0][0]).toBe('file:///big.jpg#compressed');
  });

  it('répare les URLs Storage des résultats via fixStorageUrl', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500 });

    const results = await searchByImage('file:///photo.jpg');

    expect(results).toHaveLength(1);
    expect(results[0].imageUrl).toBe('FIXED(https://store/path with space.jpg)');
    expect(results[0].articleId).toBe('a1');
  });

  it('continue la recherche même si le rafraîchissement du token échoue', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500 });
    mockGetIdToken.mockRejectedValueOnce(new Error('token refresh failed'));

    const results = await searchByImage('file:///photo.jpg');

    // L'échec du rafraîchissement n'a changé ni propriétaire ni génération.
    expect(mockVisualSearchCallable).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('n’essaie pas de rafraîchir le token quand l’utilisateur est anonyme', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500 });
    mockCurrentUser.value = null;
    mockAuthenticatedUid = null;

    await searchByImage('file:///photo.jpg');

    expect(mockGetIdToken).not.toHaveBeenCalled();
    expect(mockVisualSearchCallable).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'generation'])('ne transmet pas la photo si %s change pendant sa préparation', async (change) => {
    mockManipulateAsync.mockImplementationOnce(async (uri: string) => {
      if (change === 'owner') {
        mockCurrentUser.value = {uid: 'another-member', getIdToken: mockGetIdToken};
        mockAuthenticatedUid = 'another-member';
      } else {
        mockGeneration++;
      }
      return {uri: `${uri}#compressed`};
    });

    await expect(searchByImage('file:///photo.jpg')).rejects.toMatchObject({code: 'client/stale-operation'});
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
    expect(mockVisualSearchCallable).not.toHaveBeenCalled();
  });

  it('rejette une réponse reçue après changement de génération de session', async () => {
    mockVisualSearchCallable.mockImplementationOnce(async () => {
      mockGeneration++;
      return {data: {results: []}};
    });

    await expect(searchByImage('file:///photo.jpg')).rejects.toMatchObject({code: 'client/stale-operation'});
    expect(mockVisualSearchCallable).toHaveBeenCalledTimes(1);
  });
});
