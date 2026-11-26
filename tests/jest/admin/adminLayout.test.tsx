import {auth} from '@/config/firebaseConfig';
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';

// useUser / useIsLoading sont des hooks Zustand ciblés (shim AuthContext).
const mockUseUser = jest.fn();
const mockUseIsLoading = jest.fn();
const mockIdentity = jest.fn();
let mockPathname='/admin/shops';
let mockGeneration=0;
jest.mock('@/store/authStore',()=>({getAuthSessionGeneration:()=>mockGeneration, useAuthStore: Object.assign((selector: (value: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), {getState: () => ({authenticatedUid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, user: mockUseUser(), identityUser: mockIdentity(), isLoading: mockUseIsLoading(), identityError: false})})}));
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),

  useUser: () => mockUseUser(),
  useIsLoading: () => mockUseIsLoading(),
  useAuthenticatedIdentity: () => mockIdentity(),
  useAuthGuardSession: () => ({normalUser:mockUseUser(),identity:mockIdentity(),isAuthLoading:mockUseIsLoading()}),
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
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),

    usePathname:()=>mockPathname,
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: 'redirect' }, href),
    Slot: () => React.createElement(View, { testID: 'admin-slot' }),
  };
});

import AdminLayout from '@/app/admin/_layout';
const clients:QueryClient[]=[];
function nativeOwner(){const uid=mockUseUser()?.id ?? mockIdentity()?.id ?? null; Object.defineProperty(auth, 'currentUser', {value: uid ? {uid} : null, writable: true, configurable: true});}
function renderLayout(){nativeOwner();const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{gcTime:0}}});clients.push(client);return render(<AdminLayout/>,{wrapper:({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}
afterEach(()=>{clients.forEach(client=>client.clear());clients.length=0;});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseIsLoading.mockReturnValue(false);
  mockUseUser.mockReturnValue(null);
  mockIdentity.mockReturnValue(null);mockPathname='/admin/shops';mockGeneration++;
  mockIsUserAdmin.mockResolvedValue(false);
});

describe('<AdminLayout /> — garde de privilèges', () => {
  it("reste en 'checking' (ni redirect ni slot) tant que l'auth hydrate", () => {
    mockUseIsLoading.mockReturnValue(true);
    mockUseUser.mockReturnValue(null);

    renderLayout();

    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.queryByTestId('admin-slot')).toBeNull();
    // On n'interroge même pas le service tant que l'auth n'est pas prête.
    expect(mockIsUserAdmin).not.toHaveBeenCalled();
  });

  it('redirige vers /(tabs) si aucun utilisateur connecté', async () => {
    mockUseUser.mockReturnValue(null);

    renderLayout();

    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toHaveTextContent('/(tabs)');
    });
    expect(screen.queryByTestId('admin-slot')).toBeNull();
    expect(mockIsUserAdmin).not.toHaveBeenCalled();
  });

  it('redirige vers /(tabs) pour un utilisateur connecté NON admin', async () => {
    mockUseUser.mockReturnValue({ id: 'user_42' });
    mockIsUserAdmin.mockResolvedValue(false);

    renderLayout();

    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toBeOnTheScreen();
    });
    expect(mockIsUserAdmin).toHaveBeenCalledWith('user_42');
    expect(screen.queryByTestId('admin-slot')).toBeNull();
  });

  it('rend le contenu (Slot) pour un admin confirmé', async () => {
    mockUseUser.mockReturnValue({ id: 'admin_1' });
    mockIsUserAdmin.mockResolvedValue(true);

    renderLayout();

    await waitFor(() => {
      expect(screen.getByTestId('admin-slot')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('redirect')).toBeNull();
  });

  it('fail-closed : erreur visible et retry, sans contenu privé', async () => {
    mockUseUser.mockReturnValue({ id: 'admin_1' }); mockIsUserAdmin.mockRejectedValue(new Error('network'));
    renderLayout();
    await waitFor(() => expect(screen.getByText('Impossible de vérifier les permissions.')).toBeOnTheScreen());
    expect(screen.queryByTestId('admin-slot')).toBeNull();
    mockIsUserAdmin.mockResolvedValue(true); fireEvent.press(screen.getByText('Réessayer'));
    await waitFor(() => expect(screen.getByTestId('admin-slot')).toBeOnTheScreen());
  });
  it('identity-only pending owner enters only the admission admin route after real role check',async()=>{
    mockPathname='/admin/eligibility';mockIdentity.mockReturnValue({id:'pending_admin'});mockIsUserAdmin.mockResolvedValue(true);
    renderLayout();await waitFor(()=>expect(screen.getByTestId('admin-slot')).toBeOnTheScreen());expect(mockIsUserAdmin).toHaveBeenCalledWith('pending_admin');
  });
  it('identity-only owner cannot unlock other admin routes',async()=>{
    mockIdentity.mockReturnValue({id:'pending_admin'});mockIsUserAdmin.mockResolvedValue(true);renderLayout();
    await waitFor(()=>expect(screen.getByTestId('redirect')).toBeOnTheScreen());expect(mockIsUserAdmin).not.toHaveBeenCalled();expect(screen.queryByTestId('admin-slot')).toBeNull();
  });
  it('late admin A permission cannot admit the current non-admin B',async()=>{
    let finish:(v:boolean)=>void;mockUseUser.mockReturnValue({id:'admin_A'});mockIsUserAdmin.mockImplementation((id:string)=>id==='admin_A'?new Promise(r=>{finish=r;}):Promise.resolve(false));
    const view=renderLayout();await waitFor(()=>expect(mockIsUserAdmin).toHaveBeenCalledWith('admin_A'));
    mockGeneration++;mockUseUser.mockReturnValue({id:'owner_B'});nativeOwner();view.rerender(<AdminLayout/>);await waitFor(()=>expect(screen.getByTestId('redirect')).toBeOnTheScreen());
    await act(async()=>{finish!(true);});expect(screen.queryByTestId('admin-slot')).toBeNull();view.unmount();
  });
});
