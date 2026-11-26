import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, Linking } from 'react-native';
import { httpsCallable } from 'firebase/functions';

import SquareInventoryScreen from '@/app/shop/square';
import { auth } from '@/config/firebaseConfig';

const sandboxUrl = 'https://connect.squareupsandbox.com/oauth2/authorize?state=opaque';
const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), setParams: jest.fn() };
let mockParams: { shopId?: string } = {};
let mockEnabled = true;
let mockUid = 'owner-A';
let mockGeneration = 1;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactRuntime = require('react');
    ReactRuntime.useEffect(effect, [effect]);
  },
}));
jest.mock('@/config/featureFlags', () => ({ get SQUARE_INVENTORY_PILOT_ENABLED() { return mockEnabled; } }));
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => mockUid,
  useIsLoading: () => false,
  useUser: () => ({ id: mockUid }),
}));
jest.mock('@/store/authStore', () => {
  const state = () => ({ authenticatedUid: mockUid, user: { id: mockUid } });
  return {
    getAuthSessionGeneration: () => mockGeneration,
    useAuthStore: Object.assign((select: (value: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
  };
});
jest.mock('@/components/ui', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, TextInput } = require('react-native');
  return {
    ScreenHeader: () => null,
    Input: TextInput,
    Button: ({ children, onPress, loading, disabled }: {
      children: React.ReactNode; onPress: () => void; loading?: boolean; disabled?: boolean;
    }) => ReactRuntime.createElement(Pressable, { onPress, disabled: disabled || loading, accessibilityRole: 'button' },
      ReactRuntime.createElement(Text, null, children)),
  };
});

type Request = { action: string; expectedUid: string; shopId?: string; locationId?: string; query?: string };
const rpc = jest.fn<Promise<{ data: unknown }>, [Request]>();
let client: QueryClient;
let openUrl: jest.SpyInstance;
const subject = () => <QueryClientProvider client={client}><SquareInventoryScreen /></QueryClientProvider>;

beforeEach(() => {
  mockEnabled = true;
  mockUid = 'owner-A';
  mockGeneration = 1;
  mockParams = { shopId: 'shop-A' };
  (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: mockUid };
  AppState.currentState = 'active';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  rpc.mockReset();
  jest.mocked(httpsCallable).mockReturnValue(rpc as unknown as ReturnType<typeof httpsCallable>);
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => {
  client.clear();
  openUrl.mockRestore();
});

it('prepares a private test shop from the entry without guessing a shop ID', async () => {
  mockParams = {};
  rpc.mockResolvedValue({ data: { shopId: 'shop-fixture' } });
  const view = render(subject());
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Préparer la boutique d’essai'));
  await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledWith({ shopId: 'shop-fixture' }));
  expect(rpc).toHaveBeenCalledWith({ action: 'prepare', expectedUid: 'owner-A' });
});

it('reads status after consent and reads stock for the selected location and reference', async () => {
  let status: Record<string, unknown> = { status: 'disconnected' };
  rpc.mockImplementation(async ({ action }) => {
    if (action === 'start') {
      status = { status: 'pending' };
      return { data: { authorizationUrl: sandboxUrl } };
    }
    if (action === 'inventory') {
      return { data: {
        items: [{ id: 'variant-A', name: 'Manteau', sku: 'MT-01', quantity: '0' }],
        sampledAt: '2026-11-12T12:00:00.000Z',
        truncated: false,
      } };
    }
    return { data: status };
  });
  const view = render(subject());
  fireEvent.press(await view.findByText('Autoriser dans Square'));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith(sandboxUrl));
  await view.findByText('Autorisation en attente');
  expect(view.queryByText('Compte Square de test connecté')).toBeNull();
  status = { status: 'connected', locations: [{ id: 'location-A', name: 'Montréal' }, { id: 'location-B', name: 'Québec' }] };
  fireEvent.press(view.getByText('Vérifier la connexion'));
  fireEvent.press(await view.findByText('Québec'));
  fireEvent.changeText(view.getByLabelText('Nom de l’article ou référence'), ' MT-01 ');
  fireEvent.press(view.getByText('Lire le stock'));
  await view.findByText('En stock\u00a0: 0');
  expect(rpc).toHaveBeenCalledWith({
    action: 'inventory', expectedUid: 'owner-A', shopId: 'shop-A', locationId: 'location-B', query: 'MT-01',
  });
  fireEvent.press(view.getByText('Montréal'));
  expect(view.queryByText('Manteau')).toBeNull();
});

it('does not open a live Square URL returned by the callable', async () => {
  rpc.mockImplementation(async ({ action }) => ({ data: action === 'start'
    ? { authorizationUrl: 'https://connect.squareup.com/oauth2/authorize?state=opaque' }
    : { status: 'disconnected' } }));
  const view = render(subject());
  fireEvent.press(await view.findByText('Autoriser dans Square'));
  await view.findByText(/Impossible d’ouvrir la page/);
  expect(openUrl).not.toHaveBeenCalled();
});

it('discards consent links that arrive after a session change', async () => {
  let finish!: (value: { data: unknown }) => void;
  rpc.mockImplementation(async ({ action }) => action === 'start'
    ? new Promise(resolve => { finish = resolve; })
    : { data: { status: 'disconnected' } });
  const view = render(subject());
  fireEvent.press(await view.findByText('Autoriser dans Square'));
  await waitFor(() => expect(finish).toBeDefined());
  mockUid = 'owner-B';
  mockGeneration++;
  (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: mockUid };
  view.rerender(subject());
  await act(async () => { finish({ data: { authorizationUrl: sandboxUrl } }); });
  expect(openUrl).not.toHaveBeenCalled();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith({ action: 'status', expectedUid: 'owner-B', shopId: 'shop-A' }));
});

it('rejects direct entry outside Seconde Dev without making a request', () => {
  mockEnabled = false;
  const view = render(subject());
  expect(view.getByText('Ce test est disponible dans Seconde Dev.')).toBeTruthy();
  expect(rpc).not.toHaveBeenCalled();
});
