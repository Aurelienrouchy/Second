/**
 * useUserProfile — profil live d'un utilisateur (React Query).
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert (routage sécurité) :
 *  - quand l'uid demandé == l'utilisateur courant, on fait la lecture Firestore
 *    DIRECTE (getUserById) — seul cas autorisé par les rules.
 *  - quand l'uid est un AUTRE utilisateur, on passe par la Cloud Function
 *    getPublicProfile (Admin SDK) pour éviter une "insufficient permissions".
 *  - sans utilisateur authentifié, un uid tiers passe AUSSI par la callable
 *    publique (un invité peut voir un profil public).
 *  - sans uid, la query est désactivée et ne déclenche aucune lecture.
 *
 * .test.tsx → périmètre Jest. On mocke UserService + auth.currentUser et on
 * fournit un QueryClient frais (pas de retry) par test.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

// auth.currentUser est piloté par test pour simuler connecté / invité.
const mockAuth: { currentUser: { uid: string } | null } = { currentUser: null };
jest.mock('@/config/firebaseConfig', () => ({
  get auth() {
    return mockAuth;
  },
}));

const mockGetUserById = jest.fn();
const mockGetPublicProfile = jest.fn();
jest.mock('@/services/userService', () => ({
  UserService: {
    getUserById: (...args: unknown[]) => mockGetUserById(...args),
    getPublicProfile: (...args: unknown[]) => mockGetPublicProfile(...args),
  },
}));

import { useUserProfile } from '@/hooks/useUserProfile';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = null;
});

describe('useUserProfile — routage lecture directe vs callable', () => {
  it('lit directement Firestore (getUserById) pour son PROPRE profil', async () => {
    mockAuth.currentUser = { uid: 'me' };
    mockGetUserById.mockResolvedValueOnce({ id: 'me', displayName: 'Moi' });

    const { result } = renderHook(() => useUserProfile('me'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetUserById).toHaveBeenCalledWith('me');
    expect(mockGetPublicProfile).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ id: 'me', displayName: 'Moi' });
  });

  it('passe par la callable publique (getPublicProfile) pour un AUTRE utilisateur', async () => {
    mockAuth.currentUser = { uid: 'me' };
    mockGetPublicProfile.mockResolvedValueOnce({ id: 'other', displayName: 'Autre' });

    const { result } = renderHook(() => useUserProfile('other'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetPublicProfile).toHaveBeenCalledWith('other');
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('passe par la callable publique quand aucun utilisateur n’est connecté (invité)', async () => {
    mockAuth.currentUser = null;
    mockGetPublicProfile.mockResolvedValueOnce({ id: 'other', displayName: 'Autre' });

    const { result } = renderHook(() => useUserProfile('other'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetPublicProfile).toHaveBeenCalledWith('other');
    expect(mockGetUserById).not.toHaveBeenCalled();
  });
});

describe('useUserProfile — query désactivée', () => {
  it('ne déclenche aucune lecture sans uid', async () => {
    const { result } = renderHook(() => useUserProfile(null), { wrapper: wrapper() });

    // enabled:false → pas de fetch, statut "pending" sans loading actif.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(mockGetPublicProfile).not.toHaveBeenCalled();
  });
});
