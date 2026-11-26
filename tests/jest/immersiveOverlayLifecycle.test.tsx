import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ImmersiveOverlay } from '@/components/ui/ImmersiveOverlay';
import { animations } from '@/constants/theme';
import { Easing, type SharedValue } from 'react-native-reanimated';
import { Button } from '@/components/ui/Button';
import { useImmersiveOverlayStore, type ImmersiveOpening, type ImmersivePresentation } from '@/store/immersiveOverlayStore';
import { useAuthStore } from '@/store/authStore';
import { CONTENT_REVEAL_TIME, ENTERING_TIME, EXITING_TIME } from '@/components/ui/ImmersiveOverlay/constants';

interface Timing {
  value: number;
  duration: number;
  complete?: (finished: boolean) => void;
}

const mockTimings: Timing[] = [];
const mockReactions = new Set<() => void>();
let mockGeneration = 1;

// Native callbacks are deliberately completed by the test, including callbacks
// already queued before cancellation. The overlay and its Zustand store are real.
jest.mock('react-native-reanimated', () => {
  const official = jest.requireActual('react-native-reanimated/mock');
  const react = jest.requireActual<typeof import('react')>('react');
  const { Easing } = jest.requireActual<{ Easing: typeof import('react-native-reanimated')['Easing'] }>('react-native-reanimated/src/Easing');
  return {
    ...official,
    Easing,
    // The official mock recreates shared values on every render, unlike the
    // native hook. Preserve native identity so effect cleanup means unmount.
    useSharedValue: (initial: number) => {
      const [shared] = react.useState(() => official.useSharedValue(initial));
      return shared;
    },
    withTiming: (value: number, config: { duration: number }, complete?: Timing['complete']) => {
      mockTimings.push({ value, duration: config.duration, complete });
      return value;
    },
    useAnimatedReaction: <T,>(prepare: () => T, reaction: (current: T, previous: T | null) => void) => {
      const previous = react.useRef<T | null>(null);
      react.useEffect(() => {
        const run = () => {
          const current = prepare(); reaction(current, previous.current); previous.current = current;
        };
        mockReactions.add(run);
        return () => { mockReactions.delete(run); };
      }, [prepare, reaction]);
    },
  };
});

jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
}));

jest.mock('@/store/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    getAuthSessionGeneration: () => mockGeneration,
    useAuthStore: create(() => ({ authenticatedUid: 'owner' })),
  };
});

jest.mock('@/components/ui/ImmersiveOverlay/Gradient', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Gradient: ({ onSceneReady }: { onSceneReady: () => void }) => react.createElement(
      View, { testID: 'skia-scene', ...{ onSceneReady } }
    ),
  };
});

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

function timing(duration: number, value: number): Timing {
  const found = mockTimings.findLast((item) => item.duration === duration && item.value === value && item.complete);
  if (!found) throw new Error(`Missing animation: ${duration}ms to ${value}`);
  return found;
}

function layOutScene(screen: ReturnType<typeof render>) {
  fireEvent(screen.getByTestId('immersive-overlay-layer'), 'layout', layout);
  fireEvent(screen.getByTestId('skia-scene'), 'sceneReady');
}

function sampleEntrance(screen: ReturnType<typeof render>, elapsed: number) {
  const progress = screen.UNSAFE_root.find(node => node.props.contentReveal !== undefined).props.progress as SharedValue<number>;
  act(() => {
    progress.set(Easing.bezier(0.65, 0, 0.35, 1).factory()(Math.min(elapsed / ENTERING_TIME, 1)));
    mockReactions.forEach(run => run());
  });
}
const preparedOpacity = (screen: ReturnType<typeof render>) =>
  (screen.UNSAFE_root.find(node => node.props.contentReveal !== undefined).props.contentReveal as SharedValue<number>).get();

