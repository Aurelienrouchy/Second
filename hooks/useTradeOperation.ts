import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { captureTradeSession, isTradeProfileCurrent, staleTradeOperation, type TradeSession } from '@/services/tradeOperation';

export interface TradeOperation { session: TradeSession; frame: symbol; focusEpoch: number; slot?: string }

/** A render's callback cannot adopt a later dossier, including A→B→A. Locks belong to that frame. */
export function useTradeOperation(dossier: string, expectedUid?: string | null) {
  const uid = expectedUid === undefined ? useAuthStore.getState().user?.id ?? null : expectedUid;
  const generation = useAuthStore(getAuthSessionGeneration);
  const key = JSON.stringify([dossier, uid, generation]);
  const [renderContext, setRenderContext] = useState(() => ({ key, frame: Symbol() }));
  if (renderContext.key !== key) setRenderContext({ key, frame: Symbol() });
  const frame = renderContext.frame;
  const context = useRef({ frame, mounted: false, locks: new Map<string, TradeOperation>() });
  const focus = useRef({ active: false, epoch: 0 });
  const [focusRevision, setFocusRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    focus.current.active = true;
    focus.current.epoch++;
    setFocusRevision(value => value + 1);
    return () => {
      focus.current.active = false;
      focus.current.epoch++;
      context.current.locks.clear();
      if (context.current.mounted) setFocusRevision(value => value + 1);
    };
  }, []));
  useLayoutEffect(() => {
    context.current = { frame, mounted: true, locks: new Map() };
    return () => { if (context.current.frame === frame) context.current.mounted = false; };
  }, [frame]);
  const isCurrent = (operation: TradeOperation) => context.current.mounted && focus.current.active &&
    operation.focusEpoch === focus.current.epoch && context.current.frame === operation.frame && isTradeProfileCurrent(operation.session);
  /** Separates an obsolete opener from a current dossier that is missing its actor. */
  const isOriginCurrent = () => context.current.mounted && context.current.frame === frame &&
    generation === getAuthSessionGeneration() && focus.current.active && focus.current.epoch === focusRevision;
  const capture = (): TradeOperation => {
    if (!uid || context.current.frame !== frame || !context.current.mounted || generation !== getAuthSessionGeneration()) throw staleTradeOperation();
    const operation = { session: captureTradeSession(uid), frame, focusEpoch: focus.current.epoch };
    if (!isCurrent(operation)) throw staleTradeOperation();
    return operation;
  };
  const assertCurrent = (operation: TradeOperation) => { if (!isCurrent(operation)) throw staleTradeOperation(); };
  const start = (slot = 'default'): TradeOperation | null => {
    const operation = capture();
    if (context.current.locks.has(slot)) return null;
    operation.slot = slot;
    context.current.locks.set(slot, operation);
    return operation;
  };
  const finish = (operation: TradeOperation) => {
    if (operation.slot && context.current.locks.get(operation.slot) === operation) context.current.locks.delete(operation.slot);
  };
  const ownsLock = (operation: TradeOperation) => !!operation.slot && context.current.locks.get(operation.slot) === operation;
  return { frame, focusRevision, capture, isCurrent, isOriginCurrent, assertCurrent, start, finish, ownsLock };
}
