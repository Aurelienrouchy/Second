import React from 'react';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {AppState, type AppStateStatus} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {getDocFromServer, setDoc, updateDoc} from 'firebase/firestore';
import {queryKeys} from '@/lib/queryKeys';
import {favoritesKeys} from '@/hooks/useFavorites';
import {useAuthStore} from '@/store/authStore';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {Article} from '@/types';

let mockId = 'item', mockFocused = true;
const mockRouter = {push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true};
const mockPresent = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({id: mockId}), useRouter: () => mockRouter,
  useNavigation: () => ({isFocused: () => mockFocused}),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react'); React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);
  },
}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
// Keep real route, detail query, favorite hook, action guards and actionable CTA.
// Only unrelated visual leaves and native sheet presentation are substituted.
jest.mock('@/features/article', () => {
  const React = require('react'), {Text, View} = require('react-native');
  return {
    useArticleActions: jest.requireActual('@/features/article/hooks/useArticleActions').useArticleActions,
    ArticleCTABar: jest.requireActual('@/features/article/components/ArticleCTABar').ArticleCTABar,
    ErrorState: jest.requireActual('@/features/article/components/LoadingState').ErrorState,
    ArticleHero: () => null,
    ArticleDetails: ({article}: {article: Article}) => React.createElement(Text, {testID: 'article-title'}, article.title),
    ArticleFloatingHeader: ({isFavorite}: {isFavorite: boolean}) => React.createElement(Text, {testID: 'favorite-state'}, isFavorite ? 'favori:oui' : 'favori:non'),
    LoadingState: () => React.createElement(View, {testID: 'availability-loading'}),
    articleStyles: {}, buildTags: () => [], getDiscountPercent: () => 0,
  };
});
jest.mock('@/features/offers/components/MakeOfferModal', () => {
  const React = require('react');
  return React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {React.useImperativeHandle(ref, () => ({present: mockPresent})); return null;});
});
jest.mock('@/components/ReportBottomSheet', () => {const React = require('react'); return React.forwardRef(() => null);});
import ArticleDetailScreen from '@/app/article/[id]';

function article(id = 'item', state: 'available' | 'engaged' = 'available'): Article {
  return {id, title: `Article ${id}`, price: 20, description: 'Annonce synthétique', images: [], category: 'top', categoryIds: ['top'], condition: 'bon état',
    sellerId: 'seller', sellerName: 'Seller', createdAt: new Date('2026-11-25T18:00:00.000Z'), isActive: true, isSold: state === 'engaged',
    inventoryAvailability: {protocol: 'inventory_article_availability_v1', state}, isHandDelivery: true, isShipping: false, likes: 1, views: 0};
}
function snapshot(value: Article) {return {id: value.id, exists: () => true, data: () => value};}
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};
}
let client: QueryClient, activity: AppStateStatus;
const originalActivity = Object.getOwnPropertyDescriptor(AppState, 'currentState');
const listeners = new Set<(state: AppStateStatus) => void>();
function setActivity(next: AppStateStatus) {activity = next; for (const listener of listeners) listener(next);}
function route() {return <QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>;}
function expectNewClosed() {
  expect(screen.queryByTestId('article-buy-button')).toBeNull();
  expect(screen.queryByTestId('article-make-offer-button')).toBeNull();
  expect(screen.queryByTestId('article-propose-swap-button')).toBeNull();
  expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockPresent).not.toHaveBeenCalled();
}
function expectFavoritePreserved() {
  expect(client.getQueryData(favoritesKeys.ids('A'))).toEqual(['item']);
  expect(setDoc).not.toHaveBeenCalled(); expect(updateDoc).not.toHaveBeenCalled();
}
function retainedPress(node: ReturnType<typeof screen.getByTestId>): () => void {
  let current: typeof node | null = node;
  while (current && typeof current.props.onPress !== 'function') current = current.parent;
  expect(current).not.toBeNull(); return current!.props.onPress as () => void;
}
beforeEach(() => {
  jest.clearAllMocks(); mockId = 'item'; mockFocused = true; activity = 'active'; listeners.clear(); establishIdentityFixture('A');
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    const listener = callback as (state: AppStateStatus) => void; listeners.add(listener); return {remove: () => {listeners.delete(listener);}};
  });
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry: false}}});
  client.setQueryData(queryKeys.articles.detail('item'), article());
  client.setQueryData(favoritesKeys.ids('A'), ['item']); client.setQueryData(favoritesKeys.ids('B'), []);
  (getDocFromServer as jest.Mock).mockReset();
});
afterEach(() => {cleanup(); client.clear(); jest.restoreAllMocks(); clearIdentityFixture(); if (originalActivity) Object.defineProperty(AppState, 'currentState', originalActivity);});

