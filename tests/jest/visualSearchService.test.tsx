/**
 * visualSearchService.searchByImage — recherche visuelle par image.
 *
 * Domaine : recherche-decouverte. Comportement MÉTIER couvert :
 *  - l'image est lue en base64 et envoyée à la callable `visualSearch` sous la
 *    clé `imageBase64` (contrat backend), avec filtres + limit.
 *  - une petite image (< cible) n'est PAS recompressée (pas d'appel manipulator).
 *  - une grosse image EST recompressée avant lecture base64.
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
const mockManipulateAsync = jest.fn((uri: string) =>
  Promise.resolve({ uri: `${uri}#compressed` })
);

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...(args as [string])),
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
// Holder so individual tests can flip currentUser on/off.
// On évite `jest.Mock` (non typé par le tsconfig principal, qui n'inclut pas
// @types/jest) — un objet avec getIdToken suffit au comportement testé.
const mockCurrentUser: { value: { getIdToken: typeof mockGetIdToken } | null } = {
  value: { getIdToken: mockGetIdToken },
};

jest.mock('@/services/articlesService', () => ({
  ArticlesService: {
    // fixStorageUrl marque l'URL pour prouver qu'elle a bien transité ici.
    fixStorageUrl: (url: string) => `FIXED(${url})`,
  },
}));

import { searchByImage } from '@/services/visualSearchService';

const TARGET = 1 * 1024 * 1024; // 1MB (TARGET_IMAGE_SIZE du service)

describe('visualSearchService.searchByImage', () => {
  beforeEach(() => {
    mockGetInfoAsync.mockReset();
    mockReadAsStringAsync.mockClear();
    mockManipulateAsync.mockClear();
    mockVisualSearchCallable.mockReset();
    mockGetIdToken.mockClear();
    mockGetIdToken.mockResolvedValue('token');
    mockCurrentUser.value = { getIdToken: mockGetIdToken };
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
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500 }); // < cible

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

  it('ne recompresse pas une image sous la taille cible', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: TARGET - 1 });

    await searchByImage('file:///small.jpg');

    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(mockReadAsStringAsync).toHaveBeenCalled();
  });

  it('recompresse une image au-dessus de la taille cible avant lecture base64', async () => {
    // 1er getInfo : trop grosse → resize. 2e getInfo (post-resize) : OK.
    mockGetInfoAsync
      .mockResolvedValueOnce({ exists: true, size: TARGET * 3 })
      .mockResolvedValueOnce({ exists: true, size: 500 });

    await searchByImage('file:///big.jpg');

    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    // La lecture base64 se fait sur l'URI compressé.
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

    // La callable est tout de même appelée (mode anonyme toléré côté backend).
    expect(mockVisualSearchCallable).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('n’essaie pas de rafraîchir le token quand l’utilisateur est anonyme', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500 });
    mockCurrentUser.value = null;

    await searchByImage('file:///photo.jpg');

    expect(mockGetIdToken).not.toHaveBeenCalled();
    expect(mockVisualSearchCallable).toHaveBeenCalledTimes(1);
  });
});
