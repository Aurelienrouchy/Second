import React from 'react';
import * as RN from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/useAuth';
import { proposeSwap } from '@/services/swapService';
import { ModerationService } from '@/services/moderationService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import type { Article, SwapItemInfo, User } from '@/types';

jest.mock('@/components/ui', () => ({ Text: jest.requireActual('@/components/ui/Text').Text }));
jest.mock('@/components/swap', () => ({
  SwapItemSelector: jest.requireActual('@/components/swap/SwapItemSelector').default,
  SwapItemCard: jest.requireActual('@/components/swap/SwapItemCard').default,
  SwapSeparator: jest.requireActual('@/components/swap/SwapSeparator').default,
}));
jest.mock('@/components/ui/Skeleton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Skeleton: (props: Record<string, unknown>) => React.createElement(View, props) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) };
});
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem, ListEmptyComponent, ...props }: {
      data: SwapItemInfo[];
      renderItem: (value: { item: SwapItemInfo }) => React.ReactNode;
      ListEmptyComponent: React.ReactNode;
    }) => React.createElement(View, props, data.length
      ? data.map(item => React.createElement(React.Fragment, { key: item.articleId }, renderItem({ item })))
      : ListEmptyComponent),
  };
});
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useUser: jest.fn() }));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getArticleById: jest.fn(), getUserArticles: jest.fn() } }));
jest.mock('@/services/swapService', () => ({ proposeSwap: jest.fn(), getPartyItemsExtended: jest.fn(), GENERALIST_ZONE_ID: 'generalist' }));
jest.mock('@/services/moderationService', () => ({ ModerationService: { areUsersBlocked: jest.fn() } }));
jest.mock('@/store/authSheetStore', () => ({ useAuthSheetStore: { getState: () => ({ show: mockShowAuth }) } }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/config/featureFlags', () => ({ PAYMENTS_ENABLED: false }));
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stack = Object.assign((props: Record<string, unknown>) => React.createElement(View, props), { Screen: () => null });
  return { Stack, router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: jest.fn() };
});

import ProposeSwapScreen from '@/app/propose-swap';
import SwapItemSelector from '@/components/swap/SwapItemSelector';

const mockShowAuth = jest.fn();
const flags = jest.requireMock('@/config/featureFlags') as { PAYMENTS_ENABLED: boolean };
const mockQuery = jest.mocked(useQuery);
const mockUser = jest.mocked(useUser);
const mockParams = jest.mocked(useLocalSearchParams);
const mockPropose = jest.mocked(proposeSwap);
const mockBlocked = jest.mocked(ModerationService.areUsersBlocked);
const receiverItem: SwapItemInfo = { articleId: 'theirs', title: 'Veste en lin', price: 100, brand: 'Atelier', size: { value: 'M', system: 'EU' }, imageUrl: 'https://example.test/theirs.jpg' };
const mineItem: SwapItemInfo = { articleId: 'mine', title: 'Pull en laine', price: 40, brand: 'Maison', size: { value: 'S', system: 'EU' }, imageUrl: 'https://example.test/mine.jpg' };
const currentUser = { id: 'me', displayName: 'Alice', profileImage: 'https://example.test/alice.jpg' } as User;
const article = (item: SwapItemInfo, sellerId: string): Article => ({ id: item.articleId, title: item.title, price: item.price, images: [{ url: item.imageUrl! }], brand: item.brand, size: item.size, sellerId, sellerName: 'Camille', isActive: true, isSold: false } as Article);
const defaultParams = { receiverId: 'them', receiverName: 'Camille', receiverImage: 'https://example.test/camille.jpg', receiverItems: JSON.stringify([receiverItem]), partyId: 'zone-a' };
type QueryResult = { data?: unknown; isLoading?: boolean; isError?: boolean; refetch?: jest.Mock };
let queries: Record<string, QueryResult>;
const queryResult = (key: string[], result: QueryResult) => { queries[JSON.stringify(key)] = result; };

