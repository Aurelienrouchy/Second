import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { User } from 'firebase/auth';
import { auth } from '@/config/firebaseConfig';

let mockGeneration = 1;
let mockUid = 'seller-A';
let mockActivity = 'active';
const mockFocusCallbacks: (() => () => void)[] = [];
const mockGoogle = jest.fn<Promise<void>, [() => void]>();
const mockApple = jest.fn<Promise<void>, [() => void]>();

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => { mockFocusCallbacks.push(callback); },
}));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: { getState: () => ({ authenticatedUid: mockUid }) },
}));
jest.mock('@/services/authService', () => ({
  AuthService: {
    getAuthProvider: () => 'google.com',
    reauthenticateWithGoogle: (guard: () => void) => mockGoogle(guard),
    reauthenticateWithApple: (guard: () => void) => mockApple(guard),
  },
}));

import { useWalletWithdrawalIdentity } from '@/hooks/useWalletWithdrawalIdentity';

const appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');
function owner(): User {
  return {
    uid: 'seller-A',
    getIdTokenResult: jest.fn(async () => ({ claims: { auth_time: Math.floor(Date.now() / 1000) } })),
  } as unknown as User;
}
function openWallet() {
  const hook = renderHook(() => useWalletWithdrawalIdentity('seller-A'));
  let blur!: () => void;
  act(() => { blur = mockFocusCallbacks[0](); });
  return { ...hook, blur };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-28T22:00:00Z'));
  mockGeneration = 1;
  mockUid = 'seller-A';
  mockActivity = 'active';
  mockFocusCallbacks.length = 0;
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => mockActivity });
  (auth as unknown as { currentUser: User }).currentUser = owner();
  mockGoogle.mockImplementation(async guard => { guard(); });
  mockApple.mockImplementation(async guard => { guard(); });
});
afterEach(() => {
  jest.useRealTimers();
  if (appStateDescriptor) Object.defineProperty(AppState, 'currentState', appStateDescriptor);
});

it('accepts same-User foreground hydration without binding or dispatching a withdrawal', async () => {
  let finish!: () => void;
  mockGoogle.mockImplementation(guard => new Promise<void>(resolve => {
    guard();
    finish = () => { guard(); resolve(); };
  }));
  const { result } = openWallet();
  let challenge!: Promise<void>;
  act(() => { challenge = result.current.verify(); });
  expect(result.current.busy).toBe(true);
  mockActivity = 'inactive';
  // The private financial form is cleared while the native provider is open;
  // this must not cancel the separate, still unbound identity challenge.
  act(() => { result.current.clear(); });
  mockGeneration = 2;
  mockActivity = 'active';
  await act(async () => { finish(); await challenge; });
  expect(result.current.proof).toMatchObject({ uid: 'seller-A', generation: 2 });
  expect(result.current.proof?.reviewRequestId).toBeUndefined();
  expect(result.current.ready).toBe(true);
  expect(result.current.notice).toContain('Aucun retrait');
  expect(mockGoogle).toHaveBeenCalledTimes(1);
});

it('binds only an explicitly new review, rejects a different review or later generation, and does not repeat OAuth', async () => {
  const { result } = openWallet();
  await act(async () => { await result.current.verify(); });
  const proof = result.current.proof;
  mockGeneration = 3;
  act(() => { result.current.bindReview('withdrawal_review_123456', proof); });
  expect(result.current.proof).toMatchObject({ generation: 3, reviewRequestId: 'withdrawal_review_123456' });
  expect(() => result.current.assertProof('withdrawal_review_123456')).not.toThrow();
  expect(() => result.current.assertProof('withdrawal_review_654321')).toThrow();
  expect(() => result.current.assertProof()).toThrow();
  mockGeneration = 4;
  expect(() => result.current.assertProof('withdrawal_review_123456')).toThrow();
  expect(mockGoogle).toHaveBeenCalledTimes(1);
});

it('rejects a replaced SDK session even when the UID is unchanged', async () => {
  let finish!: () => void;
  mockGoogle.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const { result } = openWallet();
  let challenge!: Promise<void>;
  act(() => { challenge = result.current.verify(); });
  (auth as unknown as { currentUser: User }).currentUser = owner();
  await act(async () => { finish(); await challenge; });
  expect(result.current.proof).toBeNull();
  expect(() => result.current.bindReview('withdrawal_review_123456', null)).toThrow();
  expect(result.current.notice).toBe('');
});

it('expires the memory proof and invalidates it on navigation away', async () => {
  const { result, blur } = openWallet();
  await act(async () => { await result.current.verify(); });
  act(() => { jest.advanceTimersByTime(4 * 60_000); });
  expect(result.current.proof).toBeNull();
  expect(() => result.current.assertProof()).toThrow();
  await act(async () => { await result.current.verify(); });
  expect(result.current.ready).toBe(true);
  act(() => { blur(); });
  expect(result.current.proof).toBeNull();
  expect(result.current.ready).toBe(false);
  expect(() => result.current.assertProof()).toThrow();
});
