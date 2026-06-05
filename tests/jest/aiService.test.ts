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
// observable. uploadAsync renvoie un downloadToken comme l'endpoint Storage media.
const FAKE_BASE64 = 'ZmFrZS1pbWFnZS1ieXRlcw=='; // "fake-image-bytes"
const mockUploadAsync = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ status: 200, body: JSON.stringify({ downloadTokens: 'tok123' }) }),
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
    Promise.resolve({ uri: `processed-${uri}` }),
  ),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

// Firebase Storage : seul deleteDraftImagesFromStorage utilise encore le SDK
// (ref/listAll/deleteObject). L'upload ne passe plus par le SDK.
jest.mock('firebase/storage', () => ({
  ref: jest.fn((_storage: unknown, path: string) => ({ path })),
  getDownloadURL: jest.fn((..._args: unknown[]) => Promise.resolve('https://storage/x')),
  listAll: jest.fn((..._args: unknown[]) => Promise.resolve({ items: [] })),
  deleteObject: jest.fn((..._args: unknown[]) => Promise.resolve()),
}));

// Firebase Functions : callable analyzeProductImage contrôlable par test.
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((..._args: unknown[]) => mockCallable),
}));

// firebaseConfig est mocké globalement dans jest.setup.js (auth.currentUser = null,
// storage = {}). On pilote auth.currentUser + le bucket Storage à l'exécution via
// les références importées plutôt que de re-déclarer un jest.mock local.
import { auth, storage } from '@/config/firebaseConfig';
import { analyzeProductImage } from '@/services/aiService';

const mockAuth = auth as unknown as {
  currentUser: { uid: string; getIdToken: () => Promise<string> } | null;
};
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
    packageSize: 'medium',
    labelFound: true,
    confidence: 0.88,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
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
      'https://firebasestorage.googleapis.com/v0/b/test-bucket.firebasestorage.app/o?uploadType=media&name=',
    );
    expect(url).toContain('drafts%2Fuid%2F');
    // Le fichier local NORMALISÉ (resize + JPEG) est streamé (pas de base64/blob côté JS).
    expect(fileUri).toBe('processed-file:///tmp/photo.jpg');
    expect(opts.uploadType).toBe('binary');
    expect(opts.headers.Authorization).toBe('Firebase test-token');
    expect(opts.headers['Content-Type']).toBe('image/jpeg');
  });

  it('renvoie une storageUrl construite depuis le downloadToken de la réponse', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.storageUrls).toHaveLength(1);
    expect(res.storageUrls![0]).toContain('test-bucket.firebasestorage.app');
    expect(res.storageUrls![0]).toContain('alt=media');
    expect(res.storageUrls![0]).toContain('token=tok123');
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
