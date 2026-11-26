/** Real sell layout + Android capture route + foreground listener/store.
 * Only navigation/native SDK and remote/file transports are substituted. */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import type { ImagePickerResult } from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import environmentStorage from '@/utils/environmentStorage';
import { authIO, callableIO, deferred, establishSession, ownerEligibility, profile,
  providerIdentity, resetEnvironment } from './auth-onboarding/eligibilityTestHarness';
import { auth } from '@/config/firebaseConfig';
import { AuthService } from '@/services/authService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { track } from '@/lib/analytics';
import { createSellNavigationFixture } from './helpers/sellNavigationFixture';

const mockPicker = jest.fn<Promise<ImagePickerResult>, unknown[]>();
const mockCopy = jest.fn<Promise<void>, [{ from: string; to: string }]>();
const mockStackMount = jest.fn(), mockStackUnmount = jest.fn();
let mockFocused = true;
const navigationFixture = createSellNavigationFixture(() => mockFocused);
const mockNavigation = navigationFixture.navigation;
const originalAppState = AppState.currentState;
const activityListeners = new Set<(state: AppStateStatus) => unknown>();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockPicker(...args),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.requireActual('expo-router/build/react-navigation/core/usePreventRemove').usePreventRemove,
  useIsFocused: jest.requireActual('expo-router/build/react-navigation/core/useIsFocused').useIsFocused,
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: (options: { from: string; to: string }) => mockCopy(options),
  readDirectoryAsync: jest.fn(async () => []), deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('@/features/sell/services/aiService', () => ({ deleteDraftImagesFromStorage: jest.fn() }));
