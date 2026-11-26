import { establishIdentityFixture } from '@/tests/jest/helpers/identityFixture';
import NativeStorage from '@react-native-async-storage/async-storage';
import {createHash} from 'node:crypto';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
beforeEach(async () => {await NativeStorage.clear(); establishIdentityFixture('owner_1');});
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
const mockPurchaseTierFn = jest.fn();
const mockProjection = jest.fn();
const mockHttpsCallable = jest.fn((_fns: unknown, name: string) => {
  if (name === 'getMyEligibility') return jest.fn(async () => ({data: {version: 'a'.repeat(64), policyVersion: 'fixture-session-v1'}}));
  if (name === 'getFeaturedSellers') return mockProjection;
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
import {auth} from '@/config/firebaseConfig';
import { ShopService, type ShopTierPurchaseCommand, type ShopTierPurchaseObservation } from '@/services/shopService';
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
  mockPurchaseTierFn.mockImplementation(async (input: TierInput) => ({data: nativeTierObservation(input)}));
});

interface TierInput {expectedUid: string; requestId: string; command: ShopTierPurchaseCommand}
function nativeTierObservation(input: TierInput): ShopTierPurchaseObservation {
  return {protocol: 'shop_tier_purchase_command_v1', actorId: input.expectedUid, requestId: input.requestId, command: input.command,
    operationId: 'forfait_' + createHash('sha256').update(JSON.stringify(['shop_tier_purchase_v1', input.expectedUid, input.requestId])).digest('hex'),
    requestRecorded: true, state: 'payable', amountCents: 8997, currency: 'CAD', paymentIntentId: 'pi_synthetic',
    providerStatus: 'requires_payment_method', postAuthorized: true, clientSecret: 'pi_synthetic_secret_fixture', terminal: false,
    receipt: null, reason: null, readAt: '2026-11-25T20:00:00.000Z'};
}

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
    expect(mockApproveFn).toHaveBeenCalledWith({ shopId: 'shop_1', expectedUid: 'owner_1' });
    const payload = mockApproveFn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('adminId');
  });

  it("rejectShop transmet shopId + reason à la callable 'rejectShop'", async () => {
    await ShopService.rejectShop('shop_1', 'Photos insuffisantes');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'rejectShop');
    expect(mockRejectFn).toHaveBeenCalledWith({
      expectedUid: 'owner_1', shopId: 'shop_1',
      reason: 'Photos insuffisantes',
    });
  });

  it("suspendShop transmet shopId + reason à la callable 'suspendShop'", async () => {
    await ShopService.suspendShop('shop_1', 'Suspicion de fraude');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'suspendShop');
    expect(mockSuspendFn).toHaveBeenCalledWith({
      expectedUid: 'owner_1', shopId: 'shop_1',
      reason: 'Suspicion de fraude',
    });
  });

  it('une callable de modération qui échoue est enrobée en message FR', async () => {
    mockApproveFn.mockRejectedValueOnce(new Error('unauthenticated'));

    await expect(ShopService.approveShop('shop_1')).rejects.toThrow(
      'unauthenticated',
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

const projectedShop = (over: Record<string, unknown> = {}) => ({
 id: 'shop_1', ownerId: 'owner_1', name: 'Friperie', description: 'Sélection synthétique', type: 'friperie',
 address: {street: 'Adresse synthétique', city: 'Montréal', postalCode: 'H2X 1L2', country: 'CA'}, location: {latitude: 45.51, longitude: -73.57},
 phoneNumber: '', email: '', website: '', socialMedia: {instagram: '', facebook: ''}, logo: '', images: [],
 openingHours: {monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null},
 status: 'approved', tier: 'basic', tierPaidUntil: null, rating: null, reviewCount: 0, articlesCount: 0,
 createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});
const publicProjection = (shop: ReturnType<typeof projectedShop> | null) => ({data: {protocol: 'shop_public_projection_v1', mode: 'detail', shop}});
describe('ShopService.getShopById — native public projection', () => {
 it('converts native ISO dates and retains the exact projected shop without reading private Firestore', async () => {
   mockProjection.mockResolvedValue(publicProjection(projectedShop())); mockGetDoc.mockClear();
   const shop = await ShopService.getShopById('shop_1');
   expect(shop?.id).toBe('shop_1'); expect(shop?.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z')); expect(shop?.updatedAt).toEqual(new Date('2026-06-01T00:00:00.000Z'));
   expect(mockProjection).toHaveBeenCalledWith({capability: 'shop_public_projection_v1', mode: 'detail', shopId: 'shop_1', scope: 'public'}); expect(mockGetDoc).not.toHaveBeenCalled();
 });
 it('converts a native historical tier expiration without activating a purchase', async () => {
   mockProjection.mockResolvedValue(publicProjection(projectedShop({tier: 'pro', tierPaidUntil: '2026-09-01T00:00:00.000Z'})));
   const shop = await ShopService.getShopById('shop_1'); expect(shop?.tier).toBe('pro'); expect(shop?.tierPaidUntil).toEqual(new Date('2026-09-01T00:00:00.000Z'));
 });
 it('keeps absent tier expiration absent', async () => {mockProjection.mockResolvedValue(publicProjection(projectedShop())); expect((await ShopService.getShopById('shop_1'))?.tierPaidUntil).toBeUndefined();});
 it('returns null only from an explicit empty native public/private projection', async () => {mockProjection.mockResolvedValue(publicProjection(null)); await expect(ShopService.getShopById('ghost')).resolves.toBeNull();});
 it('surfaces a projection read failure instead of inventing a missing shop', async () => {mockProjection.mockRejectedValueOnce(new Error('offline')); await expect(ShopService.getShopById('shop_1')).rejects.toThrow('offline');});
});
describe('ShopService.getPendingShops — current admin and native source', () => {
 beforeEach(() => {
   Object.defineProperty(auth.currentUser, 'getIdTokenResult', {value: async () => ({claims: {admin: true, auth_time: Math.floor(Date.now()/1000), firebase: {sign_in_provider: 'password'}}}), configurable: true});
   mockGetDoc.mockReset().mockResolvedValue({exists: () => true, data: () => ({isAdmin: true, isActive: true})});
 });
 it('maps the native pending documents after current admin checks', async () => {
   const created = new Date('2026-03-01T00:00:00Z');
   mockGetDocs.mockResolvedValueOnce({size: 1, docs: [{id: 'shop_a', data: () => ({ownerId: 'owner_1', name: 'A', status: 'pending', createdAt: {toDate: () => created}, updatedAt: {toDate: () => created}})}]});
   const shops = await ShopService.getPendingShops(); expect(shops).toHaveLength(1); expect(shops[0].id).toBe('shop_a'); expect(shops[0].createdAt).toEqual(created);
 });
 it('does not report an empty admin list when its current native read fails', async () => {mockGetDocs.mockRejectedValueOnce(new Error('index-missing')); await expect(ShopService.getPendingShops()).rejects.toThrow('index-missing');});
});

describe('ShopService — contrat journalé de forfait phase2 (F134)', () => {
  it("appelle purchaseShopTier avec la commande shopId/tier/durée et la même intention déjà persistée", async () => {
    const session = captureTradeSession('owner_1'), assertCurrent = () => assertTradeSessionCurrent(session);
    const command = {shopId: 'shop_1', tier: 'pro' as const, periodMonths: 3};
    mockPurchaseTierFn.mockImplementationOnce(async (input: TierInput) => {
      expect(await ShopService.getShopTierPurchaseJournal('owner_1', 'shop_1', assertCurrent)).toMatchObject({
        actorId: 'owner_1', requestId: input.requestId, command, native: {amountCents: null, paymentIntentId: null}});
      return {data: nativeTierObservation(input)};
    });
    const observed = await ShopService.beginShopTierPurchase('owner_1', command, true, assertCurrent);

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'purchaseShopTier');
    expect(mockPurchaseTierFn).toHaveBeenCalledWith({
      capability: 'shop_tier_purchase_v1', mode: 'prepare', expectedUid: 'owner_1', requestId: observed.requestId, command,
    });
  });

  it('remonte clientSecret + amountCents (montant serveur-autoritaire) du backend', async () => {
    const session = captureTradeSession('owner_1'), assertCurrent = () => assertTradeSessionCurrent(session);
    const result = await ShopService.beginShopTierPurchase('owner_1', {shopId: 'shop_1', tier: 'pro', periodMonths: 3}, true, assertCurrent);

    expect(result.state).toBe('payable'); expect(result.terminal).toBe(false); expect(result.receipt).toBeNull();
    expect(result.clientSecret).toBe('pi_synthetic_secret_fixture');
    expect(result.amountCents).toBe(8997);
    expect(result.command.tier).toBe('pro'); expect(result.command.periodMonths).toBe(3);
    expect(await ShopService.getShopTierPurchaseJournal('owner_1', 'shop_1', assertCurrent)).toMatchObject({
      requestId: result.requestId, native: {amountCents: 8997, paymentIntentId: result.paymentIntentId}, paymentAttempted: false});
  });

  it('refuse l’ancien appel sans journal avant tout RPC et sans créer une seconde référence', async () => {
    await expect(ShopService.purchaseShopTier('shop_1', 'pro', 3)).rejects.toThrow('référence');
    expect(mockPurchaseTierFn).not.toHaveBeenCalled();
    expect(mockHttpsCallable).not.toHaveBeenCalledWith(expect.anything(), 'purchaseShopTier');
  });

  it('refuse le secret d’une autre intention sans l’adopter dans le journal courant', async () => {
    const session = captureTradeSession('owner_1'), assertCurrent = () => assertTradeSessionCurrent(session);
    mockPurchaseTierFn.mockImplementationOnce(async (input: TierInput) => ({data: {...nativeTierObservation(input), requestId: 'another_request_0000001'}}));
    await expect(ShopService.beginShopTierPurchase('owner_1', {shopId: 'shop_1', tier: 'pro', periodMonths: 3}, true, assertCurrent)).rejects.toThrow('reste à vérifier');
    expect(await ShopService.getShopTierPurchaseJournal('owner_1', 'shop_1', assertCurrent)).toMatchObject({native: {amountCents: null, paymentIntentId: null}});
  });
});
