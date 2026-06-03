/**
 * SearchHistoryService — historique de recherche (users/{uid}/searchHistory).
 *
 * Domaine : recherche-decouverte. On couvre le comportement MÉTIER du service :
 *  - refus de persister une recherche vide (ni terme, ni filtre actif).
 *  - dedupe (M8) : une recherche identique (terme + filtres) rafraîchit le
 *    timestamp de l'entrée existante au lieu d'en créer une nouvelle.
 *  - création + nettoyage : une nouvelle recherche est ajoutée puis le cap
 *    d'entrées est nettoyé.
 *  - formatSearchDisplay : composition FR lisible des filtres (taille
 *    {value,system}, couleurs, état, fourchette de prix, tri), avec fallback.
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

// --- Mock complet de firebase/firestore pour ce service (le mock global du
//     setup ne fournit pas writeBatch ; on contrôle ici les snapshots). ------
const mockAddDoc = jest.fn((..._args: unknown[]) => Promise.resolve({ id: 'new-doc-id' }));
const mockUpdateDoc = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockDeleteDoc = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockGetDocs = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn((..._args: unknown[]) => Promise.resolve());

jest.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  collection: jest.fn((...args: unknown[]) => ({ path: args.join('/') })),
  doc: jest.fn((...args: unknown[]) => ({ path: args.join('/') })),
  query: jest.fn((...args: unknown[]) => ({ q: args })),
  orderBy: jest.fn((field: string) => ({ orderBy: field })),
  limit: jest.fn((n: number) => ({ limit: n })),
  serverTimestamp: jest.fn((..._args: unknown[]) => '__serverTimestamp__'),
  writeBatch: jest.fn((..._args: unknown[]) => ({
    delete: (...args: unknown[]) => mockBatchDelete(...args),
    commit: () => mockBatchCommit(),
  })),
  Timestamp: { now: jest.fn(), fromDate: jest.fn((d: Date) => d) },
}));

jest.mock('@/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('../../config/firebaseConfig', () => ({ firestore: {} }));

import { SearchHistoryService, SearchHistoryItem } from '@/services/searchHistoryService';
import type { ArticleSize } from '@/types';

/** Build a fake Firestore snapshot whose forEach iterates the given docs. */
function snapshotOf(docs: { id: string; data: Record<string, unknown> }[]) {
  return {
    size: docs.length,
    forEach(cb: (d: { id: string; data: () => unknown; ref: unknown }) => void) {
      docs.forEach((d) =>
        cb({ id: d.id, data: () => d.data, ref: { id: d.id } })
      );
    },
  };
}

