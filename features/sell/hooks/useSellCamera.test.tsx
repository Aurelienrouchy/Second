import { act, renderHook } from '@testing-library/react-native';
import { useSellCamera } from './useSellCamera';

describe('sell camera sessions', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

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
    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.error).toBe(true);
    const failedKey = result.current.mountKey;
    act(() => result.current.retry());
    expect(result.current.error).toBe(false);
    expect(result.current.mountKey).not.toBe(failedKey);
    act(() => result.current.onMountError());
    expect(result.current.error).toBe(true);
    act(() => result.current.retry());
    act(() => result.current.onReady());
    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.error).toBe(false);
  });
});
