import {fetch as expoFetch} from 'expo/fetch';
import {auth} from '@/config/firebaseConfig';
import {runtimeEnvironment} from '@/config/firebaseEnvironment';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {setAnalyticsEnabled, suspendAnalytics} from '@/lib/analytics';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import {consumeAppleErasureAuthorization, discardAppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import type {AppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import {isAccountErasureReceipt} from '@/types/accountErasure';
import type {AccountErasureAttempt, AccountErasurePayload, AccountErasureReceipt, AccountErasureTransportPayload,
  AccountErasureRecoveryAttempt} from '@/types/accountErasure';

const REGION = 'northamerica-northeast1', ENDPOINT = 'deleteUserAccountV2';
export function accountErasureEndpoint(): string {
  const e = runtimeEnvironment;
  if (e.useEmulators) {
    if (e.projectId !== 'demo-second' || e.emulatorProjectId !== 'demo-second' ||
        !/^[A-Za-z0-9.:-]+$/.test(e.emulatorHost)) throw new Error('Environnement de suivi invalide.');
    return `http://${e.emulatorHost}:5001/demo-second/${REGION}/${ENDPOINT}`;
  }
  if (!(e.name === 'production' && e.projectId === 'seconde-b47a6' || e.name === 'development' && e.projectId === 'seconde-dev')) {
    throw new Error('Environnement de suivi invalide.');
  }
  return `https://${REGION}-${e.projectId}.cloudfunctions.net/${ENDPOINT}`;
}
const failed = (code = 'functions/unavailable') => Object.assign(new Error(
  code === 'functions/unauthenticated' ? 'Reconnectez-vous pour confirmer cette étape.' :
    code === 'functions/not-found' ? 'Le serveur ne confirme pas encore le résultat de cette demande. Vérifiez à nouveau son suivi.' :
      'Le résultat de cette étape reste à vérifier. Consultez le suivi de cette même demande.'), {code});
function frame(attempt: {ownerId: string}, view: () => void, ownerRequired: boolean) {
  const owner = auth.currentUser, generation = getAuthSessionGeneration(), uid = owner?.uid ?? null;
  const check = () => {
    view(); const state = useAuthStore.getState();
    if (state.isLoading || auth.currentUser !== owner || generation !== getAuthSessionGeneration() ||
        state.authenticatedUid !== uid || uid !== null && uid !== attempt.ownerId || ownerRequired && uid !== attempt.ownerId) {
      throw new Error('La session ou la page a changé. Relisez le suivi de votre demande.');
    }
  };
  check(); return {owner, generation, check};
}
/** Strict callable HTTP framing permits an anonymous observation without
 * creating a second Firebase App or refreshing the erased user's ID token. */
async function post(payload: AccountErasureTransportPayload, check: () => void, token?: string): Promise<AccountErasureReceipt> {
  check(); const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await expoFetch(accountErasureEndpoint(), {method: 'POST', credentials: 'omit', redirect: 'error',
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify({data: payload}), signal: controller.signal});
    check(); const raw = await response.text(); check();
    if (raw.length > 32_000) throw failed('functions/internal');
    let envelope: unknown;
    try {envelope = JSON.parse(raw);} catch {throw failed(response.status === 404 ? 'functions/not-found' : 'functions/internal');}
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw failed('functions/internal');
    const result = envelope as Record<string, unknown>;
    if (!response.ok || result.error) {
      const error = result.error && typeof result.error === 'object' ? result.error as Record<string, unknown> : {};
      const statuses = ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION',
        'ABORTED', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'];
      const status = typeof error.status === 'string' && statuses.includes(error.status) ? error.status :
        response.status === 404 ? 'NOT_FOUND' : response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE';
      throw failed(`functions/${status.toLowerCase().replaceAll('_', '-')}`);
    }
    if (Object.keys(result).length !== 1 || !isAccountErasureReceipt(result.result, 'commandId' in payload ? payload : undefined)) throw failed('functions/internal');
    return result.result;
  } catch (error) {
    check();
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('functions/')) throw error;
    throw failed(controller.signal.aborted ? 'functions/deadline-exceeded' : 'functions/unavailable');
  } finally {clearTimeout(timer);}
}
async function execute(attempt: AccountErasureAttempt, operation: Exclude<AccountErasurePayload['operation'], 'observe'>,
  view: () => void, ticket?: AppleErasureAuthorization): Promise<AccountErasureAttempt> {
  const scope = frame(attempt, view, true);
  if (!scope.owner || attempt.receipt?.deletionComplete || operation !== 'request' && !attempt.receipt) throw failed('functions/failed-precondition');
  try {
    // Only owner-authorized effects refresh Auth. Observation never calls it.
    const token = await scope.owner.getIdToken(true); scope.check();
    const submitted = operation === 'request' ? await AccountErasureJournal.beginSubmission(attempt, scope.check) : attempt;
    scope.check(); const payload = await AccountErasureJournal.payload(submitted, operation, scope.check); scope.check();
    payload.expectedUid = attempt.ownerId;
    if (operation === 'request') payload.confirmed = true;
    if (operation === 'authorize_apple') {
      if (!ticket) throw failed('functions/failed-precondition');
      payload.appleAuthorizationCode = consumeAppleErasureAuthorization(ticket, submitted, scope.owner, scope.generation);
      payload.appleAuthorizationFlow = 'ios_native';
    }
    const result = await post(payload, scope.check, token); scope.check();
    return await AccountErasureJournal.record(submitted, result, scope.check);
  } finally {if (ticket) discardAppleErasureAuthorization(ticket);}
}