beforeEach(() => {
  flags.PAYMENTS_ENABLED = false;
  queries = {};
  mockShowAuth.mockClear();
  mockParams.mockReturnValue(defaultParams);
  mockUser.mockReturnValue(currentUser);
  mockPropose.mockResolvedValue('swap-123');
  mockBlocked.mockResolvedValue(false);
  queryResult(['articles', 'user', 'me'], { data: [article(mineItem, 'me'), { ...article({ ...mineItem, articleId: 'sold' }, 'me'), isSold: true }] });
  queryResult(['articles', 'user', 'them'], { data: [article(receiverItem, 'them'), article({ ...receiverItem, articleId: 'not-in-zone' }, 'them')] });
  queryResult(['swap-parties', 'zone-a', 'items'], { data: [{ articleId: 'theirs', sellerId: 'them' }] });
  // Fixtures provide the query fields used by this route; the full generic
  // observer API is deliberately replaced at this UI boundary.
  mockQuery.mockImplementation(((options: { queryKey: string[] }) => ({ isLoading: false, isError: false, refetch: jest.fn(), ...queries[JSON.stringify(options.queryKey)] })) as unknown as typeof useQuery);
  jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

function selectMine() {
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  fireEvent.press(screen.getByTestId('swap-select-mine'));
  fireEvent.press(screen.getByRole('button', { name: 'Utiliser cette sélection' }));
}

it('explique le choix de chaque côté et conserve le destinataire fourni', () => {
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Espace échanges')).toBeOnTheScreen();
  expect(screen.getByText('Proposer un échange')).toBeOnTheScreen();
  expect(screen.getByText('Avec Camille')).toBeOnTheScreen();
  expect(screen.getByText('Les articles de Camille')).toBeOnTheScreen();
  expect(screen.getByText('Vos articles')).toBeOnTheScreen();
  expect(screen.getByText('Veste en lin')).toBeOnTheScreen();
  expect(screen.getByText('Choisissez au moins un article de chaque côté.')).toBeOnTheScreen();
  expect(screen.getByTestId('propose-swap-submit')).toBeDisabled();
});

it('fermer le sélecteur conserve la sélection et la proposition accepte des valeurs différentes', () => {
  render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  expect(screen.queryByTestId('swap-select-sold')).toBeNull();
  fireEvent.press(screen.getByTestId('swap-select-mine'));
  fireEvent.press(screen.getByRole('button', { name: 'Fermer et conserver la sélection' }));
  expect(screen.getByText('Pull en laine')).toBeOnTheScreen();
  expect(screen.getByText('Un écart de valeur n’empêche pas l’échange.')).toBeOnTheScreen();
  expect(screen.getByTestId('propose-swap-submit')).toBeEnabled();
  expect(screen.queryByText(/complément en argent/)).toBeNull();
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  expect(screen.getByTestId('swap-select-mine').props.accessibilityState.checked).toBe(true);
});

it('le sélecteur destinataire reste limité aux articles déposés dans la zone', () => {
  render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-their'));
  expect(screen.getByTestId('swap-select-theirs').props.accessibilityState.checked).toBe(true);
  expect(screen.queryByTestId('swap-select-not-in-zone')).toBeNull();
  fireEvent.press(screen.getByTestId('swap-select-theirs'));
  fireEvent.press(screen.getByRole('button', { name: 'Fermer et conserver la sélection' }));
  selectMine();
  expect(screen.getByTestId('propose-swap-submit')).toBeDisabled();
});

it('envoie le payload existant et confirme le succès avec un accès au suivi', async () => {
  render(<ProposeSwapScreen />);
  selectMine();
  fireEvent.changeText(screen.getByLabelText('Message facultatif pour votre proposition'), 'Bonjour Camille');
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  await waitFor(() => expect(mockPropose).toHaveBeenCalledTimes(1));
  expect(mockPropose).toHaveBeenCalledWith({
    initiatorId: 'me', initiatorName: 'Alice', initiatorImage: currentUser.profileImage,
    initiatorItems: [mineItem], receiverId: 'them', receiverName: 'Camille', receiverImage: defaultParams.receiverImage,
    receiverItems: [receiverItem], message: 'Bonjour Camille', cashTopUp: undefined, partyId: 'zone-a',
  });
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Votre proposition a été envoyée', expect.any(String), expect.arrayContaining([expect.objectContaining({ text: 'Voir mes échanges' })])));
  fireEvent.press(screen.getByText('Voir mes échanges'));
  expect(router.push).toHaveBeenCalledWith('/my-swaps');
});

it('verrouille les doubles appuis avant await et après succès pendant la confirmation', async () => {
  let resolveBlocked: (blocked: boolean) => void = () => {};
  mockBlocked.mockReturnValue(new Promise(resolve => { resolveBlocked = resolve; }));
  render(<ProposeSwapScreen />);
  selectMine();
  let submit = screen.getByTestId('propose-swap-submit');
  while (submit.parent && !submit.props.onPress) submit = submit.parent;
  const send = submit.props.onPress as () => Promise<void>;
  act(() => { void send(); void send(); });
  expect(mockBlocked).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Envoi…')).toBeOnTheScreen();
  expect(mockPropose).not.toHaveBeenCalled();
  await act(async () => { resolveBlocked(false); });
  await waitFor(() => expect(screen.getByText('Voir mes échanges')).toBeOnTheScreen());
  await act(async () => { await send(); });
  expect(mockPropose).toHaveBeenCalledTimes(1);
  expect(mockBlocked).toHaveBeenCalledTimes(1);
});

it('une erreur conserve les articles et permet un nouvel essai', async () => {
  mockPropose.mockRejectedValueOnce(new Error('network'));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<ProposeSwapScreen />);
  selectMine();
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Envoi impossible', expect.stringContaining('sélection est conservée')));
  expect(screen.getByText('Pull en laine')).toBeOnTheScreen();
  expect(screen.getByTestId('propose-swap-submit')).toBeEnabled();
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  await waitFor(() => expect(mockPropose).toHaveBeenCalledTimes(2));
  consoleError.mockRestore();
});

it('un membre bloqué empêche l’appel serveur et permet de revenir', async () => {
  mockBlocked.mockResolvedValue(true);
  render(<ProposeSwapScreen />);
  selectMine();
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Action impossible', expect.stringContaining('Vous ne pouvez pas')));
  expect(mockPropose).not.toHaveBeenCalled();
  expect(screen.getByTestId('propose-swap-submit')).toBeEnabled();
  fireEvent.press(screen.getByRole('button', { name: 'Revenir à l’écran précédent' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('un invité reçoit la connexion et aucun appel d’envoi', () => {
  mockUser.mockReturnValue(null);
  render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  expect(mockShowAuth).toHaveBeenCalledWith('Connectez-vous pour proposer un échange.');
  expect(useAuthSheetStore.getState().show).toBe(mockShowAuth);
  expect(screen.getByTestId('propose-swap-submit')).toBeDisabled();
  expect(mockPropose).not.toHaveBeenCalled();
});

it.each([
  [{}, /destinataire.*introuvable/],
  [{ ...defaultParams, receiverId: 'me' }, /avec vous-même/],
  [{ ...defaultParams, receiverItems: '{' }, /sélection.*indisponible/],
  [{ ...defaultParams, receiverItems: JSON.stringify([{ articleId: 'bad', price: '10', title: 'Bad' }]) }, /sélection.*indisponible/],
])('présente un retour utilisable si les paramètres sont invalides (%j)', (params, message) => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockParams.mockReturnValue(params);
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Échange indisponible')).toBeOnTheScreen();
  expect(screen.getByText(message)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Revenir aux articles' }));
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(mockPropose).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

it('affiche le chargement avec un retour, puis le retry si l’article cible échoue', () => {
  mockParams.mockReturnValue({ receiverId: 'them', targetArticleId: 'theirs' });
  const retry = jest.fn();
  queryResult(['articles', 'theirs'], { isLoading: true });
  const result = render(<ProposeSwapScreen />);
  expect(screen.getByLabelText('Chargement de la proposition')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Revenir à l’écran précédent' })).toBeEnabled();
  queryResult(['articles', 'theirs'], { isError: true, refetch: retry });
  result.rerender(<ProposeSwapScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it.each([undefined, { ...article(receiverItem, 'them'), isSold: true }, { ...article(receiverItem, 'them'), isActive: false }])('explique un article cible absent ou indisponible', target => {
  mockParams.mockReturnValue({ receiverId: 'them', targetArticleId: 'theirs' });
  queryResult(['articles', 'theirs'], { data: target });
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Cet article n’est plus disponible pour un échange.')).toBeOnTheScreen();
  expect(mockPropose).not.toHaveBeenCalled();
});

it('reprend aussi l’entrée article cible et la zone généraliste sans modifier le payload', async () => {
  mockParams.mockReturnValue({ receiverId: 'them', receiverName: 'Camille', targetArticleId: 'theirs' });
  queryResult(['articles', 'theirs'], { data: article(receiverItem, 'them') });
  render(<ProposeSwapScreen />);
  selectMine();
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  await waitFor(() => expect(mockPropose).toHaveBeenCalledWith(expect.objectContaining({ partyId: 'generalist', receiverItems: [receiverItem] })));
});

it('préserve les cents et le choix du payeur quand la gate de paiement legacy est activée', async () => {
  flags.PAYMENTS_ENABLED = true;
  render(<ProposeSwapScreen />);
  selectMine();
  fireEvent.changeText(screen.getByLabelText('Montant du complément en dollars'), '25');
  fireEvent.press(screen.getByRole('button', { name: 'Camille paie' }));
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  await waitFor(() => expect(mockPropose).toHaveBeenCalledWith(expect.objectContaining({ cashTopUp: { amount: 2500, payerId: 'them' } })));
});

it('les erreurs et les états vides du sélecteur proposent une action utile', () => {
  const retry = jest.fn();
  queryResult(['articles', 'user', 'me'], { isError: true, refetch: retry });
  const result = render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  expect(screen.getByText(/Impossible de charger vos articles/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledTimes(1);
  queryResult(['articles', 'user', 'me'], { data: [] });
  result.rerender(<ProposeSwapScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Publier un article' }));
  expect(router.push).toHaveBeenCalledWith('/(tabs)/sell');
});

it('le sélecteur en chargement attend les articles avant d’annoncer un état vide', () => {
  queryResult(['articles', 'user', 'me'], { isLoading: true });
  render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  expect(screen.getByLabelText('Chargement des articles')).toBeOnTheScreen();
  expect(screen.queryByText('Aucun article disponible')).toBeNull();
});

it('une erreur de stock de zone permet de reprendre les deux lectures du destinataire', () => {
  const retryArticles = jest.fn();
  const retryZone = jest.fn();
  queryResult(['articles', 'user', 'them'], { data: [article(receiverItem, 'them')], refetch: retryArticles });
  queryResult(['swap-parties', 'zone-a', 'items'], { isError: true, refetch: retryZone });
  render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-their'));
  expect(screen.getByText(/Impossible de charger les articles de ce membre/)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retryArticles).toHaveBeenCalledTimes(1);
  expect(retryZone).toHaveBeenCalledTimes(1);
});

it('le sélecteur utilise une colonne à 320 px ou avec une grande police et garde les contrôles à 44 px', () => {
  const dimensions = jest.spyOn(RN, 'useWindowDimensions');
  dimensions.mockReturnValue({ width: 320, height: 640, scale: 1, fontScale: 1 });
  const onClose = jest.fn();
  const props = { visible: true, onClose, items: [mineItem], selectedItems: [mineItem], onSelectionChange: jest.fn() };
  const result = render(<SwapItemSelector {...props} />);
  expect(screen.getByTestId('swap-selector-grid').props.numColumns).toBe(1);
  const close = screen.getByRole('button', { name: 'Fermer et conserver la sélection' });
  const closeStyle = RN.StyleSheet.flatten(close.props.style);
  expect(closeStyle.width).toBeGreaterThanOrEqual(44);
  expect(closeStyle.height).toBeGreaterThanOrEqual(44);
  dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1.6 });
  result.rerender(<SwapItemSelector {...props} />);
  expect(screen.getByTestId('swap-selector-grid').props.numColumns).toBe(1);
  fireEvent.press(screen.getByRole('button', { name: 'Utiliser cette sélection' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
