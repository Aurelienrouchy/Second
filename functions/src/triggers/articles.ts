/**
 * Article Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 *
 * Handles search_index cleanup when an article is soft-deleted
 * (isActive transitions from true to false).
 *
 * Note: The embeddings trigger (embeddings.ts) already handles
 * deactivating embeddings when isActive changes. This trigger
 * focuses on the search_index collection.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

/**
 * When an article's isActive changes from true to false (soft-delete),
 * remove its corresponding search_index entry so it no longer appears
 * in search results.
 *
 * When isActive changes from false to true (reactivation), we do NOT
 * recreate the search_index entry here — that is the responsibility of
 * the products.ts trigger on the `products` collection, or a manual
 * reindex.
 */
export const onArticleSoftDeleted = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // Only act when isActive transitions from true to false
    if (before.isActive === true && after.isActive === false) {
      try {
        const siRef = db.collection('search_index').doc(articleId);
        const siSnap = await siRef.get();

        if (siSnap.exists) {
          await siRef.delete();
          logger.info('[onArticleSoftDeleted] Removed search_index entry', { articleId });
        }
      } catch (error) {
        logger.error('[onArticleSoftDeleted] Failed to remove search_index', {
          articleId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }
);

/**
 * When an article is sold (isSold transitions from false to true),
 * expire all pending offers in related chats and notify participants
 * via a system message.
 *
 * This prevents buyers from seeing stale "pending" offers on articles
 * that are no longer available.
 */
export const onArticleSold = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Only fire when isSold changes from false to true
    if (before.isSold === true || after.isSold !== true) return;

    const articleId = event.params.articleId;

    // Find all chats related to this article
    const chatsSnap = await db.collection('chats')
      .where('articleId', '==', articleId)
      .get();

    if (chatsSnap.empty) {
      logger.info('[onArticleSold] No chats found for article', { articleId });
      return;
    }

    const chatIds = chatsSnap.docs.map((d) => d.id);
    let totalExpired = 0;

    // For each chat, find pending offer messages and expire them
    for (const chatId of chatIds) {
      const pendingOffers = await db.collection('messages')
        .where('chatId', '==', chatId)
        .where('type', '==', 'offer')
        .where('offer.status', '==', 'pending')
        .get();

      const batch = db.batch();
      let count = 0;
      for (const msgDoc of pendingOffers.docs) {
        batch.update(msgDoc.ref, {
          'offer.status': 'expired',
        });
        count++;
      }

      if (count > 0) {
        await batch.commit();
        totalExpired += count;

        // Send system message to inform participants
        const chatDoc = await db.collection('chats').doc(chatId).get();
        const participants = chatDoc.exists ? (chatDoc.data()?.participants || []) : [];
        await db.collection('messages').add({
          chatId,
          senderId: 'system',
          receiverId: 'system',
          type: 'system',
          content: 'Cet article a été vendu. Les offres en attente ont été annulées.',
          participants,
          timestamp: FieldValue.serverTimestamp(),
          status: 'sent',
          isRead: true,
        });
      }
    }

    logger.info(`[onArticleSold] Expired ${totalExpired} pending offers across ${chatIds.length} chats for article ${articleId}`);
  }
);
