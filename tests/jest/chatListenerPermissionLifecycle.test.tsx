import {act, cleanup, renderHook} from '@testing-library/react-native';
import {onSnapshot} from 'firebase/firestore';
import {auth} from '@/config/firebaseConfig';
import {useChatListener} from '@/features/chat/hooks/useChatListener';
import {useAuthStore} from '@/store/authStore';
import {useChatStore} from '@/store/chatStore';
import {AuthService} from '@/services/authService';
import {clearIdentityFixture, establishIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {Chat} from '@/types';

jest.mock('@/lib/analytics', () => ({track: jest.fn(), suspendAnalytics: jest.fn(), identifyUser: jest.fn(), resetAnalytics: jest.fn(),
  setAnalyticsUserConsent: jest.fn().mockResolvedValue(undefined)}));
type Snapshot = {forEach: (read: (document: {id: string; data: () => Record<string, unknown>}) => void) => void};
type NativeSubscription = {next: (snapshot: Snapshot) => void; fail: (error: Error) => void; unsubscribe: jest.Mock};
const subscriptions: NativeSubscription[] = [];
function chat(uid: string, suffix = 'initial'): Chat {
  return {id: `${uid}-${suffix}`, participants: [uid, 'peer'], createdAt: new Date(), updatedAt: new Date(),
    unreadCount: {[uid]: 3}} as Chat;
}
function emit(subscription: NativeSubscription, value: Chat) {
  const {id, ...data} = value;
  subscription.next({forEach: read => read({id, data: () => ({...data, createdAt: {toDate: () => value.createdAt}, updatedAt: {toDate: () => value.updatedAt}})})});
}
const denied = () => Object.assign(new Error('Native Firestore permission denied'), {code: 'permission-denied'});
let log: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks(); subscriptions.length = 0; establishIdentityFixture('A'); useChatStore.getState().reset();
  log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (onSnapshot as jest.Mock).mockImplementation((_query: unknown, next: NativeSubscription['next'], fail: NativeSubscription['fail']) => {
    const unsubscribe = jest.fn(); subscriptions.push({next, fail, unsubscribe}); return unsubscribe;
  });
});
afterEach(() => {cleanup(); useChatStore.getState().reset(); jest.restoreAllMocks(); clearIdentityFixture();});

it('clears only the current denied list and unread counts while preserving the real error and active identity', () => {
  renderHook(() => useChatListener()); const current = subscriptions[0], refusal = denied();
  act(() => emit(current, chat('A'))); expect(useChatStore.getState().chats).toHaveLength(1);
  act(() => current.fail(refusal));
  expect(useChatStore.getState()).toMatchObject({chats: [], unreadCountByUser: {}, isLoading: false,
    error: 'Erreur lors du chargement des conversations'});
  expect(log).toHaveBeenCalledWith('[useChatListener] error:', refusal);
  expect(auth.currentUser?.uid).toBe('A'); expect(useAuthStore.getState().authenticatedUid).toBe('A');
  expect(current.unsubscribe).not.toHaveBeenCalled();
});

it('does not clear the next owner list when an old error arrives before React commits the identity change', () => {
  renderHook(() => useChatListener()); const previous = subscriptions[0], next = chat('B');
  act(() => {
    establishIdentityFixture('B'); useChatStore.getState().setChats([next]);
    previous.fail(denied());
  });
  expect(useChatStore.getState().chats).toEqual([next]); expect(useChatStore.getState().error).toBeNull(); expect(log).not.toHaveBeenCalled();
  act(() => emit(subscriptions[subscriptions.length - 1], chat('B', 'fresh')));
  expect(useChatStore.getState().chats[0].id).toBe('B-fresh');
});

it('ignores a same-UID stale generation and accepts a new current subscription', async () => {
  renderHook(() => useChatListener()); const previous = subscriptions[0], profile = useAuthStore.getState().user!;
  jest.spyOn(AuthService, 'getCurrentUser').mockResolvedValue(profile);
  await act(async () => {await useAuthStore.getState().hydrateFromFirebase(auth.currentUser);});
  const next = chat('A', 'new-generation'); act(() => {useChatStore.getState().setChats([next]); previous.fail(denied());});
  expect(useChatStore.getState().chats).toEqual([next]); expect(useChatStore.getState().error).toBeNull(); expect(log).not.toHaveBeenCalled();
  expect(subscriptions.length).toBeGreaterThan(1);
  act(() => emit(subscriptions[subscriptions.length - 1], chat('A', 'fresh')));
  expect(useChatStore.getState().chats[0].id).toBe('A-fresh');
});

it.each(['different-uid', 'same-uid-new-sdk-reference'] as const)('ignores a stale SDK owner (%s) even without a Zustand notification', change => {
  renderHook(() => useChatListener()); const previous = subscriptions[0], next = chat('B');
  Object.assign(auth, {currentUser: {...auth.currentUser, uid: change === 'different-uid' ? 'B' : 'A'}});
  act(() => {useChatStore.getState().setChats([next]); previous.fail(denied());});
  expect(useChatStore.getState().chats).toEqual([next]); expect(useChatStore.getState().error).toBeNull(); expect(log).not.toHaveBeenCalled();
});

it('preserves a current non-permission failure as an error instead of silently treating it as a revoked list', () => {
  renderHook(() => useChatListener()); const current = subscriptions[0], cached = chat('A');
  const failure = Object.assign(new Error('Connection interrupted'), {code: 'unavailable'});
  act(() => {emit(current, cached); current.fail(failure);});
  expect(useChatStore.getState().chats[0].id).toBe(cached.id);
  expect(useChatStore.getState().error).toBe('Erreur lors du chargement des conversations');
  expect(log).toHaveBeenCalledWith('[useChatListener] error:', failure);
});