describe('SearchHistoryService.addSearchToHistory', () => {
  beforeEach(() => {
    mockAddDoc.mockClear();
    mockUpdateDoc.mockClear();
    mockGetDocs.mockClear();
    mockBatchDelete.mockClear();
    mockBatchCommit.mockClear();
    mockAddDoc.mockResolvedValue({ id: 'new-doc-id' });
  });

  it('refuse de persister une recherche vide (ni terme, ni filtre)', async () => {
    const id = await SearchHistoryService.addSearchToHistory('user-1', '   ', {});
    expect(id).toBe('');
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it('crée une nouvelle entrée et nettoie le cap quand aucun doublon n’existe', async () => {
    // 1er getDocs (findDuplicate) : aucune correspondance. 2e (cleanup) : sous
    // le cap → pas de suppression.
    mockGetDocs
      .mockResolvedValueOnce(snapshotOf([]))
      .mockResolvedValueOnce(snapshotOf([{ id: 'x', data: {} }]));

    const id = await SearchHistoryService.addSearchToHistory('user-1', 'robe rouge', {});

    expect(id).toBe('new-doc-id');
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    // Le terme est trimmé avant écriture.
    const written = mockAddDoc.mock.calls[0][1] as { query: string };
    expect(written.query).toBe('robe rouge');
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('dedupe (M8) : une recherche identique rafraîchit le timestamp au lieu de créer un doublon', async () => {
    // findDuplicate trouve une entrée existante avec le même terme + filtres.
    mockGetDocs.mockResolvedValueOnce(
      snapshotOf([
        { id: 'dup-1', data: { query: 'jean', filters: { colors: ['noir'] } } },
      ])
    );

    const id = await SearchHistoryService.addSearchToHistory('user-1', 'jean', {
      colors: ['noir'],
    });

    expect(id).toBe('dup-1');
    // On met à jour l'entrée existante, pas de addDoc.
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it('supprime les entrées au-delà du cap (cleanup writeBatch)', async () => {
    // findDuplicate : rien. cleanup : 22 docs > MAX (20) → 2 suppressions.
    const many = Array.from({ length: 22 }, (_, i) => ({
      id: `h${i}`,
      data: { query: `q${i}`, filters: {} },
    }));
    mockGetDocs
      .mockResolvedValueOnce(snapshotOf([]))
      .mockResolvedValueOnce(snapshotOf(many));

    await SearchHistoryService.addSearchToHistory('user-1', 'pull', {});

    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    // 22 - 20 = 2 entrées les plus anciennes supprimées.
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

describe('SearchHistoryService.getRecentSearches', () => {
  beforeEach(() => mockGetDocs.mockReset());

  it('mappe les documents en items avec date convertie', async () => {
    const ts = { toDate: () => new Date('2026-05-01T10:00:00Z') };
    mockGetDocs.mockResolvedValueOnce(
      snapshotOf([
        { id: 'r1', data: { query: 'sac', filters: {}, timestamp: ts } },
      ])
    );

    const items = await SearchHistoryService.getRecentSearches('user-1', 10);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('r1');
    expect(items[0].query).toBe('sac');
    expect(items[0].timestamp).toBeInstanceOf(Date);
  });

  it('remonte une erreur métier explicite quand Firestore échoue', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('perm denied'));
    await expect(
      SearchHistoryService.getRecentSearches('user-1')
    ).rejects.toThrow(/historique/i);
  });
});

describe('SearchHistoryService.formatSearchDisplay', () => {
  const base = (overrides: Partial<SearchHistoryItem>): SearchHistoryItem => ({
    id: 'i',
    query: '',
    filters: {},
    timestamp: new Date(),
    ...overrides,
  });

  it('met le terme entre guillemets', () => {
    const label = SearchHistoryService.formatSearchDisplay(base({ query: 'robe' }));
    expect(label).toContain('"robe"');
  });

  it('compose terme + couleur + état en libellé FR séparé par •', () => {
    const label = SearchHistoryService.formatSearchDisplay(
      base({ query: 'manteau', filters: { colors: ['noir'], condition: 'neuf' } })
    );
    expect(label).toContain('"manteau"');
    // getColorName('noir') → 'Noir' ; getConditionLabel('neuf') → label FR.
    expect(label).toContain('Noir');
    expect(label).toContain('Neuf');
    expect(label).toContain(' • ');
  });

  it('affiche la taille avec sa valeur ET son système (value+system)', () => {
    const size: ArticleSize = { value: '38', system: 'EU' };
    const label = SearchHistoryService.formatSearchDisplay(
      base({ filters: { sizes: [size] } })
    );
    expect(label).toContain('taille 38 EU');
  });

  it('formate une fourchette de prix bornée', () => {
    const label = SearchHistoryService.formatSearchDisplay(
      base({ filters: { minPrice: 10, maxPrice: 50 } })
    );
    expect(label).toContain('10-50 $');
  });

  it('formate un prix max seul', () => {
    const label = SearchHistoryService.formatSearchDisplay(
      base({ filters: { maxPrice: 30 } })
    );
    expect(label).toContain('<30 $');
  });

  it('retombe sur "Recherche" quand rien n’est renseigné', () => {
    const label = SearchHistoryService.formatSearchDisplay(base({}));
    expect(label).toBe('Recherche');
  });
});
