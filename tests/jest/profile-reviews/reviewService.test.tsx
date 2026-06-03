/**
 * reviewService — avis après-vente (collection `avis/`, callables Cloud Functions).
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert :
 *  - hasUserReviewedTransaction lit le doc déterministe `${reviewerId}_${transactionId}`
 *    (une seule note par acheteur et par transaction) et retourne true/false selon
 *    l'existence ; en cas d'erreur Firestore, elle retombe en `false` (fail-safe :
 *    on laisse l'utilisateur tenter, le backend tranche).
 *  - createReview délègue à la callable `createReview` et propage l'erreur (le
 *    formulaire d'avis doit pouvoir afficher l'échec).
 *  - getUserReviews / getUserPublicProfile renvoient `result.data` tel quel (pas de
 *    transformation client) et propagent les erreurs réseau.
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

const mockGetDoc = jest.fn();
// Capture l'id de doc passé à doc() pour vérifier le pattern déterministe.
const mockDoc = jest.fn((_db: unknown, collectionName: string, docId: string) => ({
  path: `${collectionName}/${docId}`,
}));

jest.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) =>
    (mockDoc as unknown as (...a: unknown[]) => unknown)(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

// Le service capture ses callables à l'IMPORT via httpsCallable(functions, name).
// La factory jest.mock est hoistée au-dessus de tout, donc on crée les callables
// DANS la factory (sinon TDZ : un `const` externe serait undefined au moment de
// l'import du service). On garde un registre par nom, récupérable depuis le test
// via le module mocké lui-même. httpsCallable n'est pas un jest.fn pour survivre
// à `clearMocks: true`.
jest.mock('firebase/functions', () => {
  const callables: Record<string, jest.Mock> = {
    createReview: jest.fn(),
    getUserReviews: jest.fn(),
    getUserPublicProfile: jest.fn(),
  };
  return {
    httpsCallable: (_functions: unknown, name: string) => {
      const fn = callables[name];
      if (!fn) throw new Error(`Unexpected callable: ${name}`);
      return fn;
    },
    // Accès aux jest.fn depuis les tests pour piloter les résolutions.
    __callables: callables,
  };
});

jest.mock('@/config/firebaseConfig', () => ({ firestore: {}, functions: {} }));

import {
  createReview,
  getUserPublicProfile,
  getUserReviews,
  hasUserReviewedTransaction,
} from '@/services/reviewService';

// Récupère les callables jest.fn créées dans la factory.
const { __callables } = jest.requireMock('firebase/functions') as {
  __callables: Record<string, jest.Mock>;
};
const mockCreateReviewCallable = __callables.createReview;
const mockGetUserReviewsCallable = __callables.getUserReviews;
const mockGetUserPublicProfileCallable = __callables.getUserPublicProfile;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reviewService.hasUserReviewedTransaction', () => {
  it('cible le doc déterministe `${reviewerId}_${transactionId}` dans la collection avis', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true });

    await hasUserReviewedTransaction('buyer-1', 'tx-42');

    // Le doc ID combine reviewer + transaction → unicité d'un avis par achat.
    expect(mockDoc).toHaveBeenCalledWith({}, 'avis', 'buyer-1_tx-42');
  });

  it('retourne true quand un avis existe déjà (anti double-notation)', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true });
    await expect(hasUserReviewedTransaction('buyer-1', 'tx-42')).resolves.toBe(true);
  });

  it('retourne false quand aucun avis n’existe encore', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(hasUserReviewedTransaction('buyer-1', 'tx-42')).resolves.toBe(false);
  });

  it('retombe sur false (fail-safe) si la lecture Firestore échoue', async () => {
    mockGetDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(hasUserReviewedTransaction('buyer-1', 'tx-42')).resolves.toBe(false);
  });
});

describe('reviewService.createReview', () => {
  it('délègue à la callable createReview avec les paramètres d’avis et renvoie son data', async () => {
    mockCreateReviewCallable.mockResolvedValueOnce({
      data: { success: true, reviewId: 'rev-1' },
    });

    const params = {
      targetUserId: 'seller-1',
      transactionId: 'tx-42',
      transactionType: 'achat' as const,
      note: 5,
      text: 'Parfait, vendeur au top.',
    };
    const result = await createReview(params);

    expect(mockCreateReviewCallable).toHaveBeenCalledWith(params);
    expect(result).toEqual({ success: true, reviewId: 'rev-1' });
  });

  it('propage l’erreur quand la création d’avis échoue côté serveur', async () => {
    mockCreateReviewCallable.mockRejectedValueOnce(new Error('already-reviewed'));
    await expect(
      createReview({
        targetUserId: 'seller-1',
        transactionId: 'tx-42',
        transactionType: 'vente',
        note: 4,
        text: 'RAS',
      }),
    ).rejects.toThrow('already-reviewed');
  });
});

describe('reviewService.getUserReviews', () => {
  it('renvoie la réponse paginée (reviews + moyenne + hasMore) telle que fournie par la callable', async () => {
    const payload = {
      reviews: [
        {
          id: 'rev-1',
          reviewerId: 'buyer-1',
          reviewerName: 'Alice',
          note: 5,
          text: 'Super',
          transactionType: 'achat' as const,
          createdAt: '2026-05-01',
        },
      ],
      totalReviews: 1,
      averageRating: 5,
      hasMore: false,
      lastDocId: null,
    };
    mockGetUserReviewsCallable.mockResolvedValueOnce({ data: payload });

    const result = await getUserReviews({ userId: 'seller-1', limit: 20 });

    expect(mockGetUserReviewsCallable).toHaveBeenCalledWith({
      userId: 'seller-1',
      limit: 20,
    });
    expect(result).toEqual(payload);
  });

  it('propage l’erreur réseau lors du chargement des avis', async () => {
    mockGetUserReviewsCallable.mockRejectedValueOnce(new Error('unavailable'));
    await expect(getUserReviews({ userId: 'seller-1' })).rejects.toThrow('unavailable');
  });
});

describe('reviewService.getUserPublicProfile', () => {
  it('passe l’userId à la callable et renvoie le profil public agrégé', async () => {
    const payload = {
      profile: { id: 'seller-1', displayName: 'Alice' },
      stats: { totalReviews: 3, averageRating: 4.5 },
      reviews: [],
      articles: [],
      isFollowing: false,
    };
    mockGetUserPublicProfileCallable.mockResolvedValueOnce({ data: payload });

    const result = await getUserPublicProfile('seller-1');

    expect(mockGetUserPublicProfileCallable).toHaveBeenCalledWith({ userId: 'seller-1' });
    expect(result).toEqual(payload);
  });

  it('propage l’erreur quand le profil public est introuvable', async () => {
    mockGetUserPublicProfileCallable.mockRejectedValueOnce(new Error('not-found'));
    await expect(getUserPublicProfile('ghost')).rejects.toThrow('not-found');
  });
});
