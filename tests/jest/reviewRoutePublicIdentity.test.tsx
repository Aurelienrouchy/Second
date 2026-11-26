import React from 'react';
import {act, fireEvent, screen, waitFor} from '@testing-library/react-native';
import {Alert} from 'react-native';
import * as Haptics from 'expo-haptics';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {renderWithQuery} from '@/tests/jest/helpers/queryRender';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';

const mockRouter = {back: jest.fn(), push: jest.fn(), replace: jest.fn()};
const mockTransaction = jest.fn(), mockArticle = jest.fn(), mockRpc = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({transactionId: 'cash-order'}), useRouter: () => mockRouter,
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);},
  useNavigation: () => ({isFocused: () => true}),
}));
jest.mock('firebase/functions', () => ({httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mockRpc(name, input)}));
jest.mock('@/services/transactionService', () => ({TransactionService: {getTransaction: (...args: unknown[]) => mockTransaction(...args)}}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {getArticleById: (...args: unknown[]) => mockArticle(...args)}}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
import {UserService} from '@/services/userService';
import ReviewScreen from '@/app/review/[transactionId]';

function renderReview() {
  return renderWithQuery(<ReviewScreen/>, {wrapper: ({children}) => <SafeAreaProvider initialMetrics={{insets: {top: 0, right: 0, bottom: 0, left: 0}, frame: {x: 0, y: 0, width: 390, height: 844}}}>{children}</SafeAreaProvider>});
}

let alerts: jest.SpyInstance, privateRead: jest.SpyInstance;
function publicReply(id: string) {
  return {data: {profile: {id, displayName: 'Profil public du pair', profileImage: null, bio: null, createdAt: '2020-01-01T00:00:00.000Z', rating: 4, accountType: 'user', sellerLikesCount: 0}}};
}
beforeEach(() => {
  establishIdentityFixture('buyer');
  mockTransaction.mockReset().mockResolvedValue({id: 'cash-order', buyerId: 'buyer', sellerId: 'seller', articleId: 'article', deliveryType: 'meetup', status: 'meetup_completed'});
  mockArticle.mockReset().mockResolvedValue(null);
  mockRpc.mockReset().mockImplementation(async (name: string, input: {userId?: string}) => {
    if (name === 'getUserPublicProfile') return publicReply(input.userId!);
    if (name === 'createReview') return {data: {success: true, reviewId: 'native-review'}};
    throw new Error(`Unexpected fixture RPC: ${name}`);
  });
  alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  privateRead = jest.spyOn(UserService, 'getUserById').mockRejectedValue(new Error('Private profile reads forbidden'));
});
afterEach(() => {jest.restoreAllMocks(); clearIdentityFixture();});

it.each(['buyer', 'seller'] as const)('lit uniquement le profil public du pair et envoie une note accessible avec le rôle exact (%s)', async actor => {
  establishIdentityFixture(actor); renderReview();
  await screen.findByText('Votre note');
  expect(mockRpc).toHaveBeenCalledWith('getUserPublicProfile', {userId: actor === 'buyer' ? 'seller' : 'buyer'});
  expect(privateRead).not.toHaveBeenCalled(); expect(screen.getAllByRole('button', {name: /^Note [1-5] sur 5$/})).toHaveLength(5);
  const submit = screen.getByText('ENVOYER MON AVIS'); expect(submit).toBeDisabled();
  fireEvent.press(screen.getByRole('button', {name: 'Note 5 sur 5'}));
  expect(screen.getByRole('button', {name: 'Note 5 sur 5', selected: true})).toBeOnTheScreen();
  fireEvent.changeText(screen.getByPlaceholderText('Partagez votre experience...'), 'Rencontre agréable.'); fireEvent.press(submit);
  await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('createReview', {targetUserId: actor === 'buyer' ? 'seller' : 'buyer', transactionId: 'cash-order', transactionType: actor === 'buyer' ? 'achat' : 'vente', note: 5, text: 'Rencontre agréable.', articleId: 'article'}));
  expect(alerts).toHaveBeenCalledWith('Merci pour votre avis !', expect.any(String), expect.any(Array));
  expect(privateRead).not.toHaveBeenCalled();
});

it('refuse une commande étrangère avant de charger article ou profil du pair', async () => {
  establishIdentityFixture('intruder'); renderReview();
  await screen.findByText('Transaction introuvable.');
  expect(mockArticle).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled(); expect(privateRead).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', {name: 'Note 5 sur 5'})).toBeNull();
});

it('ne propose aucune note pour une rencontre seulement confirmée', async () => {
  mockTransaction.mockResolvedValue({id: 'cash-order', buyerId: 'buyer', sellerId: 'seller', articleId: 'article', deliveryType: 'meetup', status: 'meetup_confirmed'});
  renderReview(); await screen.findByText('Vous pourrez laisser un avis une fois la transaction terminee.');
  expect(screen.queryByRole('button', {name: 'Note 5 sur 5'})).toBeNull(); expect(mockRpc.mock.calls.some(([name]) => name === 'createReview')).toBe(false);
});

it('écarte le profil public tardif du premier compte après un remplacement de session', async () => {
  let release!: (reply: ReturnType<typeof publicReply>) => void;
  mockRpc.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  renderReview(); await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('getUserPublicProfile', {userId: 'seller'}));
  act(() => establishIdentityFixture('intruder')); await screen.findByText('Transaction introuvable.');
  await act(async () => {release(publicReply('seller'));});
  expect(screen.queryByText(/Profil public du pair/)).toBeNull(); expect(screen.queryByRole('button', {name: 'Note 5 sur 5'})).toBeNull();
  expect(mockRpc.mock.calls.some(([name]) => name === 'createReview')).toBe(false); expect(privateRead).not.toHaveBeenCalled();
});

it('n’affiche aucun succès tardif ni retour de navigation après un changement de compte pendant l’envoi', async () => {
  let release!: (reply: {data: {success: boolean; reviewId: string}}) => void;
  mockRpc.mockImplementation(async (name: string, input: {userId?: string}) => name === 'getUserPublicProfile' ? publicReply(input.userId!) : new Promise(resolve => {release = resolve;}));
  renderReview(); await screen.findByText('Votre note');
  fireEvent.press(screen.getByRole('button', {name: 'Note 4 sur 5'})); fireEvent.changeText(screen.getByPlaceholderText('Partagez votre experience...'), 'Récit de la rencontre.');
  fireEvent.press(screen.getByText('ENVOYER MON AVIS')); await waitFor(() => expect(mockRpc.mock.calls.some(([name]) => name === 'createReview')).toBe(true));
  act(() => establishIdentityFixture('intruder')); await screen.findByText('Transaction introuvable.');
  await act(async () => {release({data: {success: true, reviewId: 'native-review'}});});
  expect(alerts).not.toHaveBeenCalled(); expect(Haptics.notificationAsync).not.toHaveBeenCalled(); expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRpc.mock.calls.filter(([name]) => name === 'createReview')).toHaveLength(1);
});
