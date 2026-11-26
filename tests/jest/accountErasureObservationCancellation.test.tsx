import React from 'react';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react-native';
import {AppState, type AppStateStatus} from 'react-native';
import {CancelledError, QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fetch as expoFetch} from 'expo/fetch';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {AuthService} from '@/services/authService';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import {useAccountErasureRecoveryGuard} from '@/hooks/useAccountErasureRecovery';
import {clearIdentityFixture, establishIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {AccountErasureAttempt, AccountErasureReceipt} from '@/types/accountErasure';

type NativeFetchResponse = Awaited<ReturnType<typeof expoFetch>>;
let mockFocused = true;
const mockMemory = new Map<string, string>(), mockDeviceMemory = new Map<string, string>();
jest.mock('expo-secure-store', () => ({WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', isAvailableAsync: async () => true,
  getItemAsync: async (key: string) => mockMemory.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {mockMemory.set(key, value);}, deleteItemAsync: async (key: string) => {mockMemory.delete(key);}}));
jest.mock('@/utils/environmentStorage', () => ({__esModule: true, default: {
  getItem: async (key: string) => mockDeviceMemory.get(key) ?? null,
  setItem: async (key: string, value: string) => {mockDeviceMemory.set(key, value);}, removeItem: async (key: string) => {mockDeviceMemory.delete(key);}}}));
jest.mock('expo/fetch', () => ({fetch: jest.fn()}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/lib/analytics', () => ({track: jest.fn(), suspendAnalytics: jest.fn(), identifyUser: jest.fn(), resetAnalytics: jest.fn(),
  setAnalyticsEnabled: jest.fn().mockResolvedValue(undefined), setAnalyticsUserConsent: jest.fn().mockResolvedValue(undefined)}));
jest.mock('expo-router', () => ({useRouter: () => ({back: jest.fn(), push: jest.fn()}),
  useFocusEffect: (callback: () => void | (() => void)) => {const React = require('react');
    React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);}}));
// Status rendering is the unrelated visual boundary. The real routes, recovery
// scope, Zustand generation, service framing and secure journal stay composed.
jest.mock('@/features/account', () => ({AccountErasureStatus: ({receipt}: {receipt: AccountErasureReceipt}) =>
  require('react').createElement(require('react-native').Text, {testID: 'receipt-state'}, receipt.state)}));
import PublicTracking from '@/app/account-deletion';
import OwnerTracking from '@/app/settings/erase-account';

function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
const noView = () => undefined;
function receipt(attempt: AccountErasureAttempt): AccountErasureReceipt {
  return {kind: 'account_erasure_receipt_v1', commandId: attempt.commandId, requestId: attempt.requestId, state: 'inspecting', version: 1,
    accountAccessClosed: false, deletionComplete: false, appleAuthorizationRequired: false, progress: {completedSteps: 1, totalSteps: 7}, reasons: [],
    updatedAt: '2026-11-25T20:00:00.000Z', completedAt: null, retentionPolicyVersion: 'seconde-erasure-2026-11-25-v1', observationExpiresAt: null,
    success: false, status: 'incomplete', newOperationsBlocked: true};
}
function response(attempt: AccountErasureAttempt): NativeFetchResponse {return {ok: true, status: 200, text: async () => JSON.stringify({result: receipt(attempt)})} as NativeFetchResponse;}
const routes = [{name: 'public', Component: PublicTracking, prefix: 'account-erasure-observation'},
  {name: 'owner', Component: OwnerTracking, prefix: 'account-erasure-owner-observation'}] as const;
let client: QueryClient, attempt: AccountErasureAttempt, activity: AppStateStatus;
const errors = jest.fn(), listeners = new Set<(state: AppStateStatus) => void>();
const originalActivity = Object.getOwnPropertyDescriptor(AppState, 'currentState');
function Subject({Component}: {Component: typeof PublicTracking}) {useAccountErasureRecoveryGuard(); return <Component/>;}
function tree(Component: typeof PublicTracking) {return <QueryClientProvider client={client}><Subject Component={Component}/></QueryClientProvider>;}
function setActivity(state: AppStateStatus) {activity = state; for (const listener of listeners) listener(state);}
beforeEach(async () => {
  jest.clearAllMocks(); errors.mockClear(); mockMemory.clear(); mockDeviceMemory.clear(); mockFocused = true; activity = 'active'; listeners.clear();
  establishIdentityFixture('erasure-owner');
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {const listener = callback as (state: AppStateStatus) => void;
    listeners.add(listener); return {remove: () => {listeners.delete(listener);}};});
  attempt = await AccountErasureJournal.beginSubmission(await AccountErasureJournal.prepare('erasure-owner', noView), noView);
  client = new QueryClient({queryCache: new QueryCache({onError: errors}), defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false}}});
  jest.mocked(expoFetch).mockReset().mockResolvedValue(response(attempt));
});
afterEach(async () => {cleanup(); client.clear(); jest.restoreAllMocks(); clearIdentityFixture();
  if (originalActivity) Object.defineProperty(AppState, 'currentState', originalActivity);
  // Drain the genuine journal queue before resetting its native storage fixture.
  await Promise.resolve(); await Promise.resolve();
});

