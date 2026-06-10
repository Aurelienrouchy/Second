/**
 * ShopService — domaine boutiques-admin (création + modération).
 *
 * Couvre le comportement MÉTIER du service qui orchestre le cycle de vie d'une
 * boutique. Les mutations sensibles (status / verificationDetails) sont
 * verrouillées côté firestore.rules : le service NE doit jamais les écrire
 * directement, il délègue aux Cloud Functions callables `approveShop` /
 * `rejectShop` / `suspendShop` (Admin SDK + runTransaction).
 *
 *  - createShop : status forcé à 'pending' (jamais l'attaquant), geohash
 *    calculé depuis lat/lng, compteurs initialisés, puis l'id du doc est
 *    réécrit dans le document.
 *  - approveShop / rejectShop / suspendShop : routent vers la BONNE callable
 *    avec le BON payload ({ shopId } / { shopId, reason }) — aucun adminId
 *    envoyé par le client (l'admin est dérivé de request.auth côté serveur).
 *  - les erreurs callable sont enrobées dans un message FR exploitable.
 *  - updateShop : SÉCURITÉ — strip de status + verificationDetails même si le
 *    client tente de les passer ; recalcul du geohash si la localisation change.
 *  - getShopById : conversion des Timestamps Firestore en Date ; null si absent.
 *  - getPendingShops : ne renvoie que le bucket 'pending' (filtre status).
 *
 * Vit dans tests/jest/ : Jest le ramasse, Vitest l'ignore.
 */

// geofire-common : geohash déterministe observable (pas de vrai calcul ici).
jest.mock('geofire-common', () => ({
  geohashForLocation: jest.fn((..._args: unknown[]) => 'GEOHASH_FIXED'),
  geohashQueryBounds: jest.fn((..._args: unknown[]) => [['a', 'b']]),
}));

// Callables : on capture le nom de la fonction appelée et le payload transmis.
const mockApproveFn = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { ok: true, shopId: 'shop_1', status: 'approved' } }),
);
const mockRejectFn = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { ok: true, shopId: 'shop_1', status: 'rejected' } }),
);
const mockSuspendFn = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { ok: true, shopId: 'shop_1', status: 'suspended' } }),
);
const mockPurchaseTierFn = jest.fn((..._args: unknown[]) =>
  Promise.resolve({
    data: {
      success: true,
      clientSecret: 'pi_secret_123',
      paymentIntentId: 'pi_123',
      tier: 'pro',
      periodMonths: 3,
      amountCents: 8997,
    },
  }),
);
const mockHttpsCallable = jest.fn((_fns: unknown, name: string) => {
  if (name === 'approveShop') return mockApproveFn;
  if (name === 'rejectShop') return mockRejectFn;
  if (name === 'suspendShop') return mockSuspendFn;
  if (name === 'purchaseShopTier') return mockPurchaseTierFn;
  return jest.fn();
});
jest.mock('firebase/functions', () => ({
  httpsCallable: (...a: unknown[]) =>
    mockHttpsCallable(...(a as [unknown, string])),
}));

import {
  addDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { ShopService } from '@/services/shopService';
import type { Shop } from '@/types';

const mockAddDoc = addDoc as jest.Mock;
const mockUpdateDoc = updateDoc as jest.Mock;
const mockGetDoc = getDoc as jest.Mock;
const mockGetDocs = getDocs as jest.Mock;
const mockServerTimestamp = serverTimestamp as jest.Mock;

// Sentinelle stable renvoyée par serverTimestamp() pour assertions d'égalité.
const TS_SENTINEL = { __ts: true };

function makeShopInput(): Omit<Shop, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    ownerId: 'owner_1',
    name: 'Friperie du Plateau',
    description: 'Belle sélection vintage',
    type: 'friperie',
    address: {
      street: '123 rue Saint-Denis',
      city: 'Montréal',
      postalCode: 'H2X 1L2',
      country: 'CA',
    },
    location: { latitude: 45.51, longitude: -73.57 },
    phoneNumber: '514-555-0100',
    email: 'contact@friperie.ca',
    openingHours: {},
    images: ['https://img/1.jpg'],
    status: 'approved' as Shop['status'], // ← tentative client, doit être ignorée
    reviewCount: 99, // ← valeurs client, doivent être écrasées
    articlesCount: 99,
  } as Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServerTimestamp.mockReturnValue(TS_SENTINEL);
});

