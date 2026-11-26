import React from 'react';
import {cleanup, render, screen, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {getDoc, getDocs, setDoc, updateDoc} from 'firebase/firestore';
import {favoritesKeys} from '@/hooks/useFavorites';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {Article} from '@/types';

let mockFocused = true;
jest.mock('expo-router', () => ({useRouter: () => ({push: jest.fn()}), useFocusEffect: (callback: () => void | (() => void)) => {
  const React = require('react'); React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);
}}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top: 0, left: 0, right: 0, bottom: 0})}));
// Inspect the real list query's data; card availability rendering has its own tests.
jest.mock('@/components/ProductGrid', () => {
  const React = require('react'), {View, Text} = require('react-native'), {articleAvailability} = require('@/utils/articleAvailability');
  return {__esModule: true, default: ({articles}: {articles: Article[]}) => React.createElement(View, {}, articles.map(article => React.createElement(Text, {key: article.id}, `${article.id}:${articleAvailability(article)}`)))};
});
import FavoritesScreen from '@/app/(tabs)/favorites';
import {FavoritesService} from '@/features/favorites/services/favoritesService';

it('rereads availability on return after cancellation even when favorite membership and the five-minute list cache are unchanged', async () => {
  establishIdentityFixture('A'); mockFocused = true;
  let engaged = true;
  const article = (): Article => ({id: 'item', title: 'Réservation QA', description: 'Synthétique', images: [], category: 'top', categoryIds: ['top'], condition: 'bon état',
    sellerId: 'seller', sellerName: 'Seller', price: 20, likes: 1, views: 0, createdAt: new Date('2026-11-25T18:00:00.000Z'), isActive: true, isSold: engaged,
    inventoryAvailability: {protocol: 'inventory_article_availability_v1', state: engaged ? 'engaged' : 'available'}});
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry: false}}});
  client.setQueryData(favoritesKeys.ids('A'), ['item']);
  client.setQueryData(favoritesKeys.list('A'), {pages: [{articles: [article()], nextCursor: null, orphanedCount: 0}], pageParams: [0]});
  (getDoc as jest.Mock).mockResolvedValue({exists: () => true, data: () => ({articleIds: ['item']})});
  (getDocs as jest.Mock).mockImplementation(async () => ({forEach: (visit: (doc: unknown) => void) => {visit({id: 'item', exists: () => true, data: () => article()});}}));
  const route = () => <QueryClientProvider client={client}><FavoritesScreen/></QueryClientProvider>;
  try {
    const view = render(route());
    await waitFor(() => expect(getDocs).toHaveBeenCalledTimes(1));
    expect(screen.getByText('item:reserved')).toBeOnTheScreen(); expect(screen.getByText('1 article')).toBeOnTheScreen();
    mockFocused = false; view.rerender(route()); engaged = false;
    mockFocused = true; view.rerender(route());
    await waitFor(() => expect(screen.getByText('item:available')).toBeOnTheScreen());
    expect(getDocs).toHaveBeenCalledTimes(2); expect(screen.getByText('1 article')).toBeOnTheScreen();
    expect(client.getQueryData(favoritesKeys.ids('A'))).toEqual(['item']);
    expect(updateDoc).not.toHaveBeenCalled(); expect(setDoc).not.toHaveBeenCalled();
  } finally {cleanup(); client.clear(); clearIdentityFixture();}
});

it('shows the qualified empty list instead of a stale raw-ID count and does not rewrite membership', async () => {
  establishIdentityFixture('A'); mockFocused = true;
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  client.setQueryData(favoritesKeys.ids('A'), ['old-id']);
  // The ID cache is still fresh locally; the separate list read sees the
  // already-empty server membership. No orphan cleanup or count write occurs.
  (getDoc as jest.Mock).mockResolvedValue({exists: () => true, data: () => ({articleIds: []})});
  try {
    render(<QueryClientProvider client={client}><FavoritesScreen/></QueryClientProvider>);
    await screen.findByText('Aucun favori'); expect(screen.queryByText('1 article')).toBeNull();
    expect(client.getQueryData(favoritesKeys.ids('A'))).toEqual(['old-id']);
    expect(updateDoc).not.toHaveBeenCalled(); expect(setDoc).not.toHaveBeenCalled();
  } finally {cleanup(); client.clear(); clearIdentityFixture();}
});

it('labels a loaded page as displayed items when more favorites remain, without claiming the raw total', async () => {
  establishIdentityFixture('A'); mockFocused = true;
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  client.setQueryData(favoritesKeys.ids('A'), Array.from({length: 25}, (_, index) => `item-${index}`));
  const page = Array.from({length: 20}, (_, index) => ({id: `item-${index}`, isActive: true, isSold: false} as Article));
  const read = jest.spyOn(FavoritesService, 'getUserFavoriteArticlesPaginated').mockResolvedValue({articles: page, nextCursor: 20, orphanedCount: 0});
  try {
    render(<QueryClientProvider client={client}><FavoritesScreen/></QueryClientProvider>);
    await screen.findByText('20 articles affichés'); expect(screen.queryByText('25 articles')).toBeNull();
    expect(read).toHaveBeenCalledWith('A', 0, 20); expect(client.getQueryData(favoritesKeys.ids('A'))).toHaveLength(25);
    expect(updateDoc).not.toHaveBeenCalled(); expect(setDoc).not.toHaveBeenCalled();
  } finally {cleanup(); client.clear(); read.mockRestore(); clearIdentityFixture();}
});
