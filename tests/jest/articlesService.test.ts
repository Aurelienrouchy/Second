/**
 * ArticlesService — publication et lecture d'article (tunnel Vendre).
 *
 * Couvre le comportement MÉTIER du service qui publie l'article via la callable
 * `createArticle` (les mutations Firestore restent côté serveur) :
 *  - chemin rapide : si toutes les images sont déjà des URLs Storage (uploadées
 *    pendant l'analyse IA), on les passe TELLES QUELLES à la callable, sans
 *    re-upload ;
 *  - chemin legacy : si ce sont des URIs locales, on upload d'abord vers Storage ;
 *  - construction du payload : champs multi-select (colors/materials/
 *    neighborhoods) prioritaires sur les champs legacy single-value, et AUCUN
 *    `undefined` envoyé à la callable (contrainte Firestore) ;
 *  - le blurhash est conservé sur le chemin rapide ;
 *  - les erreurs de la callable sont enrobées dans un message FR exploitable ;
 *  - deleteArticle délègue à la callable updateArticle (soft delete isActive) ;
 *  - getArticleById masque les articles inactifs (soft-deleted).
 *
 * Vit dans tests/jest/ : Jest le ramasse, Vitest l'ignore.
 */

// Storage : observable pour distinguer chemin rapide / legacy.
const mockUploadBytes = jest.fn((..._args: unknown[]) => Promise.resolve({ ref: {} }));
const mockGetDownloadURL = jest.fn((..._args: unknown[]) =>
  Promise.resolve('https://firebasestorage.googleapis.com/uploaded.jpg'),
);
jest.mock('firebase/storage', () => ({
  ref: jest.fn((_s: unknown, path: string) => ({ path })),
  uploadBytes: (...a: unknown[]) => mockUploadBytes(...a),
  getDownloadURL: (...a: unknown[]) => mockGetDownloadURL(...a),
  deleteObject: jest.fn((..._args: unknown[]) => Promise.resolve()),
}));

// Callable : on capture le nom et le payload transmis.
const mockCreateArticleFn = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { articleId: 'art_123' } }),
);
const mockUpdateArticleFn = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { success: true } }),
);
const mockHttpsCallable = jest.fn((_fns: unknown, name: string) =>
  name === 'createArticle' ? mockCreateArticleFn : mockUpdateArticleFn,
);
jest.mock('firebase/functions', () => ({
  httpsCallable: (...a: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockHttpsCallable(...(a as [unknown, string])),
}));

// imageUtils : pas de vraie compression sous Node.
jest.mock('@/utils/imageUtils', () => ({
  processImageWithBlurhash: jest.fn((uri: string) =>
    Promise.resolve({ compressedUri: `compressed-${uri}`, blurhash: 'LKO2:N' }),
  ),
}));

// expo-file-system/legacy : le fichier local existe.
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn((..._args: unknown[]) => Promise.resolve({ exists: true, size: 2048 })),
}));

// fetch -> blob (chemin legacy upload).
global.fetch = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ blob: () => Promise.resolve({}) }),
) as unknown as typeof fetch;

import { getDoc, updateDoc } from 'firebase/firestore';
import { auth } from '@/config/firebaseConfig';
import { ArticlesService } from '@/services/articlesService';

const mockAuth = auth as unknown as { currentUser: { uid: string } | null };

// Base d'un article à publier (champs requis par createArticle).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseArticle(overrides: Record<string, any> = {}): any {
  return {
    title: 'Robe fleurie Zara',
    description: 'Portée deux fois',
    price: 25,
    category: 'Robes',
    categoryIds: ['women', 'women_dresses'],
    condition: 'très bon état',
    sellerId: 'uid',
    sellerName: 'Alice',
    isHandDelivery: true,
    isShipping: false,
    images: [
      { url: 'https://firebasestorage.googleapis.com/drafts/a.jpg', blurhash: 'LKO2' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'uid' };
  mockCreateArticleFn.mockResolvedValue({ data: { articleId: 'art_123' } });
});

describe('createArticle — chemin rapide (images déjà sur Storage)', () => {
  it('passe les URLs Storage telles quelles, sans re-upload', async () => {
    const id = await ArticlesService.createArticle(baseArticle());

    expect(id).toBe('art_123');
    expect(mockUploadBytes).not.toHaveBeenCalled();
    expect(mockCreateArticleFn).toHaveBeenCalledTimes(1);

    const payload = mockCreateArticleFn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.images).toEqual([
      { url: 'https://firebasestorage.googleapis.com/drafts/a.jpg', blurhash: 'LKO2' },
    ]);
  });

  it('conserve le blurhash et omet l’entrée quand il est absent', async () => {
    const article = baseArticle({
      images: [
        { url: 'https://firebasestorage.googleapis.com/x/1.jpg', blurhash: 'AAA' },
        { url: 'https://firebasestorage.googleapis.com/x/2.jpg' },
      ],
    });
    await ArticlesService.createArticle(article);

    const payload = mockCreateArticleFn.mock.calls[0][0] as {
      images: { url: string; blurhash?: string }[];
    };
    expect(payload.images[0]).toEqual({
      url: 'https://firebasestorage.googleapis.com/x/1.jpg',
      blurhash: 'AAA',
    });
    expect(payload.images[1]).toEqual({
      url: 'https://firebasestorage.googleapis.com/x/2.jpg',
    });
    expect('blurhash' in payload.images[1]).toBe(false);
  });
});