describe('ShopService.createShop', () => {
  it("force le status à 'pending' et écrase les compteurs même si le client envoie autre chose", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: 'shop_new' });

    await ShopService.createShop(makeShopInput());

    const written = mockAddDoc.mock.calls[0][1];
    // SÉCURITÉ MÉTIER : une boutique naît toujours en attente de validation.
    expect(written.status).toBe('pending');
    // Compteurs neutralisés à la création (pas de réputation héritée).
    expect(written.reviewCount).toBe(0);
    expect(written.articlesCount).toBe(0);
  });

  it('calcule le geohash depuis lat/lng et timestamp serveur', async () => {
    mockAddDoc.mockResolvedValueOnce({ id: 'shop_new' });

    await ShopService.createShop(makeShopInput());

    const written = mockAddDoc.mock.calls[0][1];
    expect(written.location.geohash).toBe('GEOHASH_FIXED');
    expect(written.createdAt).toBe(TS_SENTINEL);
    expect(written.updatedAt).toBe(TS_SENTINEL);
  });

  it("réécrit l'id du document dans la boutique et le retourne", async () => {
    const docRef = { id: 'shop_new' };
    mockAddDoc.mockResolvedValueOnce(docRef);

    const id = await ShopService.createShop(makeShopInput());

    expect(id).toBe('shop_new');
    expect(mockUpdateDoc).toHaveBeenCalledWith(docRef, { id: 'shop_new' });
  });

  it('enrobe une erreur Firestore dans un message FR', async () => {
    mockAddDoc.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(ShopService.createShop(makeShopInput())).rejects.toThrow(
      'Erreur lors de la création de la boutique',
    );
  });
});

describe('ShopService — modération via Cloud Functions', () => {
  it("approveShop appelle la callable 'approveShop' avec uniquement { shopId } (pas d'adminId)", async () => {
    await ShopService.approveShop('shop_1');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'approveShop');
    expect(mockApproveFn).toHaveBeenCalledWith({ shopId: 'shop_1' });
    const payload = mockApproveFn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('adminId');
  });

  it("rejectShop transmet shopId + reason à la callable 'rejectShop'", async () => {
    await ShopService.rejectShop('shop_1', 'Photos insuffisantes');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'rejectShop');
    expect(mockRejectFn).toHaveBeenCalledWith({
      shopId: 'shop_1',
      reason: 'Photos insuffisantes',
    });
  });

  it("suspendShop transmet shopId + reason à la callable 'suspendShop'", async () => {
    await ShopService.suspendShop('shop_1', 'Suspicion de fraude');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'suspendShop');
    expect(mockSuspendFn).toHaveBeenCalledWith({
      shopId: 'shop_1',
      reason: 'Suspicion de fraude',
    });
  });

  it('une callable de modération qui échoue est enrobée en message FR', async () => {
    mockApproveFn.mockRejectedValueOnce(new Error('unauthenticated'));

    await expect(ShopService.approveShop('shop_1')).rejects.toThrow(
      "Erreur lors de l'approbation de la boutique",
    );
  });
});

describe('ShopService.updateShop — verrouillage des champs sensibles', () => {
  it('strip status et verificationDetails même si le client tente de les passer', async () => {
    await ShopService.updateShop('shop_1', {
      description: 'Nouvelle description',
      // Tentative d'escalade : un client ne peut PAS auto-approuver sa boutique.
      status: 'approved' as Shop['status'],
      verificationDetails: { reason: 'self-approved' },
    } as Partial<Shop>);

    const written = mockUpdateDoc.mock.calls[0][1];
    expect(written).not.toHaveProperty('status');
    expect(written).not.toHaveProperty('verificationDetails');
    expect(written.description).toBe('Nouvelle description');
    expect(written.updatedAt).toBe(TS_SENTINEL);
  });

  it('recalcule le geohash quand la localisation change', async () => {
    await ShopService.updateShop('shop_1', {
      location: { latitude: 46.8, longitude: -71.2 },
    });

    const written = mockUpdateDoc.mock.calls[0][1];
    expect(written.location.geohash).toBe('GEOHASH_FIXED');
  });
});

