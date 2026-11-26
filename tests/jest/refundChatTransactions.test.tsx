import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { useChatTransactions } from '@/hooks/useChatTransactions';
import { TransactionService } from '@/services/transactionService';
import type { Transaction } from '@/types/transaction';

const makeTx = (id: string, status: Transaction['status'] = 'return_requested'): Transaction => ({id, status, articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', amount: 40, shippingCost: 0, totalAmount: 40, deliveryType: 'shipping', createdAt: new Date('2026-10-01'), returnLabelUrl: 'https://example.test/return.pdf'});
let latest: Transaction = makeTx('latest');
let onLatest: (() => void) | undefined;
let onSelected: (() => void) | undefined;
let appActive: ((state: string) => void) | undefined;
let stops: jest.Mock[];
let client: QueryClient;
const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  establishIdentityFixture('buyer');
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  stops = [];
  latest = makeTx('latest');
  jest.spyOn(TransactionService, 'getTransactionByChat').mockImplementation(async () => latest);
  jest.spyOn(TransactionService, 'getChatTransaction').mockImplementation(async id => makeTx(id));
  jest.spyOn(TransactionService, 'getChatTransactionsPage').mockResolvedValue({transactions: [makeTx('old')], cursor: {buyer: null, seller: null}, hasMore: false});
  jest.spyOn(TransactionService, 'subscribeToLatestChatTransaction').mockImplementation((_chat, _uid, change) => {onLatest = change; const stop = jest.fn(); stops.push(stop); return stop;});
  jest.spyOn(TransactionService, 'subscribeToTransaction').mockImplementation((_id, change) => {onSelected = change; const stop = jest.fn(); stops.push(stop); return stop;});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {appActive = cb as (state: string) => void; return {remove: jest.fn()};});
});
afterEach(() => {jest.restoreAllMocks(); client.clear(); clearIdentityFixture();});

it('finds the default latest outside the loaded ID history page, without notification', async () => {
  latest = makeTx('chronologically-newest-outside-first-50');
  jest.spyOn(TransactionService, 'getChatTransactionsPage').mockResolvedValue({transactions: Array.from({length: 50}, (_, index) => ({...makeTx(`older-${index}`), createdAt: new Date('2026-09-01')})), cursor: {buyer: 'older-last', seller: null}, hasMore: true});
  const {result} = renderHook(() => useChatTransactions('chat', 'buyer'), {wrapper});
  await waitFor(() => expect(result.current.transaction?.id).toBe(latest.id));
  expect(result.current.transactions).toHaveLength(51);
  expect(result.current.hasMore).toBe(true);
  latest = makeTx('new-order-after-cancel', 'paid');
  act(() => onLatest?.());
  await waitFor(() => expect(result.current.transaction?.id).toBe('new-order-after-cancel'));
});
it('a new explicit route request supersedes a prior local history selection', async () => {
  const {result, rerender} = renderHook(({id}: {id: string}) => useChatTransactions('chat', 'buyer', id), {initialProps: {id: 'first-request'}, wrapper});
  await waitFor(() => expect(result.current.transaction?.id).toBe('first-request'));
  act(() => result.current.selectTransaction('chosen-in-history'));
  await waitFor(() => expect(result.current.transaction?.id).toBe('chosen-in-history'));
  rerender({id: 'new-explicit-request'});
  await waitFor(() => expect(result.current.transaction?.id).toBe('new-explicit-request'));
});
it('keeps explicit old agreement while new purchases arrive and its return document updates', async () => {
  const {result} = renderHook(() => useChatTransactions('chat', 'buyer', 'old'), {wrapper});
  await waitFor(() => expect(result.current.transaction?.id).toBe('old'));
  latest = makeTx('another-purchase', 'paid');
  act(() => onLatest?.());
  await waitFor(() => expect(TransactionService.getTransactionByChat).toHaveBeenCalledTimes(2));
  expect(result.current.transaction?.id).toBe('old');
  jest.spyOn(TransactionService, 'getChatTransaction').mockResolvedValue({...makeTx('old', 'refund_action_required'), refundBlocked: true});
  act(() => onSelected?.());
  await waitFor(() => expect(result.current.transaction?.status).toBe('refund_action_required'));
  expect(result.current.transaction?.returnLabelUrl).toContain('return.pdf');
});
it('refreshes on focus and app foreground, and stops listeners across uid/chat changes', async () => {
  const {result, rerender, unmount} = renderHook(({uid, chat}: {uid: string; chat: string}) => useChatTransactions(chat, uid), {initialProps: {uid: 'buyer', chat: 'chat'}, wrapper});
  await waitFor(() => expect(result.current.transaction).not.toBeNull());
  const calls = (useFocusEffect as jest.Mock).mock.calls;
  act(() => calls.at(-1)?.[0]());
  await waitFor(() => expect(TransactionService.getTransactionByChat).toHaveBeenCalledTimes(2));
  act(() => appActive?.('active'));
  await waitFor(() => expect(TransactionService.getTransactionByChat).toHaveBeenCalledTimes(3));
  const oldStops = [...stops];
  establishIdentityFixture('other-user');
  rerender({uid: 'other-user', chat: 'other-chat'});
  await waitFor(() => expect(TransactionService.getTransactionByChat).toHaveBeenCalledWith('other-chat', 'other-user'));
  expect(oldStops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  unmount();
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
});
it('does not replace an inaccessible explicit order with a different latest sale or an empty success', async () => {
  jest.spyOn(TransactionService, 'getChatTransaction').mockRejectedValue(new Error('Inaccessible'));
  const {result} = renderHook(() => useChatTransactions('chat', 'buyer', 'foreign'), {wrapper});
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.transaction).toBeNull();
});
