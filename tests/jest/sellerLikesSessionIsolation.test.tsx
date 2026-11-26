import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {queryKeys} from '@/lib/queryKeys';
import {useAuthStore} from '@/store/authStore';
import {useSellerLikes} from '@/features/home/featured-sellers/useSellerLikes';

const mockToggle = jest.fn();
jest.mock('firebase/functions', () => ({httpsCallable: () => (...args: unknown[]) => mockToggle(...args)}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual('zustand');
  const store = create(() => ({authenticatedUid: 'owner-a', generation: 1}));
  return {useAuthStore: store, getAuthSessionGeneration: () => store.getState().generation};
});
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));

const clients: QueryClient[] = [];
function session(uid: string, generation: number) {
  Object.defineProperty(auth, 'currentUser', {value: {uid}, writable: true, configurable: true});
  useAuthStore.setState({authenticatedUid: uid, generation} as never);
}
function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry: false, gcTime: Infinity}}});
  clients.push(client);
  client.setQueryData(queryKeys.sellers.likedIds('owner-a'), ['seller']);
  client.setQueryData(queryKeys.sellers.liked('owner-a'), [{id: 'seller'}]);
  client.setQueryData(queryKeys.sellers.likedIds('owner-b'), ['other-seller']);
  client.setQueryData(queryKeys.sellers.liked('owner-b'), [{id: 'other-seller'}]);
  const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useSellerLikes('owner-a'), {wrapper});
  return {client, ...hook};
}
beforeEach(() => {jest.clearAllMocks(); session('owner-a', 1);});
afterEach(() => {clients.splice(0).forEach(client => client.clear());});

it('stops before optimistic writes and RPC if the account changes during query cancellation', async () => {
  const {client, result} = setup();
  let finish!: () => void;
  jest.spyOn(client, 'cancelQueries').mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  act(() => result.current.toggleLike('seller'));
  await waitFor(() => expect(client.cancelQueries).toHaveBeenCalledTimes(1));
  await act(async () => {session('owner-b', 2); finish();});
  await waitFor(() => expect(result.current.isToggling).toBe(false));
  expect(mockToggle).not.toHaveBeenCalled();
  expect(client.getQueryData(queryKeys.sellers.likedIds('owner-a'))).toEqual(['seller']);
  expect(client.getQueryData(queryKeys.sellers.likedIds('owner-b'))).toEqual(['other-seller']);
});

it('does not roll back or invalidate the new account when an old RPC fails', async () => {
  const {client, result} = setup();
  let fail!: (error: Error) => void;
  mockToggle.mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}));
  act(() => result.current.toggleLike('seller'));
  await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
  expect(client.getQueryData(queryKeys.sellers.likedIds('owner-a'))).toEqual([]);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => {session('owner-b', 2); fail(new Error('late network failure'));});
  await waitFor(() => expect(result.current.isToggling).toBe(false));
  expect(client.getQueryData(queryKeys.sellers.likedIds('owner-a'))).toEqual([]);
  expect(client.getQueryData(queryKeys.sellers.likedIds('owner-b'))).toEqual(['other-seller']);
  expect(invalidate).not.toHaveBeenCalled();
});

it('sends one explicit follow state for a double tap and restores the current account on failure', async () => {
  const {client, result} = setup();
  let fail!: (error: Error) => void;
  mockToggle.mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}));
  act(() => {result.current.toggleLike('seller'); result.current.toggleLike('seller');});
  await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
  expect(mockToggle).toHaveBeenCalledWith({sellerId: 'seller', isLiked: false});
  await act(async () => {fail(new Error('network failure'));});
  await waitFor(() => expect(result.current.isToggling).toBe(false));
  expect(client.getQueryData(queryKeys.sellers.likedIds('owner-a'))).toEqual(['seller']);
});
