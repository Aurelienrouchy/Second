import { establishIdentityFixture, clearIdentityFixture } from '@/tests/jest/helpers/identityFixture';
import { renderWithQuery as render } from '@/tests/jest/helpers/queryRender';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
let mockFocused = true;
jest.mock('expo-router', () => { const React = require('react'); const router = {push: jest.fn(), back: jest.fn(), replace: jest.fn()}; return {router, useRouter: () => router, useFocusEffect: jest.fn((effect: () => void | (() => void)) => React.useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]))}; });

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
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
 useUser: jest.fn(), useIsLoading: () => false }));
jest.mock('@/store/authSheetStore', () => ({ useAuthSheetStore: (selector: (state: unknown) => unknown) => selector({ show: jest.fn() }) }));
jest.mock('@/services/swapService', () => ({ getUserSwaps: jest.fn(), getSwapItems: (swap: { initiatorItems: unknown[]; receiverItems: unknown[] }, side: string) => side === 'initiator' ? swap.initiatorItems : swap.receiverItems }));
jest.mock('@/features/swap', () => ({ ...jest.requireActual('@/features/swap/presentation'), SwapListCard: jest.requireActual('@/features/swap/components/list/SwapListCard').SwapListCard }));

import MySwapsScreen from '@/app/my-swaps';
import { useUser } from '@/hooks/useAuth';
import { getUserSwaps } from '@/services/swapService';
import type { Swap } from '@/types';

const base = {
  initiatorId: 'me', receiverId: 'alice', initiatorName: 'Moi', receiverName: 'Alice',
  initiatorItems: [{ articleId: 'coat', title: 'Manteau offert', price: 50 }],
  receiverItems: [{ articleId: 'dress', title: 'Robe reçue', price: 30 }],
  createdAt: new Date('2026-10-05'),
} as Swap;
const readSwaps = jest.mocked(getUserSwaps);
beforeEach(() => {
 jest.clearAllMocks(); mockFocused = true;
 (useUser as jest.Mock).mockReturnValue({id: 'me'}); establishIdentityFixture('me'); readSwaps.mockResolvedValue([]);
});
it('le visiteur ne lit aucune donnée privée', () => {
 (useUser as jest.Mock).mockReturnValue(null); clearIdentityFixture(); render(<MySwapsScreen />);
 expect(screen.getByText('Se connecter')).toBeOnTheScreen(); expect(readSwaps).not.toHaveBeenCalled();
});
it('permet une nouvelle lecture après un refus du serveur', async () => {
 readSwaps.mockRejectedValueOnce(new Error('Lecture refusée'));
 render(<MySwapsScreen />); fireEvent.press(await screen.findByText('Réessayer'));
 await screen.findByText('Votre premier échange commence ici'); expect(readSwaps).toHaveBeenCalledTimes(2);
});
it('sépare les propositions, échanges en cours et historiques après une vraie lecture courante', async () => {
 readSwaps.mockResolvedValue([{...base,id:'sent',status:'proposed'},{...base,id:'active',status:'shipping'},{...base,id:'history',status:'completed'}]);
 render(<MySwapsScreen />); await screen.findByText(/^Proposition envoyée/); expect(screen.getByText(/^Échange en cours/)).toBeOnTheScreen();
 fireEvent.press(screen.getByText('En attente')); expect(screen.queryByText(/^Échange en cours/)).toBeNull();
 fireEvent.press(screen.getByText('Historique')); expect(screen.getByText(/^Échange terminé/)).toBeOnTheScreen(); expect(screen.queryByText(/^Proposition envoyée/)).toBeNull();
});
it('préserve le rôle du receveur et le payeur historique exact', async () => {
 (useUser as jest.Mock).mockReturnValue({id:'alice'}); establishIdentityFixture('alice'); readSwaps.mockResolvedValue([{...base,id:'received',status:'proposed',cashTopUp:{amount:4500,payerId:'alice'}}]);
 render(<MySwapsScreen />); await screen.findByText(/^Proposition reçue/); expect(screen.getByText('Vous proposez')).toBeOnTheScreen(); expect(screen.getByText('Vous recevez')).toBeOnTheScreen();
 expect(screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Vous.')).toBeOnTheScreen();
});
it('permet de quitter une catégorie vide après le chargement', async () => {
 render(<MySwapsScreen />); await screen.findByText('Votre premier échange commence ici'); fireEvent.press(screen.getByText('En cours'));
 expect(screen.getByText('Aucun échange dans cette catégorie')).toBeOnTheScreen(); fireEvent.press(screen.getByText('Voir tous mes échanges')); expect(screen.getByText('Votre premier échange commence ici')).toBeOnTheScreen();
});
it('garde les filtres défilants et le montant CAD sans ponctuation doublée', async () => {
 readSwaps.mockResolvedValue([{...base,receiverName:'Lou Martin',id:'one',status:'proposed',cashTopUp:{amount:4500,payerId:'alice'}}]); render(<MySwapsScreen />);
 await screen.findByText(/^Proposition envoyée/); expect(screen.getByTestId('swap-filters').props.horizontal).toBe(true);
 expect(screen.getByRole('button',{name:/Échange avec Lou M\./}).props.accessibilityLabel).not.toContain('Lou M..');
 expect(screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Lou M.')).toBeOnTheScreen();
});
it('relit le serveur au retour du détail et ne conserve pas la proposition annulée', async () => {
 let server: Swap = {...base,id:'changed',status:'proposed'}; readSwaps.mockImplementation(async()=>[server]);
 const view=render(<MySwapsScreen />); await screen.findByText(/^Proposition envoyée/); expect(readSwaps).toHaveBeenCalledTimes(1);
 mockFocused=false; view.rerender(<MySwapsScreen />); expect(screen.queryByText(/^Proposition envoyée/)).toBeNull();
 server={...server,status:'cancelled'}; mockFocused=true; view.rerender(<MySwapsScreen />);
 await screen.findByText(/^Échange annulé/); expect(readSwaps).toHaveBeenCalledTimes(2); expect(screen.queryByText(/^Proposition envoyée/)).toBeNull();
 expect(screen.getByRole('button',{name:'En attente, 0 échange'})).toBeOnTheScreen(); expect(screen.getByRole('button',{name:'Historique, 1 échange'})).toBeOnTheScreen();
});
