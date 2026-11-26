import React from 'react';
import {AppState} from 'react-native';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider, useQuery} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';

let mockGeneration = 1;
const mockLatest = jest.fn();
const mockHistory = jest.fn();
jest.mock('@/services/transactionService', () => ({
  TransactionService: {
    getTransactionByChat: (...args: unknown[]) => mockLatest(...args),
    getChatTransactionsPage: (...args: unknown[]) => mockHistory(...args),
    subscribeToLatestChatTransaction: () => () => undefined,
    subscribeToTransaction: () => () => undefined,
  },
  sortTransactions: (values: unknown[]) => values,
}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => mockGeneration,
    useAuthStore: create(() => ({authenticatedUid: 'owner', tick: 0}))};
});
jest.mock('expo-router', () => ({useFocusEffect: (callback: () => () => void) => {
  const React = require('react'); React.useEffect(callback, [callback]);
}}));
import {useAuthStore} from '@/store/authStore';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {useChatTransactions} from '@/hooks/useChatTransactions';

const listeners = new Set<(state: string) => void>();
const renderCaptureErrors: unknown[] = [];
const read = jest.fn<Promise<string>, []>();
const cacheError = jest.fn();
let queryClient: QueryClient;
const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
let activity = 'active';
function setActivity(next: string) {activity = next; for (const listener of listeners) listener(next);}
function wrapper({children}: {children: React.ReactNode}) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
function consumer({dossier}: {dossier: string}) {
  const context = useShippingPurchaseContext(dossier, 'owner');
  // A query observer can evaluate admission while rendering its new key.
  if (context.focused) {try {context.capture();} catch (error) {renderCaptureErrors.push(error);}}
  const query = useQuery({queryKey: ['reader', dossier, mockGeneration, context.focusRevision],
    enabled: context.focused, retry: false, staleTime: 0, gcTime: 0,
    queryFn: async () => {const operation = context.capture(); const value = await read(); context.assertCurrent(operation); return value;},
  });
  return {context, query};
}
beforeEach(() => {
  mockGeneration = 1; activity = 'active'; listeners.clear(); renderCaptureErrors.length = 0;
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => {
    const listener = callback as (state: string) => void; listeners.add(listener);
    return {remove: () => {listeners.delete(listener);}};
  });
  useAuthStore.setState({authenticatedUid: 'owner'});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  read.mockImplementation(async () => `generation-${mockGeneration}`);
  mockLatest.mockResolvedValue(null);
  mockHistory.mockResolvedValue({transactions: [], hasMore: false, cursor: null});
  queryClient = new QueryClient({queryCache: new QueryCache({onError: cacheError}),
    defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {jest.restoreAllMocks(); queryClient.clear(); if (originalState) Object.defineProperty(AppState, 'currentState', originalState);});

it('admits queries only after the exact new dossier and same-UID generation are committed', async () => {
  const {result, rerender} = renderHook(consumer, {wrapper, initialProps: {dossier: 'chat-A'}});
  await waitFor(() => expect(result.current.query.data).toBe('generation-1'));
  const oldCapture = result.current.context.capture;
  rerender({dossier: 'chat-B'});
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  act(() => {
    mockGeneration++;
    useAuthStore.setState(state => ({...state}));
  });
  await waitFor(() => expect(result.current.query.data).toBe('generation-2'));
  expect(renderCaptureErrors).toEqual([]);
  expect(result.current.query.error).toBeNull();
  expect(() => oldCapture()).toThrow();
});

it('starts a fresh read on foreground and never adopts a late response from the previous active cycle', async () => {
  let finish!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const {result} = renderHook(consumer, {wrapper, initialProps: {dossier: 'chat'}});
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  const old = result.current.context.start()!;
  const oldEpoch = result.current.context.focusRevision;
  act(() => {setActivity('background');});
  expect(result.current.context.focused).toBe(false);
  expect(result.current.context.isCurrent(old)).toBe(false);
  act(() => {setActivity('active');});
  await waitFor(() => expect(result.current.query.data).toBe('generation-1'));
  expect(result.current.context.focusRevision).toBeGreaterThan(oldEpoch);
  await act(async () => {finish('obsolete');});
  expect(result.current.query.data).toBe('generation-1');
  expect(renderCaptureErrors).toEqual([]);
});

it('cancels the real chat-order readers on background without logging their late completions as query errors', async () => {
  let finishLatest!: (value: null) => void;
  let finishHistory!: (value: {transactions: []; hasMore: false; cursor: null}) => void;
  mockLatest.mockImplementationOnce(() => new Promise(resolve => {finishLatest = resolve;}));
  mockHistory.mockImplementationOnce(() => new Promise(resolve => {finishHistory = resolve;}));
  const {result} = renderHook(() => useChatTransactions('chat', 'owner'), {wrapper});
  await waitFor(() => expect(mockHistory).toHaveBeenCalled());
  act(() => {setActivity('background');});
  act(() => {setActivity('active');});
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  await act(async () => {finishLatest(null); finishHistory({transactions: [], hasMore: false, cursor: null});});
  expect(cacheError).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
  expect(mockLatest.mock.calls.length).toBeGreaterThan(1);
  expect(mockHistory.mock.calls.length).toBeGreaterThan(1);
});

it('still surfaces a genuine permission error from the current chat-order frame', async () => {
  const denied = Object.assign(new Error('Permission denied'), {code: 'permission-denied'});
  mockLatest.mockRejectedValue(denied);
  const {result} = renderHook(() => useChatTransactions('chat', 'owner'), {wrapper});
  await waitFor(() => expect(result.current.error).toBe(denied));
  expect(cacheError).toHaveBeenCalledWith(denied, expect.anything());
});
