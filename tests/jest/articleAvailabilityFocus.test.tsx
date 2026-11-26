import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {getDoc, getDocFromServer} from 'firebase/firestore';
import {auth} from '@/config/firebaseConfig';
import {queryKeys} from '@/lib/queryKeys';
import {articleAvailability} from '@/utils/articleAvailability';
import type {Article} from '@/types';

let mockUid: string | null = 'A';
let mockGeneration = 1;
let mockFocused = true;
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: {authenticatedUid: string | null}) => unknown) => selector({authenticatedUid: mockUid}), {
    getState: () => ({authenticatedUid: mockUid}),
  }),
}));
jest.mock('expo-router', () => ({useFocusEffect: (callback: () => void | (() => void)) => {
  const ReactModule = require('react') as typeof React;
  ReactModule.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);
}}));
import {useArticleDetail} from '@/features/article/hooks/useArticleDetail';

function article(id: string, state: 'available' | 'engaged' | 'consumed' = 'available'): Article {
  return {id, title: id, price: 20, description: 'QA', images: [], category: 'top', categoryIds: ['top'],
    condition: 'bon état', sellerId: 'seller', sellerName: 'Seller', createdAt: new Date(), isActive: true,
    isSold: state !== 'available', inventoryAvailability: {protocol: 'inventory_article_availability_v1', state}, likes: 0, views: 0};
}
function snapshot(value: Article) { return {id: value.id, exists: () => true, data: () => value}; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
let client: QueryClient;
function wrapper({children}: {children: React.ReactNode}) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(() => {
  jest.clearAllMocks(); mockUid = 'A'; mockGeneration++; mockFocused = true;
  (auth as unknown as {currentUser: {uid: string} | null}).currentUser = {uid: 'A'};
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear();});

it('ignores cached availability until a fresh native server read qualifies this visit', async () => {
  client.setQueryData(queryKeys.articles.detail('item'), article('item'));
  const pending = deferred<ReturnType<typeof snapshot>>();
  (getDocFromServer as jest.Mock).mockImplementationOnce(() => pending.promise);
  const {result} = renderHook(() => useArticleDetail('item'), {wrapper});
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(1));
  expect(result.current.data).toBeUndefined(); expect(result.current.isFetching).toBe(true);
  await act(async () => {pending.resolve(snapshot(article('item', 'engaged')));});
  await waitFor(() => expect(result.current.data?.id).toBe('item'));
  expect(articleAvailability(result.current.data!)).toBe('reserved'); expect(getDoc).not.toHaveBeenCalled();
});
it('refocus reads availability again and does not reuse the previous available visit', async () => {
  (getDocFromServer as jest.Mock).mockResolvedValueOnce(snapshot(article('item')));
  const {result, rerender} = renderHook(() => useArticleDetail('item'), {wrapper});
  await waitFor(() => expect(result.current.data?.isSold).toBe(false));
  mockFocused = false; rerender({}); await waitFor(() => expect(result.current.focused).toBe(false));
  const pending = deferred<ReturnType<typeof snapshot>>();
  (getDocFromServer as jest.Mock).mockImplementationOnce(() => pending.promise);
  mockFocused = true; rerender({});
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(2));
  expect(result.current.data).toBeUndefined(); expect(result.current.isFetching).toBe(true);
  await act(async () => {pending.resolve(snapshot(article('item', 'engaged')));});
  await waitFor(() => expect(articleAvailability(result.current.data!)).toBe('reserved'));
});
it('a current server failure remains an error instead of restoring cached availability', async () => {
  client.setQueryData(queryKeys.articles.detail('item'), article('item'));
  (getDocFromServer as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  const {result} = renderHook(() => useArticleDetail('item'), {wrapper});
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined(); expect(getDoc).not.toHaveBeenCalled();
});
it('a late previous route response cannot replace the newly focused article', async () => {
  const pending = deferred<ReturnType<typeof snapshot>>();
  (getDocFromServer as jest.Mock).mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(snapshot(article('second')));
  const {result, rerender} = renderHook(({id}: {id: string}) => useArticleDetail(id), {initialProps: {id: 'first'}, wrapper});
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(1));
  const oldKey = result.current.queryKey;
  rerender({id: 'second'});
  await waitFor(() => expect(result.current.data?.id).toBe('second'));
  await act(async () => {pending.resolve(snapshot(article('first', 'engaged')));});
  expect(result.current.data?.id).toBe('second'); expect(client.getQueryData(oldKey)).toBeUndefined();
});
it('rejects a same-UID generation change before its late read can hydrate any visit', async () => {
  const pending = deferred<ReturnType<typeof snapshot>>();
  (getDocFromServer as jest.Mock).mockImplementationOnce(() => pending.promise);
  const {result} = renderHook(() => useArticleDetail('item'), {wrapper});
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(1));
  const oldKey = result.current.queryKey; mockGeneration++;
  await act(async () => {pending.resolve(snapshot(article('item')));});
  expect(client.getQueryData(oldKey)).toBeUndefined(); expect(result.current.data).toBeUndefined();
});

it.each(['owner', 'sdk-only'] as const)('rejects a late read after %s changes even before React receives a new render', async change => {
  const pending = deferred<ReturnType<typeof snapshot>>();
  (getDocFromServer as jest.Mock).mockImplementationOnce(() => pending.promise);
  const {result} = renderHook(() => useArticleDetail('item'), {wrapper});
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(1)); const oldKey = result.current.queryKey;
  if (change === 'owner') mockUid = 'B';
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'B'};
  await act(async () => {pending.resolve(snapshot(article('item')));});
  expect(client.getQueryData(oldKey)).toBeUndefined(); expect(result.current.data).toBeUndefined();
});

it('keeps the fresh public server read available to a guest without requiring an account', async () => {
  mockUid = null; (auth as unknown as {currentUser: null}).currentUser = null;
  (getDocFromServer as jest.Mock).mockResolvedValueOnce(snapshot(article('item')));
  const {result} = renderHook(() => useArticleDetail('item'), {wrapper});
  await waitFor(() => expect(result.current.data?.id).toBe('item'));
  expect(result.current.focused).toBe(true); expect(articleAvailability(result.current.data!)).toBe('available');
  expect(getDoc).not.toHaveBeenCalled();
});
