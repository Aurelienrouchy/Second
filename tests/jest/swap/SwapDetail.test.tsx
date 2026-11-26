import { establishIdentityFixture, clearIdentityFixture } from '@/tests/jest/helpers/identityFixture';
import { renderWithQuery as render } from '@/tests/jest/helpers/queryRender';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText, Pressable } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return { Text, Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => React.createElement(Pressable, { onPress }, React.createElement(RNText, {}, children)) };
});
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
jest.mock('@/utils/imageUtils', () => ({ prepareImageForUpload: jest.fn() }));
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
  useRouter: () => require('expo-router').router,
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
 useLocalSearchParams: jest.fn(), router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() }, Stack: { Screen: (props: unknown) => React.createElement(View, props) } };
});
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
 useUser: jest.fn(), useIsLoading: () => false }));
jest.mock('@/store/authSheetStore', () => ({ useAuthSheetStore: (selector: (state: unknown) => unknown) => selector({ show: jest.fn() }) }));
jest.mock('@/components/StripePayment', () => ({ StripePayment: () => null }));
jest.mock('@/services/swapService', () => ({
  subscribeToSwap: jest.fn(),
  getSwapItems: (swap: { initiatorItems: unknown[]; receiverItems: unknown[] }, side: string) => side === 'initiator' ? swap.initiatorItems : swap.receiverItems,
  acceptSwap: jest.fn(), declineSwap: jest.fn(), cancelSwap: jest.fn(), createSwapTopUpCheckout: jest.fn(),
  setExchangeMode: jest.fn(), uploadSwapPhotos: jest.fn(), confirmShipping: jest.fn(), confirmReception: jest.fn(), rateSwap: jest.fn(),
}));
jest.mock('@/features/swap', () => {
  const React = require('react');
  const { Text, Pressable, View } = require('react-native');
  return {
    ...jest.requireActual('@/features/swap/presentation'),
    SwapTopBar: () => React.createElement(Text, {}, 'Détail de l’échange'),
    SwapDetailSkeleton: () => React.createElement(Text, {}, 'Chargement'),
    SwapProposalView: (props: Record<string, unknown>) => React.createElement(View, { testID: 'proposal', ...props }),
    SwapStatusView: (props: Record<string, unknown>) => React.createElement(View, { testID: 'status', ...props }),
    SwapContactButton: () => null,
    SwapActions: (props: Record<string, unknown>) => React.createElement(View, { testID: 'actions', ...props }),
    SwapStickyActions: ({ onAccept, acceptDisabled }: { onAccept: () => void; acceptDisabled: boolean }) => React.createElement(Pressable, { onPress: onAccept, disabled: acceptDisabled, accessibilityState: {disabled: acceptDisabled} }, React.createElement(Text, {}, 'Accepter')),
    getSwapNextStep: () => 'Prochaine étape',
    SwapActionSheet: ({visible, children}: {visible: boolean; children: React.ReactNode}) => visible ? React.createElement(View, null, children) : null,
    SwapLaunchAdmissionSheet: () => null, SwapArrangementFields: () => null, SwapAgreementReview: () => null, SwapProofPhotos: () => null, SwapHoldReviewNotice: () => null,
  };
});

import SwapDetailScreen from '@/app/swap/[id]';
import { useUser } from '@/hooks/useAuth';
import { subscribeToSwap, acceptSwap } from '@/services/swapService';
import { useLocalSearchParams } from 'expo-router';
import type { Swap } from '@/types';

const proposal = {
  id: 'swap-1', initiatorId: 'initiator', receiverId: 'receiver', initiatorName: 'Alice', receiverName: 'Bob',
  initiatorItems: [{ articleId: 'coat', title: 'Manteau', price: 50 }], receiverItems: [{ articleId: 'dress', title: 'Robe', price: 30 }],
  status: 'proposed', message: 'Bonjour', createdAt: new Date(), updatedAt: new Date(),
} as Swap;

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'swap-1' });
  (subscribeToSwap as jest.Mock).mockImplementation((_id, callback) => { callback(proposal); return jest.fn(); });
});

it.each([
  { id: 'initiator', mine: 'coat', receive: 'dress', isInitiator: true },
  { id: 'receiver', mine: 'dress', receive: 'coat', isInitiator: false },
])('le wiring de la route préserve les articles du participant $id', ({ id, mine, receive, isInitiator }) => {
  (useUser as jest.Mock).mockReturnValue({ id }); establishIdentityFixture(id);
  render(<SwapDetailScreen />);
  const props = screen.getByTestId('proposal').props;
  expect(props.myItems[0].articleId).toBe(mine);
  expect(props.senderItems[0].articleId).toBe(receive);
  expect(props.isInitiator).toBe(isInitiator);
});