jest.mock('@/components/PrivateStorageImage', () => ({ PrivateStorageImage: () => null }));
jest.mock('@/features/sell', () => ({
  PermissionDenied: jest.requireActual('@/features/sell/components/capture/PermissionDenied').PermissionDenied,
  TopControls: jest.requireActual('@/features/sell/components/capture/TopControls').TopControls,
  ThumbnailStrip: jest.requireActual('@/features/sell/components/capture/ThumbnailStrip').ThumbnailStrip,
  CameraControlsRow: jest.requireActual('@/features/sell/components/capture/CameraControlsRow').CameraControlsRow,
}));
jest.mock('expo-camera', () => {
  const runtime: typeof import('react') = jest.requireActual('react');
  const { View }: typeof import('react-native') = jest.requireActual('react-native');
  const Camera = runtime.forwardRef<unknown, { onCameraReady: () => void }>((props, ref) => {
    runtime.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn() }));
    runtime.useEffect(() => props.onCameraReady(), []);
    return runtime.createElement(View, { testID: 'camera-native-io' });
  });
  return { CameraView: Camera, useCameraPermissions: () => [
    { granted: true, status: 'granted', canAskAgain: true }, jest.fn(),
  ] };
});
jest.mock('expo-blur', () => ({ BlurView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-reanimated', () => {
  const native = jest.requireActual('react-native-reanimated/mock');
  const runtime: typeof import('react') = jest.requireActual('react');
  return { ...native, useSharedValue: (initial: number) => runtime.useState(() => native.useSharedValue(initial))[0] };
});

// The common IO harness intentionally omits unrelated navigator/camera modules.
// Install those native seams before loading the two actual route components.
const routerIO = jest.requireMock('expo-router') as Record<string, unknown>;
routerIO.useNavigation = () => mockNavigation;
routerIO.useNavigationContainerRef = () => navigationFixture.rootRef;
routerIO.useRoute = () => navigationFixture.route;
routerIO.useFocusEffect = (effect: () => void | (() => void)) => React.useEffect(() => {
  if (mockFocused) return effect();
}, [effect, mockFocused]);
routerIO.Stack = Object.assign(function NativeStack() {
  React.useEffect(() => { mockStackMount(); return () => { mockStackUnmount(); }; }, []);
  const removed = React.useSyncExternalStore(navigationFixture.subscribe, navigationFixture.removed, navigationFixture.removed);
  if (removed) return null;
  const CaptureScreen = (require('@/app/sell/capture') as typeof import('@/app/sell/capture')).default;
  return <CaptureScreen />;
}, { Screen: () => null });
Object.assign(jest.requireMock('@/components/ui'), {
  Skeleton: jest.requireActual('@/components/ui/Skeleton').Skeleton,
});
Object.assign(AuthService, {
  initialize: jest.fn(async () => undefined),
  onAuthStateChanged: jest.fn((listener: (user: typeof auth.currentUser) => Promise<void>) => {
    void listener(auth.currentUser); return jest.fn();
  }),
});

const SellLayout = (require('@/app/sell/_layout') as typeof import('@/app/sell/_layout')).default;
const { useAuthListener } = require('@/features/auth/hooks/useAuthListener') as typeof import('@/features/auth/hooks/useAuthListener');
const { default: draftService } = require('@/features/sell/services/draftService') as typeof import('@/features/sell/services/draftService');

function ForegroundSell() { useAuthListener(); return <navigationFixture.Provider><SellLayout /></navigationFixture.Provider>; }
const selected: ImagePickerResult = { canceled: false, assets: [{ uri: 'file:///gallery/public-qa.jpg', width: 1024, height: 1024 }] };
function dispatchActivity(state: AppStateStatus): Promise<unknown>[] {
  AppState.currentState = state;
  return [...activityListeners].map(listener => Promise.resolve(listener(state)));
}
function allowedEligibility() {
  return { ...ownerEligibility(), publication: { scope: 'sell', allowed: true, status: 'allowed',
    reasons: [], messages: [], policyVersion: '2026-10-26.v1', civilDate: '2026-11-26', evaluationStage: 'foundations' } };
}
beforeEach(async () => {
  await resetEnvironment(); mockFocused = true; activityListeners.clear();
  navigationFixture.reset();
  (routerIO.router as { replace: jest.Mock }).replace.mockImplementation(() => navigationFixture.queueReplace());
  (routerIO.router as { back: jest.Mock }).back.mockImplementation(() => navigationFixture.queueBack());
  mockPicker.mockReset(); mockCopy.mockReset().mockResolvedValue();
  await establishSession('A');
  Object.assign(auth.currentUser!, { reload: jest.fn(async () => undefined) });
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    activityListeners.add(listener);
    return { remove: () => { activityListeners.delete(listener); } };
  });
  callableIO.mockResolvedValue({ data: allowedEligibility() });
});
afterEach(async () => { cleanup(); AppState.currentState = originalAppState; await AsyncStorage.clear(); jest.restoreAllMocks(); });

