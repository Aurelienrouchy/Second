import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {useSwapDepositArticles} from '@/features/swap/hooks/useSwapDepositArticles';
import {queryKeys} from '@/lib/queryKeys';
import type {Article} from '@/types';

const mockReadArticles = jest.fn();
let mockFocused = true;
let mockRevision = '1';
let mockGeneration = 1;
jest.mock('@/services/articlesService', () => ({ArticlesService: {
  getUserArticles: (...args: unknown[]) => mockReadArticles(...args),
}}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => mockGeneration}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({
  focused: mockFocused,
  focusRevision: mockRevision,
  capture: () => ({revision: mockRevision, generation: mockGeneration}),
  assertCurrent: (operation: {revision: string; generation: number}) => {
    if (!mockFocused || operation.revision !== mockRevision || operation.generation !== mockGeneration)
      throw new Error('Previous inventory context');
  },
})}));

const shippingOnly = {id: 'new-shirt', sellerId: 'owner', title: 'Nouvelle chemise', isActive: true,
  isSold: false, isHandDelivery: false, isShipping: true} as Article;
const readError = jest.fn();
let client: QueryClient;
function Wrapper({children}: {children: React.ReactNode}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mockFocused = true; mockRevision = '1'; mockGeneration = 1;
  mockReadArticles.mockReset().mockResolvedValue([]);
  client = new QueryClient({queryCache: new QueryCache({onError: readError}), defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
});
afterEach(() => client.clear());

it('reloads a cached empty wardrobe immediately on reopening after publication', async () => {
  const hook = renderHook(({opened}) => useSwapDepositArticles('owner', opened), {initialProps: {opened: true}, wrapper: Wrapper});
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data).toEqual([]);
  hook.rerender({opened: false});
  mockReadArticles.mockResolvedValue([shippingOnly]);
  hook.rerender({opened: true});
  await waitFor(() => expect(hook.result.current.data).toEqual([shippingOnly]));
  expect(mockReadArticles).toHaveBeenCalledTimes(2);
});

it('does not read while closed, then reads when opened without waiting for a shared fresh empty cache', async () => {
  client.setQueryData(queryKeys.articles.userList('owner'), []);
  const hook = renderHook(({opened}) => useSwapDepositArticles('owner', opened), {initialProps: {opened: false}, wrapper: Wrapper});
  expect(mockReadArticles).not.toHaveBeenCalled();
  mockReadArticles.mockResolvedValue([shippingOnly]);
  hook.rerender({opened: true});
  await waitFor(() => expect(hook.result.current.data).toEqual([shippingOnly]));
});

it('cancels an old inventory read when leaving and uses the current list on return', async () => {
  let finish!: (articles: Article[]) => void;
  mockReadArticles.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const hook = renderHook(() => useSwapDepositArticles('owner', true), {wrapper: Wrapper});
  await waitFor(() => expect(mockReadArticles).toHaveBeenCalledTimes(1));
  mockFocused = false; mockRevision = '2';
  hook.rerender({});
  await act(async () => finish([]));
  expect(readError).not.toHaveBeenCalled();
  mockReadArticles.mockResolvedValue([shippingOnly]);
  mockFocused = true; mockRevision = '3';
  hook.rerender({});
  await waitFor(() => expect(hook.result.current.data).toEqual([shippingOnly]));
});

it('does not adopt the previous member’s delayed wardrobe after changing account', async () => {
  let finish!: (articles: Article[]) => void;
  mockReadArticles.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const hook = renderHook(({uid}) => useSwapDepositArticles(uid, true), {initialProps: {uid: 'previous-owner'}, wrapper: Wrapper});
  await waitFor(() => expect(mockReadArticles).toHaveBeenCalledTimes(1));
  mockGeneration = 2;
  mockReadArticles.mockResolvedValue([]);
  hook.rerender({uid: 'owner'});
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => finish([{...shippingOnly, sellerId: 'previous-owner'}]));
  expect(hook.result.current.data).toEqual([]);
  expect(readError).not.toHaveBeenCalled();
});
