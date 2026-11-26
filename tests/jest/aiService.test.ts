import * as ImageManipulator from 'expo-image-manipulator';
/**
 * aiService — upload + analyse IA (flux création produit)
 *
 * Régression couverte (P1/P2/P3 → sell flow) :
 *  1. L'upload Storage doit passer par le endpoint REST Firebase Storage via
 *     `expo-file-system` `uploadAsync` (BINARY_CONTENT), et NON par le Web SDK
 *     (`uploadString`/`uploadBytes`) : sous React Native New Arch (RN 0.83) le SDK
 *     construit un Blob depuis un Uint8Array que le BlobManager natif refuse
 *     ("Creating blobs from ArrayBuffer ... not supported"), ce qui faisait
 *     échouer l'upload puis bloquait l'analyse IA.
 *  2. Le contrat `confidence` est un NOMBRE côté serveur, recomposé en objet
 *     { value, level } côté client via createConfidenceScore — un champ analysé
 *     correctement doit produire un ConfidenceScore exploitable par l'écran
 *     détails (qui lit `.confidence.level`).
 *
 * Ce fichier vit dans tests/jest/ : Jest le ramasse (testMatch tests/jest/**),
 * Vitest l'ignore (exclude tests/jest/**) — pas de collision.
 */

// --- Mocks de modules natifs spécifiques à ce test ---------------------------

// expo-file-system/legacy : image lisible (existe + taille + base64) + upload REST
// observable. Firebase may return downloadTokens; the client must never persist them.
const FAKE_BASE64 = 'ZmFrZS1pbWFnZS1ieXRlcw=='; // "fake-image-bytes"
const mockUploadAsync = jest.fn<Promise<{status: number; body: string; headers?: Record<string, string>}>, unknown[]>((..._args: unknown[]) =>
  Promise.resolve({ status: 200, headers: {'x-goog-upload-status': 'final'}, body: JSON.stringify({ downloadTokens: 'synthetic-test-capability' }) }),
);
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn((..._args: unknown[]) => Promise.resolve({ exists: true, size: 1024 })),
  readAsStringAsync: jest.fn((..._args: unknown[]) => Promise.resolve('ZmFrZS1pbWFnZS1ieXRlcw==')),
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  FileSystemUploadType: { BINARY_CONTENT: 'binary', MULTIPART: 'multipart' },
}));

// expo-image-manipulator : renvoie un URI traité distinct (no-op de transform).
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri: string) =>
    Promise.resolve({ uri: `file:///prepared/${uri.split('/').pop()}` }),
  ),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

// Taille des photos : grande par défaut, pour que le redimensionnement s'applique.
const mockImageSize = jest.fn((..._args: unknown[]) => Promise.resolve({ width: 4032, height: 3024 }));
jest.mock('@/utils/imageSize', () => ({
  getImageSize: (...a: unknown[]) => mockImageSize(...a),
}));

// Spy on forbidden client cleanup operations; uploads use the native REST port.
jest.mock('firebase/storage', () => ({
  ref: jest.fn((_storage: unknown, path: string) => ({ path })),
  getDownloadURL: jest.fn((..._args: unknown[]) => Promise.resolve('https://storage/x')),
  updateMetadata: jest.fn((..._args: unknown[]) => Promise.resolve({})),
  listAll: jest.fn((..._args: unknown[]) => Promise.resolve({ items: [] })),
  deleteObject: jest.fn((..._args: unknown[]) => Promise.resolve()),
}));

// Firebase Functions : callable analyzeProductImage contrôlable par test.
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((..._args: unknown[]) => mockCallable),
}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1,
  useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), {getState: () => ({authenticatedUid: mockAuth.currentUser?.uid ?? null})}),
}));