describe('createArticle — chemin legacy (URIs locales)', () => {
  it('upload vers Storage puis envoie les download URLs à la callable', async () => {
    const article = baseArticle({
      images: [{ url: 'file:///tmp/local.jpg' }],
    });

    await ArticlesService.createArticle(article);

    expect(mockUploadBytes).toHaveBeenCalledTimes(1);
    const payload = mockCreateArticleFn.mock.calls[0][0] as {
      images: { url: string }[];
    };
    expect(payload.images[0].url).toBe(
      'https://firebasestorage.googleapis.com/uploaded.jpg',
    );
  });
});

describe('createArticle — payload : multi-select prioritaire, jamais d’undefined', () => {
  it('préfère colors[]/materials[]/neighborhoods[] aux champs legacy single-value', async () => {
    const article = baseArticle({
      colors: ['bleu-marine', 'blanc'],
      color: 'rouge', // legacy, doit être ignoré au profit de colors[]
      materials: ['coton'],
      material: 'lin', // legacy, ignoré
      neighborhoods: [{ id: 'plateau', name: 'Plateau' }],
      neighborhood: { id: 'mile-end', name: 'Mile End' }, // legacy, ignoré
    });

    await ArticlesService.createArticle(article);

    const payload = mockCreateArticleFn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.colors).toEqual(['bleu-marine', 'blanc']);
    expect(payload.materials).toEqual(['coton']);
    expect(payload.neighborhoods).toEqual([{ id: 'plateau', name: 'Plateau' }]);
    // Les champs legacy ne doivent pas coexister avec leur version multi.
    expect(payload.color).toBeUndefined();
    expect(payload.material).toBeUndefined();
    expect(payload.neighborhood).toBeUndefined();
  });

  it('retombe sur les champs legacy si les tableaux multi sont vides', async () => {
    const article = baseArticle({
      colors: [],
      color: 'rouge',
      materials: undefined,
      material: 'lin',
    });

    await ArticlesService.createArticle(article);

    const payload = mockCreateArticleFn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.color).toBe('rouge');
    expect(payload.material).toBe('lin');
  });

  it('n’envoie AUCUNE clé undefined à la callable (contrainte Firestore)', async () => {
    // size/brand/pattern absents -> ne doivent pas apparaître dans le payload.
    const article = baseArticle({ size: undefined, brand: undefined });

    await ArticlesService.createArticle(article);

    const payload = mockCreateArticleFn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect('size' in payload).toBe(false);
    expect('brand' in payload).toBe(false);
    for (const value of Object.values(payload)) {
      expect(value).not.toBeUndefined();
    }
  });

  it('porte les champs optionnels présents (size, brand, packageSize)', async () => {
    const article = baseArticle({
      size: 'M',
      brand: 'Zara',
      packageSize: 'medium',
    });

    await ArticlesService.createArticle(article);

    const payload = mockCreateArticleFn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.size).toBe('M');
    expect(payload.brand).toBe('Zara');
    expect(payload.packageSize).toBe('medium');
  });
});

describe('createArticle — erreurs', () => {
  it('enrobe l’erreur de la callable dans un message FR', async () => {
    mockCreateArticleFn.mockRejectedValueOnce(
      new Error('PERMISSION_DENIED: email non vérifié'),
    );

    await expect(ArticlesService.createArticle(baseArticle())).rejects.toThrow(
      /Erreur lors de la creation de l'article/,
    );
  });

  it('échoue le chemin legacy si l’utilisateur n’est pas authentifié', async () => {
    mockAuth.currentUser = null;
    const article = baseArticle({ images: [{ url: 'file:///tmp/x.jpg' }] });

    await expect(ArticlesService.createArticle(article)).rejects.toThrow(
      /non authentifie/,
    );
    expect(mockCreateArticleFn).not.toHaveBeenCalled();
  });
});

describe('deleteArticle — soft delete via callable', () => {
  it('délègue à updateArticle avec isActive:false (jamais de delete client)', async () => {
    await ArticlesService.deleteArticle('art_42');

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'updateArticle',
    );
    expect(mockUpdateArticleFn).toHaveBeenCalledWith({
      articleId: 'art_42',
      updates: { isActive: false },
    });
  });
});

describe('updateArticle — édition d’un article existant', () => {
  it('met à jour le document via updateDoc avec les changements fournis', async () => {
    await ArticlesService.updateArticle('art_7', { price: 30 });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    // Le 2e argument porte exactement le patch demandé.
    expect((updateDoc as jest.Mock).mock.calls[0][1]).toEqual({ price: 30 });
  });
});

describe('getArticleById — visibilité', () => {
  it('renvoie null pour un article soft-deleted (isActive=false)', async () => {
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      id: 'art_inactive',
      data: () => ({
        isActive: false,
        createdAt: { toDate: () => new Date() },
        images: [],
      }),
    });

    const article = await ArticlesService.getArticleById('art_inactive');
    expect(article).toBeNull();
  });

  it('renvoie l’article actif avec ses images normalisées', async () => {
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      id: 'art_ok',
      data: () => ({
        title: 'Robe',
        isActive: true,
        createdAt: { toDate: () => new Date('2026-01-01') },
        images: [{ url: 'https://firebasestorage.googleapis.com/i.jpg' }],
      }),
    });

    const article = await ArticlesService.getArticleById('art_ok');
    expect(article).not.toBeNull();
    expect(article!.id).toBe('art_ok');
    expect(article!.title).toBe('Robe');
    expect(article!.images).toHaveLength(1);
  });

  it('renvoie null quand le document n’existe pas', async () => {
    (getDoc as jest.Mock).mockResolvedValueOnce({ exists: () => false });
    expect(await ArticlesService.getArticleById('missing')).toBeNull();
  });
});
