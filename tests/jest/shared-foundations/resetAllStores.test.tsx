/**
 * Tests unitaires — store/resetAllStores.ts (nettoyage au logout).
 *
 * Comportement MÉTIER : à la déconnexion (ou suppression de compte / force
 * logout), TOUS les stores Zustand doivent être remis à zéro ET le cache React
 * Query vidé, pour qu'une re-connexion avec un AUTRE compte n'hérite pas des
 * badges, queries cachées, token FCM ou état de chat du précédent utilisateur.
 *
 * C'est un test de WIRING : on mocke chaque store + le queryClient et on vérifie
 * que resetAllStores orchestre bien tout le set de resets attendu. Un store
 * créé plus tard mais oublié ici resterait silencieusement non nettoyé — ce
 * test documente le contrat exact.
 */

// Préfixe `mock` requis : Jest hoiste les jest.mock() au-dessus des const, donc
// seules les variables nommées mock* sont autorisées dans la factory.
const mockNotificationReset = jest.fn();
const mockAuthReset = jest.fn();
const mockChatReset = jest.fn();
const mockImmersiveReset = jest.fn();
const mockQueryClear = jest.fn();

jest.mock('@/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ reset: mockNotificationReset }) },
}));
jest.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ reset: mockAuthReset }) },
}));
jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ reset: mockChatReset }) },
}));
jest.mock('@/store/immersiveOverlayStore', () => ({
  useImmersiveOverlayStore: { getState: () => ({ reset: mockImmersiveReset }) },
}));
// `clear` est wrappé dans une fonction qui DÉLÈGUE à mockQueryClear : la factory
// est évaluée au premier require (hoisté au-dessus des const), donc on ne peut
// pas capturer mockQueryClear par valeur ici — on le lit paresseusement.
jest.mock('@/lib/queryClient', () => ({
  queryClient: { clear: (...args: unknown[]) => mockQueryClear(...args) },
}));

import { resetAllStores } from '@/store/resetAllStores';

describe('store/resetAllStores', () => {
  beforeEach(() => {
    mockNotificationReset.mockClear();
    mockAuthReset.mockClear();
    mockChatReset.mockClear();
    mockImmersiveReset.mockClear();
    mockQueryClear.mockClear();
  });

  it('reset chaque store Zustand exactement une fois', () => {
    resetAllStores();

    expect(mockNotificationReset).toHaveBeenCalledTimes(1);
    expect(mockAuthReset).toHaveBeenCalledTimes(1);
    expect(mockChatReset).toHaveBeenCalledTimes(1);
    expect(mockImmersiveReset).toHaveBeenCalledTimes(1);
  });

  it('vide le cache React Query (sinon fuite de données entre comptes)', () => {
    resetAllStores();
    expect(mockQueryClear).toHaveBeenCalledTimes(1);
  });

  it('nettoie l’état d’auth ET le cache (pas de re-login héritant des queries)', () => {
    resetAllStores();
    expect(mockAuthReset).toHaveBeenCalled();
    expect(mockQueryClear).toHaveBeenCalled();
  });

  it('est idempotent : un second appel re-nettoie tout sans erreur', () => {
    resetAllStores();
    resetAllStores();

    expect(mockNotificationReset).toHaveBeenCalledTimes(2);
    expect(mockAuthReset).toHaveBeenCalledTimes(2);
    expect(mockChatReset).toHaveBeenCalledTimes(2);
    expect(mockImmersiveReset).toHaveBeenCalledTimes(2);
    expect(mockQueryClear).toHaveBeenCalledTimes(2);
  });
});
