/**
 * Tests unitaires — lib/queryClient.ts (singleton React Query partagé).
 *
 * Comportement MÉTIER vérifié :
 * - les defaults de cache sont tunés selon la convention (staleTime 10min,
 *   gcTime 15min, retry 2) — un drift casserait la fraîcheur/perf attendue
 * - gcTime > staleTime (audit perf #18 : ne pas GC une query encore fraîche)
 * - le singleton est partageable hors React (clear() appelable, ce que
 *   resetAllStores exploite au logout)
 *
 * On NE teste pas le branchement onlineManager → expo-network ici (effet de
 * bord au chargement du module, couvert indirectement) : on mocke expo-network
 * pour que l'import du module n'explose pas sous Node.
 */

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
  ),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import { queryClient } from '@/lib/queryClient';

const MINUTE = 60 * 1000;

describe('lib/queryClient', () => {
  it('applique les defaults de cache de la convention', () => {
    const queries = queryClient.getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(10 * MINUTE);
    expect(queries?.gcTime).toBe(15 * MINUTE);
    expect(queries?.retry).toBe(2);
  });

  it('garde gcTime strictement > staleTime (pas de GC d’une query fraîche)', () => {
    const queries = queryClient.getDefaultOptions().queries;
    expect(queries?.gcTime as number).toBeGreaterThan(queries?.staleTime as number);
  });

  it('expose un singleton dont le cache est manipulable hors React', () => {
    // resetAllStores() appelle queryClient.clear() au logout : on vérifie que
    // le client expose bien des caches et que clear() vide les données.
    queryClient.setQueryData(['__test__', 'user'], { name: 'Alice' });
    expect(queryClient.getQueryData(['__test__', 'user'])).toEqual({ name: 'Alice' });

    queryClient.clear();
    expect(queryClient.getQueryData(['__test__', 'user'])).toBeUndefined();
  });

  it('importer le module deux fois renvoie la même instance (singleton)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const again = require('@/lib/queryClient').queryClient;
    expect(again).toBe(queryClient);
  });
});
