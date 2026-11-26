import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {WalletInfo} from '@/types/wallet';

let mockUid = 'seller', mockCurrent = true;
const mockInfo = jest.fn(), mockWithdrawals = jest.fn();
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => mockUid}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/services/tradeOperation', () => ({assertTradeSessionCurrent: ({uid}: {uid: string}) => {
  if (uid !== mockUid) throw new Error('account changed');
}}));
jest.mock('@/features/wallet/services/walletService', () => ({WalletService: {
  getWalletInfo: (...args: unknown[]) => mockInfo(...args), getWithdrawalRequests: (...args: unknown[]) => mockWithdrawals(...args),
}}));

import {useWallet} from '@/features/wallet/hooks/useWallet';

const wallet: WalletInfo = {hasWallet: true, balance: 3200, pendingBalance: 0, status: 'active', ledger: []};
const assertContext = () => {if (!mockCurrent) throw new Error('La page a changé.');};
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
function environment() {
  const onError = jest.fn(), client = new QueryClient({queryCache: new QueryCache({onError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return {client, onError, wrapper: ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>};
}
beforeEach(() => {mockUid = 'seller'; mockCurrent = true; mockInfo.mockReset(); mockWithdrawals.mockReset(); mockWithdrawals.mockResolvedValue([]);});

it('silently cancels a wallet response invalidated by leaving the page, then reads afresh on return', async () => {
  const old = deferred<WalletInfo>(), env = environment();
  mockInfo.mockReturnValueOnce(old.promise).mockResolvedValue(wallet);
  const hook = renderHook(({active, focus}) => useWallet(active, 'seller', assertContext, focus),
    {initialProps: {active: true, focus: 1}, wrapper: env.wrapper});
  await waitFor(() => expect(mockInfo).toHaveBeenCalledTimes(1));
  mockCurrent = false;
  hook.rerender({active: false, focus: 1});
  await act(async () => {old.resolve(wallet);});
  expect(env.onError).not.toHaveBeenCalled();
  expect(hook.result.current.isError).toBe(false);
  mockCurrent = true;
  hook.rerender({active: true, focus: 2});
  await waitFor(() => expect(hook.result.current.wallet?.balance).toBe(3200));
  expect(mockInfo).toHaveBeenCalledTimes(2);
  env.client.clear();
});

it('does not suppress a current wallet permission failure or send a replacement request', async () => {
  const env = environment(), error = new Error('wallet permission denied');
  mockInfo.mockRejectedValue(error);
  const hook = renderHook(() => useWallet(true, 'seller', assertContext, 1), {wrapper: env.wrapper});
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(env.onError).toHaveBeenCalledWith(error, expect.anything());
  expect(mockInfo).toHaveBeenCalledTimes(1);
  env.client.clear();
});

it('never adopts an old owner wallet response or retries it under the next account', async () => {
  const old = deferred<WalletInfo>(), env = environment();
  mockInfo.mockReturnValueOnce(old.promise).mockResolvedValue({...wallet, balance: 100});
  const hook = renderHook(({owner}) => useWallet(true, owner, assertContext, 1), {initialProps: {owner: 'seller'}, wrapper: env.wrapper});
  await waitFor(() => expect(mockInfo).toHaveBeenCalledTimes(1));
  mockUid = 'other'; hook.rerender({owner: 'other'});
  await act(async () => {old.resolve(wallet);});
  await waitFor(() => expect(hook.result.current.wallet?.balance).toBe(100));
  expect(mockInfo.mock.calls.map(call => call[0])).toEqual(['seller', 'other']);
  expect(env.onError).not.toHaveBeenCalled();
  env.client.clear();
});