// firebaseConfig est mocké globalement dans jest.setup.js (auth.currentUser = null,
// storage = {}). On pilote auth.currentUser + le bucket Storage à l'exécution via
// les références importées plutôt que de re-déclarer un jest.mock local.
import { auth, storage } from '@/config/firebaseConfig';
import { deleteObject, listAll, updateMetadata } from 'firebase/storage';
import { getInfoAsync } from 'expo-file-system/legacy';
import { manipulateAsync } from 'expo-image-manipulator';
import { getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { analyzeProductImage, deleteDraftImagesFromStorage } from '@/features/sell/services/aiService';
import * as NativeStorageUpload from '@/services/nativeStorageUpload';

const mockAuth = auth as unknown as {
  currentUser: { uid: string; getIdToken: () => Promise<string> } | null;
};
const mockFetch = jest.fn();
const previousFetch = global.fetch;
afterAll(() => {global.fetch = previousFetch;});
const mockStorage = storage as unknown as { app: { options: { storageBucket: string } } };

// Réponse serveur "réaliste" : confidence émise en NOMBRE (contrat Option A).
function serverResponse() {
  return {
    title: 'Robe fleurie Zara',
    titleConfidence: 0.9,
    description: 'Jolie robe légère, portée deux fois.',
    descriptionConfidence: 0.85,
    category: {
      categoryId: 'women_dresses',
      categoryPath: ['women', 'women_dresses'],
      displayName: 'Robes',
      fullLabel: 'Femmes > Robes',
      confidence: 0.92,
      validated: true,
    },
    condition: { conditionId: 'tres-bon-etat', confidence: 0.8 },
    colors: { primaryColorId: 'bleu-marine', colorIds: ['bleu-marine'], confidence: 0.7 },
    materials: { primaryMaterialId: 'coton', materialIds: ['coton'], confidence: 0.6 },
    size: { detected: 'M', confidence: 0.75 },
    brand: { detected: 'Zara', confidence: 0.95, matchType: 'exact' },
    packageSize: { suggested: 'medium', confidence: 0.6 },
    labelFound: true,
    confidence: 0.88,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockFetch.mockImplementation(async (url: string) => ({ok: true, status: 200, headers: {get: (name: string) => name.toLowerCase() === 'x-goog-upload-status' ? 'active' : name.toLowerCase() === 'x-goog-upload-url' ? url + '&upload_id=synthetic-session' : null}}));
  mockAuth.currentUser = { uid: 'uid', getIdToken: jest.fn().mockResolvedValue('test-token') };
  mockStorage.app = { options: { storageBucket: 'test-bucket.firebasestorage.app' } };
  mockCallable.mockResolvedValue({ data: serverResponse() });
});

describe('analyzeProductImage — upload RN-safe (REST, pas le Web SDK)', () => {
  it('upload via expo-file-system uploadAsync (BINARY_CONTENT + auth Firebase)', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);

    expect(res.success).toBe(true);
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);

    const [url, fileUri, opts] = mockUploadAsync.mock.calls[0] as [
      string,
      string,
      { httpMethod: string; uploadType: string; headers: Record<string, string> },
    ];
    // Endpoint REST media + bucket configuré + chemin drafts/<uid>/ encodé (%2F).
    expect(url).toContain(
      'http://127.0.0.1:9199/v0/b/test-bucket.firebasestorage.app/o?name=',
    );
    expect(url).toContain('drafts%2Fuid%2F');
    // Le fichier local NORMALISÉ (resize + JPEG) est streamé (pas de base64/blob côté JS).
    expect(fileUri).toBe('file:///prepared/photo.jpg');
    expect(opts.uploadType).toBe('binary');
    expect(opts.headers.Authorization).toBe('Firebase test-token');
    expect(opts.headers['Content-Type']).toBe('image/jpeg');
    expect(mockCallable).toHaveBeenCalledWith({ images: [{ base64: FAKE_BASE64, mimeType: 'image/jpeg' }] });
    expect(updateMetadata).not.toHaveBeenCalled();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({name: expect.stringContaining('drafts/uid/'), contentType: 'image/jpeg', cacheControl: 'private, no-store, max-age=0'});
  });

  it('persiste une référence canonique privée sans downloadToken', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.storageUrls).toHaveLength(1);
    expect(res.storageUrls![0]).toContain('test-bucket.firebasestorage.app');
    expect(res.storageUrls![0]).toContain('alt=media');
    expect(new URL(res.storageUrls![0]).search).toBe('?alt=media');
    expect(res.storageUrls![0]).toContain('https://firebasestorage.googleapis.com');
  });

  it('upload chaque image (multi-photos)', async () => {
    await analyzeProductImage([
      'file:///tmp/a.jpg',
      'file:///tmp/b.jpg',
      'file:///tmp/c.jpg',
    ]);
    expect(mockUploadAsync).toHaveBeenCalledTimes(3);
  });
});

