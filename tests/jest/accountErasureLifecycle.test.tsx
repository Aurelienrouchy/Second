import React from 'react';
import {AppState, Text} from 'react-native';
import {act, render, screen, waitFor} from '@testing-library/react-native';
import {CancelledError, QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import {useAccountErasureRecovery} from '@/hooks/useAccountErasureRecovery';

let mockGeneration = 1;
let mockFocused = true;
const cacheError = jest.fn();
const mockListeners = new Set<(state: typeof AppState.currentState) => void>();
jest.mock('@/config/firebaseConfig', () => ({auth: {currentUser: null}}));
jest.mock('@/services/accountErasureJournal', () => ({AccountErasureJournal: {
  subscribe: () => () => undefined, getRevision: () => 0, discover: jest.fn(async () => null),
}}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => mockGeneration,
    useAuthStore: create(() => ({authenticatedUid: null, isLoading: false}))};
});
jest.mock('expo-router', () => ({useFocusEffect: (effect: () => void | (() => void)) => {
  const React = jest.requireActual<typeof import('react')>('react'); React.useEffect(() => {if (mockFocused) return effect();}, [effect, mockFocused]);
}}));

const compiledHook = (() => {
  const babel = jest.requireActual<typeof import('@babel/core')>('@babel/core');
  // Metro supplies additional caller metadata beyond Babel's base interface.
  const caller = {name: 'metro', platform: 'ios', isDev: false, isServer: false, isReactServer: false,
    supportsStaticESM: false, supportsReactCompiler: true};
  const result = babel.transformFileSync(require.resolve('@/hooks/useAccountErasureRecovery'), {
    configFile: false, babelrc: false, envName: 'production', presets: ['babel-preset-expo'],
    caller,
  });
  if (!result?.code) throw new Error('Production hook compilation failed.');
  const output: {exports: {useAccountErasureRecovery?: typeof useAccountErasureRecovery}} = {exports: {}};
  // Execute the actual production transform against the same mocked native
  // modules; uncompiled Jest alone does not expose the memoized inactive result.
  new Function('require', 'module', 'exports', result.code)(require, output, output.exports);
  if (!output.exports.useAccountErasureRecovery) throw new Error('Compiled hook export missing.');
  return output.exports.useAccountErasureRecovery;
})();
let client: QueryClient, latest: ReturnType<typeof useAccountErasureRecovery>;
function Subject({compiled = false}: {compiled?: boolean}) {
  const useRecovery = compiled ? compiledHook : useAccountErasureRecovery;
  latest = useRecovery();
  return <Text testID="read-state">{latest.ready ? 'ready' : latest.error ? 'error' : 'waiting'}</Text>;
}
function mount(compiled = false) {return render(<QueryClientProvider client={client}><Subject compiled={compiled}/></QueryClientProvider>);}
function setActivity(state: typeof AppState.currentState) {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: state});
}
async function activity(state: typeof AppState.currentState) {
  await act(async () => {setActivity(state); for (const listener of mockListeners) listener(state);});
}
beforeEach(() => {
  mockGeneration++; mockFocused = true; mockListeners.clear(); jest.clearAllMocks();
  Object.assign(auth, {currentUser: null}); useAuthStore.setState({authenticatedUid: null, isLoading: false});
  setActivity('active');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    mockListeners.add(listener); return {remove: () => mockListeners.delete(listener)};
  });
  jest.mocked(AccountErasureJournal.discover).mockReset().mockResolvedValue(null);
  client = new QueryClient({queryCache: new QueryCache({onError: cacheError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear(); jest.restoreAllMocks();});

it('reads a signed-out journal when a route mounts inactive then becomes active', async () => {
  setActivity('inactive'); mount(); expect(AccountErasureJournal.discover).not.toHaveBeenCalled();
  await activity('active'); await waitFor(() => expect(screen.getByTestId('read-state')).toHaveTextContent('ready'));
  expect(latest.attempt).toBeNull();
});
it('recomputes readiness after inactive-to-active in the actual Expo production compiler output', async () => {
  setActivity('inactive'); mount(true); expect(AccountErasureJournal.discover).not.toHaveBeenCalled();
  await activity('active'); await waitFor(() => expect(screen.getByTestId('read-state')).toHaveTextContent('ready'));
  await activity('background'); expect(latest.ready).toBe(false);
  await activity('active'); await waitFor(() => expect(latest.ready).toBe(true));
});
it('catches a foreground transition during installation of the AppState subscription', async () => {
  setActivity('inactive');
  jest.mocked(AppState.addEventListener).mockImplementationOnce((_event, listener) => {
    mockListeners.add(listener); setActivity('active');
    // Native currentState may advance while the JS listener is being attached.
    return {remove: () => mockListeners.delete(listener)};
  });
  mount(); await waitFor(() => expect(screen.getByTestId('read-state')).toHaveTextContent('ready'));
  expect(AccountErasureJournal.discover).toHaveBeenCalled();
});
it('invalidates a prior frame across background/foreground even when React batches both events', async () => {
  mount(); await waitFor(() => expect(latest.ready).toBe(true)); const old = latest.capture();
  await act(async () => {
    for (const state of ['background', 'active'] as const) {
      setActivity(state); for (const listener of mockListeners) listener(state);
    }
  });
  expect(old.assertCurrent).toThrow(); await waitFor(() => expect(latest.ready).toBe(true));
  expect(latest.capture().assertCurrent).not.toThrow();
});
it('uses the existing Auth subscription to invalidate a same-owner generation change in the foreground', async () => {
  mount(); await waitFor(() => expect(latest.ready).toBe(true)); const old = latest.capture();
  await act(async () => {mockGeneration++; useAuthStore.setState({isLoading: false});});
  expect(old.assertCurrent).toThrow(); await waitFor(() => expect(latest.ready).toBe(true));
  expect(latest.generation).toBe(mockGeneration); expect(latest.capture().assertCurrent).not.toThrow();
});

it.each(['uid', 'generation', 'focus', 'unmount'] as const)('cancels the real local discovery query after losing %s without a QueryCache error', async loss => {
  let release!: () => void; const pending = new Promise<void>(resolve => {release = resolve;});
  jest.mocked(AccountErasureJournal.discover).mockImplementationOnce(async assertCurrent => {await pending; assertCurrent?.(); return null;});
  const view = mount(); await waitFor(() => expect(AccountErasureJournal.discover).toHaveBeenCalledTimes(1));
  const oldKey = client.getQueryCache().findAll({queryKey: ['account-erasure-device']}).find(query => query.state.fetchStatus === 'fetching')!.queryKey;
  const joined = client.fetchQuery({queryKey: oldKey}); const rejected = expect(joined).rejects.toBeInstanceOf(CancelledError);
  if (loss === 'uid') Object.assign(auth, {currentUser: {uid: 'other'}});
  if (loss === 'generation') mockGeneration++;
  if (loss === 'focus') {mockFocused = false; view.rerender(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);}
  if (loss === 'unmount') view.unmount();
  await act(async () => {release(); await rejected;});
  expect(cacheError).not.toHaveBeenCalled(); expect(client.getQueryState(oldKey)?.error ?? null).toBeNull();
});

it('keeps a genuine discovery failure under the current scope observable to QueryCache and the UI', async () => {
  const failure = new Error('Le journal courant ne peut pas être lu');
  jest.mocked(AccountErasureJournal.discover).mockRejectedValueOnce(failure); mount();
  await waitFor(() => expect(latest.error).toBe(true));
  expect(cacheError).toHaveBeenCalledWith(failure, expect.anything()); expect(screen.getByTestId('read-state')).toHaveTextContent('error');
});
