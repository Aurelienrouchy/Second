import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { ImmersivePresentation } from '@/store/immersiveOverlayStore';

let mockPermission = { granted: false, status: 'denied', canAskAgain: false };
const mockRequestPermission = jest.fn();
const mockTakePicture = jest.fn();
const mockCameraMount = jest.fn();
const mockCameraUnmount = jest.fn();
const mockTimings: number[] = [];
const mockNavigation = { isFocused: () => true, addListener: () => jest.fn() };
let mockActivity: ((state: AppStateStatus) => void) | undefined;
const originalActivity = AppState.currentState;

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/components/PrivateStorageImage', () => ({ PrivateStorageImage: () => null }));
jest.mock('react-native-reanimated', () => {
  const official = jest.requireActual('react-native-reanimated/mock');
  const react = jest.requireActual<typeof import('react')>('react');
  return { ...official,
    useSharedValue: (initial: number) => react.useState(() => official.useSharedValue(initial))[0],
    withTiming: (value: number, config: { duration: number }) => { mockTimings.push(config.duration); return value; },
  };
});
jest.mock('expo-camera', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Camera = react.forwardRef<{ takePictureAsync: typeof mockTakePicture }, { onCameraReady: () => void }>((props, ref) => {
    react.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePicture }));
    react.useEffect(() => { mockCameraMount(); return () => { mockCameraUnmount(); }; }, []);
    return react.createElement(View, {...props, testID: 'native-camera'});
  });
  return { CameraView: Camera, useCameraPermissions: () => [mockPermission, mockRequestPermission] };
});
jest.mock('expo-blur', () => ({ BlurView: ({ children }: { children: React.ReactNode }) =>
  require('react').createElement(require('react-native').View, { testID: 'capture-blur' }, children),
}));
const mockDraft: { id: string; photos: string[]; storageUrls: string[] } = { id: 'test', photos: [], storageUrls: [] };
const mockLoadDraft = jest.fn(() => Promise.resolve(mockDraft));
const mockSavePhotos = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
jest.mock('@/features/sell/services/draftService', () => ({
  __esModule: true,
  default: { assertCurrentOwner: jest.fn(), loadDraft: () => mockLoadDraft(), saveDraft: jest.fn(), updateDraftPhotos: (...args: unknown[]) => mockSavePhotos(...args) },
  createEmptyDraft: () => mockDraft,
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: () => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///gallery/selected.jpg' }] }),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
import { SellOverlayCapture } from '@/features/sell/components/capture/SellOverlayCapture';

describe('gallery capture with camera denied', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockTimings.length = 0;
    mockPermission = { granted: false, status: 'denied', canAskAgain: false };
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      mockActivity = listener; return { remove: jest.fn() };
    });
  });
  afterEach(() => { AppState.currentState = originalActivity; jest.restoreAllMocks(); });

  it('lets gallery photos continue after persistence, without waiting for the debounce', async () => {
    const onContinue = jest.fn();
    const screen = render(<SellOverlayCapture onClose={jest.fn()} onContinue={onContinue} />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId('sell-gallery-button'));
    await waitFor(() => expect(screen.getByTestId('sell-capture-continue')).toBeTruthy());
    let finishSave: () => void = () => undefined;
    mockSavePhotos.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(mockDraft); }));
    fireEvent.press(screen.getByTestId('sell-capture-continue'));
    await waitFor(() => expect(mockSavePhotos).toHaveBeenCalledWith(mockDraft, ['file:///gallery/selected.jpg']));
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => finishSave());
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(['file:///gallery/selected.jpg']));
  });

  it('shows the prepared camera without presentation delay, but restores the draft before allowing photo edits', async () => {
    jest.useFakeTimers();
    try {
    mockPermission = { granted: true, status: 'granted', canAskAgain: true };
    let resolveDraft!: (value: typeof mockDraft) => void;
    mockLoadDraft.mockReturnValueOnce(new Promise(resolve => { resolveDraft = resolve; }));
    mockTakePicture.mockResolvedValueOnce({ uri: 'file:///new.jpg' });
    const onReady = jest.fn();
    const initial: ImmersivePresentation = { entranceFinished: false, visible: false, active: true, onReady };
    const props = { onClose: jest.fn(), onContinue: jest.fn() };
    const screen = render(<SellOverlayCapture {...props} presentation={initial} />);
    const native = screen.getByTestId('native-camera');
    expect(screen.queryAllByTestId('capture-blur')).toHaveLength(0);
    expect(mockLoadDraft).not.toHaveBeenCalled();
    fireEvent(native, 'cameraReady');
    expect(onReady).toHaveBeenLastCalledWith(true);
    expect(mockTimings).not.toContain(260);
    screen.rerender(<SellOverlayCapture {...props} presentation={{...initial, entranceFinished: true, visible: true}} />);
    expect(screen.queryAllByTestId('capture-blur')).toHaveLength(2);
    fireEvent.press(screen.getByTestId('sell-capture-button'));
    expect(mockTakePicture).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sell-gallery-button')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockSavePhotos).not.toHaveBeenCalled();
    expect(screen.getByTestId('native-camera')).toBe(native);
    expect(mockCameraMount).toHaveBeenCalledTimes(1);
    expect(mockCameraUnmount).not.toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    const restored = {...mockDraft, photos: ['file:///old.jpg']};
    await act(async () => { resolveDraft(restored); });
    await act(async () => { fireEvent.press(screen.getByTestId('sell-capture-button')); });
    expect(mockTakePicture).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('sell-capture-continue'));
    await waitFor(() => expect(mockSavePhotos).toHaveBeenCalledWith(restored, ['file:///old.jpg', 'file:///new.jpg']));
    expect(props.onContinue).toHaveBeenCalledWith(['file:///old.jpg', 'file:///new.jpg']);
    expect(mockSavePhotos.mock.calls.every(([, photos]) => (photos as string[]).length > 0)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for entrance completion before requesting OS permission and admits the denied fallback', async () => {
    mockPermission = { granted: false, status: 'undetermined', canAskAgain: true };
    const onReady = jest.fn();
    const initial: ImmersivePresentation = { entranceFinished: false, visible: false, active: true, onReady };
    const props = { onClose: jest.fn(), onContinue: jest.fn() };
    const screen = render(<SellOverlayCapture {...props} presentation={initial} />);
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenLastCalledWith(false);
    await act(async () => { screen.rerender(<SellOverlayCapture {...props} presentation={{...initial, entranceFinished: true}} />); });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    mockPermission = { granted: false, status: 'denied', canAskAgain: false };
    screen.rerender(<SellOverlayCapture {...props} presentation={{...initial, entranceFinished: true}} />);
    expect(onReady).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Accès caméra requis')).toBeTruthy();
    expect(screen.queryByTestId('native-camera')).toBeNull();
  });

  it('stops hidden preparation in the background and rejects the old native ready event on resumption', () => {
    mockPermission = { granted: true, status: 'granted', canAskAgain: true };
    const onReady = jest.fn();
    const presentation: ImmersivePresentation = { entranceFinished: false, visible: false, active: true, onReady };
    const screen = render(<SellOverlayCapture onClose={jest.fn()} onContinue={jest.fn()} presentation={presentation} />);
    const oldReady = screen.getByTestId('native-camera').props.onCameraReady;
    act(() => mockActivity?.('background'));
    expect(screen.queryByTestId('native-camera')).toBeNull();
    act(() => oldReady());
    expect(onReady).toHaveBeenLastCalledWith(false);
    act(() => mockActivity?.('active'));
    const currentReady = screen.getByTestId('native-camera').props.onCameraReady;
    act(() => oldReady());
    expect(onReady).toHaveBeenLastCalledWith(false);
    act(() => currentReady());
    expect(onReady).toHaveBeenLastCalledWith(true);
  });
});
