/**
 * Test de hook — hooks/useNetworkStatus.ts.
 *
 * Comportement MÉTIER : exposer deux booléens de connectivité stables au-dessus
 * d'expo-network. Le point clé est le FAIL-OPEN : tant que l'état initial n'est
 * pas résolu (valeurs `undefined`), le hook doit retourner `true` pour les deux
 * afin de NE PAS flasher une bannière offline au démarrage à froid.
 *
 * On mocke expo-network par fichier (il n'est pas mocké globalement dans
 * jest.setup) pour piloter la valeur retournée par useNetworkState.
 */

import { renderHook } from '@testing-library/react-native';

// Mock pilotable d'expo-network — on contrôle ce que useNetworkState renvoie.
const mockUseNetworkState = jest.fn();
jest.mock('expo-network', () => ({
  useNetworkState: () => mockUseNetworkState(),
}));

import { useNetworkStatus } from '@/hooks/useNetworkStatus';

describe('useNetworkStatus', () => {
  afterEach(() => {
    mockUseNetworkState.mockReset();
  });

  it('fail-open : les deux booléens sont true tant que l’état est indéfini (cold start)', () => {
    // Au démarrage à froid expo-network renvoie souvent undefined → on ne doit
    // surtout pas afficher "hors ligne".
    mockUseNetworkState.mockReturnValue({
      isConnected: undefined,
      isInternetReachable: undefined,
    });

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isInternetReachable).toBe(true);
  });

  it('reflète un état pleinement connecté', () => {
    mockUseNetworkState.mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toEqual({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it('détecte l’absence d’interface réseau (isConnected = false)', () => {
    mockUseNetworkState.mockReturnValue({
      isConnected: false,
      isInternetReachable: false,
    });

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isInternetReachable).toBe(false);
  });

  it('détecte un portail captif : connecté mais internet injoignable', () => {
    // Wi-Fi de café : interface up mais pas d'accès internet réel.
    mockUseNetworkState.mockReturnValue({
      isConnected: true,
      isInternetReachable: false,
    });

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isInternetReachable).toBe(false);
  });

  it('un changement d’état réseau se propage au re-render', () => {
    mockUseNetworkState.mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });

    const { result, rerender } = renderHook(() => useNetworkStatus());
    expect(result.current.isConnected).toBe(true);

    // La connexion tombe.
    mockUseNetworkState.mockReturnValue({
      isConnected: false,
      isInternetReachable: false,
    });
    rerender({});

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isInternetReachable).toBe(false);
  });
});
