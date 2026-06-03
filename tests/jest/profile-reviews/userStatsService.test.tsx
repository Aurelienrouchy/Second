/**
 * userStatsService — agrégats du profil vendeur (articles + avis).
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert :
 *  - getUserStats partitionne les articles en "en vente" (actif & non vendu) vs
 *    "vendus", somme vues/likes et ne compte les gains QUE sur les articles vendus.
 *  - la moyenne des notes est la moyenne arithmétique des avis, et vaut 0 (pas de
 *    division par zéro) quand le vendeur n'a aucun avis.
 *  - getUserStats lève une erreur métier FR si la lecture Firestore échoue (la
 *    section stats doit pouvoir afficher un état d'erreur).
 *  - getArticlesEnVente / getArticlesVendus retombent sur [] (fail-soft) en cas
 *    d'erreur — la grille reste affichable, simplement vide.
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

const mockGetDocs = jest.fn();

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, name: string) => ({ collection: name })),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  orderBy: jest.fn((field: string) => ({ orderBy: field })),
  query: jest.fn((...args: unknown[]) => ({ q: args })),
  where: jest.fn((field: string, op: string, value: unknown) => ({
    where: { field, op, value },
  })),
}));

jest.mock('@/config/firebaseConfig', () => ({ firestore: {} }));

// fixArticleImageUrls est un passthrough sans intérêt métier ici.
jest.mock('@/services/articlesService', () => ({
  ArticlesService: {
    fixArticleImageUrls: jest.fn((images: unknown) => images),
  },
}));

import { UserStatsService } from '@/services/userStatsService';

// Construit un snapshot Firestore minimal à partir d'un tableau de data.
function snapshotOf(docs: Record<string, unknown>[]) {
  return {
    docs: docs.map((data, i) => ({
      id: `doc-${i}`,
      data: () => data,
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UserStatsService.getUserStats — partition articles & gains', () => {
  it('compte en vente vs vendus, somme vues/likes et n’additionne les gains que sur les ventes', async () => {
    // 1er getDocs = articles, 2e getDocs = avis.
    mockGetDocs
      .mockResolvedValueOnce(
        snapshotOf([
          { isActive: true, isSold: false, views: 10, likes: 2, price: 50 }, // en vente
          { isActive: true, isSold: false, views: 5, likes: 1, price: 30 }, // en vente
          { isActive: true, isSold: true, views: 20, likes: 4, price: 80 }, // vendu
        ]),
      )
      .mockResolvedValueOnce(snapshotOf([]));

    const stats = await UserStatsService.getUserStats('seller-1');

    expect(stats.articlesEnVente).toBe(2);
    expect(stats.articlesVendus).toBe(1);
    expect(stats.totalVues).toBe(35); // 10 + 5 + 20
    expect(stats.totalLikes).toBe(7); // 2 + 1 + 4
    // Gains : uniquement les articles vendus → 80, pas les 50/30 encore en vente.
    expect(stats.gainsTotal).toBe(80);
  });

  it('exclut des "en vente" un article inactif même non vendu', async () => {
    mockGetDocs
      .mockResolvedValueOnce(
        snapshotOf([
          { isActive: false, isSold: false, price: 40 }, // inactif → pas "en vente"
          { isActive: true, isSold: false, price: 25 },
        ]),
      )
      .mockResolvedValueOnce(snapshotOf([]));

    const stats = await UserStatsService.getUserStats('seller-1');

    expect(stats.articlesEnVente).toBe(1);
    expect(stats.articlesVendus).toBe(0);
  });

  it('calcule la moyenne arithmétique des notes des avis', async () => {
    mockGetDocs
      .mockResolvedValueOnce(snapshotOf([]))
      .mockResolvedValueOnce(snapshotOf([{ note: 5 }, { note: 4 }, { note: 3 }]));

    const stats = await UserStatsService.getUserStats('seller-1');

    expect(stats.nombreAvis).toBe(3);
    expect(stats.moyenneNote).toBeCloseTo(4); // (5+4+3)/3
  });

  it('renvoie une moyenne de 0 sans avis (pas de division par zéro)', async () => {
    mockGetDocs
      .mockResolvedValueOnce(snapshotOf([]))
      .mockResolvedValueOnce(snapshotOf([]));

    const stats = await UserStatsService.getUserStats('seller-1');

    expect(stats.nombreAvis).toBe(0);
    expect(stats.moyenneNote).toBe(0);
  });

  it('lève une erreur métier FR quand la lecture des stats échoue', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('firestore down'));
    await expect(UserStatsService.getUserStats('seller-1')).rejects.toThrow(
      /Impossible de recuperer les statistiques/i,
    );
  });
});

describe('UserStatsService — listes d’articles (fail-soft)', () => {
  it('mappe les articles en vente avec un id de doc et une date convertie', async () => {
    const createdAt = { toDate: () => new Date('2026-04-10') };
    mockGetDocs.mockResolvedValueOnce(
      snapshotOf([{ title: 'Robe', price: 45, createdAt, images: [] }]),
    );

    const articles = await UserStatsService.getArticlesEnVente('seller-1');

    expect(articles).toHaveLength(1);
    expect(articles[0].id).toBe('doc-0');
    expect(articles[0].createdAt).toBeInstanceOf(Date);
  });

  it('retombe sur [] si la requête "en vente" échoue (la grille reste affichable)', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('index manquant'));
    await expect(UserStatsService.getArticlesEnVente('seller-1')).resolves.toEqual([]);
  });

  it('retombe sur [] si la requête "vendus" échoue', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('index manquant'));
    await expect(UserStatsService.getArticlesVendus('seller-1')).resolves.toEqual([]);
  });
});
