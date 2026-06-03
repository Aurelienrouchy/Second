/**
 * aiService — upload + analyse IA (flux création produit)
 *
 * Régression couverte (P1/P2/P3 → sell flow) :
 *  1. L'upload Storage doit passer par `uploadString(ref, base64, 'base64')`
 *     et NON `fetch(uri).blob()` + `uploadBytes` — ce dernier renvoie un Blob
 *     sans octets lisibles sous React Native New Arch (RN 0.83), ce qui faisait
 *     échouer l'upload ("Network request failed") puis bloquait l'analyse IA.
 *  2. Le contrat `confidence` est un NOMBRE côté serveur, recomposé en objet
 *     { value, level } côté client via createConfidenceScore — un champ analysé
 *     correctement doit produire un ConfidenceScore exploitable par l'écran
 *     détails (qui lit `.confidence.level`).
 *
 * Ce fichier vit dans tests/jest/ : Jest le ramasse (testMatch tests/jest/**),
 * Vitest l'ignore (exclude tests/jest/**) — pas de collision.
 */

// --- Mocks de modules natifs spécifiques à ce test ---------------------------

// expo-file-system/legacy : on simule une image lisible (existe + taille + base64).
const FAKE_BASE64 = 'ZmFrZS1pbWFnZS1ieXRlcw=='; // "fake-image-bytes"
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn((..._args: unknown[]) => Promise.resolve({ exists: true, size: 1024 })),
  readAsStringAsync: jest.fn((..._args: unknown[]) => Promise.resolve('ZmFrZS1pbWFnZS1ieXRlcw==')),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

// expo-image-manipulator : renvoie un URI traité distinct (no-op de transform).
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri: string) =>
    Promise.resolve({ uri: `processed-${uri}` }),
  ),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

// Firebase Storage : on observe uploadString / uploadBytes finement.
const mockUploadString = jest.fn((..._args: unknown[]) => Promise.resolve({ ref: {} }));
const mockUploadBytes = jest.fn((..._args: unknown[]) => Promise.resolve({ ref: {} }));
const mockGetDownloadURL = jest.fn((..._args: unknown[]) =>
  Promise.resolve('https://storage/o/drafts%2Fuid%2Fdraft%2Ffile.jpg?alt=media'),
);
const mockListAll = jest.fn((..._args: unknown[]) => Promise.resolve({ items: [] }));
jest.mock('firebase/storage', () => ({
  ref: jest.fn((_storage: unknown, path: string) => ({ path })),
  uploadString: (...args: unknown[]) => mockUploadString(...args),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
  getDownloadURL: (...args: unknown[]) => mockGetDownloadURL(...args),
  listAll: (...args: unknown[]) => mockListAll(...args),
  deleteObject: jest.fn((..._args: unknown[]) => Promise.resolve()),
}));

// Firebase Functions : callable analyzeProductImage contrôlable par test.
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((..._args: unknown[]) => mockCallable),
}));

// firebaseConfig est mocké globalement dans jest.setup.js (auth.currentUser = null).
// On pilote auth.currentUser à l'exécution via la référence importée plutôt que
// de re-déclarer un jest.mock local (ce qui casse la résolution sous clearMocks).
import { auth } from '@/config/firebaseConfig';
import { analyzeProductImage } from '@/services/aiService';

const mockAuth = auth as unknown as { currentUser: { uid: string } | null };

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
  mockAuth.currentUser = { uid: 'uid' };
  mockCallable.mockResolvedValue({ data: serverResponse() });
});

describe('analyzeProductImage — upload RN-safe (régression fetch/blob)', () => {
  it('upload via uploadString(base64) et JAMAIS via uploadBytes', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);

    expect(res.success).toBe(true);
    // Le cœur de la régression : on n'utilise plus le pont fetch()->blob->uploadBytes.
    expect(mockUploadBytes).not.toHaveBeenCalled();
    expect(mockUploadString).toHaveBeenCalledTimes(1);

    // Signature : (ref, base64, 'base64', { contentType })
    const [, payload, format, metadata] = mockUploadString.mock.calls[0] as [
      unknown,
      string,
      string,
      { contentType: string },
    ];
    expect(payload).toBe(FAKE_BASE64);
    expect(format).toBe('base64');
    expect(metadata.contentType).toBe('image/jpeg');
  });

  it('renvoie les storageUrls de l’upload', async () => {
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.storageUrls).toEqual([
      'https://storage/o/drafts%2Fuid%2Fdraft%2Ffile.jpg?alt=media',
    ]);
  });

  it('upload chaque image (multi-photos)', async () => {
    await analyzeProductImage([
      'file:///tmp/a.jpg',
      'file:///tmp/b.jpg',
      'file:///tmp/c.jpg',
    ]);
    expect(mockUploadString).toHaveBeenCalledTimes(3);
  });
});

describe('analyzeProductImage — gating & erreurs', () => {
  it('refuse l’analyse si l’utilisateur n’est pas authentifié', async () => {
    mockAuth.currentUser = null;
    const res = await analyzeProductImage(['file:///tmp/photo.jpg']);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('UNAUTHENTICATED');
    expect(mockUploadString).not.toHaveBeenCalled();
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
