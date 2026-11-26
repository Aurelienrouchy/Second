import { renderWithQuery as render } from '@/tests/jest/helpers/queryRender';
import { auth } from '@/config/firebaseConfig';
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 1,
  useAuthStore: Object.assign((selector: (state: { user: unknown; authenticatedUid: string | null }) => unknown) => {
    const user = mockUser(); return selector({ user, authenticatedUid: user?.id ?? null });
  }, { getState: () => { const user = mockUser(); return { user, authenticatedUid: user?.id ?? null }; } }),
}));
jest.mock('expo-crypto', () => ({randomUUID: () => require('node:crypto').randomUUID(), CryptoDigestAlgorithm: {SHA256: 'SHA-256'}, digestStringAsync: async (_algorithm: unknown, value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex')}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
import React from 'react';
import * as RN from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useUser } from '@/hooks/useAuth';
import { proposeSwap } from '@/services/swapService';
import { ModerationService } from '@/services/moderationService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import type { Article, SwapItemInfo, User } from '@/types';

jest.mock('@/components/ui', () => ({
  Button: jest.requireActual('@/components/ui/Button').Button,
  ScreenHeader: jest.requireActual('@/components/ui/ScreenHeader').ScreenHeader,
  Input: jest.requireActual('@/components/ui/Input').Input, Checkbox: jest.requireActual('@/components/ui/Checkbox').Checkbox,
 Text: jest.requireActual('@/components/ui/Text').Text }));
jest.mock('@/features/swap', () => ({
  ...jest.requireActual('@/features/swap'),
  SwapItemSelector: jest.requireActual('@/features/swap/components/shared/SwapItemSelector').default,
  SwapItemCard: jest.requireActual('@/features/swap/components/shared/SwapItemCard').default,
  SwapSeparator: jest.requireActual('@/features/swap/components/shared/SwapSeparator').default,
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
jest.mock('@tanstack/react-query', () => ({ ...jest.requireActual('@tanstack/react-query'), useQuery: jest.fn(), useQueryClient: () => mockQueryClient }));
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
 useUser: jest.fn() }));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getArticleById: jest.fn(), getUserArticles: jest.fn() } }));
const mockPreview = jest.fn();
jest.mock('@/services/swapService', () => ({getSwapAgreementPreview: (...args: unknown[]) => mockPreview(...args), getPendingSwapProposal: jest.fn(async () => null), proposeSwap: jest.fn(), getPartyItemsExtended: jest.fn(), GENERALIST_ZONE_ID: 'generalist' }));
jest.mock('@/services/moderationService', () => ({ ModerationService: { areUsersBlocked: jest.fn() } }));
jest.mock('@/store/authSheetStore', () => ({ useAuthSheetStore: { getState: () => ({ show: mockShowAuth }) } }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/config/featureFlags', () => ({ PAYMENTS_ENABLED: false }));
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stack = Object.assign((props: Record<string, unknown>) => React.createElement(View, props), { Screen: () => null });
  return {
  useRouter: () => require('expo-router').router,
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
 Stack, router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: jest.fn() };
});

import ProposeSwapScreen from '@/app/propose-swap';
import SwapItemSelector from '@/features/swap/components/shared/SwapItemSelector';

const mockShowAuth = jest.fn();
const mockQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10 * 60 * 1000 } } });
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
const defaultParams = { receiverId: 'them', receiverName: 'Camille', receiverImage: 'https://example.test/camille.jpg', receiverArticleIds: JSON.stringify([receiverItem.articleId]), partyId: 'zone-a' };
type QueryResult = { data?: unknown; isLoading?: boolean; isError?: boolean; refetch?: jest.Mock };
let queries: Record<string, QueryResult>;
const queryResult = (key: string[], result: QueryResult) => { queries[JSON.stringify(key)] = result; };