it.each(['continue', 'close'] as const)('keeps the actual photo and draft through foreground hydration, then saves before %s', async exit => {
  const picker = deferred<ImagePickerResult>(); mockPicker.mockReturnValueOnce(picker.promise);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  const capture = view.getByTestId('sell-capture-screen');
  await act(async () => undefined);
  const originalDraft = await draftService.loadDraft();
  expect(originalDraft?.id).toBeTruthy();
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await act(async () => { await Promise.all(dispatchActivity('background')); picker.resolve(selected); });
  expect(view.getByText('1 / 5')).toBeTruthy();
  const profileRead = deferred<ReturnType<typeof profile>>();
  authIO.getCurrentUser.mockReturnValueOnce(profileRead.promise);
  const generation = getAuthSessionGeneration();
  let foreground: Promise<unknown>[] = [];
  act(() => { foreground = dispatchActivity('active'); });
  await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(true));
  expect(getAuthSessionGeneration()).toBe(generation + 1);
  expect(mockStackUnmount).not.toHaveBeenCalled();
  expect(view.getByTestId('sell-capture-screen', { includeHiddenElements: true })).toBe(capture);
  expect(view.getByTestId('sell-admission-routes', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  expect(view.getByTestId('sell-admission-routes', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
  expect(view.queryByTestId('sell-capture-screen')).toBeNull();
  await act(async () => { profileRead.resolve(profile('A')); await Promise.all(foreground); });
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBe(capture));
  expect(view.getByText('1 / 5')).toBeTruthy();
  expect(mockStackMount).toHaveBeenCalledTimes(1);
  if (exit === 'continue') {
    fireEvent.press(view.getByTestId('sell-capture-continue'));
    await waitFor(() => expect((routerIO.router as { push: jest.Mock }).push).toHaveBeenCalledTimes(1));
  } else {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    fireEvent.press(view.getByTestId('sell-close-button'));
    act(() => navigationFixture.flush());
    expect(alert.mock.calls[0]?.slice(0, 3)).toEqual(['Quitter ?', expect.any(String), expect.any(Array)]);
    const originalAction = navigationFixture.prevented.at(-1);
    const nativeGuardWasActive = navigationFixture.nativeGuardActive();
    const leave = alert.mock.calls[0][2]?.find(button => button.text === 'Quitter');
    expect(leave).toBeDefined();
    await act(async () => { leave?.onPress?.(); });
    act(() => navigationFixture.flush());
    expect(alert).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(navigationFixture.removed()).toBe(true));
    expect(nativeGuardWasActive).toBe(true);
    expect(navigationFixture.nativeGuardActive()).toBe(false);
    expect(navigationFixture.dispatch.mock.calls.at(-1)?.[0]).toBe(originalAction);
    expect(originalAction).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(originalAction, 'source')).toBe(false);
    expect(Object.getOwnPropertySymbols(originalAction!)).not.toHaveLength(0);
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    expect(view.queryByTestId('sell-capture-screen')).toBeNull();
    expect(alert).not.toHaveBeenCalledWith('Brouillon non sauvegardé', expect.anything());
  }
  const saved = await draftService.loadDraft();
  expect(saved?.id).toBe(originalDraft?.id);
  expect(saved?.ownerUid).toBe('A'); expect(saved?.photos).toHaveLength(1);
  expect(mockCopy).toHaveBeenCalledWith(expect.objectContaining({ from: selected.assets[0].uri }));
  expect(saved?.photos[0]).toContain('/A/');
});

it('does not leave or claim a saved draft after a real cache failure, and permits a fresh explicit retry', async () => {
  mockPicker.mockResolvedValueOnce(selected);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await waitFor(() => expect(view.getByText('1 / 5')).toBeTruthy());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockCopy.mockRejectedValueOnce(new Error('Synthetic native cache failure'));
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  const confirm = alert.mock.calls[0][2]?.find(button => button.text === 'Quitter');
  await act(async () => { confirm?.onPress?.(); });
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Brouillon non sauvegardé', expect.any(String)));
  expect(navigationFixture.removed()).toBe(false);
  expect(navigationFixture.dispatch).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  const retry = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === 'Quitter');
  await act(async () => { retry?.onPress?.(); });
  await waitFor(() => expect(navigationFixture.removed()).toBe(true));
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect((await draftService.loadDraft())?.photos).toHaveLength(1);
});