export const AccountErasureService = {
  async prepare(ownerId: string, view: () => void): Promise<AccountErasureAttempt> {
    const scope = frame({ownerId}, view, true);
    // Stop capture synchronously at the explicit start of the intention. No
    // account_deleted event is emitted by this protocol, even on completion.
    suspendAnalytics(); await setAnalyticsEnabled(false); scope.check();
    return AccountErasureJournal.prepare(ownerId, scope.check);
  },
  request: (attempt: AccountErasureAttempt, view: () => void) => execute(attempt, 'request', view),
  resume: (attempt: AccountErasureAttempt, view: () => void) => execute(attempt, 'resume', view),
  authorizeApple: (attempt: AccountErasureAttempt, ticket: AppleErasureAuthorization, view: () => void) => execute(attempt, 'authorize_apple', view, ticket),
  async observe(attempt: AccountErasureAttempt, view: () => void): Promise<AccountErasureAttempt> {
    const scope = frame(attempt, view, false);
    const payload = await AccountErasureJournal.payload(attempt, 'observe', scope.check); scope.check();
    // Intentionally no SDK getIdToken, Authorization header or new instruction.
    const result = await post(payload, scope.check); scope.check();
    return AccountErasureJournal.record(attempt, result, scope.check);
  },
  async prepareRecovery(ownerId: string, view: () => void): Promise<AccountErasureRecoveryAttempt> {
    const scope = frame({ownerId}, view, true);
    suspendAnalytics(); await setAnalyticsEnabled(false); scope.check();
    return AccountErasureJournal.prepareRecovery(ownerId, scope.check);
  },
  async recoverOwner(attempt: AccountErasureRecoveryAttempt, view: () => void): Promise<AccountErasureAttempt> {
    const scope = frame(attempt, view, true); if (!scope.owner) throw failed('functions/unauthenticated');
    const token = await scope.owner.getIdToken(true); scope.check();
    const submitted = await AccountErasureJournal.beginRecovery(attempt, scope.check); scope.check();
    const payload = await AccountErasureJournal.recoveryPayload(submitted, 'recover_owner', scope.check); scope.check();
    payload.expectedUid = attempt.ownerId;
    const result = await post(payload, scope.check, token); scope.check();
    return AccountErasureJournal.bindRecovery(submitted, result, scope.check);
  },
  async observeRecovery(attempt: AccountErasureRecoveryAttempt, view: () => void): Promise<AccountErasureAttempt> {
    const scope = frame(attempt, view, false);
    const payload = await AccountErasureJournal.recoveryPayload(attempt, 'observe_recovery', scope.check); scope.check();
    const result = await post(payload, scope.check); scope.check();
    return AccountErasureJournal.bindRecovery(attempt, result, scope.check);
  },
};