it('keeps cached available content from enabling NEW before this visit reads the reserved server article, without deleting the favorite', async () => {
  const read = deferred<ReturnType<typeof snapshot>>(); (getDocFromServer as jest.Mock).mockReturnValueOnce(read.promise);
  render(route());
  expectNewClosed(); expect(screen.getByTestId('availability-loading')).toBeOnTheScreen(); expectFavoritePreserved();
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(1));
  await act(async () => {read.resolve(snapshot(article('item', 'engaged')));});
  await screen.findByText('Réservé temporairement'); expectNewClosed(); expectFavoritePreserved();
  expect(screen.getByTestId('favorite-state')).toHaveTextContent('favori:oui');
  expect(client.getQueryData<Article>(queryKeys.articles.detail('item'))?.inventoryAvailability?.state).toBe('engaged');
});

it('closes NEW on refocus while rereading a previously available visit and refuses its retained buy/offer callbacks', async () => {
  (getDocFromServer as jest.Mock).mockResolvedValueOnce(snapshot(article())); const view = render(route());
  const buy = await screen.findByTestId('article-buy-button'), offer = screen.getByTestId('article-make-offer-button');
  const oldBuy = retainedPress(buy), oldOffer = retainedPress(offer);
  mockFocused = false; view.rerender(route()); expectNewClosed();
  const read = deferred<ReturnType<typeof snapshot>>(); (getDocFromServer as jest.Mock).mockReturnValueOnce(read.promise);
  mockFocused = true; view.rerender(route()); expectNewClosed();
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(2));
  act(() => {oldBuy(); oldOffer();}); expectNewClosed();
  await act(async () => {read.resolve(snapshot(article('item', 'engaged')));});
  await screen.findByText('Réservé temporairement'); expectNewClosed(); expectFavoritePreserved();
});

it('keeps actions closed after a current server error and enables them only after an explicit successful fresh retry', async () => {
  (getDocFromServer as jest.Mock).mockRejectedValueOnce(new Error('offline')); render(route());
  await screen.findByText('Erreur de connexion'); expectNewClosed(); expectFavoritePreserved();
  const read = deferred<ReturnType<typeof snapshot>>(); (getDocFromServer as jest.Mock).mockReturnValueOnce(read.promise);
  fireEvent.press(screen.getByText('Réessayer')); expectNewClosed();
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(2));
  await act(async () => {read.resolve(snapshot(article()));});
  fireEvent.press(await screen.findByTestId('article-buy-button'));
  expect(mockRouter.push).toHaveBeenCalledTimes(1); expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/checkout', params: {articleId: 'item'}});
  expectFavoritePreserved();
});

it.each(['pending', 'error'] as const)('rejects retained NEW callbacks while a same-visit refresh is %s instead of trusting its former available data', async phase => {
  (getDocFromServer as jest.Mock).mockResolvedValueOnce(snapshot(article())); render(route());
  const oldBuy = retainedPress(await screen.findByTestId('article-buy-button'));
  const oldOffer = retainedPress(screen.getByTestId('article-make-offer-button'));
  const read = deferred<ReturnType<typeof snapshot>>();
  if (phase === 'error') (getDocFromServer as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  else (getDocFromServer as jest.Mock).mockReturnValueOnce(read.promise);
  act(() => {
    void client.invalidateQueries({queryKey: queryKeys.articles.detail('item')});
    // The cache starts fetching before its observer delivers a React render.
    if (phase === 'pending') {oldBuy(); oldOffer();}
  });
  expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockPresent).not.toHaveBeenCalled();
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(2));
  if (phase === 'error') await screen.findByText('Erreur de connexion');
  else await screen.findByTestId('availability-loading');
  try {act(() => {oldBuy(); oldOffer();}); expectNewClosed(); expectFavoritePreserved();}
  finally {if (phase === 'pending') await act(async () => {read.resolve(snapshot(article('item', 'engaged')));});}
  if (phase === 'pending') {await screen.findByText('Réservé temporairement'); expectNewClosed();}
});

it.each(['owner', 'route', 'background', 'generation'] as const)('never adopts a late available response after %s changes; current reserved content and favorites remain exact', async change => {
  const read = deferred<ReturnType<typeof snapshot>>();
  (getDocFromServer as jest.Mock).mockReturnValueOnce(read.promise).mockResolvedValueOnce(snapshot(article(change === 'route' ? 'second' : 'item', 'engaged')));
  const view = render(route()); await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(1)); expectNewClosed();
  if (change === 'owner') act(() => establishIdentityFixture('B'));
  if (change === 'route') {mockId = 'second'; view.rerender(route());}
  if (change === 'background') act(() => {setActivity('background'); setActivity('active');});
  if (change === 'generation') act(() => {useAuthStore.getState().reset(); establishIdentityFixture('A');});
  await screen.findByText('Réservé temporairement'); expect(getDocFromServer).toHaveBeenCalledTimes(2);
  await act(async () => {read.resolve(snapshot(article()));});
  expect(screen.getByText('Réservé temporairement')).toBeOnTheScreen(); expectNewClosed(); expectFavoritePreserved();
  expect(screen.getByTestId('article-title')).toHaveTextContent(change === 'route' ? 'Article second' : 'Article item');
  if (change === 'owner') expect(screen.getByTestId('favorite-state')).toHaveTextContent('favori:non');
});
