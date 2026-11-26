import React from 'react';
import {AppState} from 'react-native';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import type {Message, Notification} from '@/types';

type Data = Record<string, unknown>;
type Ref = {collection: string; id: string};
const mockMemory: Record<string, Map<string, Data>> = {chats: new Map(), messages: new Map(), notifications: new Map()};
const mockBadge = jest.fn(async (_count: number) => undefined);
const mockCommitted = jest.fn();
const mockListeners = new Set<(mockSnapshot: {docs: ReturnType<typeof mockSnapshot>[]}) => void>();
let mockGeneration = 1;
let mockBeforeTransaction: (() => void) | undefined;
let mockMessageCallback: ((messages: Message[]) => void) | undefined;
let mockMessageError: ((error: Error) => void) | undefined;
const mockMark = jest.fn();
const mockClone = (value: Data) => JSON.parse(JSON.stringify(value)) as Data;
function mockSnapshot(collection: string, id: string) {
  const value = mockMemory[collection].get(id);
  return {id, ref: {collection, id}, exists: () => !!value, data: () => value ? mockClone(value) : undefined};
}
function mockApply(ref: Ref, changes: Data) {
  const value = mockMemory[ref.collection].get(ref.id)!;
  for (const [key, next] of Object.entries(changes)) {
    const [field, child] = key.split('.');
    if (child) (value[field] as Data)[child] = next; else value[field] = next;
  }
}
function mockQueryDocs(request: {collection: string; clauses: {field: string; op: string; value: unknown}[]}) {
  const docs = [...mockMemory[request.collection]].filter(([, value]) => request.clauses.every(clause =>
    clause.op === 'array-contains' ? (value[clause.field] as unknown[])?.includes(clause.value) : value[clause.field] === clause.value))
    .map(([id]) => mockSnapshot(request.collection, id));
  return {docs, empty: !docs.length, forEach: (callback: (value: typeof docs[number]) => void) => docs.forEach(callback)};
}
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, collection: string) => ({collection}), doc: (_db: unknown, collection: string, id: string) => ({collection, id}),
  query: (ref: {collection: string}, ...clauses: unknown[]) => ({...ref, clauses}), where: (field: string, op: string, value: unknown) => ({field, op, value}),
  getDocFromServer: async (ref: Ref) => mockSnapshot(ref.collection, ref.id),
  getDocsFromServer: async (request: Parameters<typeof mockQueryDocs>[0]) => mockQueryDocs(request),
  getCountFromServer: async (request: Parameters<typeof mockQueryDocs>[0]) => ({data: () => ({count: mockQueryDocs(request).docs.length})}),
  onSnapshot: (_request: unknown, callback: (value: unknown) => void) => {mockListeners.add(callback); return () => mockListeners.delete(callback);},
  writeBatch: () => {const writes: {ref: Ref; changes: Data}[] = []; return {
    update: (ref: Ref, changes: Data) => writes.push({ref, changes}), commit: async () => {writes.forEach(write => mockApply(write.ref, write.changes)); mockCommitted(writes);},
  };},
  runTransaction: async (_db: unknown, body: (tx: unknown) => Promise<void>) => {
    mockBeforeTransaction?.();
    const writes: {ref: Ref; changes: Data}[] = [];
    await body({get: async (ref: Ref) => mockSnapshot(ref.collection, ref.id), update: (ref: Ref, changes: Data) => writes.push({ref, changes})});
    writes.forEach(write => mockApply(write.ref, write.changes)); mockCommitted(writes);
  },
}));
jest.mock('expo-notifications', () => ({setBadgeCountAsync: (count: number) => mockBadge(count)}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => mockGeneration, useAuthStore: create(() => ({authenticatedUid: 'owner'}))};
});
jest.mock('expo-router', () => ({useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/services/chatService', () => ({ChatService: {
  getChatById: async () => ({id: 'chat', ...mockClone(mockMemory.chats.get('chat')!)}),
  listenToMessages: (_chat: string, _uid: string, callback: (messages: Message[]) => void, error: (error: Error) => void) => {
    mockMessageCallback = callback; mockMessageError = error; return () => {mockMessageCallback = undefined;};
  },
  listenToActiveOffers: () => () => undefined, listenToChat: () => () => undefined,
  markMessagesAsRead: (...args: unknown[]) => mockMark(...args),
}}));
import {useAuthStore} from '@/store/authStore';
import {useNotificationStore} from '@/store/notificationStore';
import {useChat} from '@/features/chat/hooks/useChat';
import {markMessagesAsRead} from '@/services/chat/conversation';
import {reconcileReadChatCounter} from '@/services/chatNotificationReadService';
import {queryKeys} from '@/lib/queryKeys';

let client: QueryClient;
let activity = 'active';
const activities = new Set<(next: string) => void>();
function wrapper({children}: {children: React.ReactNode}) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
async function messages(values: Message[]) {await act(async () => {mockMessageCallback?.(values);});}
async function notices() {await act(async () => {const docs = [...mockMemory.notifications.keys()].map(id => mockSnapshot('notifications', id)); for (const callback of mockListeners) callback({docs});});}
const received = (id = 'message') => ({id, chatId: 'chat', senderId: 'peer', receiverId: 'owner', participants: ['owner', 'peer'], type: 'text',
  content: 'Bonjour', timestamp: new Date(), status: 'sent', isRead: false}) as Message;