beforeEach(() => {
  mockQueryClient.clear();
  flags.PAYMENTS_ENABLED = false;
  queries = {};
  mockShowAuth.mockClear();
  mockParams.mockReturnValue(defaultParams);
  mockUser.mockReturnValue(currentUser); Object.defineProperty(auth, 'currentUser', {value: {uid: currentUser.id}, writable: true, configurable: true});
  mockPropose.mockReset().mockResolvedValue('swap-123');
  mockPreview.mockReset().mockImplementation(async (input: import('@/types/swap').SwapProposalPreviewInput) => ({
    protocol: 'swap_exchange_agreement_v1', scope: 'new_proposal', sourceHash: require('node:crypto').createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    termsVersion: '2026-10-17.v1', termsText: 'Conditions natives de la proposition synthétique.', exchangeMode: input.exchangeMode, arrangements: input.arrangements,
    message: input.message ?? null, initiatorId: input.expectedUid, receiverId: input.receiverId,
    initiatorItems: input.initiatorArticleIds.map(id => ({...mineItem, articleId: id})), receiverItems: input.receiverArticleIds.map(id => ({...receiverItem, articleId: id})), cashTopUp: input.cashTopUp ?? null,
  }));
  mockBlocked.mockResolvedValue(false);
  queryResult(['articles', 'user', 'me'], { data: [article(mineItem, 'me'), { ...article({ ...mineItem, articleId: 'sold' }, 'me'), isSold: true }] });
  queryResult(['articles', 'user', 'them'], { data: [article(receiverItem, 'them'), article({ ...receiverItem, articleId: 'not-in-zone' }, 'them')] });
  queryResult(['swap-parties', 'zone-a', 'items'], { data: [{ ...receiverItem, sellerId: 'them' }] });
  // Fixtures provide the query fields used by this route; the full generic
  // observer API is deliberately replaced at this UI boundary.
  mockQuery.mockImplementation(((options: { queryKey: string[] }) => {
    const base = {isLoading: false, isError: false, isFetching: false, isSuccess: true, refetch: jest.fn()};
    if (String(options.queryKey[0]).startsWith('private-article-image-')) return {...base, isSuccess: false, isPending: true};
    if (options.queryKey[0] === 'eligibility') return {...base, data: {version: 'a'.repeat(64), statementVersion: 'current', statements: {personal: 'Affaires personnelles', professional: 'Professionnel'}, activityDeclaration: {kind: 'personal', statementVersion: 'current'}, quebecResidenceStatementVersion: '2026-10-17.v1', quebecResidenceStatement: 'Résidence au Québec', swapLaunch: {allowed: true, reasons: [], policyVersion: '2026-10-17.v1'}}};
    if (options.queryKey[0] === 'pending-swap-proposal') return {...base, data: null};
    const key = options.queryKey[0] === 'articles' && options.queryKey[1] === 'user' ? options.queryKey.slice(0,3) : options.queryKey;
    return {...base, ...queries[JSON.stringify(key)]};
  }) as unknown as typeof useQuery);
  jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { mockQueryClient.clear(); jest.restoreAllMocks(); });

function selectMine() {
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  fireEvent.press(screen.getByTestId('swap-select-mine'));
  fireEvent.press(screen.getByRole('button', { name: 'Utiliser cette sélection' }));
  fireEvent.press(screen.getByText('Remise en main propre'));
  fireEvent.changeText(screen.UNSAFE_getAllByType(RN.TextInput).find(node => node.props.maxLength === 2000)!, 'Métro, samedi à 14 h');
}

function reviewSendButton() { return within(screen.UNSAFE_getAllByType(RN.Modal).find(node => node.props.visible === true)!).getByRole('button', {name: 'Envoyer ma proposition'}); }
async function readAndConfirm() {
  fireEvent.press(screen.getByTestId('propose-swap-submit'));
  const consent = await screen.findByLabelText('Je confirme ces articles et les conditions de cet échange');
  expect(consent.props.accessibilityState.checked).toBe(false);
  expect(mockPropose).not.toHaveBeenCalled();
  expect(reviewSendButton()).toBeDisabled();
  fireEvent.press(consent);
  return reviewSendButton();
}
async function confirmAndSend() {
  fireEvent.press(await readAndConfirm());
  await act(async () => {await Promise.resolve();});
}


it('explique le choix de chaque côté et conserve le destinataire fourni', () => {
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Ma proposition')).toBeOnTheScreen();
  expect(screen.getByText('Avec Camille')).toBeOnTheScreen();
  expect(screen.getByText('Vous recevez')).toBeOnTheScreen();
  expect(screen.getByText('Vous proposez')).toBeOnTheScreen();
  expect(screen.getByText('Veste en lin')).toBeOnTheScreen();
  expect(screen.getByText('Choisissez entre 1 et 20 articles de chaque côté.')).toBeOnTheScreen();
  expect(screen.getByTestId('propose-swap-submit')).toBeDisabled();
});

it('fermer le sélecteur conserve la sélection et la proposition accepte des valeurs différentes', () => {
  render(<ProposeSwapScreen />);
  fireEvent.press(screen.getByTestId('propose-swap-add-mine'));
  expect(screen.queryByTestId('swap-select-sold')).toBeNull();
  fireEvent.press(screen.getByTestId('swap-select-mine'));
  fireEvent.press(screen.getByRole('button', { name: 'Fermer et conserver la sélection' }));
  expect(screen.getAllByText('Pull en laine').length).toBeGreaterThan(0);
  expect(screen.getByText('Valeurs indicatives')).toBeOnTheScreen();
  expect(screen.getByLabelText('Vous recevez, 100 $')).toBeOnTheScreen();
  expect(screen.getByLabelText('Vous proposez, 40 $')).toBeOnTheScreen();
  expect(screen.getByTestId('propose-swap-submit')).toBeDisabled();
  fireEvent.press(screen.getByText('Remise en main propre'));
  fireEvent.changeText(screen.UNSAFE_getAllByType(RN.TextInput).find(node => node.props.maxLength === 2000)!, 'Métro, samedi à 14 h');
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
  await confirmAndSend();
  await waitFor(() => expect(mockPropose).toHaveBeenCalledTimes(1));
  expect(mockPropose).toHaveBeenCalledWith({
    initiatorId: 'me', initiatorName: 'Alice', initiatorImage: currentUser.profileImage,
    clientRequestId: expect.any(String), expectedUid: 'me', agreementProtocol: 'swap_exchange_agreement_v1', expectedSourceHash: expect.any(String), exchangeMode: 'hand_delivery', arrangements: 'Métro, samedi à 14 h',
    initiatorItems: [mineItem], receiverId: 'them', receiverName: 'Camille', receiverImage: '',
    receiverItems: [receiverItem], message: 'Bonjour Camille', cashTopUp: undefined, partyId: 'zone-a',
  }, expect.any(Function));
  expect(mockPropose.mock.calls[0][0].expectedSourceHash).toBe((await mockPreview.mock.results[0].value).sourceHash);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({pathname: '/swap/[id]', params: {id: 'swap-123', source: 'post_proposal'}}));
  fireEvent.press(screen.getByText('Voir mon échange'));
  expect(router.push).toHaveBeenCalledWith('/my-swaps');
});

