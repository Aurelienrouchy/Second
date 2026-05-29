/**
 * User profile Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 *
 * Propagates displayName and profileImage changes to denormalized data:
 * - articles.sellerName / articles.sellerImage
 * - chats.participantsInfo[uid].userName / .profileImage
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

/**
 * When a user updates their displayName or profileImage, propagate
 * the change to all articles they own and all chats they participate in.
 *
 * Uses batch writes for efficiency (max 500 ops per batch).
 */
export const onUserProfileUpdated = onDocumentUpdated(
  { document: 'users/{uid}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    const nameChanged = before.displayName !== after.displayName;
    const imageChanged = before.profileImage !== after.profileImage;

    if (!nameChanged && !imageChanged) return;

    const newName = after.displayName || 'Utilisateur';
    const newImage = after.profileImage || null;

    logger.info('[onUserProfileUpdated] Propagating profile changes', {
      uid,
      nameChanged,
      imageChanged,
      newName,
    });

    let articlesUpdated = 0;
    let chatsUpdated = 0;

    // 1. Update sellerName / sellerImage on all articles owned by this user
    const articlesSnap = await db
      .collection('articles')
      .where('sellerId', '==', uid)
      .get();

    if (!articlesSnap.empty) {
      const articleUpdates: Record<string, any> = {};
      if (nameChanged) articleUpdates.sellerName = newName;
      if (imageChanged) articleUpdates.sellerImage = newImage;

      // Batch writes (max 500 per batch)
      let batch = db.batch();
      let batchCount = 0;

      for (const doc of articlesSnap.docs) {
        batch.update(doc.ref, articleUpdates);
        batchCount++;
        articlesUpdated++;

        if (batchCount >= 499) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) await batch.commit();
    }

    // 2. Update participantsInfo[uid] in all chats where user participates
    const chatsSnap = await db
      .collection('chats')
      .where('participants', 'array-contains', uid)
      .get();

    if (!chatsSnap.empty) {
      let batch = db.batch();
      let batchCount = 0;

      for (const doc of chatsSnap.docs) {
        const chatData = doc.data();
        const info = chatData.participantsInfo;

        if (Array.isArray(info)) {
          const idx = info.findIndex((p: any) => p.userId === uid);
          if (idx >= 0) {
            const updated = [...info];
            if (nameChanged) updated[idx] = { ...updated[idx], userName: newName };
            if (imageChanged) updated[idx] = { ...updated[idx], userImage: newImage };

            batch.update(doc.ref, {
              participantsInfo: updated,
              updatedAt: FieldValue.serverTimestamp(),
            });
            batchCount++;
            chatsUpdated++;
          }
        } else if (info && typeof info === 'object' && info[uid]) {
          const updatedInfo = { ...info };
          if (nameChanged) updatedInfo[uid] = { ...updatedInfo[uid], userName: newName };
          if (imageChanged) updatedInfo[uid] = { ...updatedInfo[uid], profileImage: newImage };

          batch.update(doc.ref, {
            participantsInfo: updatedInfo,
            updatedAt: FieldValue.serverTimestamp(),
          });
          batchCount++;
          chatsUpdated++;
        }

        if (batchCount >= 499) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) await batch.commit();
    }

    // 3. Update reviewerName / reviewerImage on all reviews written by this user
    let avisUpdated = 0;
    const avisSnap = await db
      .collection('avis')
      .where('reviewerId', '==', uid)
      .get();

    if (!avisSnap.empty) {
      const avisUpdateData: Record<string, any> = {};
      if (nameChanged) avisUpdateData.reviewerName = newName;
      if (imageChanged) avisUpdateData.reviewerImage = newImage;

      let batch = db.batch();
      let batchCount = 0;

      for (const doc of avisSnap.docs) {
        batch.update(doc.ref, avisUpdateData);
        batchCount++;
        avisUpdated++;

        if (batchCount >= 499) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) await batch.commit();
    }

    // 4. (Removed) swapPartyParticipants propagation — the Swap Zone is open to
    //    all with no participant docs anymore.

    // 5. Update swapPartyItems where sellerId == uid
    let swapItemsUpdated = 0;
    const swapItemsSnap = await db
      .collection('swapPartyItems')
      .where('sellerId', '==', uid)
      .get();

    if (!swapItemsSnap.empty) {
      const itemUpdates: Record<string, any> = {};
      if (nameChanged) itemUpdates.sellerName = newName;
      if (imageChanged) itemUpdates.sellerImage = newImage;

      let batch = db.batch();
      let batchCount = 0;

      for (const doc of swapItemsSnap.docs) {
        batch.update(doc.ref, itemUpdates);
        batchCount++;
        swapItemsUpdated++;

        if (batchCount >= 499) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) await batch.commit();
    }

    logger.info('[onUserProfileUpdated] Propagation complete', {
      uid,
      articlesUpdated,
      chatsUpdated,
      avisUpdated,
      swapParticipantsUpdated,
      swapItemsUpdated,
    });
  }
);
