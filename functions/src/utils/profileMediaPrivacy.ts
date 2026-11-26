import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { db, storage } from '../config/firebase';
import { storageObjectPath } from './articleMedia';
import { preservePrivateImage, sourceImageWitness } from './privateMedia';

export const profileSourceId = (uid: string, url: string) => createHash('sha256').update(JSON.stringify([uid, url])).digest('hex');
export const profileSourceRef = (uid: string, mediaId: string) => db.collection('profile_privacy_media').doc(uid).collection('sources').doc(mediaId);

/** Only the current explicit visibility choice can authorize token metadata IO.
 * A token is never put in a public projection until the final owner transaction.
 */
export async function synchronizeProfileMediaVisibility(uid: string): Promise<void> {
  const userRef = db.collection('users').doc(uid), user = (await userRef.get()).data();
  const url = user?.profileImage;
  if (typeof url !== 'string' || !url) return;
  const path = storageObjectPath(url, storage.bucket().name);
  // Fresh profile uploads use a UUIDv4 name; the historical fixed sources stay
  // recognizable. Never treat identity, bank or arbitrary UID-owned objects as
  // profile media merely because they share this private namespace.
  const profilePrefix = `users/${uid}/`;
  const profileName = path?.startsWith(profilePrefix) ? path.slice(profilePrefix.length) : null;
  const versionedProfile = profileName !== null && profileName.startsWith('profile_') && profileName.endsWith('.jpg') &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileName.slice(8, -4));
  const owned = path === `users/${uid}/profile.jpg` || path === `avatars/${uid}` || versionedProfile;
  const mediaId = profileSourceId(uid, url), ref = profileSourceRef(uid, mediaId);
  if (!owned || path === null) {
    if (user?.preferences?.privacy?.showProfilePhoto === true) return;
    await db.runTransaction(async tx => {
      const current = (await tx.get(userRef)).data();
      const old = await tx.get(ref);
      if (current?.profileImage !== url || current.preferences?.privacy?.showProfilePhoto === true || old.exists) return;
      tx.create(ref, { schemaVersion: 1, ownerId: uid, mediaId, sourceUrl: url,
        state: 'needs_review', reason: 'external_or_unqualified_source', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    return;
  }
  const bucket = storage.bucket(), source = bucket.file(path);
  try {
    const [metadata] = await source.getMetadata();
    const witness = sourceImageWitness(metadata);
    if (user?.preferences?.privacy?.showProfilePhoto === true) {
      // Re-publication after a completed private retirement rotates the token.
      // The old known URL stays revoked; never restore its former bearer token.
      if (metadata.metadata?.firebaseStorageDownloadTokens) return;
      const permit = await db.runTransaction(async tx => {
        const current = (await tx.get(userRef)).data();
        return current?.profileImage === url && current.preferences?.privacy?.showProfilePhoto === true;
      });
      if (!permit) return;
      const token = randomUUID();
      await source.setMetadata({ cacheControl: 'public, max-age=3600', metadata: { firebaseStorageDownloadTokens: token } },
        { ifMetagenerationMatch: metadata.metageneration, ifGenerationMatch: witness.sourceGeneration });
      const origin = process.env.FIREBASE_STORAGE_EMULATOR_HOST
        ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
      const publicUrl = `${origin}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
      const committed = await db.runTransaction(async tx => {
        const current = (await tx.get(userRef)).data();
        if (current?.profileImage !== url || current.preferences?.privacy?.showProfilePhoto !== true) return false;
        tx.update(userRef, { profileImage: publicUrl }); return true;
      });
      if (!committed) {
        const [fresh] = await source.getMetadata();
        if (fresh.metadata?.firebaseStorageDownloadTokens === token) await source.setMetadata({ cacheControl: 'private, no-store',
          metadata: { firebaseStorageDownloadTokens: null } }, { ifGenerationMatch: witness.sourceGeneration, ifMetagenerationMatch: fresh.metageneration });
      }
      return;
    }
    const operationId = createHash('sha256').update(JSON.stringify([uid, mediaId, witness.sourceGeneration])).digest('hex');
    const privatePath = `profile_privacy/${uid}/${operationId}/${mediaId}`;
    const permit = await db.runTransaction(async tx => {
      const [currentSnap, existingSnap] = await Promise.all([tx.get(userRef), tx.get(ref)]);
      const current = currentSnap.data(), existing = existingSnap.data();
      if (current?.profileImage !== url || current.preferences?.privacy?.showProfilePhoto === true) return false;
      if (existing && existing.operationId !== operationId) {
        tx.update(ref, { state: 'needs_review', reason: 'source_generation_changed', updatedAt: Timestamp.now() }); return false;
      }
      if (!existing) tx.create(ref, { schemaVersion: 1, ownerId: uid, mediaId, operationId, sourceUrl: url,
        sourcePath: path, privatePath, ...witness, state: 'pending', reason: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      return true;
    });
    if (!permit) return;
    const privateGeneration = await preservePrivateImage(path, privatePath, witness, operationId, mediaId);
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.operationId !== operationId) return;
      tx.update(ref, { privateGeneration, state: 'copied', updatedAt: Timestamp.now() });
    });
    // Re-read current visibility and metageneration immediately before revoke.
    const stillHidden = (await userRef.get()).data();
    if (stillHidden?.profileImage !== url || stillHidden.preferences?.privacy?.showProfilePhoto === true) return;
    const [fresh] = await source.getMetadata();
    if (String(fresh.generation) !== witness.sourceGeneration) return;
    await source.setMetadata({ cacheControl: 'private, no-store', metadata: { firebaseStorageDownloadTokens: null } },
      { ifGenerationMatch: witness.sourceGeneration, ifMetagenerationMatch: fresh.metageneration });
    const [revoked] = await source.getMetadata();
    await db.runTransaction(async tx => {
      const [currentSnap, operationSnap] = await Promise.all([tx.get(userRef), tx.get(ref)]);
      const current = currentSnap.data(), operation = operationSnap.data();
      if (operation?.operationId !== operationId) return;
      const qualified = current?.profileImage === url && current.preferences?.privacy?.showProfilePhoto !== true
        && String(revoked.generation) === witness.sourceGeneration && !revoked.metadata?.firebaseStorageDownloadTokens
        && revoked.cacheControl === 'private, no-store';
      tx.update(ref, { state: qualified ? 'revoked' : 'pending', revokedAt: qualified ? Timestamp.now() : null, updatedAt: Timestamp.now() });
    });
  } catch (error) {
    logger.warn('profile_media_privacy_pending', { uid, mediaId, reason: 'source_or_copy_unqualified' });
  }
}