describe.each(routes)('$name observation route', ({Component, prefix}) => {
  it('cancels a response after focus loss without reporting a provider failure or recording a late receipt', async () => {
    const network = deferred<NativeFetchResponse>(); jest.mocked(expoFetch).mockReturnValueOnce(network.promise);
    const record = jest.spyOn(AccountErasureJournal, 'record'); const view = render(tree(Component));
    await waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(1));
    const query = client.getQueryCache().findAll({queryKey: [prefix]})[0];
    const joined = client.fetchQuery({queryKey: query.queryKey});
    const rejected = expect(joined).rejects.toBeInstanceOf(CancelledError);
    mockFocused = false; view.rerender(tree(Component));
    await act(async () => {network.resolve(response(attempt)); await rejected;});
    expect(errors).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
  });

  it.each(['uid', 'generation', 'sdk-only', 'background', 'unmount', 'abort'] as const)('silently cancels a late response after %s without writing its receipt', async loss => {
    const network = deferred<NativeFetchResponse>(); jest.mocked(expoFetch).mockReturnValueOnce(network.promise);
    const record = jest.spyOn(AccountErasureJournal, 'record'), view = render(tree(Component));
    await waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(1));
    const query = client.getQueryCache().findAll({queryKey: [prefix]})[0];
    const joined = client.fetchQuery({queryKey: query.queryKey}), rejected = expect(joined).rejects.toBeInstanceOf(CancelledError);
    let hydration: Promise<void> | undefined, restoreProfile: (() => void) | undefined;
    if (loss === 'uid') act(() => establishIdentityFixture('account-B'));
    if (loss === 'generation') {
      const profile = useAuthStore.getState().user!, pendingProfile = deferred<typeof profile>(); restoreProfile = () => {pendingProfile.resolve(profile);};
      jest.spyOn(AuthService, 'getCurrentUser').mockReturnValueOnce(pendingProfile.promise);
      act(() => {hydration = useAuthStore.getState().hydrateFromFirebase(auth.currentUser);});
    }
    if (loss === 'sdk-only') Object.assign(auth, {currentUser: {...auth.currentUser, uid: 'account-B'}});
    if (loss === 'background') act(() => setActivity('background'));
    if (loss === 'unmount') view.unmount();
    if (loss === 'abort') await act(async () => {await client.cancelQueries({queryKey: query.queryKey});});
    try {
      await act(async () => {network.resolve(response(attempt)); await rejected;});
      expect(errors).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      if (restoreProfile) await act(async () => {restoreProfile!(); await hydration;});
    }
  });

  it('keeps a genuine current HTTP refusal visible and preserves the same secure journal', async () => {
    const network = deferred<NativeFetchResponse>(); jest.mocked(expoFetch).mockReturnValueOnce(network.promise);
    const record = jest.spyOn(AccountErasureJournal, 'record'); render(tree(Component));
    await waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(1)); const stored = new Map(mockMemory);
    await act(async () => {network.resolve({ok: false, status: 403, text: async () => JSON.stringify({error: {status: 'PERMISSION_DENIED'}})} as NativeFetchResponse);});
    await screen.findByText(/Le serveur ne confirme pas/);
    expect(errors).toHaveBeenCalledTimes(1); expect(errors.mock.calls[0][0]).toMatchObject({code: 'functions/permission-denied'});
    expect(record).not.toHaveBeenCalled(); expect(mockMemory).toEqual(stored);
    expect(JSON.parse(String(jest.mocked(expoFetch).mock.calls[0][1]?.body)).data.operation).toBe('observe');
  });

  it('accepts a fresh foreground observation while rejecting the old foreground frame and its higher late receipt', async () => {
    const network = deferred<NativeFetchResponse>(); jest.mocked(expoFetch).mockReturnValueOnce(network.promise);
    const record = jest.spyOn(AccountErasureJournal, 'record'); render(tree(Component));
    await waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(1));
    const oldKey = client.getQueryCache().findAll({queryKey: [prefix]})[0].queryKey;
    const joined = client.fetchQuery({queryKey: oldKey}), rejected = expect(joined).rejects.toBeInstanceOf(CancelledError);
    act(() => setActivity('background')); act(() => setActivity('active'));
    await screen.findByTestId('receipt-state'); expect(expoFetch).toHaveBeenCalledTimes(2);
    await act(async () => {network.resolve({ok: true, status: 200, text: async () => JSON.stringify({result: {...receipt(attempt), version: 99}})} as NativeFetchResponse); await rejected;});
    expect(errors).not.toHaveBeenCalled(); expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][1].version).toBe(1);
    expect((await AccountErasureJournal.discover(noView) as AccountErasureAttempt).receipt?.version).toBe(1);
  });

  it('records a qualified current observation and displays it without issuing a new erasure instruction', async () => {
    const record = jest.spyOn(AccountErasureJournal, 'record'); render(tree(Component));
    await screen.findByTestId('receipt-state'); expect(screen.getByTestId('receipt-state')).toHaveTextContent('inspecting');
    expect(record).toHaveBeenCalledTimes(1); expect(errors).not.toHaveBeenCalled();
    expect(jest.mocked(expoFetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)).data.operation)).toEqual(['observe']);
    expect((await AccountErasureJournal.discover(noView) as AccountErasureAttempt).receipt).toEqual(receipt(attempt));
  });
});