describe('analyzeProductImage — gating & erreurs', () => {
  it('does not adopt photos into a new account when auth changes during image processing', async () => {
    (ImageManipulator.manipulateAsync as jest.Mock).mockImplementationOnce(async (uri: string) => {
      mockAuth.currentUser = { uid: 'different-user', getIdToken: async () => 'synthetic-id-token' };
      return { uri: `file:///prepared/${uri.split('/').pop()}` };
    });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(false);
    expect(mockUploadAsync).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('never uploads remaining photos under a second account after a multi-photo switch', async () => {
    const res = await analyzeProductImage(['file:///tmp/a.jpg', 'file:///tmp/b.jpg'], {
      onProgress: (progress) => {
        if (mockUploadAsync.mock.calls.length === 1) mockAuth.currentUser = { uid: 'different-user', getIdToken: async () => 'synthetic-id-token' };
      },
    });
    expect(res.success).toBe(false);
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
    expect(mockUploadAsync.mock.calls[0][0]).toContain('drafts%2Fuid%2F');
    expect(mockCallable).not.toHaveBeenCalled();
    expect(res.storageUrls).toBeUndefined();
  });

  it('drops another account’s late AI result without cleaning that new account storage', async () => {
    mockCallable.mockImplementationOnce(async () => {
      mockAuth.currentUser = { uid: 'different-user', getIdToken: async () => 'synthetic-id-token' };
      return { data: serverResponse() };
    });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(false);
    expect(res.storageUrls).toBeUndefined();
    expect(listAll).not.toHaveBeenCalled();
  });

  it('does not upload or persist another account’s draft if auth changes during token retrieval', async () => {
    mockAuth.currentUser!.getIdToken = async () => {
      mockAuth.currentUser = { uid: 'different-user', getIdToken: async () => 'synthetic-id-token' };
      return 'synthetic-old-token';
    };
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(false);
    expect(res.storageUrls).toBeUndefined();
    expect(mockUploadAsync).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('does not expose an upload failure body containing a download capability', async () => {
    mockUploadAsync.mockResolvedValueOnce({ status: 403, body: JSON.stringify({ downloadTokens: 'synthetic-test-capability' }) });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('synthetic-test-capability');
    expect(res.storageUrls).toBeUndefined();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('ignores automatically generated download capabilities and keeps analysis working', async () => {
    mockUploadAsync.mockResolvedValueOnce({ status: 200, headers: {'x-goog-upload-status': 'final'}, body: JSON.stringify({ downloadTokens: 'synthetic-test-capability' }) });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(true);
    expect(res.storageUrls).toHaveLength(1);
    expect(new URL(res.storageUrls![0]).search).toBe('?alt=media');
    expect(JSON.stringify(res)).not.toContain('synthetic-test-capability');
    expect(mockCallable).toHaveBeenCalledTimes(1);
  });

  it('refuse l’analyse si l’utilisateur n’est pas authentifié', async () => {
    mockAuth.currentUser = null;
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('UNAUTHENTICATED');
    expect(mockUploadAsync).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('refuse une liste vide de photos', async () => {
    const res = await analyzeProductImage([]);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_IMAGE');
  });
});

describe('analyzeProductImage — parsing confidence (nombre → ConfidenceScore)', () => {
  it('recompose les ConfidenceScore { value, level } depuis les nombres serveur', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(true);
    const r = res.result!;

    // 0.92 -> high ; objet exploitable par details.tsx (.confidence.level)
    expect(r.category.confidence).toMatchObject({ value: 0.92, level: 'high' });
    // 0.6 -> medium
    expect(r.materials.confidence).toMatchObject({ value: 0.6, level: 'medium' });
    // 0.95 -> high
    expect(r.brand.confidence.level).toBe('high');
  });

  it('mappe correctement les champs métier pour pré-remplir le formulaire', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    const r = res.result!;

    expect(r.title).toBe('Robe fleurie Zara');
    expect(r.description).toContain('robe');
    expect(r.category.categoryId).toBe('women_dresses');
    expect(r.condition.conditionId).toBe('tres-bon-etat');
    expect(r.colors.primaryColorId).toBe('bleu-marine');
    expect(r.materials.primaryMaterialId).toBe('coton');
    expect(r.size.detected).toBe('M');
    expect(r.brand.detected).toBe('Zara');
    expect(r.labelFound).toBe(true);
  });
});

describe('analyzeProductImage — délai d’attente (AC01)', () => {
  it('attend au moins aussi longtemps que le serveur travaille (120 s)', async () => {
    // Le SDK coupe à 70 s par défaut : le client abandonnait pendant que le
    // serveur finissait l'analyse, facturée et débitée pour rien.
    await analyzeProductImage(['file:///tmp/photo.jpg']);
    const options = (httpsCallable as jest.Mock).mock.calls[0][2] as { timeout?: number } | undefined;
    expect(options?.timeout ?? 70_000).toBeGreaterThan(120_000);
  });
});

describe('analyzeProductImage — nettoyage après échec (A12)', () => {
  it('conserve les originaux immuables de cet essai comme ceux des analyses précédentes', async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'functions/internal' }));
    const upload = jest.spyOn(NativeStorageUpload, 'uploadPreparedJpeg').mockResolvedValue({publicDownloadUrl: null});
    try {
      const result = await analyzeProductImage(['file:///tmp/photo.jpg'], { draftId: 'draft-1' });
      expect(upload).toHaveBeenCalledTimes(1); expect(mockCallable).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(listAll).not.toHaveBeenCalled();
      expect(getDocs).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    } finally {upload.mockRestore();}
  });
});

describe('analyzeProductImage — abandon (A11)', () => {
  it('n’appelle pas l’analyse, payante, quand l’écran a été quitté pendant le téléversement', async () => {
    const controller = new AbortController();
    mockUploadAsync.mockImplementationOnce(async () => {
      controller.abort();
      return { status: 200, headers: {'x-goog-upload-status': 'final'}, body: JSON.stringify({ downloadTokens: 'tok123' }) };
    });

    const res = await analyzeProductImage(['file:///tmp/photo.jpg'], { signal: controller.signal });

    expect(mockCallable).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
  });
});

describe('analyzeProductImage — messages d’erreur (A13, A07)', () => {
  it('n’affiche pas le code brut du SDK à l’utilisateur', async () => {
    mockCallable.mockRejectedValueOnce(
      Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }),
    );
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.error?.message).not.toBe('deadline-exceeded');
  });

  it('garde le message français du serveur quand il en porte un', async () => {
    const message = 'Cette photo a été refusée par la modération automatique. Essayez avec une autre photo.';
    mockCallable.mockRejectedValueOnce(
      Object.assign(new Error(message), { code: 'functions/failed-precondition' }),
    );
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.error?.message).toBe(message);
  });

  it('le quota atteint n’est pas une erreur à réessayer tout de suite', async () => {
    mockCallable.mockRejectedValueOnce(
      Object.assign(new Error('Limite atteinte : maximum 10 analyses par heure. Réessayez plus tard.'), {
        code: 'functions/resource-exhausted',
      }),
    );
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.error?.code).toBe('QUOTA_EXCEEDED');
    expect(res.error?.retryable).toBe(false);
  });
});