it.each(['generation', 'actor', 'sdk-source', 'focus', 'root-container'] as const)('does not replay a confirmed native action after %s changes during persistence', async change => {
  mockPicker.mockResolvedValueOnce(selected);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await waitFor(() => expect(view.getByText('1 / 5')).toBeTruthy());
  const copy = deferred<void>(); mockCopy.mockReturnValueOnce(copy.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  const confirm = alert.mock.calls[0][2]?.find(button => button.text === 'Quitter');
  act(() => { confirm?.onPress?.(); });
  await waitFor(() => expect(mockCopy).toHaveBeenCalled());
  if (change === 'generation') await act(async () => useAuthStore.getState().hydrateFromFirebase(auth.currentUser));
  if (change === 'actor') await act(async () => establishSession('B'));
  if (change === 'sdk-source') {
    providerIdentity('A'); Object.assign(auth.currentUser!, { reload: jest.fn(async () => undefined) });
    view.rerender(<ForegroundSell />);
  }
  if (change === 'focus') { mockFocused = false; view.rerender(<ForegroundSell />); }
  if (change === 'root-container') navigationFixture.rootRef.current = { ...navigationFixture.rootNavigation, dispatch: jest.fn() };
  await act(async () => { copy.resolve(); });
  expect(navigationFixture.dispatch).toHaveBeenCalledTimes(1);
  expect(navigationFixture.removed()).toBe(false);
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalledWith('Brouillon non sauvegardé', expect.anything());
});

it('waits for actual empty-draft initialization before removing the empty draft and exiting without a prompt', async () => {
  const initialRead = deferred<string | null>();
  const read = environmentStorage.getItem.bind(environmentStorage);
  let intercepted = false;
  jest.spyOn(environmentStorage, 'getItem').mockImplementation(key => {
    if (key === '@article_draft:user:A' && !intercepted) {
      intercepted = true;
      return initialRead.promise;
    }
    return read(key);
  });
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  expect(intercepted).toBe(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  expect(navigationFixture.removed()).toBe(false);
  await act(async () => { initialRead.resolve(null); });
  await waitFor(() => expect(navigationFixture.removed()).toBe(true));
  expect(alert).not.toHaveBeenCalled();
  expect(await draftService.loadDraft()).toBeNull();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});

it('does not leave with an old photo snapshot when the selection changes during the confirmed save', async () => {
  mockPicker.mockResolvedValueOnce(selected);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await waitFor(() => expect(view.getByText('1 / 5')).toBeTruthy());
  const copy = deferred<void>(); mockCopy.mockReturnValueOnce(copy.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  act(() => { alert.mock.calls[0][2]?.find(button => button.text === 'Quitter')?.onPress?.(); });
  await waitFor(() => expect(mockCopy).toHaveBeenCalled());
  mockPicker.mockResolvedValueOnce({ ...selected, assets: [{ ...selected.assets[0], uri: 'file:///gallery/public-qa-second.jpg' }] });
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await waitFor(() => expect(view.getByText('2 / 5')).toBeTruthy());
  await act(async () => { copy.resolve(); });
  expect(navigationFixture.removed()).toBe(false);
  expect(alert).not.toHaveBeenCalledWith('Brouillon non sauvegardé', expect.anything());
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.find(button => button.text === 'Quitter')?.onPress?.(); });
  await waitFor(() => expect(navigationFixture.removed()).toBe(true));
  expect((await draftService.loadDraft())?.photos).toHaveLength(2);
});

it('cancels or dismisses one prompt without permitting a later different removal action', async () => {
  mockPicker.mockResolvedValueOnce(selected);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await waitFor(() => expect(view.getByText('1 / 5')).toBeTruthy());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  fireEvent.press(view.getByTestId('sell-close-button'));
  act(() => navigationFixture.flush());
  const firstConfirm = alert.mock.calls[0][2]?.find(button => button.text === 'Quitter');
  act(() => { alert.mock.calls[0][3]?.onDismiss?.(); });
  await act(async () => { firstConfirm?.onPress?.(); });
  expect(navigationFixture.dispatch).toHaveBeenCalledTimes(1);
  expect(navigationFixture.removed()).toBe(false);
  act(() => { navigationFixture.queueBack(); navigationFixture.flush(); });
  expect(alert).toHaveBeenCalledTimes(2);
  const secondAction = navigationFixture.prevented.at(-1);
  const secondConfirm = alert.mock.calls[1][2]?.find(button => button.text === 'Quitter');
  await act(async () => { secondConfirm?.onPress?.(); secondConfirm?.onPress?.(); });
  await waitFor(() => expect(navigationFixture.removed()).toBe(true));
  expect(navigationFixture.dispatch.mock.calls.at(-1)?.[0]).toBe(secondAction);
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
});

it.each(['different-owner', 'same-uid-new-sdk', 'A-B-A', 'A-B-A-batched-reused-sdk'] as const)('rejects a picker response from the former actor after %s', async change => {
  const picker = deferred<ImagePickerResult>(); mockPicker.mockReturnValueOnce(picker.promise);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  await act(async () => undefined);
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  jest.mocked(track).mockClear();
  if (change === 'same-uid-new-sdk') {
    providerIdentity('A'); Object.assign(auth.currentUser!, { reload: jest.fn(async () => undefined) });
    view.rerender(<ForegroundSell />);
  } else if (change === 'A-B-A-batched-reused-sdk') {
    const originalActor = auth.currentUser;
    await act(async () => {
      providerIdentity('B');
      const other = useAuthStore.getState().hydrateFromFirebase(auth.currentUser);
      Object.assign(auth, { currentUser: originalActor });
      const restored = useAuthStore.getState().hydrateFromFirebase(originalActor);
      picker.resolve(selected);
      await Promise.resolve();
      expect(track).not.toHaveBeenCalledWith('sell_photo_added', expect.anything());
      await Promise.all([other, restored]);
    });
    expect(auth.currentUser).toBe(originalActor);
  } else {
    await act(async () => establishSession('B'));
    if (change === 'A-B-A') await act(async () => establishSession('A'));
  }
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  await act(async () => { picker.resolve(selected); });
  expect(view.getByText('0 / 5')).toBeTruthy();
  expect(mockStackUnmount).toHaveBeenCalled();
  expect(mockCopy).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalledWith('sell_photo_added', expect.anything());
});

it('does not adopt a deferred gallery result after leaving the capture focus', async () => {
  const picker = deferred<ImagePickerResult>(); mockPicker.mockReturnValueOnce(picker.promise);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  await act(async () => undefined);
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  mockFocused = false; view.rerender(<ForegroundSell />);
  await act(async () => { picker.resolve(selected); });
  expect(mockCopy).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalledWith('sell_photo_added', expect.anything());
});

it('rejects a deferred gallery result after unmount even when the former native navigation still reports focus', async () => {
  const picker = deferred<ImagePickerResult>(); mockPicker.mockReturnValueOnce(picker.promise);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  await act(async () => undefined);
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  view.unmount();
  expect(mockNavigation.isFocused()).toBe(true);
  await act(async () => { picker.resolve(selected); });
  expect(mockCopy).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalledWith('sell_photo_added', expect.anything());
});

it('keeps the same local draft hidden after a fresh refusal and unlocks only after a fresh successful retry', async () => {
  mockPicker.mockResolvedValueOnce(selected);
  const view = render(<ForegroundSell />);
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBeTruthy());
  await act(async () => undefined);
  const capture = view.getByTestId('sell-capture-screen');
  const original = await draftService.loadDraft();
  fireEvent.press(view.getByTestId('sell-gallery-button'));
  await waitFor(() => expect(view.getByText('1 / 5')).toBeTruthy());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  callableIO.mockRejectedValueOnce(new Error('Temporary owner eligibility transport failure'));
  await act(async () => { await Promise.all(dispatchActivity('background')); await Promise.all(dispatchActivity('active')); });
  await waitFor(() => expect(view.getByText('Réessayer')).toBeTruthy());
  expect(alert).toHaveBeenCalled();
  expect(view.queryByTestId('sell-capture-screen')).toBeNull();
  expect(view.getByTestId('sell-capture-screen', { includeHiddenElements: true })).toBe(capture);
  expect(view.getByTestId('sell-admission-routes', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  expect(mockStackUnmount).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Réessayer'));
  await waitFor(() => expect(view.getByTestId('sell-capture-screen')).toBe(capture));
  expect(view.getByText('1 / 5')).toBeTruthy();
  expect(view.getByTestId('sell-admission-routes').props.pointerEvents).toBe('auto');
  fireEvent.press(view.getByTestId('sell-capture-continue'));
  await waitFor(() => expect((routerIO.router as { push: jest.Mock }).push).toHaveBeenCalledTimes(1));
  const saved = await draftService.loadDraft();
  expect(saved?.id).toBe(original?.id); expect(saved?.photos).toHaveLength(1);
});
