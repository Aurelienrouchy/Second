import {AppState} from 'react-native';
import {auth} from '@/config/firebaseConfig';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {staleTradeOperation} from '@/services/tradeOperation';

interface NativeReturn {
  user: NonNullable<typeof auth.currentUser>; uid: string; generation: number; expiresAt: number;
  assertOrigin: () => void; reloads: Set<Promise<void>>;
}
let pending: NativeReturn | null = null;
const NATIVE_RETURN_TIMEOUT_MS = 120_000;
function current(scope: NativeReturn): boolean {
  return pending === scope && Date.now() < scope.expiresAt && auth.currentUser === scope.user &&
    auth.currentUser.uid === scope.uid && useAuthStore.getState().authenticatedUid === scope.uid &&
    getAuthSessionGeneration() === scope.generation;
}
export function isExpectedNativeReauthentication(uid: string | null): boolean {
  return !!pending && pending.uid === uid && current(pending);
}

/** Called before reload, only for the foreground event of the expected native
 * challenge. Reload still validates Firebase; this ticket only avoids treating
 * that same validated identity as a new session before its operation resumes. */
export function captureNativeReauthenticationReturn(user: typeof auth.currentUser) {
  const scope = pending;
  if (!scope || user !== scope.user || !current(scope)) return null;
  let complete!: () => void;
  const settled = new Promise<void>(resolve => {complete = resolve;});
  scope.reloads.add(settled);
  return {
    preservesSession: () => {try {scope.assertOrigin(); return current(scope);} catch {return false;}},
    finish: () => {scope.reloads.delete(settled); complete();},
  };
}

export async function withNativeReauthentication<T>(uid: string, assertOrigin: () => void,
  work: (context: {assertCurrent: () => void; waitForActive: () => Promise<void>}) => Promise<T>): Promise<T> {
  assertOrigin();
  const user = auth.currentUser;
  if (!user || user.uid !== uid || AppState.currentState !== 'active' || pending) throw staleTradeOperation();
  const scope: NativeReturn = {user, uid, generation: getAuthSessionGeneration(), expiresAt: Date.now() + NATIVE_RETURN_TIMEOUT_MS,
    assertOrigin, reloads: new Set()};
  pending = scope;
  let expirationTimer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    expirationTimer = setTimeout(() => reject(staleTradeOperation()), NATIVE_RETURN_TIMEOUT_MS);
  });
  const assertCurrent = () => {if (!current(scope)) throw staleTradeOperation(); assertOrigin();};
  const waitForActive = async () => {
    assertCurrent();
    if (AppState.currentState !== 'active') await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {subscription.remove(); reject(staleTradeOperation());}, Math.max(0, scope.expiresAt - Date.now()));
      const subscription = AppState.addEventListener('change', state => {
        try {assertCurrent();} catch (error) {clearTimeout(timer); subscription.remove(); reject(error); return;}
        if (state === 'active') {clearTimeout(timer); subscription.remove(); resolve();}
      });
    });
    // The listener registers the validation before its first await. Do not let
    // a late reload hydrate after this native return has already been released.
    while (scope.reloads.size > 0) {
      let validationTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...scope.reloads]),
          new Promise<never>((_resolve, reject) => {validationTimer = setTimeout(() => reject(staleTradeOperation()), Math.max(0, scope.expiresAt - Date.now()));}),
        ]);
      } finally {if (validationTimer) clearTimeout(validationTimer);}
      assertCurrent();
    }
    assertCurrent();
    if (AppState.currentState !== 'active') throw staleTradeOperation();
  };
  try {
    const result = await Promise.race([work({assertCurrent, waitForActive}), expired]);
    await Promise.race([waitForActive(), expired]);
    return result;
  } finally {
    if (expirationTimer) clearTimeout(expirationTimer);
    if (pending === scope) pending = null;
  }
}
