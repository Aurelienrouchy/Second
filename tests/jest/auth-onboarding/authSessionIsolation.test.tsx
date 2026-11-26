import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import { analyticsIO, authIO, deferred, establishSession, profile, providerIdentity, resetEnvironment } from './eligibilityTestHarness';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuthGuardSession } from '@/hooks/useAuth';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';

beforeEach(resetEnvironment);
afterEach(() => jest.restoreAllMocks());

it('closes normal A capabilities while signIn B waits for its cache, then admits B', async () => {
  await establishSession('A');
  const gate = deferred<void>();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === getEnvironmentStorageKey('user_data') && value === JSON.stringify(profile('B'))) await gate.promise;
    return write(key, value);
  });
  const { result } = renderHook(useAuthGuardSession);
  providerIdentity('B');
  let pending!: Promise<void>;
  act(() => { pending = useAuthStore.getState().signIn(profile('B')); });
  try {
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(getEnvironmentStorageKey('user_data'), JSON.stringify(profile('B'))));
    expect(result.current.normalUser).toBeNull();
    expect(result.current.identity?.id).toBe('B');
    expect(useAuthStore.getState().authenticatedUid).toBe('B');
  } finally { await act(async () => { gate.resolve(); await pending; }); }
  expect(result.current.normalUser?.id).toBe('B');
  expect(await AsyncStorage.getItem(getEnvironmentStorageKey('user_data'))).toBe(JSON.stringify(profile('B')));
});

it('keeps B readonly after cache IO fails instead of projecting normal A', async () => {
  await establishSession('A');
  const { result } = renderHook(useAuthGuardSession);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Local storage unavailable'));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  providerIdentity('B');
  await act(async () => useAuthStore.getState().signIn(profile('B')));
  expect(result.current.normalUser).toBeNull();
  expect(result.current.identity?.id).toBe('B');
  expect(useAuthStore.getState().authenticatedUid).toBe('B');
  expect(analyticsIO.identify).not.toHaveBeenCalledWith('B', expect.anything());
});

it('retains legitimate normal capabilities on a same-UID refresh while cache IO waits', async () => {
  await establishSession('A');
  const gate = deferred<void>();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === getEnvironmentStorageKey('user_data')) await gate.promise;
    return write(key, value);
  });
  const { result } = renderHook(useAuthGuardSession);
  let pending!: Promise<void>;
  act(() => { pending = useAuthStore.getState().signIn(profile('A')); });
  try { expect(result.current.normalUser?.id).toBe('A'); }
  finally { await act(async () => { gate.resolve(); await pending; }); }
  expect(result.current.normalUser?.id).toBe('A');
});

it.each(['B', 'A'] as const)('ignores old logout completion after A→B with final owner %s', async finalOwner => {
  await establishSession('A');
  const gate = deferred<void>();
  authIO.signOut.mockReturnValueOnce(gate.promise);
  const pending = useAuthStore.getState().signOut();
  await waitFor(() => expect(authIO.signOut).toHaveBeenCalledTimes(1));
  try {
    await establishSession('B');
    if (finalOwner === 'A') await establishSession('A');
    jest.mocked(AsyncStorage.removeItem).mockClear();
    analyticsIO.track.mockClear(); analyticsIO.reset.mockClear();
  } finally { gate.resolve(); await pending; }
  expect(useAuthStore.getState().user?.id).toBe(finalOwner);
  expect(useAuthStore.getState().authenticatedUid).toBe(finalOwner);
  expect(await AsyncStorage.getItem(getEnvironmentStorageKey('user_data'))).toBe(JSON.stringify(profile(finalOwner)));
  expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith(getEnvironmentStorageKey('user_data'));
  // Wrapper invocations only; this does not claim PostHog SDK behavior.
  expect(analyticsIO.track).not.toHaveBeenCalledWith('user_signed_out', expect.anything());
  expect(analyticsIO.reset).not.toHaveBeenCalled();
});

it('completes nominal logout after the provider delivers a coherent null event', async () => {
  await establishSession('A');
  authIO.signOut.mockImplementationOnce(async () => {
    providerIdentity(null);
    await useAuthStore.getState().hydrateFromFirebase(null);
  });
  await useAuthStore.getState().signOut();
  expect(useAuthStore.getState().authenticatedUid).toBeNull();
  expect(useAuthStore.getState().user).toBeNull();
  expect(await AsyncStorage.getItem(getEnvironmentStorageKey('user_data'))).toBeNull();
  expect(analyticsIO.track.mock.calls.filter(([name]) => name === 'user_signed_out')).toHaveLength(1);
  expect(analyticsIO.track).toHaveBeenCalledWith('user_signed_out', { source: 'user_action' });
  expect(analyticsIO.reset).toHaveBeenCalledTimes(1);
});

it('ignores queued null observer payload when Auth.currentUser already belongs to B', async () => {
  await establishSession('A'); await establishSession('B');
  const before = getAuthSessionGeneration();
  const cache = await AsyncStorage.getItem(getEnvironmentStorageKey('user_data'));
  await useAuthStore.getState().hydrateFromFirebase(null);
  expect(getAuthSessionGeneration()).toBe(before);
  expect(useAuthStore.getState().user?.id).toBe('B');
  expect(useAuthStore.getState().authenticatedUid).toBe('B');
  expect(await AsyncStorage.getItem(getEnvironmentStorageKey('user_data'))).toBe(cache);
});
