import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { profileSourceId, profileSourceRef } from '../utils/profileMediaPrivacy';
import { readPrivateImage, PrivateImageWitness } from '../utils/privateMedia';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function authorized(uid: string, ownerId: string, admin: boolean): void {
  if (uid === ownerId || admin) return;
  // Current order producers freeze no immutable avatar generation. Legacy
  // swap images are client proposal arguments, not a native identity snapshot.
  // Contract membership therefore grants no version of the owner's private
  // avatar. Do not pick their current profile or adopt a requested mediaId.
  throw new HttpsError('permission-denied', 'Ce contrat ne contient pas de référence native d’avatar figée.',
    { reason: 'private_profile_contract_reference_unqualified' });
}
export const readPrivateProfileMedia = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 },
  async request => {
  return withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
    const uid = request.auth.uid, { ownerId, expectedUid, mediaId: requestedMediaId, mode = 'read' } = request.data ?? {};
    if (expectedUid !== uid || !validId(ownerId)) throw new HttpsError('invalid-argument', 'Identité invalide.');
    if (!['read', 'observe'].includes(mode)) throw new HttpsError('invalid-argument', 'Mode invalide.');
    authorized(uid, ownerId, (await assertPrivateAccountSession(request)).currentAdminClaim);
    const user = (await db.collection('users').doc(ownerId).get()).data();
    const mediaId = requestedMediaId ?? (typeof user?.profileImage === 'string' ? profileSourceId(ownerId, user.profileImage) : null);
    if (mediaId !== null && (typeof mediaId !== 'string' || !/^[a-f0-9]{64}$/.test(mediaId))) throw new HttpsError('invalid-argument', 'Référence privée invalide.');
    const op = mediaId ? (await profileSourceRef(ownerId, mediaId).get()).data() : undefined;
    if (mode === 'observe') {
      if (op && (op.schemaVersion !== 1 || op.ownerId !== ownerId || op.mediaId !== mediaId || !(op.createdAt instanceof Timestamp))) {
        throw new HttpsError('failed-precondition', 'Intention privée non qualifiée.');
      }
      if (op) authorized(uid, ownerId, (await assertPrivateAccountSession(request)).currentAdminClaim);
      return { kind: 'private_profile_media_v1', mode, state: op?.state ?? 'unrecorded', viewerId: uid, ownerId,
        mediaId, evidenceId: op?.operationId ?? null, generation: op?.privateGeneration ?? null,
        contentType: op?.contentType ?? null, size: op?.size ?? null, dataUrl: null,
        publicWithdrawalComplete: op?.state === 'revoked', downloadedCopiesRecallable: false };
    }
    if (!op || op.schemaVersion !== 1 || op.ownerId !== ownerId || op.mediaId !== mediaId
        || !(op.createdAt instanceof Timestamp) || !/^[a-f0-9]{64}$/.test(op.operationId ?? '')
        || op.privatePath !== `profile_privacy/${ownerId}/${op.operationId}/${mediaId}`
        || !op.privateGeneration || !['copied', 'revoked'].includes(op.state)) {
      throw new HttpsError('failed-precondition', 'Copie privée non qualifiée.');
    }
    authorized(uid, ownerId, (await assertPrivateAccountSession(request)).currentAdminClaim);
    const bytes = await readPrivateImage(op.privatePath, op as PrivateImageWitness, op.operationId, mediaId);
    authorized(uid, ownerId, (await assertPrivateAccountSession(request)).currentAdminClaim);
    return { kind: 'private_profile_media_v1', mode, state: op.state, viewerId: uid, ownerId, mediaId, evidenceId: op.operationId,
      generation: op.privateGeneration, contentType: op.contentType, size: bytes.length,
      publicWithdrawalComplete: op.state === 'revoked', downloadedCopiesRecallable: false,
      dataUrl: `data:${op.contentType};base64,${bytes.toString('base64')}` };
  
  });
},
);
