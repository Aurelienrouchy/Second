import {useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {useShallow} from 'zustand/react/shallow';
import {auth} from '@/config/firebaseConfig';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import type {AccountErasureLocalAttempt} from '@/types/accountErasure';
import {readScopedQuery} from '@/utils/readScopedQuery';

/** Mount once beside the existing Auth listener. The Zustand subscription
 * observes intermediate B identities even when no erasure screen is opened. */
export function useAccountErasureRecoveryGuard(): void {
  useLayoutEffect(() => AccountErasureJournal.attachIdentityWatcher(), []);
}

interface Frame {
  owner: typeof auth.currentUser;
  uid: string | null;
  generation: number;
  focusEpoch: number;
  activityEpoch: number;
}
export function useAccountErasureRecovery() {
  const {uid, loading, generation, sdkUid} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid,
    loading: state.isLoading, generation: getAuthSessionGeneration(), sdkUid: auth.currentUser?.uid ?? null})));
  const view = useRef({mounted: false, focused: false, focusEpoch: 0, activityEpoch: 0, activity: AppState.currentState});
  const [focusRevision, setFocusRevision] = useState(0);
  const activitySnapshot = useRef({state: AppState.currentState, revision: 0});
  const getActivitySnapshot = useCallback(() => {
    // React checks this again after subscribing, including a foreground event
    // that occurred while the native subscription was being attached.
    if (view.current.activity !== AppState.currentState) {
      view.current.activity = AppState.currentState; view.current.activityEpoch++;
      activitySnapshot.current = {state: view.current.activity, revision: view.current.activityEpoch};
    }
    return activitySnapshot.current;
  }, []);
  const subscribeActivity = useCallback((notify: () => void) => {
    const listener = AppState.addEventListener('change', state => {
      if (view.current.activity !== state) {
        view.current.activity = state; view.current.activityEpoch++;
        activitySnapshot.current = {state, revision: view.current.activityEpoch};
      }
      notify();
    });
    return () => listener.remove();
  }, []);
  const activity = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getActivitySnapshot);
  const activityRevision = activity.revision;
  const revision = useSyncExternalStore(AccountErasureJournal.subscribe, AccountErasureJournal.getRevision, () => 0);
  useLayoutEffect(() => {view.current.mounted = true; return () => {view.current.mounted = false;};}, []);
  useFocusEffect(useCallback(() => {
    view.current.focused = true; view.current.focusEpoch++;
    setFocusRevision(view.current.focusEpoch);
    return () => {view.current.focused = false; view.current.focusEpoch++; setFocusRevision(0);};
  }, [uid, generation]));
  const isCurrent = useCallback((frame: Frame) => {
    const state = useAuthStore.getState();
    return view.current.mounted && view.current.focused && view.current.focusEpoch === frame.focusEpoch &&
      view.current.activityEpoch === frame.activityEpoch && view.current.activity === 'active' && AppState.currentState === 'active' &&
      !state.isLoading && state.authenticatedUid === frame.uid && auth.currentUser === frame.owner &&
      (auth.currentUser?.uid ?? null) === frame.uid && getAuthSessionGeneration() === frame.generation;
  }, []);
  const capture = useCallback(() => {
    const frame: Frame = {owner: auth.currentUser, uid: auth.currentUser?.uid ?? null, generation: getAuthSessionGeneration(),
      focusEpoch: view.current.focusEpoch, activityEpoch: view.current.activityEpoch};
    const assertCurrent = () => {if (!isCurrent(frame)) throw new Error('La session ou la page a changé. Relisez votre demande.');};
    assertCurrent(); return {...frame, assertCurrent};
  }, [isCurrent]);
  const captureNativeOwner = useCallback(() => {
    const frame = capture(); if (!frame.owner || !frame.uid) throw new Error('Reconnectez-vous pour confirmer cette étape.');
    // Only the explicit, timed native challenge may cross inactive/active.
    // It never carries an erasure permission or sends a mutation on return.
    const assertNavigation = () => {
      const state = useAuthStore.getState();
      if (!view.current.mounted || !view.current.focused || view.current.focusEpoch !== frame.focusEpoch ||
          state.isLoading || auth.currentUser !== frame.owner || state.authenticatedUid !== frame.uid ||
          getAuthSessionGeneration() !== frame.generation) throw new Error('La session ou la page a changé.');
    };
    return {...frame, owner: frame.owner, uid: frame.uid, assertNavigation};
  }, [capture]);
  // Render from reactive snapshots. Reading AppState.currentState here is not
  // reactive and lets React Compiler reuse an inactive result after foreground.
  // Destructive actions still recheck live SDK identity/generation in capture.
  const coherent = !loading && sdkUid === uid && focusRevision > 0 && activity.state === 'active';
  const local = useQuery<AccountErasureLocalAttempt | null>({
    queryKey: ['account-erasure-device', uid ?? 'signed-out', generation, focusRevision, activityRevision, revision],
    queryFn: ({signal}) => readScopedQuery(signal, () => capture().assertCurrent,
      assertCurrent => AccountErasureJournal.discover(assertCurrent)),
    enabled: coherent, staleTime: 0, gcTime: 0, retry: false,
    refetchOnReconnect: false, refetchOnWindowFocus: false,
  });
  const ready = coherent && local.isSuccess && !local.isFetching;
  const attempt = ready && (!uid || local.data?.ownerId === uid) ? local.data ?? null : null;
  return {uid, generation, attempt, ready, loading: coherent && local.isFetching, error: coherent && local.isError,
    refresh: local.refetch, capture, captureNativeOwner,
    contextKey: `${uid ?? 'signed-out'}:${generation}:${focusRevision}:${activityRevision}`};
}
