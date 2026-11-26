import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTrocMosaicMotion } from '@/features/home/swap-zone/useTrocMosaicMotion';

describe('Le Troc — mouvement décoratif', () => {
  let onMotionChange: (enabled: boolean) => void;
  let onAppStateChange: (state: AppStateStatus) => void;
  const removeMotion = jest.fn();
  const removeAppState = jest.fn();

  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    // This hook subscribes only to reduceMotionChanged, not the announcement overload.
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, handler: (enabled: boolean) => void) => {
      onMotionChange = handler;
      return { remove: removeMotion };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
      onAppStateChange = handler;
      return { remove: removeAppState };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('s’arrête au changement d’écran, en arrière-plan et quand Réduire les animations est activé', async () => {
    const { result, unmount } = renderHook(useTrocMosaicMotion);
    expect(result.current).toBe(false);
    act(() => onAppStateChange('active'));
    let blur: (() => void) | undefined;
    act(() => {
      blur = jest.mocked(useFocusEffect).mock.calls[0][0]() ?? undefined;
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => onAppStateChange('background'));
    expect(result.current).toBe(false);
    act(() => onAppStateChange('active'));
    expect(result.current).toBe(true);
    act(() => onMotionChange(true));
    expect(result.current).toBe(false);
    act(() => onMotionChange(false));
    expect(result.current).toBe(true);
    act(() => blur?.());
    expect(result.current).toBe(false);

    unmount();
    expect(removeMotion).toHaveBeenCalledTimes(1);
    expect(removeAppState).toHaveBeenCalledTimes(1);
  });

  it('ne réactive pas le mouvement si une ancienne lecture du réglage arrive après son changement', async () => {
    let resolvePreference: (enabled: boolean) => void = () => {};
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise((resolve) => {
      resolvePreference = resolve;
    }));
    const { result } = renderHook(useTrocMosaicMotion);
    act(() => onAppStateChange('active'));
    act(() => { jest.mocked(useFocusEffect).mock.calls[0][0](); });
    act(() => onMotionChange(true));
    await act(async () => resolvePreference(false));
    expect(result.current).toBe(false);
  });
});