describe('deleteDraftImagesFromStorage — les photos d’un article publié (V09)', () => {
  it('ne confirme aucune purge distante et ne lance aucun inventaire ni DELETE depuis le client', async () => {
    await expect(deleteDraftImagesFromStorage('d1', 'uid')).resolves.toBe(false);
    expect(listAll).not.toHaveBeenCalled();
    expect(getDocs).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe('analyzeProductImage — une confiance nulle reste nulle (TY02)', () => {
  it('un champ où l’IA n’a rien trouvé ne remonte pas comme « Probable »', async () => {
    // `raw.x.confidence || 0.5` réécrivait un 0 du serveur en 0,5 — « moyenne ».
    mockCallable.mockResolvedValueOnce({
      data: {
        ...serverResponse(),
        colors: { primaryColorId: '', colorIds: [], confidence: 0 },
        brand: { detected: null, confidence: 0, matchType: 'none' },
      },
    });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.result!.colors.confidence.value).toBe(0);
    expect(res.result!.brand.confidence.value).toBe(0);
  });
});

describe('analyzeProductImage — une petite photo n’est pas agrandie (A01)', () => {
  it('ne redimensionne pas une photo plus petite que la borne', async () => {
    // `resize: { width: 1600 }` AGRANDISSAIT une photo de 800 px : plus
    // lourde à téléverser, sans un pixel d'information en plus.
    mockImageSize
      .mockResolvedValueOnce({ width: 800, height: 600 })
      .mockResolvedValueOnce({ width: 800, height: 600 });
    await analyzeProductImage(['file:///tmp/small.jpg']);
    // Ni le rendu envoyé au modèle, ni celui qui part au stockage.
    expect((manipulateAsync as jest.Mock).mock.calls[0][1]).toEqual([]);
    expect((manipulateAsync as jest.Mock).mock.calls[1][1]).toEqual([]);
  });
});

describe('analyzeProductImage — taille de colis suggérée (TY04)', () => {
  it('lit la suggestion du serveur sous sa forme objet', async () => {
    mockCallable.mockResolvedValueOnce({
      data: { ...serverResponse(), packageSize: { suggested: 'large', confidence: 0.7 } },
    });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.result!.packageSize.suggested).toBe('large');
  });

  it('lit aussi la chaîne brute que renvoie le serveur actuellement déployé', async () => {
    mockCallable.mockResolvedValueOnce({ data: { ...serverResponse(), packageSize: 'large' } });
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.result!.packageSize.suggested).toBe('large');
  });
});

describe('analyzeProductImage — compression avant stockage (A02)', () => {
  it('téléverse le rendu du point d’entrée unique (1200 px / 0,75), pas celui de l’analyse', async () => {
    (manipulateAsync as jest.Mock)
      .mockImplementationOnce((uri: string) => Promise.resolve({ uri: `file:///analysis/${uri.split('/').pop()}` }))
      .mockImplementationOnce((uri: string) => Promise.resolve({ uri: `file:///upload/${uri.split('/').pop()}` }));

    await analyzeProductImage(['file:///tmp/photo.jpg']);

    const calls = (manipulateAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    // Le rendu envoyé au modèle garde ses 1600 px : c'est ce qui permet de lire l'étiquette.
    expect(calls[0][1]).toEqual([{ resize: { width: 1600 } }]);
    expect(calls[0][2]).toMatchObject({ compress: 0.8 });
    // Le rendu stocké, lui, passe par prepareImageForUpload : 1200 px, qualité 0,75.
    expect(calls[1][1]).toEqual([{ resize: { width: 1200 } }]);
    expect(calls[1][2]).toMatchObject({ compress: 0.75 });

    const [, fileUri] = mockUploadAsync.mock.calls[0] as [string, string];
    expect(fileUri).toBe('file:///upload/photo.jpg');
  });
});

describe('analyzeProductImage — jeton de téléchargement manquant (A05)', () => {
  it('ne publie pas une URL « token=undefined »', async () => {
    mockUploadAsync.mockImplementationOnce(() =>
      Promise.resolve({ status: 200, headers: {'x-goog-upload-status': 'final'}, body: JSON.stringify({ name: 'drafts/uid/d1/a.jpg' }) }),
    );

    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);

    expect(res.success).toBe(true);
    expect(JSON.stringify(res.storageUrls ?? [])).not.toContain('token=undefined');
  });
});

describe('analyzeProductImage — progression (A09)', () => {
  it('ne recule jamais', async () => {
    const values: number[] = [];
    await analyzeProductImage(['file:///tmp/photo.jpg'], { onProgress: (p) => values.push(p) });
    const reculs = values.filter((v, i) => i > 0 && v < values[i - 1]);
    expect(reculs).toEqual([]);
  });

  it('continue d’avancer pendant que le serveur travaille', async () => {
    jest.useFakeTimers();
    try {
      let resolveCall: (value: unknown) => void = () => {};
      mockCallable.mockImplementationOnce(
        () => new Promise((resolve) => { resolveCall = resolve; }),
      );

      const values: number[] = [];
      const promise = analyzeProductImage(['file:///tmp/photo.jpg'], {
        onProgress: (p) => values.push(p),
      });
      await jest.advanceTimersByTimeAsync(6000);

      // La barre restait figée à 60 % pendant toute l'attente réelle.
      expect(values.filter((v) => v > 60).length).toBeGreaterThan(0);
      // ... sans jamais dépasser la phase suivante (88 %), sinon elle reculerait.
      expect(Math.max(...values)).toBeLessThan(88);

      resolveCall({ data: serverResponse() });
      await promise;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('analyzeProductImage — photo disparue entre la sélection et l’analyse (AC04)', () => {
  it('annonce une image illisible plutôt qu’une erreur serveur', async () => {
    // Le fichier n'existe plus au moment de l'analyse : le service partait
    // quand même, et l'échec ressortait en « Erreur serveur » réessayable.
    (getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false, size: 0 });

    const res = await analyzeProductImage(['file:///tmp/disparue.jpg']);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_IMAGE');
    expect(res.error?.retryable).toBe(false);
    expect(mockCallable).not.toHaveBeenCalled();
  });
});

describe('analyzeProductImage — échec de téléversement (A04)', () => {
  it('ne tente aucune suppression interdite quand le deuxième téléversement échoue', async () => {
    const upload = jest.spyOn(NativeStorageUpload, 'uploadPreparedJpeg')
      .mockResolvedValueOnce({publicDownloadUrl: null}).mockRejectedValueOnce(new Error('offline'));
    try {
      const res = await analyzeProductImage(['file:///tmp/a.jpg', 'file:///tmp/b.jpg'], {draftId: 'draft-1'});
      expect(upload).toHaveBeenCalledTimes(2); expect(mockCallable).not.toHaveBeenCalled();
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('NETWORK_ERROR');
      expect(listAll).not.toHaveBeenCalled();
      expect(getDocs).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    } finally {upload.mockRestore();}
  });
});
