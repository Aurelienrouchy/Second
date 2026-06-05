/**
 * <AdminLayout /> — garde d'accès central de la section /admin/*.
 *
 * SÉCURITÉ MÉTIER (defense in depth) : ce layout empêche l'escalade de
 * privilèges via les routes /admin/*. Comportement vérifié :
 *  - tant que l'auth hydrate (isLoading), on reste en 'checking' : on ne
 *    redirige PAS prématurément un admin légitime hors de la section.
 *  - aucun utilisateur connecté → accès refusé → redirection /(tabs).
 *  - utilisateur connecté mais NON admin → accès refusé → redirection /(tabs)
 *    (on appelle bien UserService.isUserAdmin avec son uid).
 *  - admin confirmé → on rend le contenu (Slot).
 *  - si la vérification admin échoue (erreur réseau) → fail-closed (refusé),
 *    jamais fail-open.
 *
 * Le Redirect d'expo-router est mocké en un marqueur exposant son `href` ;
 * Slot rend ses enfants. On pilote useUser / useIsLoading / isUserAdmin.
 *
 * NOTE EMPLACEMENT : ce test vit dans tests/jest/ (et NON colocé dans app/).
 * Un `*.test.tsx` placé sous app/ est ramassé par le require.context de
 * expo-router (le routeur scanne tout app/**) → il tente de bundler
 * @testing-library/react-native dans l'app, le bundle échoue et la génération
 * des routes typées (.expo/types/router.d.ts) reste incomplète. On le sort
 * donc de app/ pour garder app/ = routes uniquement.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

// useUser / useIsLoading sont des hooks Zustand ciblés (shim AuthContext).
const mockUseUser = jest.fn();
const mockUseIsLoading = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
  useUser: () => mockUseUser(),
  useIsLoading: () => mockUseIsLoading(),
}));

// La vérification du rôle admin (custom claim + fallback Firestore).
const mockIsUserAdmin = jest.fn();
jest.mock('@/services/userService', () => ({
  UserService: { isUserAdmin: (...a: unknown[]) => mockIsUserAdmin(...a) },
}));

// Skeleton tire expo-linear-gradient (ESM non transpilé sous jest-expo) ; le
// layout ne s'en sert que comme placeholder de chargement → stub View.
jest.mock('@/components/ui/Skeleton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: 'skeleton' }),
    SkeletonText: (props: Record<string, unknown>) =>
      React.createElement(View, props),
  };
});

// Redirect → marqueur exposant le href ciblé ; Slot → rend ses enfants ;
// le Skeleton de chargement est rendu tel quel par le layout.
jest.mock('expo-router', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: 'redirect' }, href),
    Slot: () => React.createElement(View, { testID: 'admin-slot' }),
  };
});

import AdminLayout from '@/app/admin/_layout';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseIsLoading.mockReturnValue(false);
  mockUseUser.mockReturnValue(null);
  mockIsUserAdmin.mockResolvedValue(false);
});

describe('<AdminLayout /> — garde de privilèges', () => {
  it("reste en 'checking' (ni redirect ni slot) tant que l'auth hydrate", () => {
    mockUseIsLoading.mockReturnValue(true);
    mockUseUser.mockReturnValue(null);

    render(<AdminLayout />);

    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.queryByTestId('admin-slot')).toBeNull();
    // On n'interroge même pas le service tant que l'auth n'est pas prête.
    expect(mockIsUserAdmin).not.toHaveBeenCalled();
  });

  it('redirige vers /(tabs) si aucun utilisateur connecté', async () => {
    mockUseUser.mockReturnValue(null);

    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toHaveTextContent('/(tabs)');
    });
    expect(screen.queryByTestId('admin-slot')).toBeNull();
    expect(mockIsUserAdmin).not.toHaveBeenCalled();
  });

  it('redirige vers /(tabs) pour un utilisateur connecté NON admin', async () => {
    mockUseUser.mockReturnValue({ id: 'user_42' });
    mockIsUserAdmin.mockResolvedValue(false);

    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toBeOnTheScreen();
    });
    expect(mockIsUserAdmin).toHaveBeenCalledWith('user_42');
    expect(screen.queryByTestId('admin-slot')).toBeNull();
  });

  it('rend le contenu (Slot) pour un admin confirmé', async () => {
    mockUseUser.mockReturnValue({ id: 'admin_1' });
    mockIsUserAdmin.mockResolvedValue(true);

    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-slot')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('redirect')).toBeNull();
  });

  it('fail-closed : refuse l\'accès si la vérification admin lève une erreur', async () => {
    mockUseUser.mockReturnValue({ id: 'admin_1' });
    mockIsUserAdmin.mockRejectedValue(new Error('network'));

    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toHaveTextContent('/(tabs)');
    });
    expect(screen.queryByTestId('admin-slot')).toBeNull();
  });
});
