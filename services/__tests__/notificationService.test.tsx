/**
 * NotificationService — lecture / marquage / comptage + producteurs in-app.
 *
 * Comportement MÉTIER couvert (pas de tautologie : on observe les vraies
 * requêtes Firestore et les contrats de données consommés par l'écran) :
 *
 *  - getUserNotifications : filtre par userId, trie par date décroissante,
 *    convertit le Timestamp Firestore en Date (l'écran fait createdAt.getTime()),
 *    et PROPAGE l'erreur (l'écran affiche un état erreur + Réessayer, pas une
 *    liste vide silencieuse).
 *  - markAllAsRead : lit uniquement les non-lus et les bascule en UN SEUL batch
 *    atomique ; court-circuite (aucun commit) si rien n'est non-lu.
 *  - countUnreadNotifications : compte côté serveur (aggregation) et retombe sur
 *    0 en cas d'erreur (le badge ne doit jamais planter l'app).
 *  - notifyPriceDrop : calcule la remise % et la passe dans le message + data.
 *  - notifyOfferResponse : mappe statut → (type, titre) — accepted/rejected/counter,
 *    et n'inclut le montant que pour la contre-offre.
 *
 * .tsx pour rester dans le périmètre Jest. firebase/firestore est remocké
 * localement (le mock global de jest.setup.js ne pilote pas les snapshots).
 */

// --- Mock contrôlable de firebase/firestore --------------------------------
const mockGetDocs = jest.fn();
const mockGetCountFromServer = jest.fn();
const mockAddDoc = jest.fn((..._args: unknown[]) => Promise.resolve({ id: 'notif-1' }));
const mockUpdateDoc = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockWriteBatch = jest.fn((..._args: unknown[]) => ({
  update: mockBatchUpdate,
  commit: mockBatchCommit,
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, name: string) => ({ __collection: name })),
  doc: jest.fn((_db: unknown, col: string, id: string) => ({ __doc: `${col}/${id}` })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getCountFromServer: (...args: unknown[]) => mockGetCountFromServer(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: jest.fn((..._args: unknown[]) => Promise.resolve()),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
  query: jest.fn((...parts: unknown[]) => ({ __query: parts })),
  where: jest.fn((field: string, op: string, value: unknown) => ({ where: [field, op, value] })),
  orderBy: jest.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  serverTimestamp: jest.fn((..._args: unknown[]) => '__serverTime'),
}));

import { NotificationService } from '@/services/notificationService';

/** Construit un snapshot Firestore minimal compatible forEach/empty/size. */
function makeSnapshot(
  docs: { id: string; data: Record<string, unknown>; ref?: unknown }[],
) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: (d: unknown) => void) =>
      docs.forEach((d) =>
        cb({ id: d.id, ref: d.ref ?? { __ref: d.id }, data: () => d.data }),
      ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUserNotifications — lecture du centre de notifications', () => {
  it('mappe les docs, convertit le Timestamp en Date et injecte l’id', async () => {
    const created = new Date('2026-01-15T10:00:00Z');
    mockGetDocs.mockResolvedValueOnce(
      makeSnapshot([
        {
          id: 'n1',
          data: {
            userId: 'u1',
            type: 'price_drop',
            title: 'Baisse de prix !',
            message: '…',
            isRead: false,
            createdAt: { toDate: () => created },
          },
        },
      ]),
    );

    const result = await NotificationService.getUserNotifications('u1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
    // L'écran consomme createdAt comme une Date (formatTimeAgo → getTime()).
    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(result[0].createdAt.getTime()).toBe(created.getTime());
  });

  it('filtre par userId et trie par date décroissante (notifs récentes en tête)', async () => {
    mockGetDocs.mockResolvedValueOnce(makeSnapshot([]));
    const { where, orderBy } = jest.requireMock('firebase/firestore');

    await NotificationService.getUserNotifications('u42');

    expect(where).toHaveBeenCalledWith('userId', '==', 'u42');
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('PROPAGE l’erreur Firestore (l’écran montre un état erreur, pas une liste vide)', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('firestore down'));

    await expect(NotificationService.getUserNotifications('u1')).rejects.toThrow(
      'Erreur lors du chargement des notifications',
    );
  });
});

