import React from 'react';
import type { NavigationAction, StackNavigationState } from 'expo-router/react-navigation';

const { StackRouter } = jest.requireActual<typeof import('expo-router/build/react-navigation/routers/StackRouter')>('expo-router/build/react-navigation/routers/StackRouter');
const { shouldPreventRemove } = jest.requireActual<typeof import('expo-router/build/react-navigation/core/useOnPreventRemove')>('expo-router/build/react-navigation/core/useOnPreventRemove');
const { NavigationContext } = jest.requireActual<typeof import('expo-router/build/react-navigation/core/NavigationContext')>('expo-router/build/react-navigation/core/NavigationContext');
const { NavigationRouteContext } = jest.requireActual<typeof import('expo-router/build/react-navigation/core/NavigationProvider')>('expo-router/build/react-navigation/core/NavigationProvider');
const { PreventRemoveContext } = jest.requireActual<typeof import('expo-router/build/react-navigation/core/PreventRemoveContext')>('expo-router/build/react-navigation/core/PreventRemoveContext');

interface NativeEvent {
  type: string;
  target?: string;
  data: { action: NavigationAction };
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** Native navigation IO fixture. The installed StackRouter and removal traversal
 * remain real, including their opaque visited-route action symbol. Router calls
 * enqueue first; tests explicitly deliver them after the caller's finally. */
export function createSellNavigationFixture(focused: () => boolean, screen = 'capture') {
  const router = StackRouter({});
  const screenKey = `${screen}-key`;
  const route = { name: screen, key: screenKey };
  const childNames = screen === 'capture' ? ['capture'] : ['details', screen];
  const options = { routeNames: ['(tabs)', 'sell'], routeParamList: {}, routeGetIdList: {} };
  const childOptions = { routeNames: childNames, routeParamList: {}, routeGetIdList: {} };
  const makeChild = (): StackNavigationState<Record<string, object | undefined>> => ({
    ...router.getInitialState(childOptions), key: 'sell-stack', index: childNames.length - 1,
    routes: childNames.map(name => ({ name, key: `${name}-key` })),
  });
  const makeRoot = (): StackNavigationState<Record<string, object | undefined>> => ({
    ...router.getInitialState(options), key: 'root-stack', index: 1,
    routes: [{ key: 'tabs-key', name: '(tabs)' }, { key: 'sell-key', name: 'sell', state: makeChild() }],
  });
  let state = makeRoot(), ready = true;
  const queue: NavigationAction[] = [], prevented: NavigationAction[] = [];
  const listeners = new Map<string, Set<(event: NativeEvent) => void>>();
  const renderListeners = new Set<() => void>();
  const nativeRegistrations = new Map<string, { routeKey: string; preventRemove: boolean }>();
  const child = () => state.routes.find(item => item.key === 'sell-key')?.state as StackNavigationState<Record<string, object | undefined>> | undefined;
  const removed = () => !child()?.routes.some(item => item.key === screenKey);
  const emit = (input: { type: string; target?: string; data: { action: NavigationAction } }) => {
    const event: NativeEvent = { ...input, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    if (!event.target || event.target === screenKey) listeners.get(event.type)?.forEach(listener => listener(event));
    if (event.defaultPrevented) prevented.push(event.data.action);
    return event;
  };
  const emitter = { emit } as unknown as Parameters<typeof shouldPreventRemove>[0];
  const notify = () => {
    renderListeners.forEach(listener => listener());
    emit({ type: removed() || !focused() ? 'blur' : 'focus', target: screenKey, data: { action: { type: 'FOCUS_CHANGED' } } });
  };
  const dispatch = jest.fn((action: NavigationAction) => {
    const currentChild = child();
    // Native events expose NavigationAction, wider than one router's declared
    // union. The real router still decides whether it handles this action.
    const stackAction = action as Parameters<typeof router.getStateForAction>[1];
    // Root's focused-navigator dispatch tries the child navigator first.
    if (currentChild && (!action.target || action.target === currentChild.key)) {
      const nextChild = router.getStateForAction(currentChild, stackAction, childOptions);
      if (nextChild && nextChild !== currentChild) {
        if (shouldPreventRemove(emitter, {}, currentChild.routes, nextChild.routes, action)) return;
        state = { ...state, routes: state.routes.map(item => item.key === 'sell-key' ? { ...item, state: nextChild } : item) };
        notify(); return;
      }
      if (action.target === currentChild.key) return;
    }
    if (action.target && action.target !== state.key) return;
    const next = router.getStateForAction(state, stackAction, options);
    // Native core treats a null result targeted to this navigator as handled
    // without changing state. A capture-key injected into a root REPLACE hits it.
    if (!next || next === state) return;
    const children = currentChild ? {
      'sell-key': (parentAction: NavigationAction) => shouldPreventRemove(emitter, {}, currentChild.routes, [], parentAction),
    } : {};
    if (shouldPreventRemove(emitter, children, state.routes, next.routes, action)) return;
    state = router.getRehydratedState(next, options); notify();
  });
  const rootNavigation = { dispatch, isReady: () => ready, getRootState: () => state };
  const rootRef: { current: typeof rootNavigation | null } = { current: rootNavigation };
  const navigation = {
    isFocused: () => focused() && !removed(),
    getState: child,
    getParent: () => rootNavigation,
    addListener: (name: string, listener: (event: NativeEvent) => void) => {
      let group = listeners.get(name);
      if (!group) { group = new Set(); listeners.set(name, group); }
      group.add(listener); return () => { group.delete(listener); };
    },
    // This exact source injection is the installed useNavigationCache contract.
    dispatch: jest.fn((action: NavigationAction) => dispatch({ source: screenKey, ...action })),
  };
  const setPreventRemove = jest.fn((id: string, key: string, preventRemove: boolean) => {
    nativeRegistrations.set(id, { routeKey: key, preventRemove });
  });
  function Provider({ children }: { children: React.ReactNode }) {
    return <NavigationContext.Provider value={navigation as unknown as NonNullable<React.ContextType<typeof NavigationContext>>}>
      <NavigationRouteContext.Provider value={route}>
        <PreventRemoveContext.Provider value={{ preventedRoutes: {}, setPreventRemove }}>{children}</PreventRemoveContext.Provider>
      </NavigationRouteContext.Provider>
    </NavigationContext.Provider>;
  }
  return {
    navigation, rootNavigation, rootRef, route, Provider, prevented, dispatch, setPreventRemove,
    queueReplace: () => { queue.push({ type: 'REPLACE', target: 'root-stack', payload: { name: '(tabs)', params: {} } }); },
    queueBack: () => { queue.push({ type: 'GO_BACK' }); },
    flush: () => { while (queue.length) dispatch(queue.shift()!); },
    queued: () => queue.length,
    removed,
    getRootState: () => state,
    setReady: (value: boolean) => { ready = value; },
    notify,
    subscribe: (listener: () => void) => { renderListeners.add(listener); return () => { renderListeners.delete(listener); }; },
    reset: () => {
      state = makeRoot(); ready = true; queue.length = 0; prevented.length = 0;
      rootRef.current = rootNavigation; nativeRegistrations.clear(); dispatch.mockClear(); navigation.dispatch.mockClear(); setPreventRemove.mockClear();
    },
    nativeGuardActive: () => [...nativeRegistrations.values()].some(item => item.routeKey === screenKey && item.preventRemove),
  };
}