it('rafraîchit une liste vide encore fraîche après envoi, sans invalider celle d’un autre membre', async () => {
  const queryKey = queryKeys.swaps.userList('me');
  const fetchList = jest.fn<Promise<{ id: string }[]>, []>().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'swap-123' }]);
  await mockQueryClient.fetchQuery({ queryKey, queryFn: fetchList });
  mockQueryClient.setQueryData(queryKeys.swaps.userList('someone-else'), [{ id: 'unrelated' }]);
  expect(mockQueryClient.getQueryData(queryKey)).toEqual([]);
  render(<ProposeSwapScreen />);
  selectMine();
  await confirmAndSend();
  await waitFor(() => expect(screen.getByText('Voir mon échange')).toBeOnTheScreen());
  fireEvent.press(screen.getByText('Voir mon échange'));
  // Reopening the list must fetch despite its ten-minute staleTime.
  expect(await mockQueryClient.fetchQuery({ queryKey, queryFn: fetchList })).toEqual([{ id: 'swap-123' }]);
  expect(fetchList).toHaveBeenCalledTimes(2);
  expect(mockQueryClient.getQueryState(queryKeys.swaps.userList('someone-else'))?.isInvalidated).toBe(false);
});

it('verrouille les doubles appuis avant await et après succès pendant la confirmation', async () => {
  let resolveBlocked: (blocked: boolean) => void = () => {};
  mockBlocked.mockReturnValue(new Promise(resolve => { resolveBlocked = resolve; }));
  render(<ProposeSwapScreen />);
  selectMine();
  let submit = await readAndConfirm();
  while (submit.parent && !submit.props.onPress) submit = submit.parent;
  const send = submit.props.onPress as () => Promise<void>;
  act(() => { void send(); void send(); });
  expect(mockBlocked).toHaveBeenCalledTimes(1);
  expect(reviewSendButton()).toBeDisabled();
  expect(mockPropose).not.toHaveBeenCalled();
  await act(async () => { resolveBlocked(false); });
  await waitFor(() => expect(screen.getByText('Voir mon échange')).toBeOnTheScreen());
  await act(async () => { await send(); });
  expect(mockPropose).toHaveBeenCalledTimes(1);
  expect(mockBlocked).toHaveBeenCalledTimes(1);
});