describe('ShopService.getShopById', () => {
  it('convertit les Timestamps Firestore en Date et expose l\'id du doc', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const updatedAt = new Date('2026-02-01T00:00:00Z');
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'shop_1',
      data: () => ({
        name: 'Friperie',
        status: 'approved',
        createdAt: { toDate: () => createdAt },
        updatedAt: { toDate: () => updatedAt },
      }),
    });

    const shop = await ShopService.getShopById('shop_1');

    expect(shop?.id).toBe('shop_1');
    expect(shop?.createdAt).toEqual(createdAt);
    expect(shop?.updatedAt).toEqual(updatedAt);
  });

  it('convertit tierPaidUntil (Timestamp CF) en Date (F134)', async () => {
    const paidUntil = new Date('2026-09-01T00:00:00Z');
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'shop_1',
      data: () => ({
        name: 'Friperie',
        status: 'approved',
        tier: 'pro',
        tierPaidUntil: { toDate: () => paidUntil },
        createdAt: { toDate: () => new Date('2026-01-01') },
        updatedAt: { toDate: () => new Date('2026-01-01') },
      }),
    });

    const shop = await ShopService.getShopById('shop_1');
    expect(shop?.tier).toBe('pro');
    expect(shop?.tierPaidUntil).toEqual(paidUntil);
  });

  it('laisse tierPaidUntil undefined si absent (forfait jamais souscrit)', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'shop_1',
      data: () => ({
        name: 'Friperie',
        status: 'approved',
        createdAt: { toDate: () => new Date('2026-01-01') },
        updatedAt: { toDate: () => new Date('2026-01-01') },
      }),
    });

    const shop = await ShopService.getShopById('shop_1');
    expect(shop?.tierPaidUntil).toBeUndefined();
  });

  it('retourne null si la boutique n\'existe pas', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => null });

    await expect(ShopService.getShopById('ghost')).resolves.toBeNull();
  });

  it('retourne null (sans crasher) si la lecture Firestore échoue', async () => {
    mockGetDoc.mockRejectedValueOnce(new Error('offline'));

    await expect(ShopService.getShopById('shop_1')).resolves.toBeNull();
  });
});

describe('ShopService.getPendingShops', () => {
  it('mappe le snapshot en boutiques avec id + dates converties', async () => {
    const created = new Date('2026-03-01T00:00:00Z');
    mockGetDocs.mockResolvedValueOnce({
      forEach: (cb: (d: unknown) => void) => {
        cb({
          id: 'shop_a',
          data: () => ({
            name: 'A',
            status: 'pending',
            createdAt: { toDate: () => created },
            updatedAt: { toDate: () => created },
          }),
        });
      },
    });

    const shops = await ShopService.getPendingShops();

    expect(shops).toHaveLength(1);
    expect(shops[0].id).toBe('shop_a');
    expect(shops[0].createdAt).toEqual(created);
  });

  it('retourne un tableau vide en cas d\'erreur (jamais throw côté liste admin)', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('index-missing'));

    await expect(ShopService.getPendingShops()).resolves.toEqual([]);
  });
});

describe('ShopService.purchaseShopTier (F134)', () => {
  it("appelle la callable 'purchaseShopTier' avec shopId + tier + periodMonths", async () => {
    await ShopService.purchaseShopTier('shop_1', 'pro', 3);

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'purchaseShopTier');
    expect(mockPurchaseTierFn).toHaveBeenCalledWith({
      shopId: 'shop_1',
      tier: 'pro',
      periodMonths: 3,
    });
  });

  it('remonte clientSecret + amountCents (montant serveur-autoritaire) du backend', async () => {
    const result = await ShopService.purchaseShopTier('shop_1', 'pro', 3);

    expect(result.success).toBe(true);
    expect(result.clientSecret).toBe('pi_secret_123');
    expect(result.amountCents).toBe(8997);
    expect(result.tier).toBe('pro');
    expect(result.periodMonths).toBe(3);
  });
});
