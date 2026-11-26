import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';

export interface SellActorSource {
  readonly uid: string | null;
  readonly sdkUser: FirebaseUser | null;
  readonly occurrence: number;
}

/** Local media continuity only, never an admission or an RPC session.
 * Observe actor changes synchronously: React may batch A→B→A into one render.
 * A foreground revalidation of the same SDK actor keeps local draft state. */
export function useSellActorSource() {
  const [observer] = useState(() => {
    let source: SellActorSource = {
      uid: useAuthStore.getState().authenticatedUid, sdkUser: auth.currentUser, occurrence: 0,
    };
    const listeners = new Set<() => void>();
    let unsubscribe: (() => void) | null = null;
    const observe = () => {
      const uid = useAuthStore.getState().authenticatedUid;
      const sdkUser = auth.currentUser;
      if (source.uid !== uid || source.sdkUser !== sdkUser) {
        source = { uid, sdkUser, occurrence: source.occurrence + 1 };
        listeners.forEach(listener => listener());
      }
    };
    return {
      observe,
      getSnapshot: () => source,
      subscribe: (listener: () => void) => {
        if (listeners.size === 0) unsubscribe = useAuthStore.subscribe(observe);
        listeners.add(listener);
        observe();
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) { unsubscribe?.(); unsubscribe = null; }
        };
      },
    };
  });
  const source = useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getSnapshot);
  // Also reject a native SDK replacement observed before its store notification.
  useLayoutEffect(observer.observe);
  return { source, getCurrentSource: observer.getSnapshot };
}

export function isSellActorSourceCurrent(current: SellActorSource, captured: SellActorSource): boolean {
  return current === captured && captured.uid !== null && captured.sdkUser !== null &&
    auth.currentUser === captured.sdkUser && auth.currentUser.uid === captured.uid &&
    useAuthStore.getState().authenticatedUid === captured.uid;
}
