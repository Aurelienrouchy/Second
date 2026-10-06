import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText, Pressable, View } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return {
    Text,
    Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => React.createElement(Pressable, { onPress }, React.createElement(RNText, {}, children)),
    ScreenHeader: ({ title, topContent }: { title: string; topContent: React.ReactNode }) => React.createElement(View, {}, topContent, React.createElement(RNText, {}, title)),
  };
});
jest.mock('@/components/ui/Skeleton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Skeleton: (props: Record<string, unknown>) => React.createElement(View, props) };
});
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem, ListEmptyComponent }: { data: { id: string }[]; renderItem: (item: unknown) => React.ReactNode; ListEmptyComponent: React.ReactNode }) => React.createElement(View, {}, data.length ? data.map(item => React.createElement(View, { key: item.id }, renderItem({ item }))) : ListEmptyComponent),
  };
});
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useUser: jest.fn(), useIsLoading: () => false }));
jest.mock('@/store/authSheetStore', () => ({ useAuthSheetStore: (selector: (state: unknown) => unknown) => selector({ show: jest.fn() }) }));
jest.mock('@/services/swapService', () => ({ getUserSwaps: jest.fn(), getSwapItems: (swap: { initiatorItems: unknown[]; receiverItems: unknown[] }, side: string) => side === 'initiator' ? swap.initiatorItems : swap.receiverItems }));
jest.mock('@/features/swap', () => jest.requireActual('@/features/swap/presentation'));

import MySwapsScreen from '@/app/my-swaps';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useAuth';
import type { Swap } from '@/types';

const base = {
  initiatorId: 'me', receiverId: 'alice', initiatorName: 'Moi', receiverName: 'Alice',
  initiatorItems: [{ articleId: 'coat', title: 'Manteau offert', price: 50 }],
  receiverItems: [{ articleId: 'dress', title: 'Robe reçue', price: 30 }],
  createdAt: new Date('2026-10-05'),
} as Swap;
const retry = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (useUser as jest.Mock).mockReturnValue({ id: 'me' });
  (useQuery as jest.Mock).mockReturnValue({ data: [], isLoading: false, isError: false, refetch: retry, isRefetching: false });
});

it('le visiteur peut se connecter et les données privées restent désactivées', () => {
  (useUser as jest.Mock).mockReturnValue(null);
  render(<MySwapsScreen />);
  expect(screen.getByText('Se connecter')).toBeOnTheScreen();
  expect((useQuery as jest.Mock).mock.calls[0][0].enabled).toBe(false);
});

it('affiche une reprise possible après un chargement en erreur', () => {
  (useQuery as jest.Mock).mockReturnValue({ data: [], isError: true, refetch: retry });
  render(<MySwapsScreen />);
  fireEvent.press(screen.getByText('Réessayer'));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('sépare propositions, échanges actifs et historique avec une action pour revenir à Tous', () => {
  (useQuery as jest.Mock).mockReturnValue({ data: [{ ...base, id: 'sent', status: 'proposed' }, { ...base, id: 'active', status: 'shipping' }, { ...base, id: 'history', status: 'completed' }], refetch: retry });
  render(<MySwapsScreen />);
  expect(screen.getByText('Proposition envoyée')).toBeOnTheScreen();
  expect(screen.getByText('Échange en cours')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('En attente'));
  expect(screen.getByText('Proposition envoyée')).toBeOnTheScreen();
  expect(screen.queryByText('Échange en cours')).toBeNull();
  fireEvent.press(screen.getByText('Historique'));
  expect(screen.getByText('Échange terminé')).toBeOnTheScreen();
  expect(screen.queryByText('Proposition envoyée')).toBeNull();
});

it('le receveur voit une proposition reçue et le payeur historique réel', () => {
  (useUser as jest.Mock).mockReturnValue({ id: 'alice' });
  (useQuery as jest.Mock).mockReturnValue({ data: [{ ...base, id: 'received', status: 'proposed', cashTopUp: { amount: 4500, payerId: 'alice' } }], refetch: retry });
  render(<MySwapsScreen />);
  expect(screen.getByText('Proposition reçue')).toBeOnTheScreen();
  expect(screen.getByText('Vous donnez')).toBeOnTheScreen();
  expect(screen.getByText('Vous recevez')).toBeOnTheScreen();
  expect(screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Vous.')).toBeOnTheScreen();
});

it('une catégorie vide permet de revenir à tous les échanges', () => {
  render(<MySwapsScreen />);
  fireEvent.press(screen.getByText('En cours'));
  expect(screen.getByText('Aucun échange dans cette catégorie')).toBeOnTheScreen();
  fireEvent.press(screen.getByText('Voir tous mes échanges'));
  expect(screen.getByText('Votre premier échange commence ici')).toBeOnTheScreen();
});


it('présente les filtres sur une ligne défilante et évite la ponctuation doublée', () => {
  (useQuery as jest.Mock).mockReturnValue({ data: [{ ...base, receiverName: 'Lou Martin', id: 'one', status: 'proposed', cashTopUp: { amount: 4500, payerId: 'alice' } }], refetch: retry });
  render(<MySwapsScreen />);
  expect(screen.getByTestId('swap-filters').props.horizontal).toBe(true);
  expect(screen.getByRole('button', { name: /Échange avec Lou M\./ }).props.accessibilityLabel).not.toContain('Lou M..');
  const legacy = screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Lou M.');
  expect(React.Children.toArray(legacy.props.children).join('')).toContain('45,00\u00A0$\u00A0CA');
});