function notice(id: string, data: Data = {}) {mockMemory.notifications.set(id, {userId: 'owner', isRead: false, type: 'new_message', data: {chatId: 'chat', messageId: 'message'}, ...data});}
beforeEach(() => {
  for (const collection of Object.values(mockMemory)) collection.clear(); mockListeners.clear(); activities.clear();
  mockBeforeTransaction = undefined; mockMessageCallback = undefined; mockMessageError = undefined; mockGeneration = 1; activity = 'active';
  mockMemory.chats.set('chat', {participants: ['owner', 'peer'], unreadCount: {owner: 1, peer: 0}, lastMessageTimestamp: {seconds: 1, nanoseconds: 0}, updatedAt: {seconds: 1, nanoseconds: 0}, lastMessage: 'Bonjour', lastMessageType: 'text'});
  mockMemory.messages.set('message', {...received()});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  useAuthStore.setState({authenticatedUid: 'owner'}); useNotificationStore.getState().reset();
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => {const listener = callback as (next: string) => void; activities.add(listener); return {remove: () => activities.delete(listener)};});
  mockMark.mockImplementation(markMessagesAsRead);
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
});
afterEach(() => {client.clear(); jest.restoreAllMocks();});

it('acknowledges only after loaded messages, preserves unrelated notices and aligns the list, in-app count and iPhone badge', async () => {
  notice('current'); notice('other', {type: 'order_paid'});
  const key = [...queryKeys.notifications.list('owner'), 1, 1];
  client.setQueryData<Notification[]>(key, [{id: 'current', isRead: false}, {id: 'other', isRead: false}] as Notification[]);
  renderHook(() => useChat('chat', 'owner'), {wrapper});
  await waitFor(() => expect(mockMessageCallback).toBeDefined());
  expect(mockMark).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
  await messages([received()]); await notices();
  await waitFor(() => expect(mockMemory.notifications.get('current')?.isRead).toBe(true));
  await waitFor(() => expect(mockBadge).toHaveBeenLastCalledWith(1));
  expect(mockMemory.notifications.get('other')?.isRead).toBe(false);
  expect(mockMemory.messages.get('message')?.isRead).toBe(true);
  expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(0);
  expect(useNotificationStore.getState().unreadCount).toBe(1);
  expect(client.getQueryData<Notification[]>(key)?.find(value => value.id === 'current')?.isRead).toBe(true);
});

it('reads notices produced after an already read message and repairs its late stale chat counter without touching unloaded message notices', async () => {
  mockMemory.messages.get('message')!.isRead = true;
  renderHook(() => useChat('chat', 'owner'), {wrapper});
  await waitFor(() => expect(mockMessageCallback).toBeDefined());
  await messages([{...received(), isRead: true}]);
  notice('late', {type: 'offer_received', data: {chatId: 'chat'}}); // Legacy visit semantics.
  notice('unloaded', {data: {chatId: 'chat', messageId: 'not-loaded'}});
  (mockMemory.chats.get('chat')!.unreadCount as Data).owner = 1; // The delayed producer commits its notice and count together.
  await notices();
  await waitFor(() => expect(mockMemory.notifications.get('late')?.isRead).toBe(true));
  expect(mockMemory.notifications.get('unloaded')?.isRead).toBe(false);
  expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(1);
  mockMemory.notifications.delete('unloaded'); await notices();
  await waitFor(() => expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(0));
  await waitFor(() => expect(mockBadge).toHaveBeenLastCalledWith(0));
});

it('does not acknowledge after a message-loading error or after the conversation goes into the background', async () => {
  notice('current');
  renderHook(() => useChat('chat', 'owner'), {wrapper});
  await waitFor(() => expect(mockMessageCallback).toBeDefined());
  await act(async () => {mockMessageError?.(new Error('unavailable'));});
  expect(mockMark).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
  await act(async () => {activity = 'background'; for (const callback of activities) callback('background');});
  await messages([received()]); await notices();
  expect(mockMemory.notifications.get('current')?.isRead).toBe(false);
  expect(mockMemory.messages.get('message')?.isRead).toBe(false);
});

it('never clears a stale count across a concurrent message/preview change or while any unread source remains', async () => {
  await reconcileReadChatCounter('chat', 'owner', () => undefined);
  expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(1);
  mockMemory.messages.get('message')!.isRead = true;
  mockBeforeTransaction = () => {mockMemory.chats.get('chat')!.lastMessageTimestamp = {seconds: 2, nanoseconds: 0}; (mockMemory.chats.get('chat')!.unreadCount as Data).owner = 2;};
  await reconcileReadChatCounter('chat', 'owner', () => undefined);
  expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(2);
  mockBeforeTransaction = undefined; notice('new-offer', {type: 'offer_received', data: {chatId: 'chat'}});
  await reconcileReadChatCounter('chat', 'owner', () => undefined);
  expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(2);
});

it('decrements an exact loaded message only once across echoes, leaving another unread message untouched', async () => {
  mockMemory.messages.set('second', {...received('second')});
  (mockMemory.chats.get('chat')!.unreadCount as Data).owner = 2;
  await markMessagesAsRead('chat', 'owner', () => undefined, ['message']);
  await markMessagesAsRead('chat', 'owner', () => undefined, ['message']);
  expect((mockMemory.chats.get('chat')?.unreadCount as Data).owner).toBe(1);
  expect(mockMemory.messages.get('second')?.isRead).toBe(false);
});
