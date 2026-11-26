import { act, renderHook } from '@testing-library/react-native';
import { useSellCamera } from './useSellCamera';

describe('sell camera sessions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('remounts on flip, disables capture until ready and turns the rear torch off', () => {
    const { result } = renderHook(() => useSellCamera(true));
    act(() => result.current.onReady());
    act(() => result.current.toggleTorch());
    expect(result.current.torchActive).toBe(true);
    const backKey = result.current.mountKey;
    const oldReady = result.current.onReady;
    act(() => result.current.flip());
    expect(result.current.facing).toBe('front');
    expect(result.current.mountKey).not.toBe(backKey);
    expect(result.current.ready).toBe(false);
    act(() => { oldReady(); });
    expect(result.current.ready).toBe(false);
    expect(result.current.torchActive).toBe(false);
    act(() => result.current.onReady());
    act(() => result.current.toggleTorch());
    expect(result.current.torchActive).toBe(false);
  });

  it('offers a new session after a native mount error or missing ready event', () => {
    const { result } = renderHook(() => useSellCamera(true));
    const timedOutReady = result.current.onReady;
    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.error).toBe(true);
    act(() => { expect(timedOutReady()).toBe(false); });
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBe(true);
    const failedKey = result.current.mountKey;
    act(() => result.current.retry());
    expect(result.current.error).toBe(false);
    expect(result.current.mountKey).not.toBe(failedKey);
    const nativeFailedReady = result.current.onReady;
    act(() => result.current.onMountError({ message: 'Camera unavailable' }));
    expect(result.current.error).toBe(true);
    act(() => { expect(nativeFailedReady()).toBe(false); });
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBe(true);
    act(() => result.current.retry());
    act(() => { expect(nativeFailedReady()).toBe(false); });
    act(() => result.current.onReady());
    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBe(false);
  });

  it('rejects repeated shots and lens changes immediately while a capture is pending', () => {
    const { result } = renderHook(() => useSellCamera(true));
    act(() => result.current.onReady());
    const originalKey = result.current.mountKey;
    let capture!: NonNullable<ReturnType<typeof result.current.beginCapture>>;
    act(() => {
      capture = result.current.beginCapture()!;
      expect(result.current.beginCapture()).toBeNull();
      result.current.flip();
      result.current.toggleTorch();
    });
    expect(result.current.isCapturing).toBe(true);
    expect(result.current.flipAvailable).toBe(false);
    expect(result.current.torchAvailable).toBe(false);
    expect(result.current.mountKey).toBe(originalKey);
    expect(result.current.facing).toBe('back');
    expect(result.current.torchActive).toBe(false);
    expect(result.current.isCaptureCurrent(capture)).toBe(true);
    act(() => result.current.finishCapture(capture));
    expect(result.current.isCapturing).toBe(false);
    act(() => result.current.flip());
    expect(result.current.facing).toBe('front');
    expect(result.current.isCaptureCurrent(capture)).toBe(false);
  });

  it('keeps retry usable after a capture session fails and ignores its late completion', () => {
    const { result } = renderHook(() => useSellCamera(true));
    act(() => result.current.onReady());
    let oldCapture!: NonNullable<ReturnType<typeof result.current.beginCapture>>;
    act(() => { oldCapture = result.current.beginCapture()!; });
    act(() => result.current.onMountError({ message: 'Camera interrupted' }));
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.isCaptureCurrent(oldCapture)).toBe(false);
    act(() => result.current.retry());
    act(() => result.current.onReady());
    let newCapture!: NonNullable<ReturnType<typeof result.current.beginCapture>>;
    act(() => { newCapture = result.current.beginCapture()!; });
    act(() => result.current.finishCapture(oldCapture));
    expect(result.current.isCapturing).toBe(true);
    expect(result.current.isCaptureCurrent(oldCapture)).toBe(false);
    expect(result.current.isCaptureCurrent(newCapture)).toBe(true);
    act(() => result.current.finishCapture(newCapture));
    expect(result.current.isCapturing).toBe(false);
  });

  it('rejects an old torch action during a lens change before the next render', () => {
    const { result } = renderHook(() => useSellCamera(true));
    act(() => result.current.onReady());
    const oldToggle = result.current.toggleTorch;
    act(() => {
      result.current.flip();
      oldToggle();
    });
    expect(result.current.facing).toBe('front');
    expect(result.current.torchActive).toBe(false);
    expect(result.current.ready).toBe(false);
    expect(result.current.beginCapture()).toBeNull();
  });

  it('invalidates pending captures and rear torch when inactive, then starts a new session', () => {
    const { result, rerender } = renderHook(({ enabled }) => useSellCamera(enabled), { initialProps: { enabled: true } });
    act(() => result.current.onReady());
    act(() => result.current.toggleTorch());
    expect(result.current.torchActive).toBe(true);
    const oldKey = result.current.mountKey;
    const oldReady = result.current.onReady;
    let capture!: NonNullable<ReturnType<typeof result.current.beginCapture>>;
    act(() => { capture = result.current.beginCapture()!; });
    rerender({ enabled: false });
    act(() => { oldReady(); result.current.toggleTorch(); });
    expect(result.current.ready).toBe(false);
    expect(result.current.torchActive).toBe(false);
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.isCaptureCurrent(capture)).toBe(false);
    expect(result.current.beginCapture()).toBeNull();
    rerender({ enabled: true });
    expect(result.current.mountKey).not.toBe(oldKey);
    act(() => { expect(oldReady()).toBe(false); });
    expect(result.current.ready).toBe(false);
    act(() => result.current.onReady());
    expect(result.current.ready).toBe(true);
    expect(result.current.torchActive).toBe(false);
  });

  it('requires explicit retry after an error even if enabled changes', () => {
    const { result, rerender } = renderHook(({ enabled }) => useSellCamera(enabled), { initialProps: { enabled: true } });
    act(() => result.current.onMountError({ message: 'Camera failed' }));
    rerender({ enabled: false });
    rerender({ enabled: true });
    act(() => { expect(result.current.onReady()).toBe(false); });
    expect(result.current.error).toBe(true);
    expect(result.current.beginCapture()).toBeNull();
    act(() => result.current.retry());
    act(() => result.current.onReady());
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBe(false);
  });
});
