import AsyncStorage from '@react-native-async-storage/async-storage';
import { establishIdentityFixture } from '@/tests/jest/helpers/identityFixture';
beforeEach(() => establishIdentityFixture('uid'));
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
const mockNativeUpload = jest.fn(async (..._args: unknown[]) => ({status: 200, headers: {'X-Goog-Upload-Status': 'final'}, body: '{}'}));
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
    Promise.resolve({ compressedUri: `file:///prepared/${encodeURIComponent(uri)}.jpg`, blurhash: 'LKO2:N' }),
  ),
}));

// expo-file-system/legacy : le fichier local existe.
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn((..._args: unknown[]) => Promise.resolve({ exists: true, size: 2048 })),
  FileSystemUploadType: {BINARY_CONTENT: 'binary'},
  uploadAsync: (...args: unknown[]) => mockNativeUpload(...args),
}));

// fetch -> blob (chemin legacy upload).
global.fetch = jest.fn(async (url: string) => {
 const target = new URL(url); target.searchParams.set('upload_id', 'synthetic-session');
 return {ok: true, status: 200, headers: {get: (key: string) => key === 'X-Goog-Upload-Status' ? 'active' : key === 'X-Goog-Upload-URL' ? target.toString() : null}};
}) as unknown as typeof fetch;

import { getDoc, getDocs, limit as firestoreLimit, where } from 'firebase/firestore';
import firestoreIndexes from '../../firestore.indexes.json';
import { storage, auth } from '@/config/firebaseConfig';
import { ArticlesService } from '@/services/articlesService';

const mockAuth = auth as unknown as { currentUser: { uid: string } | null };
function createFixtureArticle(input: Parameters<typeof ArticlesService.createArticle>[0], options: Parameters<typeof ArticlesService.createArticle>[1] = {}) { return ArticlesService.createArticle(input, {requestId: 'fixture-draft', ...options}); }


// Base d'un article à publier (champs requis par createArticle).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseArticle(overrides: Record<string, any> = {}): any {
  return {
    quantity: 1,
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

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.assign(storage, { app: { options: { storageBucket: 'demo-second.appspot.com' } } });

  mockCreateArticleFn.mockResolvedValue({ data: { articleId: 'art_123' } });
});

