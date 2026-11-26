import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { staleTradeOperation } from '@/services/tradeOperation';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import {isExpectedNativeReauthentication} from '@/services/nativeReauthentication';
/** The existing SDK/navigation fence also loses admission on backgrounding. */
export function useLabelLifecycleContext(dossier: string, uid: string | null, options?: {preserveNativeReauthentication?: boolean}) {
  const preserveNativeReauthentication = options?.preserveNativeReauthentication === true;
  const generation = useAuthStore(() => getAuthSessionGeneration());
  const [activity, setActivity] = useState(() => ({state: AppState.currentState, revision: 0}));
  const currentActivity = useRef(activity);
  useEffect(() => {
    const changed = (state: typeof AppState.currentState) => {
      if (preserveNativeReauthentication && isExpectedNativeReauthentication(uid)) return;
      if (state === currentActivity.current.state) return;
      const next = {state, revision: currentActivity.current.revision + 1}; currentActivity.current = next; setActivity(next);
    };
    const sub = AppState.addEventListener('change', changed); changed(AppState.currentState); return () => {sub.remove();};
  }, [uid, preserveNativeReauthentication]);
  const base = useShippingPurchaseContext(JSON.stringify([dossier, activity.revision, generation]), uid, options);
  type Operation = {base: ReturnType<typeof base.capture>; activityRevision: number};
  const active = (revision: number) => {if (AppState.currentState !== 'active' || currentActivity.current.state !== 'active' || currentActivity.current.revision !== revision) throw staleTradeOperation();};
  const capture = (): Operation => {active(activity.revision); return {base: base.capture(), activityRevision: activity.revision};};
  const start = (): Operation | null => {active(activity.revision); const op = base.start(); return op ? {base: op, activityRevision: activity.revision} : null;};
  const assertCurrent = (op: Operation) => {active(op.activityRevision); base.assertCurrent(op.base);};
  const isCurrent = (op: Operation) => {try {assertCurrent(op); return true;} catch {return false;}};
  return {frame: base.frame, focused: base.focused && activity.state === 'active' && AppState.currentState === 'active', focusRevision: JSON.stringify([base.focusRevision, activity.revision]),
    capture, start, assertCurrent, isCurrent, finish: (op: Operation) => base.finish(op.base)};
}
