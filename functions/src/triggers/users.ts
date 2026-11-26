/**
 * Fresh identity projections. Every public write reads the current owner in
 * the same transaction, so a delayed event cannot restore a withdrawn avatar.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { synchronizeProfileMediaVisibility } from '../utils/profileMediaPrivacy';
import {withDocumentaryProjection,identityProjectionFields} from '../utils/documentaryProjection';

export const onUserProfileUpdated = onDocumentUpdated(
  { document: 'users/{uid}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 },
  async event => {
    const uid = event.params.uid, before = event.data?.before.data(), after = event.data?.after.data();
    if (!before || !after) return;
    const nameChanged = before.displayName !== after.displayName;
    const imageChanged = before.profileImage !== after.profileImage;
    const photoVisibilityChanged = before.preferences?.privacy?.showProfilePhoto
      !== after.preferences?.privacy?.showProfilePhoto;
    if (!nameChanged && !imageChanged && !photoVisibilityChanged) return;
    await synchronizeProfileMediaVisibility(uid);

    const projections = [
      { collection: 'articles', field: 'sellerId', name: 'sellerName', image: 'sellerImage' },
      { collection: 'avis', field: 'reviewerId', name: 'reviewerName', image: 'reviewerImage' },
      { collection: 'swapPartyItems', field: 'sellerId', name: 'sellerName', image: 'sellerImage' },
    ];
    let publicUpdated = 0;
    for (const projection of projections) {
      const rows = await db.collection(projection.collection).where(projection.field, '==', uid).get();
      for (const row of rows.docs) {
        await withDocumentaryProjection({kind:'identity',ownerId:uid,path:row.ref.path},()=>db.runTransaction(async tx => {
          const [owner, target] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(row.ref)]);
          const current = target.data(), user = owner.data();
          if (!current || current[projection.field] !== uid) return;
          tx.update(row.ref,identityProjectionFields(row.ref.path,uid,current,user));
          publicUpdated++;
        }));
      }
    }
    // Private participant identities are a distinct purpose. Hiding a PUBLIC
    // photo does not erase the parties' private conversation identity.
    const chats = await db.collection('chats').where('participants', 'array-contains', uid).get();
    let privateUpdated = 0;
    for (const row of chats.docs) {
      await withDocumentaryProjection({kind:'identity',ownerId:uid,path:row.ref.path},()=>db.runTransaction(async tx => {
        const [owner, target] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(row.ref)]);
        const chat = target.data(), user = owner.data();
        if (!Array.isArray(chat?.participants) || !chat.participants.includes(uid) || !Array.isArray(chat.participantsInfo)) return;
        tx.update(row.ref,identityProjectionFields(row.ref.path,uid,chat!,user));
        privateUpdated++;
      }));
    }
    logger.info('user_identity_projections_updated', { uid, publicUpdated, privateUpdated });
  },
);