describe('createArticle — chemin rapide (images déjà sur Storage)', () => {
  it('passe les URLs Storage telles quelles, sans re-upload', async () => {
    const id = await createFixtureArticle(baseArticle());

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
    await createFixtureArticle(article);

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

    await createFixtureArticle(article);

    expect(mockNativeUpload).toHaveBeenCalledTimes(1);
    expect(mockUploadBytes).not.toHaveBeenCalled();
    const payload = mockCreateArticleFn.mock.calls[0][0] as {
      images: { url: string }[];
    };
    expect(payload.images[0].url).toContain('drafts%2Fuid%2F');
    expect(payload.images[0].url).not.toContain('token=');
    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  it('dépose les photos dans le dossier de brouillon du vendeur, qui lui appartient', async () => {
    // `articles/draft_{horodatage}/` n'était rattaché à aucun article ni à
    // aucun compte : les règles ne pouvaient pas en protéger les objets, et la
    // suppression de compte ne pouvait pas les retrouver.
    await createFixtureArticle(
      baseArticle({ images: [{ url: 'file:///tmp/a.jpg' }, { url: 'file:///tmp/b.jpg' }] }),
    );

    const paths = mockNativeUpload.mock.calls.map(c => new URL(c[0] as string).searchParams.get('name')!);
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).toMatch(/^drafts\/uid\/fixture-draft\/image_\d_\d+\.jpg$/);
    }
    expect(new Set(paths.map((path) => path.split('/').slice(0, 3).join('/'))).size).toBe(1);
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

    await createFixtureArticle(article);

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

    await createFixtureArticle(article);

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

    await createFixtureArticle(article);

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

    await createFixtureArticle(article);

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

    await expect(createFixtureArticle(baseArticle())).rejects.toThrow(
      /Erreur lors de la création de l'article/,
    );
  });

  it('échoue le chemin legacy si l’utilisateur n’est pas authentifié', async () => {
    mockAuth.currentUser = null;
    const article = baseArticle({ images: [{ url: 'file:///tmp/x.jpg' }] });

    await expect(createFixtureArticle(article)).rejects.toThrow(
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
  it('délègue l’édition à la callable qui valide et protège la réservation', async () => {
    await ArticlesService.updateArticle('art_7', { price: 30 });
    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'updateArticle');
    expect(mockUpdateArticleFn).toHaveBeenCalledWith({ articleId: 'art_7', updates: { price: 30 } });
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

describe('lecteurs — une date de création mal formée ne casse plus la liste', () => {
  it('getUserArticles rend tous les articles, même si l’un porte une date qui n’est pas un Timestamp', async () => {
    // La règle de création directe n'imposait aucun type à `createdAt` : un
    // seul document mal formé faisait lever `data.createdAt.toDate()` et
    // vidait la liste entière.
    const docs = [
      { id: 'a1', data: () => ({ title: 'A', createdAt: { toDate: () => new Date('2026-09-01') }, images: [] }) },
      { id: 'a2', data: () => ({ title: 'B', createdAt: 'hier', images: [] }) },
    ];
    (getDocs as jest.Mock).mockResolvedValueOnce({
      docs,
      forEach: (cb: (d: unknown) => void) => docs.forEach(cb),
    });

    const articles = await ArticlesService.getUserArticles('uid');

    expect(articles.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(articles[1].createdAt).toBeInstanceOf(Date);
  });
});

describe('fixArticleImageUrls — une entrée d’image mal formée', () => {
  it('écarte les entrées sans URL au lieu de lever sur tout le lot', () => {
    // La règle de création directe ne validait pas le contenu de `images` :
    // une seule entrée `null` ou numérique faisait lever le lecteur, et
    // l'exception vidait le parcours de tous les utilisateurs.
    const url = 'https://firebasestorage.googleapis.com/v0/b/b/o/drafts%2Fa.jpg?alt=media';
    const images = [null, { url: 5 }, { url }] as unknown as { url: string }[];

    expect(ArticlesService.fixArticleImageUrls(images)).toEqual([{ url }]);
  });
});

describe('createArticle — une demande de publication identifiable (V09)', () => {
  it('transmet l’identifiant de la demande, pour qu’un nouvel essai ne publie pas deux fois', async () => {
    await createFixtureArticle(baseArticle(), { requestId: 'draft_1757000000000_abc' });
    const payload = mockCreateArticleFn.mock.calls[0][0] as { clientRequestId?: string };
    expect(payload.clientRequestId).toBe('draft_1757000000000_abc');
  });
});

// --- Recherche : pagination et filtres poussés au serveur --------------------

type IndexField = { fieldPath: string; order?: string; arrayConfig?: string };
type CompositeIndex = { collectionGroup: string; fields: IndexField[] };

const compositeIndexes = firestoreIndexes.indexes as unknown as CompositeIndex[];

function hasIndex(collectionGroup: string, signature: string[]): boolean {
  return compositeIndexes.some(
    (index) =>
      index.collectionGroup === collectionGroup &&
      index.fields.map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig}`).join('|') ===
        signature.join('|'),
  );
}

// Un document du flux serveur ; par défaut il ne passe PAS le filtre couleur.
function indexedDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      title: 'Robe',
      price: 20,
      isActive: true,
      isSold: false,
      keywords: ['robe'],
      colors: ['bleu'],
      categoryIds: ['women', 'women_dresses'],
      condition: 'bon état',
      createdAt: { toDate: () => new Date('2026-01-01') },
      ...overrides,
    }),
  };
}

// Un lot PLEIN (100 = 20 x 5) dont une seule pièce est rouge.
function fullBatchWithOneMatch() {
  const docs = Array.from({ length: 100 }, (_, i) =>
    indexedDoc(`a${i}`, i === 0 ? { colors: ['rouge'] } : {}),
  );
  return { docs, forEach: (cb: (d: unknown) => void) => docs.forEach(cb) };
}

describe('recherche — la suite du flux ne dépend pas du nombre de résultats retenus', () => {
  it('garde la pagination ouverte quand cinq fenêtres pleines ne remplissent pas la page (search_index)', async () => {
    (getDocs as jest.Mock).mockResolvedValue(fullBatchWithOneMatch());

    const page = await ArticlesService.searchArticles('robe', { colors: ['rouge'] }, 20);

    // Cinq lots pleins, une seule robe rouge par lot : la page n'est pas pleine,
    // mais le flux serveur, lui, est loin d'être épuisé.
    expect(page.articles).toHaveLength(5);
    expect(page.hasMore).toBe(true);
  });

  it('garde la pagination ouverte sur le chemin articles (tri récent, filtre en mémoire)', async () => {
    (getDocs as jest.Mock).mockResolvedValue(fullBatchWithOneMatch());

    const page = await ArticlesService.searchArticles(
      undefined,
      { colors: ['rouge'], sortBy: 'recent' },
      20,
    );

    expect(page.articles).toHaveLength(5);
    expect(page.hasMore).toBe(true);
  });

  it('referme la pagination quand le flux serveur est réellement épuisé', async () => {
    const docs = [indexedDoc('a0', { colors: ['rouge'] })];
    (getDocs as jest.Mock).mockResolvedValue({
      docs,
      forEach: (cb: (d: unknown) => void) => docs.forEach(cb),
    });

    const page = await ArticlesService.searchArticles('robe', { colors: ['rouge'] }, 20);

    expect(page.hasMore).toBe(false);
  });
});

describe('tri « populaires » — la catégorie est filtrée par le serveur', () => {
  it('pousse categoryIds dans la requête au lieu de la filtrer en mémoire', async () => {
    (getDocs as jest.Mock).mockResolvedValue({ docs: [], forEach: () => {} });

    await ArticlesService.searchArticles(
      '',
      { categoryIds: ['women', 'women_dresses'], sortBy: 'popular' },
      20,
    );

    expect(where).toHaveBeenCalledWith('categoryIds', 'array-contains', 'women_dresses');
    // Plus rien à filtrer en mémoire : la sur-lecture x5 n'a plus lieu d'être.
    expect(firestoreLimit).toHaveBeenCalledWith(21);
  });

  it('dispose des index composites que cette requête exige', () => {
    expect(
      hasIndex('search_index', [
        'isActive:ASCENDING',
        'isSold:ASCENDING',
        'categoryIds:CONTAINS',
        'popularityScore:DESCENDING',
      ]),
    ).toBe(true);
    expect(
      hasIndex('search_index', [
        'isActive:ASCENDING',
        'isSold:ASCENDING',
        'categoryIds:CONTAINS',
        'condition:ASCENDING',
        'popularityScore:DESCENDING',
      ]),
    ).toBe(true);
  });
});

describe('articles similaires — le repli sur la catégorie legacy', () => {
  it('dispose de l’index composite que sa requête exige', () => {
    // Sans lui, Firestore refuse la requête et la section disparaît sans un mot.
    expect(
      hasIndex('articles', [
        'isActive:ASCENDING',
        'isSold:ASCENDING',
        'category:ASCENDING',
        'createdAt:DESCENDING',
      ]),
    ).toBe(true);
  });
});
