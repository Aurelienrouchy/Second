/**
 * SavedSearchService — recherches sauvegardées (users/{uid}/savedSearches).
 *
 * Domaine : recherche-decouverte. Comportement MÉTIER couvert :
 *  - saveSearch génère un nom par défaut pertinent (terme + 1re marque) quand
 *    aucun nom n'est fourni, et démarre lastNotifiedAt à "maintenant".
 *  - toggleNotifications lit la valeur courante puis la bascule (et réarme
 *    lastNotifiedAt à l'activation seulement) — pas d'écriture aveugle.
 *  - getSavedSearchById retourne null quand le document n'existe pas.
 *  - les erreurs Firestore remontent en messages métier FR.
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

const mockAddDoc = jest.fn((..._args: unknown[]) => Promise.resolve({ id: 'saved-1' }));
const mockUpdateDoc = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockDeleteDoc = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();

jest.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  collection: jest.fn((...args: unknown[]) => ({ path: args.join('/') })),
  doc: jest.fn((...args: unknown[]) => ({ path: args.join('/') })),
  query: jest.fn((...args: unknown[]) => ({ q: args })),
  orderBy: jest.fn((field: string) => ({ orderBy: field })),
  serverTimestamp: jest.fn((..._args: unknown[]) => '__serverTimestamp__'),
  Timestamp: { now: jest.fn(), fromDate: jest.fn((d: Date) => d) },
}));

jest.mock('@/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('../../config/firebaseConfig', () => ({ firestore: {} }));

import { SavedSearchService } from '@/services/savedSearchService';

describe('SavedSearchService.saveSearch', () => {
  beforeEach(() => {
    mockAddDoc.mockClear();
    mockAddDoc.mockResolvedValue({ id: 'saved-1' });
  });

  it('génère un nom par défaut à partir du terme et de la marque quand aucun nom n’est fourni', async () => {
    await SavedSearchService.saveSearch('user-1', '', 'robe', {
      brands: ['Sézane'],
    });

    const written = mockAddDoc.mock.calls[0][1] as { name: string; query: string };
    // generateDefaultName : terme + 1re marque, joints par " - ".
    expect(written.name).toBe('robe - Sézane');
    expect(written.query).toBe('robe');
  });

  it('retombe sur "Ma recherche" quand ni nom, ni terme, ni filtre nommable', async () => {
    await SavedSearchService.saveSearch('user-1', '', '', {});
    const written = mockAddDoc.mock.calls[0][1] as { name: string };
    expect(written.name).toBe('Ma recherche');
  });

  it('respecte un nom explicite fourni par l’utilisateur', async () => {
    await SavedSearchService.saveSearch('user-1', '  Mes vestes  ', 'veste', {});
    const written = mockAddDoc.mock.calls[0][1] as { name: string };
    expect(written.name).toBe('Mes vestes');
  });

  it('initialise notifyNewItems et un compteur de nouveautés à zéro', async () => {
    await SavedSearchService.saveSearch('user-1', 'sac', 'sac', {}, true);
    const written = mockAddDoc.mock.calls[0][1] as {
      notifyNewItems: boolean;
      newItemsCount: number;
    };
    expect(written.notifyNewItems).toBe(true);
    expect(written.newItemsCount).toBe(0);
  });
});

describe('SavedSearchService.toggleNotifications', () => {
  beforeEach(() => {
    mockGetDoc.mockReset();
    mockUpdateDoc.mockClear();
  });

  it('bascule false → true et réarme lastNotifiedAt à l’activation', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ notifyNewItems: false }),
    });

    const next = await SavedSearchService.toggleNotifications('user-1', 'saved-1');

    expect(next).toBe(true);
    const update = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(update.notifyNewItems).toBe(true);
    // À l'activation, lastNotifiedAt est réarmé.
    expect(update.lastNotifiedAt).toBeDefined();
  });

  it('bascule true → false sans réarmer lastNotifiedAt', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ notifyNewItems: true }),
    });

    const next = await SavedSearchService.toggleNotifications('user-1', 'saved-1');

    expect(next).toBe(false);
    const update = mockUpdateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(update.notifyNewItems).toBe(false);
    expect(update.lastNotifiedAt).toBeUndefined();
  });

  it('échoue avec un message métier quand la recherche est introuvable', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(
      SavedSearchService.toggleNotifications('user-1', 'absent')
    ).rejects.toThrow(/introuvable/i);
  });
});

describe('SavedSearchService.getSavedSearchById', () => {
  beforeEach(() => mockGetDoc.mockReset());

  it('retourne null quand le document n’existe pas', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const result = await SavedSearchService.getSavedSearchById('user-1', 'absent');
    expect(result).toBeNull();
  });

  it('mappe le document en SavedSearch avec dates converties', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'saved-1',
      data: () => ({
        name: 'Mes robes',
        query: 'robe',
        filters: { colors: ['noir'] },
        createdAt: { toDate: () => new Date('2026-04-01') },
        notifyNewItems: true,
      }),
    });

    const result = await SavedSearchService.getSavedSearchById('user-1', 'saved-1');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Mes robes');
    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result?.notifyNewItems).toBe(true);
  });
});