describe('ImmersiveOverlay opening lifecycle', () => {
  beforeEach(() => {
    useImmersiveOverlayStore.getState().reset();
    mockTimings.length = 0;
    mockReactions.clear();
    mockGeneration = 1;
    useAuthStore.setState({ authenticatedUid: 'owner' });
  });

  it('lays out the new shell before animating, then mounts and reveals content once', () => {
    const mounted = jest.fn();
    const unmounted = jest.fn();
    function CameraContent() {
      useEffect(() => { mounted(); return unmounted; }, []);
      return <Text>Camera content</Text>;
    }
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <CameraContent /> }));

    expect(screen.queryByText('Camera content')).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    expect(mockTimings).toHaveLength(0);
    fireEvent(screen.getByTestId('immersive-overlay-layer'), 'layout', layout);
    expect(mockTimings).toHaveLength(0);
    fireEvent(screen.getByTestId('skia-scene'), 'sceneReady');
    const entrance = timing(ENTERING_TIME, 1);
    expect(mounted).not.toHaveBeenCalled();

    act(() => entrance.complete?.(true));
    expect(screen.getByText('Camera content')).toBeOnTheScreen();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(mockTimings.some((item) => item.duration === CONTENT_REVEAL_TIME)).toBe(false);

    fireEvent(screen.getByTestId('immersive-overlay-content'), 'layout', layout);
    expect(timing(CONTENT_REVEAL_TIME, 1)).toBeDefined();
    fireEvent(screen.getByTestId('immersive-overlay-content'), 'layout', layout);
    expect(mockTimings.filter((item) => item.duration === CONTENT_REVEAL_TIME)).toHaveLength(1);
    screen.rerender(<ImmersiveOverlay><Text>Updated tabs</Text></ImmersiveOverlay>);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it('ignores a late first layout when dismissed before the shell appears', () => {
    const onDismissed = jest.fn();
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Camera</Text> }));
    const lateLayout = screen.getByTestId('immersive-overlay-layer').props.onLayout;
    const lateScene = screen.getByTestId('skia-scene').props.onSceneReady;
    fireEvent(screen.getByTestId('skia-scene'), 'sceneReady');
    expect(mockTimings).toHaveLength(0);
    act(() => useImmersiveOverlayStore.getState().dismiss?.({ onDismissed }));
    act(() => { lateLayout(layout); lateScene(); });
    expect(mockTimings.some((item) => item.duration === ENTERING_TIME)).toBe(false);
    expect(screen.queryByText('Camera')).toBeNull();
    act(() => timing(EXITING_TIME, 0).complete?.(true));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it('rejects old layout, entrance and exit callbacks after a rapid reopen', () => {
    const onOldDismissed = jest.fn();
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Old camera</Text> }));
    const oldLayout = screen.getByTestId('immersive-overlay-layer').props.onLayout;
    const oldScene = screen.getByTestId('skia-scene').props.onSceneReady;
    layOutScene(screen);
    const oldEntrance = timing(ENTERING_TIME, 1);
    act(() => useImmersiveOverlayStore.getState().dismiss?.({ onDismissed: onOldDismissed }));
    const oldExit = timing(EXITING_TIME, 0);
    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>New camera</Text> }));
    const timingCount = mockTimings.length;
    act(() => {
      oldLayout(layout);
      oldScene();
      oldEntrance.complete?.(true);
      oldExit.complete?.(true);
    });
    expect(mockTimings).toHaveLength(timingCount);
    expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
    expect(screen.queryByText('Old camera')).toBeNull();
    expect(screen.queryByText('New camera')).toBeNull();
    expect(onOldDismissed).not.toHaveBeenCalled();
    layOutScene(screen);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    expect(screen.getByText('New camera')).toBeOnTheScreen();
  });

  it('invalidates deferred content for an obsolete opener, session reset and unmount', () => {
    let openerCurrent = true;
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => useImmersiveOverlayStore.getState().immerse?.({
      component: <Text>Camera</Text>, isCurrent: () => openerCurrent,
    }));
    layOutScene(screen);
    const obsoleteEntrance = timing(ENTERING_TIME, 1);
    openerCurrent = false;
    act(() => obsoleteEntrance.complete?.(true));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    expect(screen.queryByText('Camera')).toBeNull();

    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Camera</Text> }));
    layOutScene(screen);
    const oldSessionEntrance = timing(ENTERING_TIME, 1);
    act(() => { mockGeneration++; useAuthStore.setState({ authenticatedUid: 'owner' }); });
    act(() => oldSessionEntrance.complete?.(true));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    expect(screen.queryByText('Camera')).toBeNull();

    act(() => useImmersiveOverlayStore.getState().reset());
    expect(useImmersiveOverlayStore.getState().immerse).toEqual(expect.any(Function));
    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Camera</Text> }));
    layOutScene(screen);
    const unmountedEntrance = timing(ENTERING_TIME, 1);
    screen.unmount();
    act(() => unmountedEntrance.complete?.(true));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    expect(useImmersiveOverlayStore.getState().immerse).toBeNull();
  });

  it('keeps mounted content through same-owner foreground revalidation and qualifies the close separately', () => {
    const onDismissed = jest.fn();
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    const openingGeneration = mockGeneration;
    act(() => useImmersiveOverlayStore.getState().immerse?.({
      component: <Text>Camera</Text>, isCurrent: () => mockGeneration === openingGeneration,
    }));
    layOutScene(screen);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    const mountedCamera = screen.getByText('Camera');
    act(() => { mockGeneration++; useAuthStore.setState({ authenticatedUid: 'owner' }); });
    fireEvent(screen.getByTestId('immersive-overlay-content'), 'layout', layout);
    act(() => timing(CONTENT_REVEAL_TIME, 1).complete?.(true));
    expect(screen.getByText('Camera')).toBe(mountedCamera);
    expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
    act(() => useImmersiveOverlayStore.getState().dismiss?.({ onDismissed }));
    act(() => timing(EXITING_TIME, 0).complete?.(true));
    expect(onDismissed).toHaveBeenCalledTimes(1);

    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Camera</Text> }));
    layOutScene(screen);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    act(() => useImmersiveOverlayStore.getState().dismiss?.({ onDismissed }));
    const staleExit = timing(EXITING_TIME, 0);
    act(() => { mockGeneration++; useAuthStore.setState({ authenticatedUid: 'owner' }); });
    act(() => staleExit.complete?.(true));
    expect(onDismissed).toHaveBeenCalledTimes(1);
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
  });

  it('closes mounted content on owner change and reset, and rejects their old callbacks', () => {
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Camera</Text> }));
    layOutScene(screen);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    const oldContentLayout = screen.getByTestId('immersive-overlay-content').props.onLayout;
    act(() => useAuthStore.setState({ authenticatedUid: 'other-owner' }));
    act(() => oldContentLayout(layout));
    expect(screen.queryByText('Camera')).toBeNull();
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);

    act(() => useImmersiveOverlayStore.getState().immerse?.({ component: <Text>Camera</Text> }));
    layOutScene(screen);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    const beforeResetLayout = screen.getByTestId('immersive-overlay-content').props.onLayout;
    act(() => useImmersiveOverlayStore.getState().reset());
    act(() => beforeResetLayout(layout));
    expect(screen.queryByText('Camera')).toBeNull();
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
  });

  it('cancels a pending ticket immediately and rejects its content and native cancel event after reopen', () => {
    const onDismiss = jest.fn();
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    let first: ImmersiveOpening | null = null;
    act(() => { first = useImmersiveOverlayStore.getState().immerse?.({ onDismiss }) ?? null; });
    const lateCancel = screen.UNSAFE_getByType(Button).props.onPress;
    fireEvent.press(screen.getByTestId('immersive-overlay-cancel'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(first!.isCurrent()).toBe(false);

    let second: ImmersiveOpening | null = null;
    act(() => { second = useImmersiveOverlayStore.getState().immerse?.() ?? null; });
    act(() => lateCancel());
    expect(second!.isCurrent()).toBe(true);
    act(() => { expect(first!.setContent(<Text>Old camera</Text>)).toBe(false); });
    act(() => { expect(second!.setContent(<Text>Current camera</Text>)).toBe(true); });
    expect(screen.queryByText('Current camera')).toBeNull();
    layOutScene(screen);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    expect(screen.queryByText('Old camera')).toBeNull();
    expect(screen.getByText('Current camera')).toBeOnTheScreen();
  });

  it.each([200, 600])('fades ready content during the remaining entrance window (ready at %ims) and completes at 750ms', readyAt => {
    const mounted = jest.fn();
    let presentation: ImmersivePresentation | null = null;
    function PreparedCamera({ state }: { state: ImmersivePresentation }) {
      presentation = state;
      useEffect(() => { mounted(); }, []);
      return <Text>{state.visible ? 'Visible camera' : 'Preparing camera'}</Text>;
    }
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    let opening: ImmersiveOpening | null = null;
    act(() => { opening = useImmersiveOverlayStore.getState().immerse?.() ?? null; });
    act(() => { opening!.prepareContent(state => <PreparedCamera state={state} />); });
    expect(mounted).not.toHaveBeenCalled();
    layOutScene(screen);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(presentation!.entranceFinished).toBe(false);
    expect(presentation!.visible).toBe(false);
    fireEvent(screen.getByTestId('immersive-overlay-content', { includeHiddenElements: true }), 'layout', layout);
    expect(screen.getByTestId('immersive-overlay-cancel')).toBeTruthy();
    sampleEntrance(screen, readyAt);
    act(() => presentation!.onReady(true));
    sampleEntrance(screen, Math.max(readyAt, ENTERING_TIME - animations.duration.normal));
    expect(presentation!.visible).toBe(false);
    expect(preparedOpacity(screen)).toBe(0);
    sampleEntrance(screen, (Math.max(readyAt, ENTERING_TIME - animations.duration.normal) + ENTERING_TIME) / 2);
    expect(preparedOpacity(screen)).toBeGreaterThan(0);
    expect(preparedOpacity(screen)).toBeLessThan(1);
    expect(presentation!.visible).toBe(false);
    expect(screen.getByTestId('immersive-overlay-cancel')).toBeTruthy();
    sampleEntrance(screen, ENTERING_TIME);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    expect(preparedOpacity(screen)).toBe(1);
    expect(presentation!.visible).toBe(true);
    expect(screen.getByText('Visible camera')).toBeOnTheScreen();
    expect(mockTimings.some(item => item.duration === CONTENT_REVEAL_TIME)).toBe(false);
    expect(mounted).toHaveBeenCalledTimes(1);
    const timingCount = mockTimings.length;
    act(() => { presentation!.onReady(false); presentation!.onReady(true); });
    sampleEntrance(screen, ENTERING_TIME);
    expect(mockTimings).toHaveLength(timingCount);
  });

  it('starts a single normal fade immediately when native readiness arrives after the entrance', () => {
    let presentation: ImmersivePresentation | null = null;
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => {
      const opening = useImmersiveOverlayStore.getState().immerse?.();
      opening?.prepareContent(state => { presentation = state; return <Text>Late camera</Text>; });
    });
    layOutScene(screen);
    fireEvent(screen.getByTestId('immersive-overlay-content', { includeHiddenElements: true }), 'layout', layout);
    sampleEntrance(screen, ENTERING_TIME);
    act(() => timing(ENTERING_TIME, 1).complete?.(true));
    expect(presentation!.visible).toBe(false);
    expect(preparedOpacity(screen)).toBe(0);
    act(() => presentation!.onReady(true));
    sampleEntrance(screen, ENTERING_TIME);
    const fade = timing(animations.duration.normal, 1);
    expect(presentation!.visible).toBe(false);
    act(() => presentation!.onReady(true));
    sampleEntrance(screen, ENTERING_TIME);
    expect(mockTimings.filter(item => item.duration === animations.duration.normal && item.value === 1)).toHaveLength(1);
    act(() => fade.complete?.(true));
    expect(presentation!.visible).toBe(true);
    expect(mockTimings.some(item => item.duration === CONTENT_REVEAL_TIME)).toBe(false);
    act(() => useImmersiveOverlayStore.getState().immerse?.());
    act(() => fade.complete?.(true));
    expect(screen.queryByText('Late camera')).toBeNull();
    expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
  });

  it('keeps preparation strictly qualified and ignores a late ready callback after a close or reopen', () => {
    let ready: ((value: boolean) => void) | undefined;
    const screen = render(<ImmersiveOverlay><Text>Tabs</Text></ImmersiveOverlay>);
    act(() => {
      const opening = useImmersiveOverlayStore.getState().immerse?.();
      opening?.prepareContent(state => { ready = state.onReady; return <Text>Prepared camera</Text>; });
    });
    layOutScene(screen);
    const oldReady = ready!;
    act(() => { mockGeneration++; useAuthStore.setState({ authenticatedUid: 'owner' }); });
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    act(() => useImmersiveOverlayStore.getState().immerse?.());
    act(() => oldReady(true));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
    expect(screen.queryByText('Prepared camera')).toBeNull();
    expect(mockTimings.some(item => item.duration === CONTENT_REVEAL_TIME)).toBe(false);
  });
});
