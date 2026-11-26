import React from 'react';
import {Alert, AppState, Modal} from 'react-native';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';

let mockGeneration = 1;
const mockPush = jest.fn();
const mockTransactions = jest.fn();
const mockSellerCancel = jest.fn();
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => mockGeneration,
    useAuthStore: create(() => ({authenticatedUid: 'owner', user: {id: 'owner'}, identityUser: {id: 'owner'}}))};
});
jest.mock('expo-router', () => ({useRouter: () => ({push: mockPush, back: jest.fn()}), useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/services/transactionService', () => ({TransactionService: {getUserTransactions: (...args: unknown[]) => mockTransactions(...args),
  sellerCancelTransaction: (...args: unknown[]) => mockSellerCancel(...args)}}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {getArticlesByIds: async () => new Map()}}));
jest.mock('@/features/reviews/services/reviewService', () => ({hasUserReviewedTransaction: async () => false}));
jest.mock('@/hooks/useAuthRequired', () => ({useRequireAuth: () => ({showAuthSheet: jest.fn()})}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('expo-image', () => ({Image: () => null}));
jest.mock('@shopify/flash-list', () => ({FlashList: ({data, renderItem}: {data: unknown[]; renderItem: (value: {item: unknown}) => React.ReactNode}) => {
  const React = require('react'); const {View} = require('react-native');
  return React.createElement(View, null, data.map((item, index) => React.createElement(View, {key: index}, renderItem({item}))));
}}));
jest.mock('@/components/ui', () => ({Button: jest.requireActual('@/components/ui/Button').Button, ScreenHeader: () => null}));
jest.mock('@/components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('@/features/orders', () => ({OrderOptionsList: jest.requireActual('@/features/orders/components/OrderOptionsList').OrderOptionsList}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: require('react-native').View, SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
import {useAuthStore} from '@/store/authStore';
import MyOrders from '@/app/my-orders';
import MySales from '@/app/my-sales';

const listeners = new Set<(value: string) => void>();
const onQueryError = jest.fn();
const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
let activity = 'background';
let client: QueryClient;
function setActivity(value: string) {activity = value; for (const listener of listeners) listener(value);}
function wrapper({children}: {children: React.ReactNode}) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(() => {
  activity = 'background'; mockGeneration = 1; listeners.clear();
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    const listener = callback as (value: string) => void; listeners.add(listener); return {remove: () => {listeners.delete(listener);}};
  });
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  mockTransactions.mockResolvedValue([]);
  mockSellerCancel.mockResolvedValue({state: 'pending'});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  client = new QueryClient({queryCache: new QueryCache({onError: onQueryError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {jest.restoreAllMocks(); client.clear(); if (originalState) Object.defineProperty(AppState, 'currentState', originalState);});

it.each([MyOrders, MySales])('%p starts no premature manual focus read and reloads after active same-owner hydration', async Screen => {
  render(<Screen/>, {wrapper});
  expect(mockTransactions).not.toHaveBeenCalled(); expect(onQueryError).not.toHaveBeenCalled();
  act(() => {setActivity('active');});
  await waitFor(() => expect(mockTransactions).toHaveBeenCalledTimes(1));
  act(() => {mockGeneration++; useAuthStore.setState(state => ({...state}));});
  await waitFor(() => expect(mockTransactions).toHaveBeenCalledTimes(2));
  expect(onQueryError).not.toHaveBeenCalled();
});

it.each([MyOrders, MySales])('%p cancels a backgrounded read without hiding a real error of its active frame', async Screen => {
  activity = 'active';
  let finish!: (value: []) => void;
  mockTransactions.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  render(<Screen/>, {wrapper});
  await waitFor(() => expect(mockTransactions).toHaveBeenCalledTimes(1));
  act(() => {setActivity('background');});
  const denied = Object.assign(new Error('Permission denied'), {code: 'permission-denied'});
  mockTransactions.mockRejectedValue(denied);
  act(() => {setActivity('active');});
  await waitFor(() => expect(onQueryError).toHaveBeenCalledWith(denied, expect.anything()));
  const errors = onQueryError.mock.calls.length;
  await act(async () => {finish([]);});
  expect(onQueryError).toHaveBeenCalledTimes(errors);
});

it('does not submit a seller cancellation from a confirmation opened before backgrounding', async () => {
  activity = 'active';
  mockTransactions.mockResolvedValue([{id: 'sale', sellerId: 'owner', buyerId: 'buyer', articleId: 'article',
    status: 'paid', deliveryType: 'shipping', amount: 32, shippingCost: 5, totalAmount: 40, createdAt: new Date()}]);
  render(<MySales/>, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('Options de la vente Article de la commande')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Options de la vente Article de la commande'), {stopPropagation: jest.fn()});
  fireEvent.press(screen.getByText('Demander l’annulation'));
  act(() => {screen.UNSAFE_getByType(Modal).props.onDismiss();});
  const confirm = (Alert.alert as jest.Mock).mock.calls.find(call => call[0] === 'Demander l’annulation')?.[2]?.[1];
  expect(confirm).toBeTruthy();
  act(() => {setActivity('background');});
  act(() => {setActivity('active');});
  await act(async () => {await confirm.onPress();});
  expect(mockSellerCancel).not.toHaveBeenCalled();
});


const sale = {
  id: 'sale', sellerId: 'owner', buyerId: 'buyer', articleId: 'article', currency: 'CAD',
  status: 'label_created', deliveryType: 'shipping', amount: 32, shippingCost: 8, totalAmount: 43.10,
  articleSnapshot: {title: 'Pull en coton', price: 40, images: []},
  createdAt: new Date('2026-10-29T12:00:00Z'),
};

it('shows the seller agreed item amount without buyer fees or the mutable listing price', async () => {
  activity = 'active'; mockTransactions.mockResolvedValue([sale]);
  render(<MySales/>, {wrapper});
  await waitFor(() => expect(screen.getByText('32 $')).toBeTruthy());
  expect(screen.queryByText('43,10 $')).toBeNull();
  expect(screen.queryByText('40 $')).toBeNull();
  expect(screen.queryByText(/Renseignements enregistrés avec la commande/)).toBeNull();
  expect(screen.queryByText('Annuler la commande')).toBeNull();
});

it('does not invent a zero seller price or borrow the catalog snapshot when the agreed amount is missing', async () => {
  activity = 'active';
  const {amount: _missing, ...historical} = sale;
  mockTransactions.mockResolvedValue([historical]);
  render(<MySales/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Montant à vérifier')).toBeTruthy());
  expect(screen.queryByText('0 $')).toBeNull();
  expect(screen.queryByText('40 $')).toBeNull();
});

it('keeps the full buyer total in purchases', async () => {
  activity = 'active'; mockTransactions.mockResolvedValue([{...sale, sellerId: 'seller', buyerId: 'owner'}]);
  render(<MyOrders/>, {wrapper});
  await waitFor(() => expect(screen.getByText('43,10 $')).toBeTruthy());
  expect(screen.queryByText('32 $')).toBeNull();
  expect(screen.queryByText(/Renseignements enregistrés avec la commande/)).toBeNull();
});

it.each([MyOrders, MySales])('%p distinguishes a first read failure from an empty list and retries only its read', async Screen => {
  activity = 'active'; mockTransactions.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue([]);
  render(<Screen/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Consultation indisponible')).toBeTruthy());
  expect(screen.queryByText(/^Aucune (commande|vente)$/)).toBeNull();
  fireEvent.press(screen.getByText('Réessayer'));
  await waitFor(() => expect(screen.getByText(/^Aucune (commande|vente)$/)).toBeTruthy());
  expect(mockTransactions).toHaveBeenCalledTimes(2);
  expect(mockSellerCancel).not.toHaveBeenCalled();
});

it('keeps cancellation in options, stops navigation and dispatches once after its explicit confirmation', async () => {
  activity = 'active'; mockTransactions.mockResolvedValue([sale]);
  let finish!: (value: {state: string}) => void;
  mockSellerCancel.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  render(<MySales/>, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('Options de la vente Pull en coton')).toBeTruthy());
  const stopPropagation = jest.fn();
  fireEvent.press(screen.getByLabelText('Options de la vente Pull en coton'), {stopPropagation});
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(mockSellerCancel).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Demander l’annulation'));
  // A native iOS sheet finishes dismissing before presenting the confirmation.
  expect(Alert.alert).not.toHaveBeenCalled();
  act(() => {screen.UNSAFE_getByType(Modal).props.onDismiss();});
  expect(mockSellerCancel).not.toHaveBeenCalled();
  const confirm = (Alert.alert as jest.Mock).mock.calls.find(call => call[0] === 'Demander l’annulation')?.[2]?.[1];
  let pending!: Promise<void>;
  await act(async () => {pending = confirm.onPress(); await confirm.onPress();});
  expect(mockSellerCancel).toHaveBeenCalledTimes(1);
  expect(mockSellerCancel).toHaveBeenCalledWith('sale');
  await act(async () => {finish({state: 'pending'}); await pending;});
});


it.each([undefined, null, '43.10', NaN, Infinity, -1, 0])('does not crash or invent a buyer price from the malformed native total %p', async totalAmount => {
  activity = 'active';
  mockTransactions.mockResolvedValue([{...sale, sellerId: 'seller', buyerId: 'owner', totalAmount}]);
  render(<MyOrders/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Montant à vérifier')).toBeTruthy());
  expect(screen.queryByText('0 $')).toBeNull();
  expect(screen.queryByText('43,10 $')).toBeNull();
});


it('exposes sale navigation and its options as independent accessible buttons and scopes the sheet action', async () => {
  activity = 'active'; mockTransactions.mockResolvedValue([sale]);
  render(<MySales/>, {wrapper});
  const navigation = await screen.findByRole('button', {name: /^Ouvrir Pull en coton/});
  const options = screen.getByRole('button', {name: 'Options de la vente Pull en coton'});
  expect(within(navigation).queryByRole('button', {name: 'Options de la vente Pull en coton'})).toBeNull();
  fireEvent.press(options, {stopPropagation: jest.fn()});
  expect(mockPush).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Voir la commande'));
  expect(mockPush).not.toHaveBeenCalled();
  act(() => {screen.UNSAFE_getByType(Modal).props.onDismiss();});
  expect(mockPush).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'sale'}});
  expect(mockSellerCancel).not.toHaveBeenCalled();
});

it('does not act on a sale-options sheet opened before the foreground session changed', async () => {
  activity = 'active'; mockTransactions.mockResolvedValue([sale]);
  render(<MySales/>, {wrapper});
  fireEvent.press(await screen.findByRole('button', {name: 'Options de la vente Pull en coton'}), {stopPropagation: jest.fn()});
  fireEvent.press(screen.getByText('Demander l’annulation'));
  act(() => {setActivity('background');});
  act(() => {setActivity('active');});
  act(() => {screen.UNSAFE_getByType(Modal).props.onDismiss();});
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockSellerCancel).not.toHaveBeenCalled();
});

it.each([[MySales, 'seller'], [MyOrders, 'buyer']] as const)('%p exposes the review action outside the accessible navigation group', async (Screen, role) => {
  activity = 'active';
  mockTransactions.mockResolvedValue([{...sale, status: 'delivered',
    sellerId: role === 'seller' ? 'owner' : 'seller', buyerId: role === 'buyer' ? 'owner' : 'buyer'}]);
  render(<Screen/>, {wrapper});
  const navigation = await screen.findByRole('button', {name: /^Ouvrir Pull en coton/});
  const review = screen.getByRole('button', {name: 'Laisser un avis pour Pull en coton'});
  expect(within(navigation).queryByRole('button', {name: 'Laisser un avis pour Pull en coton'})).toBeNull();
  fireEvent.press(review, {stopPropagation: jest.fn()});
  expect(mockPush).toHaveBeenCalledWith('/review/sale');
});
