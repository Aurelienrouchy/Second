import { useLayoutEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigationContainerRef, useRoute } from 'expo-router';
import { useIsFocused, usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { staleTradeOperation } from '@/services/tradeOperation';

export interface SellExitGuardOptions {
  captureOrigin: () => () => void;
  save: (assertCurrent: () => void) => Promise<void>;
  hasWork: () => boolean;
  isPublished?: () => boolean;
  confirmExit?: boolean;
  onDecision?: (confirmed: boolean) => void;
  message?: string;
  errorMessage?: string;
}

/** Compare native route visits, never an href or a fabricated navigation action. */
function focusedPath(value: unknown): string[] | null {
  const path: string[] = [];
  let current = value;
  while (current && typeof current === 'object') {
    const state = current as { key?: unknown; index?: unknown; routes?: unknown };
    if (typeof state.key !== 'string' || !Array.isArray(state.routes) ||
      !Number.isInteger(state.index) || (state.index as number) < 0 ||
      (state.index as number) >= state.routes.length) return null;
    const route = state.routes[state.index as number] as { key?: unknown; state?: unknown };
    if (!route || typeof route.key !== 'string') return null;
    path.push(`state:${state.key}`, `route:${route.key}`);
    current = route.state;
  }
  return path.length > 0 ? path : null;
}

/** One confirmation owns one native action. Saving never grants a general
 * bypass, and replay must use the root dispatcher so a child route cannot add
 * its own source to an action targeting a parent navigator. */
export function useSellExitGuard({ captureOrigin, save, hasWork, isPublished,
  confirmExit = true, onDecision,
  message = 'Ton brouillon sera sauvegardé. Tu pourras le reprendre plus tard.',
  errorMessage = 'Réessayez avant de quitter pour conserver votre brouillon.',
}: SellExitGuardOptions): void {
  const rootRef = useNavigationContainerRef();
  const route = useRoute();
  const focused = useIsFocused();
  const pending = useRef<{ action: NavigationAction; saving: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!focused) pending.current = null;
    return () => { pending.current = null; };
  }, [focused]);

  usePreventRemove(focused, ({ data }) => {
    if (pending.current) return;
    let assertOrigin: () => void;
    try { assertOrigin = captureOrigin(); assertOrigin(); } catch { return; }
    const root = rootRef.current;
    const path = root?.isReady() ? focusedPath(root.getRootState()) : null;
    if (!root || !path?.includes(`route:${route.key}`)) {
      Alert.alert('Navigation indisponible', 'Impossible de quitter pour le moment. Réessayez.');
      return;
    }
    const visit = JSON.stringify(path);
    const intent = { action: data.action, saving: false };
    pending.current = intent;
    const assertCurrent = () => {
      assertOrigin();
      if (pending.current !== intent || rootRef.current !== root || !root.isReady() ||
        JSON.stringify(focusedPath(root.getRootState())) !== visit) throw staleTradeOperation();
    };
    const current = () => { try { assertCurrent(); return true; } catch { return false; } };
    const cancel = () => {
      if (pending.current !== intent || intent.saving) return;
      if (current()) onDecision?.(false);
      pending.current = null;
    };
    const finish = async (confirmed: boolean) => {
      if (intent.saving || !current()) { if (pending.current === intent && !intent.saving) pending.current = null; return; }
      intent.saving = true;
      try {
        if (confirmed) onDecision?.(true);
        assertCurrent();
        if (!isPublished?.()) await save(assertCurrent);
        assertCurrent();
        // Preserve the original action object, including target, absent source,
        // and React Navigation's visited-route symbol used for this replay.
        root.dispatch(intent.action);
      } catch {
        if (current()) Alert.alert('Brouillon non sauvegardé', errorMessage);
      } finally {
        if (pending.current === intent) pending.current = null;
      }
    };
    if (isPublished?.() || !confirmExit || !hasWork()) {
      void finish(false);
      return;
    }
    Alert.alert('Quitter ?', message, [
      { text: 'Annuler', style: 'cancel', onPress: cancel },
      { text: 'Quitter', onPress: () => { void finish(true); } },
    ], { cancelable: true, onDismiss: cancel });
  });
}