it('une erreur conserve les articles et permet un nouvel essai', async () => {
  mockPropose.mockRejectedValueOnce(Object.assign(new Error('refus défini'), {code: 'functions/failed-precondition'}));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<ProposeSwapScreen />);
  selectMine();
  await confirmAndSend();
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Envoi impossible', expect.stringContaining('Relisez ses conditions')));
  expect(screen.getAllByText('Pull en laine').length).toBeGreaterThan(0);
  expect(reviewSendButton()).toBeEnabled();
  fireEvent.press(reviewSendButton());
  await waitFor(() => expect(mockPropose).toHaveBeenCalledTimes(2));
  consoleError.mockRestore();
});

it('conserve une réponse inconnue et bloque un nouvel envoi de proposition', async () => {
  mockPropose.mockRejectedValueOnce(Object.assign(new Error('Réponse réseau inconnue'), {code: 'functions/unavailable'}));
  render(<ProposeSwapScreen />); selectMine(); await confirmAndSend();
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Envoi en attente de confirmation', expect.any(String)));
  const sent = mockPropose.mock.calls[0][0];
  expect(sent.clientRequestId).toEqual(expect.any(String));
  expect(sent.expectedSourceHash).toBe((await mockPreview.mock.results[0].value).sourceHash);
  expect(reviewSendButton()).toBeDisabled();
  expect(mockPropose).toHaveBeenCalledTimes(1);
});

it('un membre bloqué empêche l’appel serveur et permet de revenir', async () => {
  mockBlocked.mockResolvedValue(true);
  render(<ProposeSwapScreen />);
  selectMine();
  await confirmAndSend();
  await waitFor(() => expect(RN.Alert.alert).toHaveBeenCalledWith('Action impossible', expect.stringContaining('Vous ne pouvez pas')));
  expect(mockPropose).not.toHaveBeenCalled();
  expect(reviewSendButton()).toBeEnabled();
  fireEvent.press(screen.getByRole('button', {name: 'Fermer'}));
  fireEvent.press(screen.getByRole('button', { name: 'Retour' }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('un invité reçoit la connexion et aucun appel d’envoi', () => {
  mockUser.mockReturnValue(null); Object.defineProperty(auth, 'currentUser', {value: null, writable: true, configurable: true});
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
  [{ ...defaultParams, receiverArticleIds: '{' }, /sélection.*indisponible/],
  [{ ...defaultParams, receiverArticleIds: JSON.stringify([{ articleId: 'bad', price: '10', title: 'Bad' }]) }, /sélection.*indisponible/],
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
  expect(screen.getByRole('button', { name: 'Retour' })).toBeEnabled();
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
  await confirmAndSend();
  await waitFor(() => expect(mockPropose).toHaveBeenCalledWith(expect.objectContaining({ partyId: 'generalist', receiverItems: [receiverItem] }), expect.any(Function)));
});

it('préserve les cents et le choix du payeur quand la gate de paiement legacy est activée', async () => {
  flags.PAYMENTS_ENABLED = true;
  render(<ProposeSwapScreen />);
  selectMine();
  fireEvent.changeText(screen.getByLabelText('Montant du complément en dollars'), '25');
  fireEvent.press(screen.getByRole('button', { name: 'Camille paie' }));
  await confirmAndSend();
  await waitFor(() => expect(mockPropose).toHaveBeenCalledWith(expect.objectContaining({ cashTopUp: { amount: 2500, payerId: 'them' } }), expect.any(Function)));
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

it('une erreur de stock de zone permet de reprendre la lecture du stock déposé', () => {
  const retryArticles = jest.fn();
  const retryZone = jest.fn();
  queryResult(['articles', 'user', 'them'], { data: [article(receiverItem, 'them')], refetch: retryArticles });
  queryResult(['swap-parties', 'zone-a', 'items'], { isError: true, refetch: retryZone });
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Échange indisponible')).toBeOnTheScreen();
  expect(screen.getByText('Impossible de charger les articles. Veuillez réessayer.')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retryArticles).not.toHaveBeenCalled();
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
