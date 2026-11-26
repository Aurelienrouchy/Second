import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';

export interface TradeSession { uid: string; generation: number }

export function staleTradeOperation(): Error {
  return Object.assign(new Error('La session ou le dossier a changé. Veuillez reprendre depuis le dossier actuel.'), {
    code: 'client/stale-operation',
  });
}

/** Identity fence only. Admission and the rights of an existing agreement stay on the server. */
export function captureTradeSession(expectedUid?: string): TradeSession {
  const uid = auth.currentUser?.uid;
  if (!uid || useAuthStore.getState().authenticatedUid !== uid || (expectedUid !== undefined && uid !== expectedUid)) throw staleTradeOperation();
  return { uid, generation: getAuthSessionGeneration() };
}

export function isTradeSessionCurrent(session: TradeSession): boolean {
  return auth.currentUser?.uid === session.uid && useAuthStore.getState().authenticatedUid === session.uid &&
    getAuthSessionGeneration() === session.generation;
}

export function assertTradeSessionCurrent(session: TradeSession): void {
  if (!isTradeSessionCurrent(session)) throw staleTradeOperation();
}

export function isTradeProfileCurrent(session: TradeSession): boolean {
  const state = useAuthStore.getState();
  return isTradeSessionCurrent(session) && state.authenticatedUid === session.uid && state.user?.id === session.uid;
}

/** Unknown responses keep their original request identity. Do not classify plain transport errors as refusals. */
export function isDefinitiveTradeRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const details = (error as { details?: unknown } | null)?.details;
  if ((code === 'unauthenticated' || code === 'functions/unauthenticated') && details && typeof details === 'object' &&
      'reason' in details && (details.reason === 'private_session_stale' || details.reason === 'private_session_unqualified') &&
      'action' in details && details.action === 'reauthenticate') return false;
  return typeof code === 'string' && [
    'invalid-argument', 'unauthenticated', 'permission-denied', 'not-found',
    'already-exists', 'failed-precondition', 'out-of-range', 'unimplemented',
  ].some(value => code === value || code === `functions/${value}`);
}
