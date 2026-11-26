import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation, type TradeSession } from '@/services/tradeOperation';
import {isExpectedNativeReauthentication} from '@/services/nativeReauthentication';

interface Operation { session: TradeSession; frame: symbol; focusEpoch: number; slot?: string }
/** Owner identity/focus fences also cover an existing reservation with an incomplete normal profile. */
export function useShippingPurchaseContext(dossier: string, uid: string | null, options?: {preserveNativeReauthentication?: boolean}) {
  const preserveNativeReauthentication = options?.preserveNativeReauthentication === true;
  // Same-UID foreground hydration increments the generation too. Subscribe to
  // it instead of waiting for an unrelated profile/dossier render.
  const generation = useAuthStore(getAuthSessionGeneration);
  const key = JSON.stringify([dossier, uid, generation]);
  const [renderFrame, setRenderFrame] = useState(() => ({ key, frame: Symbol() }));
  if (renderFrame.key !== key) setRenderFrame({ key, frame: Symbol() });
  const frame = renderFrame.frame;
  const context = useRef({ frame, mounted: false, active: false, epoch: 0, locks: new Map<string, Operation>() });
  const [focus, setFocus] = useState({ frame, active: false, epoch: 0 });
  useLayoutEffect(() => {
    context.current.frame = frame; context.current.mounted = true;
    context.current.active = false; context.current.epoch++; context.current.locks.clear();
    return () => {
      if (context.current.frame !== frame) return;
      context.current.mounted = false; context.current.active = false;
      context.current.epoch++; context.current.locks.clear();
    };
  }, [frame]);
  useFocusEffect(useCallback(() => {
    // Publish admission only AFTER this frame's layout commit. React Query may
    // examine enabled during render; a previous frame's focus is not authority
    // to start the new frame's query before capture can succeed.
    const publishActivity = () => {
      if (!context.current.mounted || context.current.frame !== frame) return;
      context.current.active = AppState.currentState === 'active';
      context.current.epoch++; context.current.locks.clear();
      setFocus({frame, active: context.current.active, epoch: context.current.epoch});
    };
    publishActivity();
    let activity = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      if (preserveNativeReauthentication && isExpectedNativeReauthentication(uid)) return;
      if (nextState === activity) return;
      activity = nextState;
      publishActivity();
    });
    return () => {
      subscription.remove();
      if (context.current.frame !== frame) return;
      context.current.active = false; context.current.epoch++; context.current.locks.clear();
      if (context.current.mounted) setFocus({frame, active: false, epoch: context.current.epoch});
    };
  }, [frame, uid, preserveNativeReauthentication]));
  const assertCurrent = (operation: Operation) => {
    if (!context.current.mounted || !context.current.active || context.current.frame !== operation.frame ||
        context.current.epoch !== operation.focusEpoch || AppState.currentState !== 'active') throw staleTradeOperation();
    assertTradeSessionCurrent(operation.session);
  };
  const capture = (): Operation => {
    if (!uid || renderFrame.key !== key || generation !== getAuthSessionGeneration() || context.current.frame !== frame ||
        focus.frame !== frame || !focus.active || focus.epoch !== context.current.epoch) throw staleTradeOperation();
    const operation = { session: captureTradeSession(uid), frame, focusEpoch: context.current.epoch };
    assertCurrent(operation); return operation;
  };
  const start = (slot = 'default') => {
    const operation = capture();
    if (context.current.locks.has(slot)) return null;
    operation.slot = slot;
    context.current.locks.set(slot, operation);
    return operation;
  };
  const finish = (operation: Operation) => {
    if (operation.slot !== undefined && context.current.locks.get(operation.slot) === operation) context.current.locks.delete(operation.slot);
  };
  const isCurrent = (operation: Operation) => { try { assertCurrent(operation); return true; } catch { return false; } };
  return { frame, focused: renderFrame.key === key && focus.frame === frame && focus.active,
    focusRevision: focus.epoch, capture, start, finish, assertCurrent, isCurrent };
}