it('ne confirme aucune acceptation avant la lecture des renseignements et conditions', () => {
  (useUser as jest.Mock).mockReturnValue({id: 'receiver'}); establishIdentityFixture('receiver');
  render(<SwapDetailScreen />);
  const accept = screen.getByText('Accepter'); expect(accept).toBeDisabled();
  fireEvent.press(accept); fireEvent.press(accept); expect(acceptSwap).not.toHaveBeenCalled();
});

it('propose une connexion en visiteur sans abonnement aux données privées', () => {
  (useUser as jest.Mock).mockReturnValue(null); clearIdentityFixture();
  render(<SwapDetailScreen />);
  expect(screen.getByText('Se connecter')).toBeOnTheScreen();
  expect(subscribeToSwap).not.toHaveBeenCalled();
});

it('permet de réessayer lorsque l’abonnement retourne un échange indisponible', () => {
  (useUser as jest.Mock).mockReturnValue({ id: 'initiator' }); establishIdentityFixture('initiator');
  (subscribeToSwap as jest.Mock).mockImplementation((_id, callback) => { callback(null); return jest.fn(); });
  render(<SwapDetailScreen />);
  expect(screen.getByText('Échange indisponible')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Réessayer'));
  expect(subscribeToSwap).toHaveBeenCalledTimes(2);
});

const catalogueClients: QueryClient[] = [];
afterEach(() => { catalogueClients.splice(0).forEach(client => client.clear()); });
function catalogueClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  catalogueClients.push(client);
  client.setQueryData(['home', 'new-arrivals'], [{ id: 'coat' }, { id: 'dress' }]);
  client.setQueryData(['swap-parties', 'generalist'], { party: { id: 'generalist', itemsCount: 2 }, items: [
    { id: 'zone-coat', articleId: 'coat', sellerId: 'initiator', partyId: 'generalist' },
    { id: 'zone-dress', articleId: 'dress', sellerId: 'receiver', partyId: 'generalist' },
  ] });
  return client;
}
function delivery() {
  return (subscribeToSwap as jest.Mock).mock.calls.at(-1)![1] as (swap: Swap | null) => void;
}

it.each(['initiator', 'receiver'])('le callback serveur du participant %s retire les deux cartes à la fin du troc', async uid => {
  (useUser as jest.Mock).mockReturnValue({ id: uid }); establishIdentityFixture(uid);
  const client = catalogueClient();
  const pending = { ...proposal, partyId: 'generalist', status: 'shipping' as const };
  (subscribeToSwap as jest.Mock).mockImplementation((_id, callback) => { callback(pending); return jest.fn(); });
  render(<QueryClientProvider client={client}><SwapDetailScreen /></QueryClientProvider>);
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([{ id: 'coat' }, { id: 'dress' }]);
  const cancel = jest.spyOn(client, 'cancelQueries');
  await act(async () => { delivery()({ ...pending, status: 'completed' }); });
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([]);
  expect(client.getQueryData(['swap-parties', 'generalist'])).toEqual({ party: { id: 'generalist', itemsCount: 2 }, items: [] });
  expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(true);
  await act(async () => { delivery()({ ...pending, status: 'completed', initiatorRating: { score: 5 } }); });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('un completed initial rafraîchit les listes sans évincer les cartes actuelles depuis une archive', async () => {
  (useUser as jest.Mock).mockReturnValue({ id: 'initiator' }); establishIdentityFixture('initiator');
  const client = catalogueClient();
  (subscribeToSwap as jest.Mock).mockImplementation((_id, callback) => { callback({ ...proposal, partyId: 'generalist', status: 'completed' }); return jest.fn(); });
  render(<QueryClientProvider client={client}><SwapDetailScreen /></QueryClientProvider>);
  await waitFor(() => expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(true));
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([{ id: 'coat' }, { id: 'dress' }]);
  expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(true);
});

it('un ancien callback ne réconcilie pas le cache du nouveau participant connecté', async () => {
  (useUser as jest.Mock).mockReturnValue({ id: 'initiator' }); establishIdentityFixture('initiator');
  const client = catalogueClient();
  const pending = { ...proposal, partyId: 'generalist', status: 'shipping' as const };
  (subscribeToSwap as jest.Mock).mockImplementation((_id, callback) => { callback(pending); return jest.fn(); });
  const rendered = render(<QueryClientProvider client={client}><SwapDetailScreen /></QueryClientProvider>);
  const oldCallback = delivery();
  (useUser as jest.Mock).mockReturnValue({ id: 'receiver' });
  await act(async () => { establishIdentityFixture('receiver'); });
  await rendered.rerenderAsync(<QueryClientProvider client={client}><SwapDetailScreen /></QueryClientProvider>);
  expect(() => oldCallback({ ...pending, status: 'completed' })).toThrow();
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([{ id: 'coat' }, { id: 'dress' }]);
  expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(false);
});
