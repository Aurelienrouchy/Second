/** Private servicing needs a CURRENT session, independently of commercial
 * eligibility. A fresh authentication never removes the containment barrier. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { auth, db } from '../config/firebase';
import { hasAccountSecurityBarrier } from '../shared/accountSecurity';
import {assertNoLegacyDeletionFence} from './phase1LegacyFence';
import {assertNoAccountErasureFence} from './accountErasureContract';
import { qualifyAccountSecurityProfile, readAccountSecurityEpisode, qualifiedAccountSecurityRecoveryReceipt,
  qualifyAccountSecurityRecoveryAuthentication } from './accountSecurityIdentity';

type Request = { auth?: { uid: string; token?: Record<string, unknown> } | null; data?: any };
const statementVersion = 'account_security_containment_v1';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const refuse = (unqualified = false): never => { throw new HttpsError('unauthenticated',
  'Réauthentifiez-vous pour accéder à vos renseignements privés. Si le problème persiste, contactez notre équipe.',
  { reason: unqualified ? 'private_session_unqualified' : 'private_session_stale', action: 'reauthenticate' }); };
const unavailable = (): never => { throw new HttpsError('unavailable',
  'La session privée ne peut pas être vérifiée actuellement. Réessayez après réauthentification.',
  { reason: 'private_session_unqualified', action: 'reauthenticate' }); };

/** When tx is supplied its profile and command reads join the caller's read
 * set, so a concurrent containment forces the same transaction to retry. Call
 * before any write; Auth itself is read anew on every transaction attempt. */
export async function assertPrivateAccountSession(request: Request, tx?: FirebaseFirestore.Transaction) {
  const uid = request.auth?.uid, authTime = request.auth?.token?.auth_time;
  if (typeof uid !== 'string' || !uid || uid.includes('/') || !Number.isSafeInteger(authTime) || (authTime as number) < 1 ||
      (authTime as number) > Math.floor(Date.now() / 1000) + 60 ||
      Object.prototype.hasOwnProperty.call(request.data ?? {}, 'expectedUid') && request.data.expectedUid !== uid) return refuse();
  let user;
  try { user = await auth.getUser(uid); } catch (error) {
    if ((error as {code?: unknown})?.code === 'auth/user-not-found') return refuse();
    return unavailable();
  }
  const authenticatedAtMs = (authTime as number) * 1000;
  const cutoff = typeof user.tokensValidAfterTime === 'string' ? Date.parse(user.tokensValidAfterTime) : NaN;
  if (user.uid !== uid || !Number.isSafeInteger(authenticatedAtMs) ||
      !Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now()) return refuse(true);
  if (user.disabled !== false || authenticatedAtMs < cutoff) return refuse();
  const profileRef = db.collection('eligibility_profiles').doc(uid);
  const profile = (await (tx ? tx.get(profileRef) : profileRef.get())).data();
  assertNoLegacyDeletionFence(profile);
  assertNoAccountErasureFence(profile);
  if (profile != null && Object.prototype.hasOwnProperty.call(profile, 'accountSecurityBarrier')) {
    const barrier = profile.accountSecurityBarrier;
    if (!barrier || typeof barrier !== 'object' || Array.isArray(barrier) || barrier.schemaVersion !== 1 || barrier.ownerId !== uid ||
        barrier.source !== 'owner_security_request' || barrier.accepted !== true || barrier.statementVersion !== statementVersion ||
        barrier.newEffectsBlocked !== true || !(barrier.recordedAt instanceof Timestamp) || barrier.recordedAt.toMillis() < 1 ||
        barrier.recordedAt.toMillis() > Date.now() || typeof barrier.requestId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(barrier.requestId) ||
        barrier.commandId !== 'security_' + hash([uid, barrier.requestId]) ||
        barrier.inputHash !== hash([uid, barrier.requestId, statementVersion, true])) return refuse(true);
    // auth_time has second precision: every authentication during the
    // containment's second is rejected, including milliseconds before it.
    if ((authTime as number) <= barrier.recordedAt.seconds) return refuse();
    const commandRef = db.collection('eligibility_audit').doc(barrier.commandId);
    const command = (await (tx ? tx.get(commandRef) : commandRef.get())).data();
    if (!command || command.schemaVersion !== 1 || command.action !== 'account_security_containment' || command.ownerId !== uid ||
        command.actorUid !== uid || command.commandId !== barrier.commandId || command.requestId !== barrier.requestId ||
        command.inputHash !== barrier.inputHash || command.statementVersion !== statementVersion || command.accepted !== true ||
        !(command.receivedAt instanceof Timestamp) || !command.receivedAt.isEqual(barrier.recordedAt) ||
        command.receivedAtMs !== barrier.recordedAt.toMillis() ||
        !['revocation_pending', 'revocation_unknown', 'contained'].includes(command.state)) return refuse(true);
    // Historical/private access remains independent of commercial recovery.
    // When its native restoration currently qualifies, however, an old or
    // custom authentication cannot borrow the new primary login's permission.
    const checkRecovered = async (readTx: FirebaseFirestore.Transaction) => {
      const qualified = await qualifyAccountSecurityProfile(profile,readTx,uid);
      if (hasAccountSecurityBarrier(qualified)) return;
      const episode = await readAccountSecurityEpisode(profile,readTx,uid), marker = profile.accountSecurityRecovery;
      const receipt = marker && typeof marker.requestId === 'string' && typeof marker.commandId === 'string'
        ? qualifiedAccountSecurityRecoveryReceipt((await readTx.get(db.collection('eligibility_audit').doc(marker.commandId))).data(),uid,marker.requestId) : null;
      const proof = episode && qualifyAccountSecurityRecoveryAuthentication(episode,request.auth?.token,user,uid,Date.now(),false);
      if (!receipt?.restoration || !proof || proof.nativeCutoffMs !== receipt.restoration.nativeCutoffMs ||
          proof.authTimeSeconds < receipt.restoration.authTimeSeconds) return refuse();
    };
    if (tx) await checkRecovered(tx); else await db.runTransaction(checkRecovered);
  }
  return { uid, currentAdminClaim: user.customClaims?.admin === true };
}

/** Explicitly applied to private callable boundaries, never a global onCall
 * patch. The second check prevents long provider/media reads disclosing a body
 * after confinement. Mutating handlers also guard their own transaction. */
export async function withPrivateAccountSession<T>(request: Request, operation: () => Promise<T>): Promise<T> {
  await assertPrivateAccountSession(request);
  const result = await operation();
  await assertPrivateAccountSession(request);
  return result;
}
