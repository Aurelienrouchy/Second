import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

let mockImageUri = 'file:///search-photo.jpg';
let mockFocused = true;
let mockGeneration = 1;
let mockOwner: {uid: string} | null = {uid: 'member'};
const mockPush = jest.fn();
const mockSearchByImage = jest.fn();

jest.mock('expo-router', () => ({
  router: {push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn()},
  useLocalSearchParams: () => ({imageUri: mockImageUri}),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);
  },
}));
jest.mock('@/config/firebaseConfig', () => ({auth: {get currentUser() {return mockOwner;}}}));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: (select: () => unknown) => select(),
}));
jest.mock('@/services/tradeOperation', () => ({staleTradeOperation: () => new Error('stale operation')}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/features/search/services/visualSearchService', () => ({
  searchByImage: (...args: unknown[]) => mockSearchByImage(...args),
  isVisualSearchImageUri: (uri: string) => uri.startsWith('file:///'),
  captureVisualSearchOwner: () => {
    const owner = mockOwner;
    const uid = owner?.uid ?? null;
    const generation = mockGeneration;
    return () => {
      if (mockOwner !== owner || (mockOwner?.uid ?? null) !== uid || mockGeneration !== generation) {
        throw new Error('stale owner');
      }
    };
  },
}));
jest.mock('@/components/ProductCard', () => {
  const React = require('react');
  const {Pressable, Text} = require('react-native');
  return ({product, onPress}: {product: {title: string}; onPress: () => void}) =>
    React.createElement(Pressable, {onPress}, React.createElement(Text, null, product.title));
});
jest.mock('@/components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {FlashList: ({data, renderItem, ListHeaderComponent}: {
    data: Array<{articleId: string}>;
    renderItem: (props: {item: {articleId: string}}) => React.ReactNode;
    ListHeaderComponent: () => React.ReactNode;
  }) => React.createElement(View, null, React.createElement(ListHeaderComponent),
    data.map(item => React.createElement(React.Fragment, {key: item.articleId}, renderItem({item}))))};
});
jest.mock('react-native-safe-area-context', () => {
  const {View} = require('react-native');
  return {SafeAreaView: View};
});

import VisualSearchResultsScreen from '@/app/visual-search-results';

const RESULT = {articleId: 'coat', title: 'Manteau similaire', price: 30, imageUrl: '', condition: 'tres_bon_etat', similarity: 91};
let onActivityChange: (state: AppStateStatus) => void;

beforeEach(() => {
  mockImageUri = 'file:///search-photo.jpg';
  mockFocused = true;
  mockGeneration = 1;
  mockOwner = {uid: 'member'};
  mockSearchByImage.mockReset().mockResolvedValue([RESULT]);
  mockPush.mockReset();
  Object.defineProperty(AppState, 'currentState', {configurable: true, writable: true, value: 'active'});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onActivityChange = listener;
    return {remove: jest.fn()};
  });
});

afterEach(() => jest.restoreAllMocks());

it.each(['member', 'guest'])('préserve les résultats au retour de fiche pour %s sans nouvelle analyse', async (mode) => {
  if (mode === 'guest') mockOwner = null;
  const screen = render(<VisualSearchResultsScreen />);
  fireEvent.press(await screen.findByText(RESULT.title));
  expect(mockPush).toHaveBeenCalledWith('/article/coat');
  mockFocused = false;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);
  mockFocused = true;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);

  expect(screen.getByText(RESULT.title)).toBeOnTheScreen();
  expect(screen.queryByText(/La recherche a été interrompue/)).toBeNull();
  expect(mockSearchByImage).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText(RESULT.title));
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it.each(['owner', 'generation', 'activity'])('invalide le succès après changement de %s et attend une reprise explicite', async (change) => {
  const screen = render(<VisualSearchResultsScreen />);
  await screen.findByText(RESULT.title);
  mockFocused = false;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);
  if (change === 'owner') mockOwner = {uid: 'another-member'};
  if (change === 'generation') mockGeneration++;
  if (change === 'activity') {
    act(() => {
      Object.defineProperty(AppState, 'currentState', {value: 'background'});
      onActivityChange('background');
    });
    act(() => {
      Object.defineProperty(AppState, 'currentState', {value: 'active'});
      onActivityChange('active');
    });
  }
  mockFocused = true;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);

  expect(screen.queryByText(RESULT.title)).toBeNull();
  expect(screen.getByText(/La recherche a été interrompue/)).toBeOnTheScreen();
  expect(mockSearchByImage).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Réessayer'));
  await screen.findByText(RESULT.title);
  expect(mockSearchByImage).toHaveBeenCalledTimes(2);
});

it('ne réutilise pas les résultats de la photo précédente pendant une nouvelle recherche', async () => {
  const screen = render(<VisualSearchResultsScreen />);
  await screen.findByText(RESULT.title);
  mockSearchByImage.mockResolvedValueOnce([]);
  mockImageUri = 'file:///another-photo.jpg';
  await screen.rerenderAsync(<VisualSearchResultsScreen />);

  await screen.findByText('Aucun produit similaire trouvé');
  expect(screen.queryByText(RESULT.title)).toBeNull();
  expect(mockSearchByImage).toHaveBeenNthCalledWith(2, mockImageUri, undefined, 20, expect.any(Object));
});

it('efface le succès si la photo change hors focus, même si la photo initiale revient ensuite', async () => {
  const screen = render(<VisualSearchResultsScreen />);
  await screen.findByText(RESULT.title);
  mockFocused = false;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);
  mockImageUri = 'file:///another-photo.jpg';
  await screen.rerenderAsync(<VisualSearchResultsScreen />);
  mockImageUri = 'file:///search-photo.jpg';
  mockFocused = true;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);

  expect(screen.queryByText(RESULT.title)).toBeNull();
  expect(screen.getByText(/La recherche a été interrompue/)).toBeOnTheScreen();
  expect(mockSearchByImage).toHaveBeenCalledTimes(1);
});

it('rejette une analyse terminée hors focus puis ne relance rien sans appui sur Réessayer', async () => {
  let finishSearch!: (results: typeof RESULT[]) => void;
  mockSearchByImage.mockImplementationOnce(() => new Promise(resolve => {finishSearch = resolve;}));
  const screen = render(<VisualSearchResultsScreen />);
  await waitFor(() => expect(mockSearchByImage).toHaveBeenCalledTimes(1));
  mockFocused = false;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);
  await act(async () => finishSearch([RESULT]));
  mockFocused = true;
  await screen.rerenderAsync(<VisualSearchResultsScreen />);

  expect(screen.queryByText(RESULT.title)).toBeNull();
  expect(screen.getByText(/La recherche a été interrompue/)).toBeOnTheScreen();
  expect(mockSearchByImage).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Réessayer'));
  await screen.findByText(RESULT.title);
  expect(mockSearchByImage).toHaveBeenCalledTimes(2);
});
