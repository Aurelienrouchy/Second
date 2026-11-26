import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionService } from '@/services/transactionService';
import type { Transaction } from '@/types/transaction';
import { useOfferTransaction } from './useOfferTransaction';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {AppState} from 'react-native';

jest.mock('expo-router', () => ({useFocusEffect: (callback: () => () => void) => {
  const React = require('react'); React.useEffect(callback, [callback]);
}}));

jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'user-1', user: {id: 'user-1'}}))};
});

jest.mock('@/services/transactionService', () => ({TransactionService: {
  getTransactionForOffer: jest.fn(), subscribeToTransaction: jest.fn(() => jest.fn()),
}}));
const read = TransactionService.getTransactionForOffer as jest.Mock;
const baseParams = {status: 'accepted' as 'accepted' | 'pending', isMeetupOffer: false, chatId: 'chat-1', currentUserId: 'user-1', messageId: 'message'};
const tx = (overrides: Partial<Transaction> = {}): Transaction => ({id: 'tx-42', status: 'pending_payment', buyerId: 'user-1', sellerId: 'seller', chatId: 'chat-1', offerMessageId: 'message', articleId: 'article', amount: 50, totalAmount: 50, shippingCost: 0, deliveryType: 'shipping', createdAt: new Date(), ...overrides});
const proof = (transaction: Transaction | null, extra = {}) => ({transaction, canStartCheckout: transaction === null, ambiguous: false, ...extra});
let client: QueryClient;
const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'user-1'};
  useAuthStore.setState({authenticatedUid: 'user-1', user: {id: 'user-1'} as never});
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}}); read.mockReset();
});
afterEach(() => {client.clear();});

it('does not propose a refunded agreement as payment of this offer (original red case)', async () => {
  read.mockResolvedValue(proof(tx({id: 'refunded-old', status: 'refunded'})));
  const {result} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.transactionId).toBeNull();
  expect(result.current.blocked).toBe(true);
});
it('immediately clears the old ID when accepted changes to pending (original red case)', async () => {
  read.mockResolvedValue(proof(tx()));
  const {result, rerender} = renderHook((props: Parameters<typeof useOfferTransaction>[0]) => useOfferTransaction(props), {initialProps: baseParams, wrapper});
  await waitFor(() => expect(result.current.transactionId).toBe('tx-42'));
  rerender({...baseParams, status: 'pending'});
  expect(result.current.transactionId).toBeNull();
});
it.each([{...baseParams, status: 'pending' as const}, {...baseParams, isMeetupOffer: true}])('does not query an inactive or cash offer', params => {
  renderHook(() => useOfferTransaction(params), {wrapper});
  expect(read).not.toHaveBeenCalled();
});
it('loads only the proven offer binding, including message identity', async () => {
  read.mockResolvedValue(proof(tx()));
  const {result} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  await waitFor(() => expect(result.current.transactionId).toBe('tx-42'));
  expect(read).toHaveBeenCalledWith('chat-1', 'user-1', 'message', undefined);
});
it('waits as seller for the native message link, then reads and observes that exact order', async () => {
  read.mockResolvedValue(proof(tx({buyerId: 'buyer', sellerId: 'user-1'})));
  const initial = {...baseParams, sellerId: 'user-1', linkedTransactionId: undefined as string | undefined};
  const {result, rerender} = renderHook((props: typeof initial) => useOfferTransaction(props), {initialProps: initial, wrapper});
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(read).not.toHaveBeenCalled(); expect(result.current.canStartCheckout).toBe(false);
  rerender({...initial, linkedTransactionId: 'tx-42'});
  await waitFor(() => expect(result.current.transaction?.id).toBe('tx-42'));
  expect(read).toHaveBeenCalledWith('chat-1', 'user-1', 'message', 'tx-42');
  expect(result.current.transactionId).toBeNull(); expect(result.current.canStartCheckout).toBe(false);
  expect(TransactionService.subscribeToTransaction).toHaveBeenCalledWith('tx-42', expect.any(Function), expect.any(Function));
  read.mockResolvedValue(proof(tx({buyerId: 'buyer', sellerId: 'user-1', status: 'label_created', shipEngineLabelId: 'label'})));
  const subscription = (TransactionService.subscribeToTransaction as jest.Mock).mock.calls.at(-1);
  await act(async () => {subscription![1]();});
  await waitFor(() => expect(result.current.transaction?.status).toBe('label_created'));
  expect(result.current.transactionId).toBeNull();
});
it('keeps a paid order accessible for tracking without offering another payment', async () => {
  read.mockResolvedValue(proof(tx({status: 'paid'})));
  const {result} = renderHook(() => useOfferTransaction({...baseParams, linkedTransactionId: 'tx-42'}), {wrapper});
  await waitFor(() => expect(result.current.transaction?.id).toBe('tx-42'));
  expect(result.current.transactionId).toBeNull(); expect(result.current.canStartCheckout).toBe(false);
});
it('permits a first checkout only after a successful no-agreement proof', async () => {
  read.mockResolvedValue(proof(null));
  const {result} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  await waitFor(() => expect(result.current.canStartCheckout).toBe(true));
  expect(result.current.transactionId).toBeNull();
});
it('exposes read failure and never interprets it as no agreement/new checkout', async () => {
  read.mockRejectedValue(new Error('network down'));
  const {result} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.transactionId).toBeNull();
  expect(result.current.canStartCheckout).toBe(false);
});
it('has no stale ID after unmount before the response', async () => {
  let resolve!: (value: ReturnType<typeof proof>) => void;
  read.mockReturnValue(new Promise(res => {resolve = res;}));
  const {result, unmount} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  unmount();
  await act(async () => {resolve(proof(tx())); await Promise.resolve();});
  expect(result.current.transactionId).toBeNull();
});
it('isolates private identity across chat/account changes before the new response', async () => {
  read.mockResolvedValueOnce(proof(tx())).mockReturnValue(new Promise(() => {}));
  const {result, rerender} = renderHook((props: Parameters<typeof useOfferTransaction>[0]) => useOfferTransaction(props), {initialProps: baseParams, wrapper});
  await waitFor(() => expect(result.current.transactionId).toBe('tx-42'));
  act(() => {
    (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'user-2'};
    useAuthStore.setState({authenticatedUid: 'user-2', user: {id: 'user-2'} as never});
  });
  rerender({...baseParams, chatId: 'chat-2', currentUserId: 'user-2'});
  expect(result.current.transactionId).toBeNull();
  await waitFor(() => expect(read).toHaveBeenLastCalledWith('chat-2', 'user-2', 'message', undefined));
});
it.each([tx({refundBlocked: true}), tx({bankDispute: {id: 'dp', state: 'open'}}), tx({offerMessageId: 'another-offer'})])('does not expose an independently blocked or mismatched purchase', async blocked => {
  read.mockResolvedValue(proof(blocked));
  const {result} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.transactionId).toBeNull();
  expect(result.current.blocked).toBe(true);
});

it('locks a first payment navigation and rejects a callback from a previous account', async () => {
  read.mockResolvedValue(proof(tx()));
  const {result} = renderHook(() => useOfferTransaction(baseParams), {wrapper});
  await waitFor(() => expect(result.current.transactionId).toBe('tx-42'));
  expect(result.current.beginPayment()).toBeTruthy();
  expect(result.current.beginPayment()).toBeNull();
  const oldPress = result.current.beginPayment;
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'user-2'};
  expect(oldPress).toThrow();
});
