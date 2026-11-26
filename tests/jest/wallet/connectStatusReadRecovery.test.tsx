import React from 'react';
import {renderHook, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {httpsCallable} from 'firebase/functions';
import {auth} from '@/config/firebaseConfig';
import {StripeAccountService} from '@/features/wallet/services/stripeAccountService';
import {useStripeAccount} from '@/features/wallet/hooks/useStripeAccount';
import * as tradeOperation from '@/services/tradeOperation';

let mockOwner = 'seller', mockGeneration = 1;
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: {getState: () => ({authenticatedUid: mockOwner})},
}));
jest.mock('@/utils/imageUtils', () => ({prepareImageForUpload: jest.fn()}));
jest.mock('expo-file-system/legacy', () => ({EncodingType: {Base64: 'base64'}, readAsStringAsync: jest.fn()}));

const staleRead = () => Object.assign(new Error('Concurrent Connect observation'), {
  code: 'functions/aborted', details: {reason: 'connect_observation_stale', action: 'getStripeAccountStatus'},
});
const currentStatus = {success: true, hasAccount: true, status: 'active', chargesEnabled: true, payoutsEnabled: true};
const mockCallable = jest.fn();
beforeEach(() => {
  mockOwner = 'seller'; mockGeneration = 1;
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'seller'};
  jest.mocked(httpsCallable).mockReturnValue(mockCallable);
  mockCallable.mockReset();
});

it('rereads only the stale GET under the same owner, preserving the explicit inventory request', async () => {
  mockCallable.mockRejectedValueOnce(staleRead()).mockResolvedValueOnce({data: currentStatus});
  await expect(StripeAccountService.getAccountStatus('seller', undefined, {includeBankAccounts: true})).resolves.toEqual(currentStatus);
  expect(mockCallable.mock.calls).toEqual([[{includeBankAccounts: true}], [{includeBankAccounts: true}]]);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getStripeAccountStatus');
});

it.each(['another-owner', 'same-owner-new-session'])('never starts the reread after %s', async change => {
  mockCallable.mockImplementationOnce(async () => {
    if (change === 'another-owner') {mockOwner = 'other'; (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'other'};}
    else mockGeneration++;
    throw staleRead();
  });
  await expect(StripeAccountService.getAccountStatus('seller')).rejects.toMatchObject({code: 'client/stale-operation'});
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

it('does not reread after leaving the route during the bounded delay', async () => {
  let current = true;
  mockCallable.mockRejectedValue(staleRead());
  const pending = StripeAccountService.getAccountStatus('seller', () => {if (!current) throw new Error('Route closed');});
  const outcome = pending.catch((error: unknown) => error);
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  current = false;
  expect(await outcome).toEqual(new Error('Route closed'));
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

it.each([
  {code: 'functions/permission-denied', details: {reason: 'connect_observation_stale', action: 'getStripeAccountStatus'}},
  {code: 'functions/aborted', details: {reason: 'other_reason', action: 'getStripeAccountStatus'}},
  {code: 'functions/aborted', details: {reason: 'connect_observation_stale', action: 'addBankAccount'}},
])('preserves a current error that is not the exact retriable observation: %j', async fields => {
  const error = Object.assign(new Error('Current account failure'), fields);
  mockCallable.mockRejectedValue(error);
  await expect(StripeAccountService.getAccountStatus('seller')).rejects.toBe(error);
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

it('keeps the hook recovery bounded to three GETs and gives a useful error after exhaustion', async () => {
  mockCallable.mockRejectedValue(staleRead());
  const onError = jest.fn();
  const client = new QueryClient({queryCache: new QueryCache({onError}), defaultOptions: {queries: {gcTime: 0, retry: 2}}});
  const {result, unmount} = renderHook(() => useStripeAccount('seller'), {
    wrapper: ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(mockCallable).toHaveBeenCalledTimes(3);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].message).toBe('Impossible d’actualiser votre compte pour le moment. Réessayez.');
  unmount(); client.clear();
});

it('never retries a bank mutation, even if it returns that same observation error', async () => {
  const error = staleRead();
  mockCallable.mockRejectedValue(error);
  await expect(StripeAccountService.replaceBankAccount({requestId: 'delete_request', mode: 'delete_existing', bankAccountId: 'ba_old'}, 'seller')).rejects.toBe(error);
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'addBankAccount');
});

it('does not let a normal React Query retry capture a new login session', async () => {
  mockCallable.mockRejectedValue(new Error('Temporary network failure'));
  const guard = jest.spyOn(tradeOperation, 'assertTradeSessionCurrent');
  const onError = jest.fn();
  const client = new QueryClient({queryCache: new QueryCache({onError}), defaultOptions: {queries: {gcTime: 0, retry: 2, retryDelay: 60}}});
  const {unmount} = renderHook(() => useStripeAccount('seller'), {
    wrapper: ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.fetchFailureCount).toBe(1));
  const initialGuardCalls = guard.mock.calls.length;
  mockGeneration++;
  await waitFor(() => expect(guard.mock.calls.length).toBeGreaterThan(initialGuardCalls));
  expect(guard.mock.calls.at(-1)?.[0]).toEqual({uid: 'seller', generation: 1});
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
  unmount(); client.clear(); guard.mockRestore();
});
