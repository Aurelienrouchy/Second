import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

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
  return { useLocalSearchParams: jest.fn(), router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() }, Stack: { Screen: (props: unknown) => React.createElement(View, props) } };
});
jest.mock('@/hooks/useAuth', () => ({ useUser: jest.fn(), useIsLoading: () => false }));
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
    SwapTopBar: () => React.createElement(Text, {}, 'Détail de l’échange'),
    SwapDetailSkeleton: () => React.createElement(Text, {}, 'Chargement'),
    SwapProposalView: (props: Record<string, unknown>) => React.createElement(View, { testID: 'proposal', ...props }),
    SwapStatusView: (props: Record<string, unknown>) => React.createElement(View, { testID: 'status', ...props }),
    SwapContactButton: () => null,
    SwapActions: (props: Record<string, unknown>) => React.createElement(View, { testID: 'actions', ...props }),
    SwapStickyActions: ({ onAccept }: { onAccept: () => void }) => React.createElement(Pressable, { onPress: onAccept }, React.createElement(Text, {}, 'Accepter')),
    getSwapNextStep: () => 'Prochaine étape',
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
  (useUser as jest.Mock).mockReturnValue({ id });
  render(<SwapDetailScreen />);
  const props = screen.getByTestId('proposal').props;
  expect(props.myItems[0].articleId).toBe(mine);
  expect(props.senderItems[0].articleId).toBe(receive);
  expect(props.isInitiator).toBe(isInitiator);
});

it('empêche les appels d’acceptation répétés avant le retour de la mutation', async () => {
  (useUser as jest.Mock).mockReturnValue({ id: 'receiver' });
  let finish!: () => void;
  (acceptSwap as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<SwapDetailScreen />);
  act(() => { fireEvent.press(screen.getByText('Accepter')); fireEvent.press(screen.getByText('Accepter')); });
  expect(acceptSwap).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it('propose une connexion en visiteur sans abonnement aux données privées', () => {
  (useUser as jest.Mock).mockReturnValue(null);
  render(<SwapDetailScreen />);
  expect(screen.getByText('Se connecter')).toBeOnTheScreen();
  expect(subscribeToSwap).not.toHaveBeenCalled();
});

it('permet de réessayer lorsque l’abonnement retourne un échange indisponible', () => {
  (useUser as jest.Mock).mockReturnValue({ id: 'initiator' });
  (subscribeToSwap as jest.Mock).mockImplementation((_id, callback) => { callback(null); return jest.fn(); });
  render(<SwapDetailScreen />);
  expect(screen.getByText('Échange indisponible')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Réessayer'));
  expect(subscribeToSwap).toHaveBeenCalledTimes(2);
});
