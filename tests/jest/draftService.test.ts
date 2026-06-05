/**
 * draftService — persistance du brouillon de vente (tunnel Vendre).
 *
 * Couvre le comportement MÉTIER du brouillon, source de vérité locale du flux
 * de création/édition d'article :
 *  - cycle de vie : créer / sauver / charger / supprimer ;
 *  - expiration à 14 jours (un brouillon périmé est purgé au chargement et ne
 *    compte pas comme "draft existant") ;
 *  - progression du `currentStep` qui ne régresse jamais (Math.max) ;
 *  - cache local des photos via expo-file-system ;
 *  - règle critique de publication : `deleteDraft(true)` NE supprime PAS les
 *    images Storage (elles appartiennent désormais à l'article publié), alors
 *    que `deleteDraft()` les nettoie ;
 *  - récursion : deleteDraft lit AsyncStorage directement (jamais loadDraft).
 *
 * Vit dans tests/jest/ : Jest le ramasse, Vitest l'ignore (pas de collision).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-file-system/legacy — système de fichiers simulé pour le cache d'images.
const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockCopyAsync = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockReadDirectoryAsync = jest.fn(
  (..._args: unknown[]): Promise<string[]> => Promise.resolve([]),
);
const mockDeleteAsync = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return 'file:///documents/';
  },
  getInfoAsync: (...a: unknown[]) => mockGetInfoAsync(...a),
  makeDirectoryAsync: (...a: unknown[]) => mockMakeDirectoryAsync(...a),
  copyAsync: (...a: unknown[]) => mockCopyAsync(...a),
  readDirectoryAsync: (...a: unknown[]) => mockReadDirectoryAsync(...a),
  deleteAsync: (...a: unknown[]) => mockDeleteAsync(...a),
}));

// aiService.deleteDraftImagesFromStorage — on observe les appels Storage.
const mockDeleteDraftImagesFromStorage = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/aiService', () => ({
  deleteDraftImagesFromStorage: (...a: unknown[]) =>
    mockDeleteDraftImagesFromStorage(...a),
}));

import draftService, {
  createEmptyDraft,
  getDaysUntilExpiration,
  ArticleDraft,
  DraftFields,
  DraftPricing,
} from '@/services/draftService';

const DRAFT_KEY = '@article_draft';

function readStored(): ArticleDraft | null {
  const calls = (AsyncStorage.setItem as jest.Mock).mock.calls;
  const last = calls[calls.length - 1];
  return last ? (JSON.parse(last[1]) as ArticleDraft) : null;
}

const sampleFields = (): DraftFields => ({
  title: 'Robe fleurie Zara',
  description: 'Portée deux fois',
  categoryIds: ['women', 'women_dresses'],
  categoryDisplay: { icon: '', name: 'Robes', context: 'Femmes' },
  condition: 'tres-bon-etat',
  colors: ['bleu-marine'],
  materials: ['coton'],
  brands: ['Zara'],
  size: 'M',
});

const samplePricing = (): DraftPricing => ({
  price: 25,
  isHandDelivery: true,
  isShipping: false,
  neighborhood: null,
  neighborhoods: [],
  packageSize: null,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // Par défaut : le répertoire d'images existe et est vide.
  mockGetInfoAsync.mockResolvedValue({ exists: true });
  mockReadDirectoryAsync.mockResolvedValue([]);
});

describe('createEmptyDraft', () => {
  it('initialise un brouillon vide à l’étape 1 avec un id unique', () => {
    const a = createEmptyDraft();
    const b = createEmptyDraft();

    expect(a.currentStep).toBe(1);
    expect(a.photos).toEqual([]);
    expect(a.storageUrls).toEqual([]);
    expect(a.fields).toBeNull();
    expect(a.pricing).toBeNull();
    expect(a.aiResult).toBeNull();
    // Deux brouillons consécutifs n'entrent jamais en collision d'id.
    expect(a.id).not.toBe(b.id);
  });
});

describe('save / load — round-trip', () => {
  it('sauve puis recharge un brouillon non périmé', async () => {
    const draft = createEmptyDraft();
    draft.fields = sampleFields();

    await draftService.saveDraft(draft);
    const loaded = await draftService.loadDraft();

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(draft.id);
    expect(loaded!.fields?.title).toBe('Robe fleurie Zara');
  });

  it('rafraîchit updatedAt à chaque sauvegarde', async () => {
    const draft = createEmptyDraft();
    draft.updatedAt = '2020-01-01T00:00:00.000Z';

    await draftService.saveDraft(draft);

    const stored = readStored()!;
    expect(stored.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(new Date(stored.updatedAt).getTime()).toBeGreaterThan(
      new Date('2020-01-01').getTime(),
    );
  });

  it('renvoie null quand aucun brouillon n’existe', async () => {
    expect(await draftService.loadDraft()).toBeNull();
  });
});

describe('expiration — purge à 14 jours', () => {
  it('supprime et renvoie null pour un brouillon créé il y a plus de 14 jours', async () => {
    const draft = createEmptyDraft();
    draft.createdAt = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    const loaded = await draftService.loadDraft();

    expect(loaded).toBeNull();
    // Purge réelle : la clé AsyncStorage est retirée.
    expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('conserve un brouillon créé il y a 13 jours', async () => {
    const draft = createEmptyDraft();
    draft.createdAt = new Date(
      Date.now() - 13 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    const loaded = await draftService.loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(draft.id);
  });

  it('hasDraft ne compte pas un brouillon périmé', async () => {
    const draft = createEmptyDraft();
    draft.createdAt = new Date(
      Date.now() - 20 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    expect(await draftService.hasDraft()).toBe(false);
  });

  it('hasDraft est vrai pour un brouillon frais, faux quand vide', async () => {
    expect(await draftService.hasDraft()).toBe(false);
    await draftService.saveDraft(createEmptyDraft());
    expect(await draftService.hasDraft()).toBe(true);
  });

  it('getDaysUntilExpiration renvoie ~14 pour un brouillon neuf et 0 si périmé', () => {
    const fresh = createEmptyDraft();
    expect(getDaysUntilExpiration(fresh)).toBeGreaterThanOrEqual(13);
    expect(getDaysUntilExpiration(fresh)).toBeLessThanOrEqual(14);

    const expired = createEmptyDraft();
    expired.createdAt = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(getDaysUntilExpiration(expired)).toBe(0);
  });
});

describe('progression des étapes — Math.max, jamais de régression', () => {
  it('updateDraftFields fait passer à l’étape 2 minimum', async () => {
    const draft = createEmptyDraft();
    const updated = await draftService.updateDraftFields(draft, sampleFields());
    expect(updated.currentStep).toBe(2);
    expect(updated.fields?.title).toBe('Robe fleurie Zara');
  });

  it('updateDraftPricing fait passer à l’étape 3 minimum', async () => {
    const draft = createEmptyDraft();
    const updated = await draftService.updateDraftPricing(
      draft,
      samplePricing(),
    );
    expect(updated.currentStep).toBe(3);
    expect(updated.pricing?.price).toBe(25);
  });

  it('ne régresse pas le step si le brouillon est déjà plus avancé', async () => {
    const draft = createEmptyDraft();
    draft.currentStep = 4;
    const updated = await draftService.updateDraftFields(draft, sampleFields());
    expect(updated.currentStep).toBe(4);
  });

  it('updateDraftStep applique une étape explicite et persiste', async () => {
    const draft = createEmptyDraft();
    const updated = await draftService.updateDraftStep(draft, 3);
    expect(updated.currentStep).toBe(3);
    expect(readStored()!.currentStep).toBe(3);
  });
});

describe('photos & storageUrls', () => {
  it('cache une photo distante en local et la persiste comme photo du brouillon', async () => {
    // Source distante (n'est pas dans documentDirectory) -> doit être copiée.
    mockCopyAsync.mockResolvedValue(undefined);

    const draft = createEmptyDraft();
    const updated = await draftService.updateDraftPhotos(draft, [
      'https://cdn/remote.jpg',
    ]);

    expect(mockCopyAsync).toHaveBeenCalledTimes(1);
    expect(updated.photos[0]).toContain('draft_images/');
    expect(updated.originalPhotoUris).toEqual(['https://cdn/remote.jpg']);
  });

  it('ne recopie pas une photo déjà locale (documentDirectory)', async () => {
    const draft = createEmptyDraft();
    const localUri = 'file:///documents/already-there.jpg';
    const cached = await draftService.cachePhotos([localUri], draft.id);

    expect(mockCopyAsync).not.toHaveBeenCalled();
    expect(cached).toEqual([localUri]);
  });

  it('updateDraftAIResult conserve les anciennes storageUrls si non fournies', async () => {
    const draft = createEmptyDraft();
    draft.storageUrls = ['https://storage/a.jpg'];
    const updated = await draftService.updateDraftAIResult(
      draft,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    expect(updated.storageUrls).toEqual(['https://storage/a.jpg']);
  });

  it('hasStorageUrls reflète la présence d’URLs uploadées', () => {
    const empty = createEmptyDraft();
    expect(draftService.hasStorageUrls(empty)).toBe(false);
    empty.storageUrls = ['https://storage/a.jpg'];
    expect(draftService.hasStorageUrls(empty)).toBe(true);
  });
});

describe('deleteDraft — règle de publication (keepStorageImages)', () => {
  it('par défaut, supprime aussi les images Storage du brouillon', async () => {
    const draft = createEmptyDraft();
    draft.storageUrls = ['https://storage/img.jpg'];
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    await draftService.deleteDraft();

    expect(mockDeleteDraftImagesFromStorage).toHaveBeenCalledWith(draft.id);
    expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('après publication (keepStorageImages=true), NE supprime PAS les images Storage', async () => {
    const draft = createEmptyDraft();
    draft.storageUrls = ['https://storage/img.jpg'];
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    await draftService.deleteDraft(true);

    // Les images appartiennent désormais à l'article publié : on les garde.
    expect(mockDeleteDraftImagesFromStorage).not.toHaveBeenCalled();
    // Le brouillon local est tout de même purgé.
    expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('nettoie les images locales du brouillon ciblé', async () => {
    const draft = createEmptyDraft();
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    mockReadDirectoryAsync.mockResolvedValue([
      `${draft.id}_0.jpg`,
      `${draft.id}_1.jpg`,
      'other_draft_0.jpg',
    ]);

    await draftService.deleteDraft();

    // Seuls les fichiers du brouillon courant sont supprimés (pas other_draft).
    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
  });

  it('est idempotent quand il n’y a rien à supprimer', async () => {
    await expect(draftService.deleteDraft()).resolves.toBeUndefined();
    expect(mockDeleteDraftImagesFromStorage).not.toHaveBeenCalled();
  });
});

describe('flag de publication — wasPublished / markPublished', () => {
  it('est false par défaut (aucune publication)', () => {
    // saveDraft remet le flag à false : on part d'un état propre.
    expect(draftService.wasPublished).toBe(false);
  });

  it('markPublished arme le flag', () => {
    draftService.markPublished();
    expect(draftService.wasPublished).toBe(true);
    // Nettoyage pour les tests suivants (le singleton est partagé).
    await draftService.saveDraft(createEmptyDraft());
  });

  it('saveDraft ré-arme le guard (flag remis à false)', async () => {
    draftService.markPublished();
    await draftService.saveDraft(createEmptyDraft());
    expect(draftService.wasPublished).toBe(false);
  });

  it('loadDraft ré-arme le guard (flag remis à false)', async () => {
    await draftService.saveDraft(createEmptyDraft());
    draftService.markPublished();
    await draftService.loadDraft();
    expect(draftService.wasPublished).toBe(false);
  });
});

describe('cleanupExpiredDrafts — purge des images orphelines', () => {
  it('supprime toutes les images locales quand aucun brouillon n’existe', async () => {
    mockReadDirectoryAsync.mockResolvedValue(['a.jpg', 'b.jpg']);

    await draftService.cleanupExpiredDrafts();

    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
  });

  it('ne supprime que les images n’appartenant pas au brouillon courant', async () => {
    const draft = createEmptyDraft();
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    mockReadDirectoryAsync.mockResolvedValue([
      `${draft.id}_0.jpg`,
      'orphan_0.jpg',
    ]);

    await draftService.cleanupExpiredDrafts();

    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      expect.stringContaining('orphan_0.jpg'),
      { idempotent: true },
    );
  });
});