describe('markAllAsRead — tout marquer comme lu', () => {
  it('bascule chaque non-lu en UN SEUL batch atomique puis commit', async () => {
    mockGetDocs.mockResolvedValueOnce(
      makeSnapshot([
        { id: 'a', data: { isRead: false }, ref: { __ref: 'a' } },
        { id: 'b', data: { isRead: false }, ref: { __ref: 'b' } },
        { id: 'c', data: { isRead: false }, ref: { __ref: 'c' } },
      ]),
    );

    await NotificationService.markAllAsRead('u1');

    // Un seul batch (un round-trip), une update par doc non lu.
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    expect(mockBatchUpdate).toHaveBeenCalledWith({ __ref: 'a' }, { isRead: true });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('ne lit QUE les non-lus (where isRead == false) pour ne pas réécrire le déjà-lu', async () => {
    mockGetDocs.mockResolvedValueOnce(makeSnapshot([]));
    const { where } = jest.requireMock('firebase/firestore');

    await NotificationService.markAllAsRead('u1');

    expect(where).toHaveBeenCalledWith('userId', '==', 'u1');
    expect(where).toHaveBeenCalledWith('isRead', '==', false);
  });

  it('court-circuite sans commit quand il n’y a aucun non-lu', async () => {
    mockGetDocs.mockResolvedValueOnce(makeSnapshot([]));

    await NotificationService.markAllAsRead('u1');

    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('remonte une erreur métier si le commit échoue', async () => {
    mockGetDocs.mockResolvedValueOnce(
      makeSnapshot([{ id: 'a', data: { isRead: false }, ref: { __ref: 'a' } }]),
    );
    mockBatchCommit.mockRejectedValueOnce(new Error('commit failed'));

    await expect(NotificationService.markAllAsRead('u1')).rejects.toThrow(
      'Erreur lors du marquage des notifications',
    );
  });
});

describe('countUnreadNotifications — badge', () => {
  it('renvoie le count serveur (aggregation, sans télécharger les docs)', async () => {
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 5 }) });

    const count = await NotificationService.countUnreadNotifications('u1');

    expect(count).toBe(5);
    // Aggregation, pas un getDocs qui rapatrierait toute la collection.
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('retombe sur 0 en cas d’erreur (le badge ne doit jamais crasher l’app)', async () => {
    mockGetCountFromServer.mockRejectedValueOnce(new Error('boom'));

    const count = await NotificationService.countUnreadNotifications('u1');

    expect(count).toBe(0);
  });
});

describe('notifyPriceDrop — producteur in-app', () => {
  it('calcule la remise % et l’embarque dans le message et la data', async () => {
    await NotificationService.notifyPriceDrop('u1', 'art1', 'Robe Zara', 100, 60);

    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, any>];
    expect(payload.type).toBe('price_drop');
    expect(payload.userId).toBe('u1');
    // 100 → 60 = -40%
    expect(payload.message).toContain('-40%');
    expect(payload.message).toContain('100 $');
    expect(payload.message).toContain('60 $');
    expect(payload.data).toMatchObject({
      articleId: 'art1',
      oldPrice: 100,
      newPrice: 60,
    });
    expect(payload.isRead).toBe(false);
  });
});

describe('notifyOfferResponse — réponse vendeur → acheteur', () => {
  it('offre acceptée → type offer_accepted + titre "Offre acceptée !"', async () => {
    await NotificationService.notifyOfferResponse(
      'buyer', 'art1', 'Sac', 'accepted', 'Alice', 'chat1',
    );
    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, any>];
    expect(payload.type).toBe('offer_accepted');
    expect(payload.title).toBe('Offre acceptée !');
    expect(payload.data.chatId).toBe('chat1');
  });

  it('offre refusée → type offer_rejected', async () => {
    await NotificationService.notifyOfferResponse(
      'buyer', 'art1', 'Sac', 'rejected', 'Alice', 'chat1',
    );
    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, any>];
    expect(payload.type).toBe('offer_rejected');
    expect(payload.title).toBe('Offre refusée');
  });

  it('contre-offre → type offer_counter, montant dans le message ET la data', async () => {
    await NotificationService.notifyOfferResponse(
      'buyer', 'art1', 'Sac', 'counter', 'Alice', 'chat1', 45,
    );
    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, any>];
    expect(payload.type).toBe('offer_counter');
    expect(payload.title).toBe('Contre-offre reçue');
    expect(payload.message).toContain('45 $');
    expect(payload.data.amount).toBe(45);
  });
});
