import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isDevPushRuntime, parseDevPushInput, writeDevPushDestination } from '../utils/devPush';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { checkRateLimit } from '../utils/rateLimit';

/** Native identity is explicitly client-declared, never an OS attestation. */
export const registerDevPushDestination = onCall({region: 'northamerica-northeast1', memory: '512MiB'}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (!isDevPushRuntime()) throw new HttpsError('failed-precondition', 'Les notifications de test sont réservées à Seconde Dev.');
  const input = parseDevPushInput(request.data, request.auth.uid);
  return withPrivateAccountSession(request, async () => {
    await checkRateLimit(request.auth!.uid, true, {functionName: 'registerDevPushDestination',
      maxCallsAuthenticated: 40, maxCallsUnauthenticated: 0, windowMs: 60_000});
    return writeDevPushDestination(request.auth!.uid, input, tx => assertPrivateAccountSession(request, tx));
  });
});
